(function () {
  var s = document.getElementById('slider');
  if (s) {
    var slides = s.querySelectorAll('.slide'),
      dots = s.querySelectorAll('.dots span'),
      i = 0,
      t;
    var go = function (n) {
      slides[i].classList.remove('on');
      if (dots[i]) dots[i].classList.remove('on');
      i = (n + slides.length) % slides.length;
      slides[i].classList.add('on');
      if (dots[i]) dots[i].classList.add('on');
    };
    var auto = function () {
      clearInterval(t);
      t = setInterval(function () {
        go(i + 1);
      }, 6000);
    };
    var p = s.querySelector('.sl-prev'),
      n = s.querySelector('.sl-next');
    if (p)
      p.onclick = function () {
        go(i - 1);
        auto();
      };
    if (n)
      n.onclick = function () {
        go(i + 1);
        auto();
      };
    dots.forEach(function (d, k) {
      d.onclick = function () {
        go(k);
        auto();
      };
    });
    if (slides.length > 1) auto();
  }
  document.querySelectorAll('.faq-q').forEach(function (b) {
    b.addEventListener('click', function () {
      var it = b.parentElement,
        open = it.classList.toggle('open');
      b.querySelector('.plus').textContent = open ? '−' : '+';
    });
  });
  var nt = document.getElementById('navToggle');
  if (nt)
    nt.addEventListener('click', function () {
      document.body.classList.toggle('nav-open');
    });

  // Gece / gündüz modu
  var tt = document.getElementById('themeToggle');
  if (tt)
    tt.addEventListener('click', function () {
      var el = document.documentElement;
      var next = el.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      el.setAttribute('data-theme', next);
      try {
        localStorage.setItem('bionic-theme', next);
      } catch (e) {}
    });
})();

// Bağlantı davranışı: kendi sayfalarımız aynı sekmede açılır; yalnızca FARKLI siteye
// giden dış bağlantılar (ve şablonda target belirtilenler) yeni sekmede açılır.
document.querySelectorAll('a[href]').forEach(a => {
  if (a.hasAttribute('target')) return; // şablonda zaten ayarlanmış (ör. sosyal medya)
  const h = a.getAttribute('href');
  if (!h || h.startsWith('#') || h.startsWith('javascript:') || h.startsWith('tel:') || h.startsWith('mailto:')) return;
  let external = false;
  try {
    external = new URL(h, location.href).origin !== location.origin;
  } catch (e) {}
  if (external) {
    a.target = '_blank';
    a.rel = 'noopener';
  }
});
