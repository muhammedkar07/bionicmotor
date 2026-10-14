// Panel ortak davranışları (inline onclick yerine — katı CSP uyumlu).
// - .pnav-toggle : mobil menüyü açar/kapatır
// - .dd-t        : açılır alt menüyü açar/kapatır
// - [data-close] : verilen id'li öğeyi gizler (modal kapat)
// - form[data-confirm] : gönderimden önce onay ister
(function () {
  document.addEventListener('click', function (e) {
    var t = e.target;

    var nav = t.closest && t.closest('.pnav-toggle');
    if (nav) { var p = document.querySelector('.pnav'); if (p) p.classList.toggle('open'); return; }

    var dd = t.closest && t.closest('.dd-t');
    if (dd) { e.preventDefault(); var li = dd.closest('.dd'); if (li) li.classList.toggle('open'); return; }

    var cl = t.closest && t.closest('[data-close]');
    if (cl) { var el = document.getElementById(cl.getAttribute('data-close')); if (el) el.hidden = true; return; }
  }, true);

  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f && f.matches && f.matches('form[data-confirm]') && !window.confirm(f.getAttribute('data-confirm'))) {
      e.preventDefault();
    }
  }, true);
})();
