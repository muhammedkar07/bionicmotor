const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { db, logAudit, STATUS } = require('../db');
const { flash, throttle, publicOrigin } = require('../lib/core');
const { clean } = require('../lib/sanitize');
const { UPLOAD_DIR } = require('../lib/upload');
const seo = require('../lib/seo');

// "dijital-katalog" sayfasına PDF yüklenmişse doğrudan indirir. İndirildiyse true döner.
function sendCatalog(res, p) {
  if (!p || !p.catalog_pdf) return false;
  const full = path.join(UPLOAD_DIR, path.basename(String(p.catalog_pdf)));
  if (!fs.existsSync(full)) return false;
  res.download(full, 'bionic-katalog.pdf');
  return true;
}

const clip = (v, n) =>
  String(v || '')
    .trim()
    .slice(0, n);
const render = (res, view, title, active, extra = {}) => res.render(view, { title, active, ...extra });

const xmlEsc = s =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// Model kayıtlarına SEO adresi (slug) ekler: /model/22/bm-50-klasik
const withPath = rows => rows.map(r => ({ ...r, path: seo.modelPath(r) }));

// Aktif modellerden kategori listesi (slug + etiket + adet)
function categories() {
  const rows = db
    .prepare(
      "SELECT category, COUNT(*) AS n FROM models WHERE active=1 AND category IS NOT NULL AND TRIM(category) <> '' GROUP BY category ORDER BY n DESC, category"
    )
    .all();
  return rows.map(r => ({
    category: r.category,
    slug: seo.slugify(r.category),
    label: seo.categoryLabel(r.category),
    count: r.n,
    path: seo.categoryPath(r.category)
  }));
}

// Arama motorları: robots.txt + sitemap.xml
router.get('/robots.txt', (req, res) => {
  res
    .type('text/plain')
    .send(
      'User-agent: *\nAllow: /\n' +
        'Disallow: /admin\nDisallow: /bayi\nDisallow: /servis\nDisallow: /odeme\nDisallow: /sifre\n' +
        'Sitemap: ' +
        publicOrigin(req) +
        '/sitemap.xml\n'
    );
});

router.get('/sitemap.xml', (req, res) => {
  const origin = publicOrigin(req);
  const entries = [];
  const add = (p, priority, freq, lastmod) => entries.push({ loc: origin + p, priority, freq, lastmod });

  add('/', '1.0', 'daily');
  add('/modeller', '0.9', 'weekly');
  for (const c of categories()) add(c.path, '0.8', 'weekly');
  for (const m of db.prepare('SELECT id, name FROM models WHERE active=1 ORDER BY sort, id').all()) add(seo.modelPath(m), '0.8', 'weekly');
  add('/satis-ve-servis', '0.7', 'weekly');
  add('/destek', '0.7', 'monthly');
  add('/iletisim', '0.6', 'monthly');
  add('/bayilik-basvurusu', '0.6', 'monthly');
  add('/medya', '0.5', 'monthly');
  for (const p of db.prepare('SELECT slug, updated_at FROM pages').all()) add('/sayfa/' + p.slug, '0.5', 'monthly', p.updated_at);

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries
      .map(
        e =>
          '  <url><loc>' +
          xmlEsc(e.loc) +
          '</loc>' +
          (e.lastmod ? '<lastmod>' + xmlEsc(String(e.lastmod).slice(0, 10)) + '</lastmod>' : '') +
          '<changefreq>' +
          e.freq +
          '</changefreq><priority>' +
          e.priority +
          '</priority></url>'
      )
      .join('\n') +
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
  // Satış noktası sayısı /satis-ve-servis sayfasındaki kayıtlardan gelir (sabit değil).
  const pointCount = db.prepare('SELECT COUNT(*) n FROM points WHERE active=1').get().n;
  // Online ödeme sonrası ana sayfaya dönüşte dekont bağlantısı (yalnızca ödemenin sahibi görür)
  const odemeId = +req.query.odeme || 0;
  let receipt = null;
  if (odemeId && req.session && req.session.pay) {
    const p = db.prepare('SELECT id, user_id, amount_tl, status FROM payments WHERE id=?').get(odemeId);
    if (p && p.user_id === req.session.pay.userId && p.status === STATUS.COLLECTED) receipt = p;
  }
  render(res, 'site/home', 'Ana Sayfa', 'home', {
    slides,
    models: withPath(models),
    campaigns,
    pointCount,
    receipt,
    seo: {
      ...seo.homeSeo(res.locals.s),
      jsonld: [
        seo.websiteJson(res.locals.s, res.locals.origin),
        seo.dealerJson(res.locals.s, res.locals.origin, res.locals.origin + (res.locals.s.logo_image || '/static/img/bionic-logo.png'))
      ]
    }
  });
});

router.get('/modeller', (req, res) => {
  const rows = db.prepare('SELECT * FROM models WHERE active=1 ORDER BY sort,id').all();
  const origin = res.locals.origin;
  const s = res.locals.s;
  render(res, 'site/models', 'Modeller', 'models', {
    models: withPath(rows),
    heading: 'Motosiklet ve Elektrikli Scooter Modelleri',
    intro:
      seo.siteName(s) +
      ' model ailesi: elektrikli scooter, tricycle, 50 cc ve touring motosikletler. Teknik özellikleri inceleyin, size en yakın yetkili satış noktasından fiyat bilgisi alın.',
    cats: categories(),
    activeCat: null,
    seo: {
      ...seo.modelsSeo(s),
      jsonld: [
        seo.breadcrumbJson([
          { name: 'Ana Sayfa', url: origin + '/' },
          { name: 'Modeller', url: origin + '/modeller' }
        ]),
        seo.itemListJson(rows, origin, 'Motosiklet modelleri')
      ]
    }
  });
});

// Kategori sayfaları: /modeller/e-scoter, /modeller/e-tricycle, /modeller/elektrikli, /modeller/touring
router.get('/modeller/:cat', (req, res, next) => {
  const cats = categories();
  const hit = cats.find(c => c.slug === req.params.cat);
  if (!hit) return next();
  const rows = db.prepare('SELECT * FROM models WHERE active=1 AND category=? ORDER BY sort,id').all(hit.category);
  const origin = res.locals.origin;
  const s = res.locals.s;
  const names = rows.slice(0, 3).map(m => m.name);
  render(res, 'site/models', hit.label + ' Modelleri', 'models', {
    models: withPath(rows),
    heading: hit.label + ' Modelleri',
    intro:
      seo.siteName(s) +
      ' ' +
      hit.label +
      ' modelleri' +
      (names.length ? ' (' + names.join(', ') + (rows.length > 3 ? ' ve diğerleri' : '') + ')' : '') +
      '. Teknik özellikler, fiyat bilgisi ve yetkili satış noktaları aşağıda.',
    cats,
    activeCat: hit.slug,
    seo: {
      ...seo.categorySeo(hit.category, rows, s),
      jsonld: [
        seo.breadcrumbJson([
          { name: 'Ana Sayfa', url: origin + '/' },
          { name: 'Modeller', url: origin + '/modeller' },
          { name: hit.label, url: origin + hit.path }
        ]),
        seo.itemListJson(rows, origin, hit.label + ' modelleri')
      ]
    }
  });
});

router.get('/model/:id/:slug?', (req, res, next) => {
  const id = Number(String(req.params.id).match(/^\d+/));
  const m = id ? db.prepare('SELECT * FROM models WHERE id=? AND active=1').get(id) : null;
  if (!m) return next();
  // Kanonik (slug'lı) adres: /model/22/bm-50-klasik — eski/kısa adresler 301 ile taşınır.
  const path = seo.modelPath(m);
  if (String(req.params.slug || '') !== path.split('/').pop()) return res.redirect(301, path);

  const origin = res.locals.origin;
  const s = res.locals.s;
  const logo = origin + (s.logo_image || '/static/img/bionic-logo.png');
  const related = withPath(
    db.prepare('SELECT * FROM models WHERE active=1 AND id<>? AND category IS ? ORDER BY sort,id LIMIT 3').all(m.id, m.category || '')
  );
  const crumbs = [
    { name: 'Ana Sayfa', url: origin + '/' },
    { name: 'Modeller', url: origin + '/modeller' },
    ...(m.category ? [{ name: seo.categoryLabel(m.category), url: origin + seo.categoryPath(m.category) }] : []),
    { name: m.name, url: origin + path }
  ];
  render(res, 'site/model', m.name, 'models', {
    m: { ...m, path },
    related,
    catPath: m.category ? seo.categoryPath(m.category) : null,
    catLabel: m.category ? seo.categoryLabel(m.category) : null,
    seo: {
      ...seo.modelSeo(m, s),
      ogType: 'product',
      image: m.image ? origin + m.image : undefined,
      imageAlt: m.name + ' – ' + seo.categoryLabel(m.category),
      canonical: origin + path,
      jsonld: [seo.productJson(m, s, origin, logo), seo.breadcrumbJson(crumbs)]
    }
  });
});

router.get('/satis-ve-servis', (req, res) => {
  const points = db.prepare('SELECT * FROM points WHERE active=1 ORDER BY city,name').all();
  const cities = [...new Set(points.map(p => (p.city || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  const origin = res.locals.origin;
  render(res, 'site/points', 'Satış ve Servis', 'points', {
    points,
    cities,
    seo: {
      ...seo.staticSeo('points', res.locals.s),
      jsonld: [
        seo.breadcrumbJson([
          { name: 'Ana Sayfa', url: origin + '/' },
          { name: 'Satış ve Servis', url: origin + '/satis-ve-servis' }
        ])
      ]
    }
  });
});

router.get('/destek', (req, res) => {
  const faqs = db.prepare('SELECT * FROM faqs WHERE active=1 ORDER BY sort,id').all();
  const origin = res.locals.origin;
  render(res, 'site/support', 'Destek', 'support', {
    faqs,
    seo: {
      ...seo.staticSeo('support', res.locals.s),
      jsonld: [
        seo.breadcrumbJson([
          { name: 'Ana Sayfa', url: origin + '/' },
          { name: 'Destek', url: origin + '/destek' }
        ]),
        ...(faqs.length ? [seo.faqJson(faqs)] : [])
      ]
    }
  });
});

router.get('/iletisim', (req, res) =>
  res.render('site/contact', {
    title: 'İletişim',
    active: 'contact',
    seo: {
      ...seo.staticSeo('contact', res.locals.s),
      jsonld: [
        seo.dealerJson(res.locals.s, res.locals.origin, res.locals.origin + (res.locals.s.logo_image || '/static/img/bionic-logo.png')),
        seo.breadcrumbJson([
          { name: 'Ana Sayfa', url: res.locals.origin + '/' },
          { name: 'İletişim', url: res.locals.origin + '/iletisim' }
        ])
      ]
    }
  })
);
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
  if (!b.kvkk) {
    flash(req, 'danger', 'Lütfen KVKK Aydınlatma Metni’ni okuyup onaylayın.');
    return res.redirect('/iletisim');
  }
  db.prepare('INSERT INTO messages(name,email,phone,message) VALUES(?,?,?,?)').run(name, email, clip(b.phone, 40), msg);
  logAudit({ type: 'ziyaretci', name }, 'create', 'messages', null, { email, pazarlama: b.marketing ? 1 : 0 }, req.ip);
  t.hit();
  flash(req, 'success', 'Mesajınız alındı. En kısa sürede dönüş yapılacaktır.');
  res.redirect('/iletisim');
});

router.get('/bayilik-basvurusu', (req, res) =>
  render(res, 'site/apply', 'Bayilik Başvurusu', '', {
    seo: {
      ...seo.staticSeo('apply', res.locals.s),
      jsonld: [
        seo.breadcrumbJson([
          { name: 'Ana Sayfa', url: res.locals.origin + '/' },
          { name: 'Bayilik Başvurusu', url: res.locals.origin + '/bayilik-basvurusu' }
        ])
      ]
    }
  })
);
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
  if (!b.kvkk) {
    flash(req, 'danger', 'Lütfen KVKK Aydınlatma Metni’ni okuyup onaylayın.');
    return res.redirect('/bayilik-basvurusu');
  }
  db.prepare('INSERT INTO applications(name,city,district,phone,note) VALUES(?,?,?,?,?)').run(
    name,
    clip(b.city, 60),
    clip(b.district, 60),
    phone,
    clip(b.note, 2000)
  );
  logAudit(
    { type: 'ziyaretci', name },
    'create',
    'applications',
    null,
    { city: clip(b.city, 60), phone, pazarlama: b.marketing ? 1 : 0 },
    req.ip
  );
  t.hit();
  flash(req, 'success', 'Başvurunuz alındı. Sizinle iletişime geçeceğiz.');
  res.redirect('/bayilik-basvurusu');
});

router.get('/sayfa/:slug', (req, res, next) => {
  const p = db.prepare('SELECT * FROM pages WHERE slug=?').get(req.params.slug);
  if (!p) return next();
  // Dijital katalog: PDF yüklüyse sayfa yerine doğrudan indir.
  if (p.slug === 'dijital-katalog' && sendCatalog(res, p)) return;
  render(res, 'site/page', p.title, p.slug, {
    page: { ...p, body: clean(p.body) },
    seo: {
      ...seo.pageSeo(p, res.locals.s),
      jsonld: [
        seo.pageJson(p, res.locals.s, res.locals.origin),
        seo.breadcrumbJson([
          { name: 'Ana Sayfa', url: res.locals.origin + '/' },
          { name: p.title, url: res.locals.origin + '/sayfa/' + p.slug }
        ])
      ]
    }
  });
});
router.get('/kurumsal', (req, res) => res.redirect('/sayfa/kurumsal'));
router.get('/dijital-katalog', (req, res) => {
  const p = db.prepare('SELECT * FROM pages WHERE slug=?').get('dijital-katalog');
  if (sendCatalog(res, p)) return;
  res.redirect('/sayfa/dijital-katalog');
});
router.get('/medya', (req, res) => {
  const models = db
    .prepare("SELECT name, category, image FROM models WHERE active=1 AND image IS NOT NULL AND image<>'' ORDER BY sort,id")
    .all();
  render(res, 'site/media', 'Medya', 'media', {
    models,
    seo: {
      ...seo.staticSeo('media', res.locals.s),
      jsonld: [
        seo.breadcrumbJson([
          { name: 'Ana Sayfa', url: res.locals.origin + '/' },
          { name: 'Medya', url: res.locals.origin + '/medya' }
        ])
      ]
    }
  });
});

module.exports = router;
