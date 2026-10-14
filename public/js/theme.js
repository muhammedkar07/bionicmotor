// Tema (açık/koyu) tercihini ilk boyamadan önce uygular; sayfa yenilenince korunur.
(function () {
  try {
    var t = localStorage.getItem('bionic-theme');
    if (t !== 'dark' && t !== 'light') {
      t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
