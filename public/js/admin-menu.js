// Yönetim paneli sol menüsünde sürükle-bırak ile sıralama (yalnızca süper yönetici).
// Sıra değişince /admin/menu-sirala ucuna kaydedilir.
(function () {
  const nav = document.querySelector('nav[data-menu-drag]');
  if (!nav) return;
  const csrfEl = document.querySelector('input[name="_csrf"]');
  const CSRF = csrfEl ? csrfEl.value : '';

  let dragged = null;      // taşınan öğe (.mgroup veya <a>)
  let draggedType = null;  // 'group' | 'item'
  let didDrag = false;

  const groupEls = () => Array.from(nav.querySelectorAll('.mgroup'));
  const clearDrop = () => nav.querySelectorAll('.drop-on').forEach(el => el.classList.remove('drop-on'));

  nav.addEventListener('dragstart', e => {
    const grp = e.target.closest('.mgroup > .grp[draggable="true"]');
    const item = e.target.closest('a[data-key][draggable="true"]');
    if (grp) { dragged = grp.closest('.mgroup'); draggedType = 'group'; }
    else if (item) { dragged = item; draggedType = 'item'; }
    else return;
    didDrag = true;
    dragged.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', 'm'); } catch (_) {}
  });

  nav.addEventListener('dragend', () => {
    if (dragged) dragged.classList.remove('dragging');
    dragged = null; draggedType = null;
    clearDrop();
    setTimeout(() => { didDrag = false; }, 60);
  });

  nav.addEventListener('dragover', e => {
    if (!dragged) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDrop();
    const target = e.target.closest('.mgroup');
    if (target && target !== dragged) target.classList.add('drop-on');
  });

  nav.addEventListener('drop', e => {
    if (!dragged) return;
    e.preventDefault();
    const targetGroup = e.target.closest('.mgroup');
    if (!targetGroup) return;

    if (draggedType === 'group') {
      if (targetGroup === dragged) return;
      const box = targetGroup.getBoundingClientRect();
      const after = (e.clientY - box.top) > box.height / 2;
      targetGroup.parentNode.insertBefore(dragged, after ? targetGroup.nextSibling : targetGroup);
    } else {
      const anchor = e.target.closest('a[data-key]');
      if (anchor && anchor !== dragged && anchor.parentNode === targetGroup) {
        const box = anchor.getBoundingClientRect();
        const after = (e.clientY - box.top) > box.height / 2;
        targetGroup.insertBefore(dragged, after ? anchor.nextSibling : anchor);
      } else {
        const items = targetGroup.querySelectorAll('a[data-key]');
        const last = items[items.length - 1];
        if (last && last !== dragged) last.parentNode.insertBefore(dragged, last.nextSibling);
        else targetGroup.appendChild(dragged);
      }
    }
    clearDrop();
    save();
  });

  // Sürükleme sonrası kazara linke tıklanmasını engelle.
  nav.addEventListener('click', e => {
    if (didDrag && e.target.closest('a[data-key]')) e.preventDefault();
  }, true);

  let toast;
  function showToast(msg, ok) {
    if (!toast) { toast = document.createElement('div'); toast.className = 'menu-toast'; document.body.appendChild(toast); }
    toast.textContent = msg;
    toast.style.background = ok ? '#1f7a3f' : '#b42318';
    toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function payload() {
    return { groups: groupEls().map(g => ({ group: g.dataset.group, keys: Array.from(g.querySelectorAll('a[data-key]')).map(a => a.dataset.key) })) };
  }

  function save() {
    const body = new URLSearchParams({ _csrf: CSRF, data: JSON.stringify(payload()) });
    fetch('/admin/menu-sirala', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, credentials: 'same-origin' })
      .then(r => r.json())
      .then(j => showToast(j && j.ok ? 'Menü sırası kaydedildi' : 'Kaydedilemedi', !!(j && j.ok)))
      .catch(() => showToast('Kaydedilemedi', false));
  }
})();
