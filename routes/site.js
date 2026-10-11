const router = require('express').Router();
const { db } = require('../db');
const { flash } = require('../lib/core');

const clip = (v, n) => String(v || '').trim().slice(0, n);
const render = (res, view, title, active, extra = {}) => res.render(view, { title, active, ...extra });

router.get('/', (req, res) => {
  const slides = db.prepare('SELECT * FROM slides WHERE active=1 ORDER BY sort,id').all();
  const models = db.prepare('SELECT * FROM models WHERE active=1 ORDER BY sort,id LIMIT 6').all();
  render(res, 'site/home', 'Ana Sayfa', 'home', { slides, models });
});

router.get('/modeller', (req, res) => {
  const models = db.prepare('SELECT * FROM models WHERE active=1 ORDER BY sort,id').all();
  render(res, 'site/models', 'Modeller', 'models', { models });
});

router.get('/satis-ve-servis', (req, res) => {
  const points = db.prepare('SELECT * FROM points WHERE active=1 ORDER BY city,name').all();
  render(res, 'site/points', 'Satış ve Servis', 'points', { points });
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
  const b = req.body;
  const name = clip(b.name, 120), email = clip(b.email, 160), msg = clip(b.message, 3000);
  if (!name || !msg || !/^\S+@\S+\.\S+$/.test(email)) {
    flash(req, 'danger', 'Lütfen ad soyad, geçerli e-posta ve mesaj alanlarını doldurun.');
    return res.redirect('/iletisim');
  }
  db.prepare('INSERT INTO messages(name,email,phone,message) VALUES(?,?,?,?)').run(name, email, clip(b.phone, 40), msg);
  flash(req, 'success', 'Mesajınız alındı. En kısa sürede dönüş yapılacaktır.');
  res.redirect('/iletisim');
});

router.get('/bayilik-basvurusu', (req, res) => render(res, 'site/apply', 'Bayilik Başvurusu', ''));
router.post('/bayilik-basvurusu', (req, res) => {
  const b = req.body;
  const name = clip(b.name, 120), phone = clip(b.phone, 40);
  if (!name || !clip(b.city, 60) || phone.replace(/\D/g, '').length < 10) {
    flash(req, 'danger', 'Ad soyad, il ve geçerli bir telefon numarası zorunludur.');
    return res.redirect('/bayilik-basvurusu');
  }
  db.prepare('INSERT INTO applications(name,city,district,phone,note) VALUES(?,?,?,?,?)')
    .run(name, clip(b.city, 60), clip(b.district, 60), phone, clip(b.note, 2000));
  flash(req, 'success', 'Başvurunuz alındı. Sizinle iletişime geçeceğiz.');
  res.redirect('/bayilik-basvurusu');
});

router.get('/sayfa/:slug', (req, res, next) => {
  const p = db.prepare('SELECT * FROM pages WHERE slug=?').get(req.params.slug);
  if (!p) return next();
  render(res, 'site/page', p.title, p.slug, { page: p });
});
router.get('/kurumsal', (req, res) => res.redirect('/sayfa/kurumsal'));
router.get('/dijital-katalog', (req, res) => res.redirect('/sayfa/dijital-katalog'));
router.get('/medya', (req, res) => res.redirect('/sayfa/medya'));

module.exports = router;
