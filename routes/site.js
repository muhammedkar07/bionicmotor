const router = require('express').Router();
const { db, logAudit } = require('../db');
const { flash, throttle, publicOrigin } = require('../lib/core');
const { clean } = require('../lib/sanitize');

const clip = (v, n) =>
  String(v || '')
    .trim()
    .slice(0, n);
const render = (res, view, title, active, extra = {}) => res.render(view, { title, active, ...extra });

// Arama motorları: robots.txt + sitemap.xml
router.get('/robots.txt', (req, res) => {
  res
    .type('text/plain')
    .send(
      'User-agent: *\nAllow: /\n' +
        'Disallow: /admin\nDisallow: /bayi\nDisallow: /servis\nDisallow: /odeme\n' +
        'Sitemap: ' +
        publicOrigin(req) +
        '/sitemap.xml\n'
    );
});

router.get('/sitemap.xml', (req, res) => {
  const origin = publicOrigin(req);
  const staticPaths = ['/', '/modeller', '/satis-ve-servis', '/destek', '/iletisim', '/bayilik-basvurusu', '/perakende-fiyat-listesi'];
  const pages = db
    .prepare('SELECT slug FROM pages')
    .all()
    .map(p => '/sayfa/' + p.slug);
  const urls = staticPaths.concat(pages);
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => '  <url><loc>' + origin + u + '</loc></url>').join('\n') +
    '\n</urlset>';
  res.type('application/xml').send(xml);
});

router.get('/', (req, res) => {
  const slides = db.prepare('SELECT * FROM slides WHERE active=1 ORDER BY sort,id').all();
  const campaigns = db
    .prepare(
      "SELECT * FROM campaigns WHERE active=1 AND (start_date IS NULL OR start_date='' OR start_date<=date('now')) AND (end_date IS NULL OR end_date='' OR end_date>=date('now')) ORDER BY sort,id"
    )
    .all();
  const models = db.prepare('SELECT * FROM models WHERE active=1 ORDER BY sort,id LIMIT 6').all();
  render(res, 'site/home', 'Ana Sayfa', 'home', { slides, models, campaigns });
});

router.get('/modeller', (req, res) => {
  const models = db.prepare('SELECT * FROM models WHERE active=1 ORDER BY sort,id').all();
  render(res, 'site/models', 'Modeller', 'models', { models });
});

router.get('/satis-ve-servis', (req, res) => {
  const points = db.prepare('SELECT * FROM points WHERE active=1 ORDER BY city,name').all();
  const cities = [...new Set(points.map(p => (p.city || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  render(res, 'site/points', 'Satış ve Servis', 'points', { points, cities });
});

router.get('/destek', (req, res) => {
  const faqs = db.prepare('SELECT * FROM faqs WHERE active=1 ORDER BY sort,id').all();
  render(res, 'site/support', 'Destek', 'support', { faqs });
});

router.get('/perakende-fiyat-listesi', (req, res) => {
  const models = db.prepare('SELECT * FROM models WHERE active=1 AND price>0 ORDER BY sort,id').all();
  render(res, 'site/retail', 'Perakende Fiyat Listesi', 'retail', { models });
});

router.get('/iletisim', (req, res) => render(res, 'site/contact', 'İletişim', 'contact'));
router.post('/iletisim', (req, res) => {
  const t = throttle('site:contact:' + req.ip, 10, 60 * 1000);
  if (t.blocked) {
    flash(req, 'danger', 'Çok fazla gönderim. Daha sonra tekrar deneyin.');
    return res.redirect('/iletisim');
  }
  const b = req.body;
  const name = clip(b.name, 120),
    email = clip(b.email, 160),
    msg = clip(b.message, 3000);
  if (!name || !msg || !/^\S+@\S+\.\S+$/.test(email)) {
    flash(req, 'danger', 'Lütfen ad soyad, geçerli e-posta ve mesaj alanlarını doldurun.');
    return res.redirect('/iletisim');
  }
  db.prepare('INSERT INTO messages(name,email,phone,message) VALUES(?,?,?,?)').run(name, email, clip(b.phone, 40), msg);
  logAudit({ type: 'ziyaretci', name }, 'create', 'messages', null, { email }, req.ip);
  t.hit();
  flash(req, 'success', 'Mesajınız alındı. En kısa sürede dönüş yapılacaktır.');
  res.redirect('/iletisim');
});

router.get('/bayilik-basvurusu', (req, res) => render(res, 'site/apply', 'Bayilik Başvurusu', ''));
router.post('/bayilik-basvurusu', (req, res) => {
  const t = throttle('site:apply:' + req.ip, 6, 60 * 1000);
  if (t.blocked) {
    flash(req, 'danger', 'Çok fazla başvuru. Daha sonra tekrar deneyin.');
    return res.redirect('/bayilik-basvurusu');
  }
  const b = req.body;
  const name = clip(b.name, 120),
    phone = clip(b.phone, 40);
  if (!name || !clip(b.city, 60) || phone.replace(/\D/g, '').length < 10) {
    flash(req, 'danger', 'Ad soyad, il ve geçerli bir telefon numarası zorunludur.');
    return res.redirect('/bayilik-basvurusu');
  }
  db.prepare('INSERT INTO applications(name,city,district,phone,note) VALUES(?,?,?,?,?)').run(
    name,
    clip(b.city, 60),
    clip(b.district, 60),
    phone,
    clip(b.note, 2000)
  );
  logAudit({ type: 'ziyaretci', name }, 'create', 'applications', null, { city: clip(b.city, 60), phone }, req.ip);
  t.hit();
  flash(req, 'success', 'Başvurunuz alındı. Sizinle iletişime geçeceğiz.');
  res.redirect('/bayilik-basvurusu');
});

router.get('/sayfa/:slug', (req, res, next) => {
  const p = db.prepare('SELECT * FROM pages WHERE slug=?').get(req.params.slug);
  if (!p) return next();
  render(res, 'site/page', p.title, p.slug, { page: { ...p, body: clean(p.body) } });
});
router.get('/kurumsal', (req, res) => res.redirect('/sayfa/kurumsal'));
router.get('/dijital-katalog', (req, res) => res.redirect('/sayfa/dijital-katalog'));
router.get('/medya', (req, res) => res.redirect('/sayfa/medya'));

module.exports = router;
