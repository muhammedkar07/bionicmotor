// Yönetim paneli sol menüsünde sürükle-bırak ile sıralama (yalnızca süper yönetici).
// Menü kategorisiz tek düz listedir; sıra değişince /admin/menu-sirala ucuna kaydedilir.
(function () {
  const nav = document.querySelector('nav[data-menu-drag]');
  if (!nav) return;
  const csrfEl = document.querySelector('input[name="_csrf"]');
  const CSRF = csrfEl ? csrfEl.value : '';

  let dragged = null;
  let didDrag = false;
  const items = () => Array.from(nav.querySelectorAll('a[data-menu-id]'));

  function afterElement(y) {
    const els = items().filter(el => el !== dragged);
    let closest = { offset: -Infinity, el: null };
    for (const el of els) {
      const box = el.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) closest = { offset, el };
    }
    return closest.el;
  }

  nav.addEventListener('dragstart', e => {
    const it = e.target.closest('a[data-menu-id][draggable="true"]');
    if (!it) return;
    dragged = it;
    didDrag = true;
    it.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', 'm');
    } catch (_) {}
  });

  nav.addEventListener('dragend', () => {
    if (dragged) dragged.classList.remove('dragging');
    dragged = null;
    nav.querySelectorAll('.drop-on').forEach(el => el.classList.remove('drop-on'));
    setTimeout(() => {
      didDrag = false;
    }, 60);
  });

  nav.addEventListener('dragover', e => {
    if (!dragged) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.target.closest('a[data-menu-id]');
    nav.querySelectorAll('.drop-on').forEach(el => el.classList.remove('drop-on'));
    if (target && target !== dragged) target.classList.add('drop-on');
  });

  nav.addEventListener('drop', e => {
    if (!dragged) return;
    e.preventDefault();
    const after = afterElement(e.clientY);
    if (after) after.parentNode.insertBefore(dragged, after);
    else nav.appendChild(dragged);
    nav.querySelectorAll('.drop-on').forEach(el => el.classList.remove('drop-on'));
    save();
  });

  // Sürükleme sonrası kazara linke tıklanmasını engelle.
  nav.addEventListener(
    'click',
    e => {
      if (didDrag && e.target.closest('a[data-menu-id]')) e.preventDefault();
    },
    true
  );

  let toast;
  function showToast(msg, ok) {
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'menu-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.background = ok ? '#1f7a3f' : '#b42318';
    toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function save() {
    const body = new URLSearchParams({ _csrf: CSRF, data: JSON.stringify({ order: items().map(a => a.dataset.menuId) }) });
    fetch((window.__BASE__ || '') + '/admin/menu-sirala', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      credentials: 'same-origin'
    })
      .then(r => r.json())
      .then(j => showToast(j && j.ok ? 'Menü sırası kaydedildi' : 'Kaydedilemedi', !!(j && j.ok)))
      .catch(() => showToast('Kaydedilemedi', false));
  }
})();
