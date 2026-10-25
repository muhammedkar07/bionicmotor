'use strict';
// SEO testleri: başlık/açıklama tekilliği, canonical, slug yönlendirmesi, sitemap/robots,
// JSON-LD (Product / Breadcrumb / FAQ / WebSite / MotorcycleDealer) ve noindex kuralları.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bionic-seo-'));
process.env.DATA_DIR = TMP;
process.env.UPLOAD_DIR = path.join(TMP, 'uploads');
process.env.ADMIN_PASSWORD = 'TestAdmin1234!xy';
process.env.SEED_DEMO = '0';
process.env.NODE_ENV = 'test';

const app = require('../server');
const { db, set } = require('../db');
const seo = require('../lib/seo');

let server, base;
let modelA, modelB, modelOff, catB;

test.before(async () => {
  set('brand_1', 'BIONIC');
  set('brand_2', 'MOTOR');
  set('company', 'TEST MOTOR LTD.');
  set('phone', '0555 111 22 33');
  set('email', 'info@test.local');
  set('address', 'Merkez Mah. 1. Sokak No:1 Akdeniz / MERSİN');
  set('map_lat', '36.8');
  set('map_lng', '34.63');
  set('branch', 'MERKEZ');

  modelA = Number(
    db
      .prepare('INSERT INTO models(name,category,cc,power,gearbox,description,price,sort,active) VALUES(?,?,?,?,?,?,?,?,1)')
      .run('BM 50 KLASIK', 'TOURING', '80 km/s', '50 cc', 'OTOMATİK', 'Şehir içi kullanım için 50 cc sınıfı klasik motosiklet.', 1234500, 1)
      .lastInsertRowid
  );
  modelB = Number(
    db
      .prepare('INSERT INTO models(name,category,cc,power,description,price,sort,active) VALUES(?,?,?,?,?,?,?,1)')
      .run('SR 1', 'E-Scoter', '25 km/s', '250W', 'Hafif ve ekonomik elektrikli scooter.', 0, 2).lastInsertRowid
  );
  modelOff = Number(
    db
      .prepare('INSERT INTO models(name,category,description,active) VALUES(?,?,?,0)')
      .run('PASIF MODEL', 'E-Scoter', 'Yayında olmayan model.').lastInsertRowid
  );
  db.prepare('INSERT INTO faqs(question,answer,sort,active) VALUES(?,?,?,1)').run('Garanti süresi ne kadar?', '2 yıl garantilidir.', 1);
  catB = seo.categoryPath('E-Scoter');

  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => {
  server && server.close();
});

async function page(url) {
  const res = await fetch(base + url, { redirect: 'manual' });
  const html = await res.text();
  return { status: res.status, html, location: res.headers.get('location') };
}
const jsonLd = html => {
  const out = [];
  const re = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      /* yok say */
    }
  }
  return out;
};
const types = html => jsonLd(html).map(j => j['@type']);
const titleOf = html => (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
const descOf = html => (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
const canonicalOf = html => (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1] || '';
const h1s = html => (html.match(/<h1[\s>]/g) || []).length;

test('robots.txt: paneller kapalı, sitemap bildirilmiş', async () => {
  const r = await page('/robots.txt');
  assert.strictEqual(r.status, 200);
  assert.ok(/Disallow: \/admin/.test(r.html));
  assert.ok(/Disallow: \/sifre/.test(r.html));
  assert.ok(/Sitemap: http:\/\/127\.0\.0\.1:\d+\/sitemap\.xml/.test(r.html));
});

test('sitemap.xml: model (slug) ve kategori adreslerini içerir', async () => {
  const r = await page('/sitemap.xml');
  assert.strictEqual(r.status, 200);
  assert.ok(r.html.includes('/model/' + modelA + '/' + seo.slugify('BM 50 KLASIK')), 'model adresi sitemap’te olmalı');
  assert.ok(r.html.includes(catB), 'kategori adresi sitemap’te olmalı');
  assert.ok(r.html.includes('/sayfa/'), 'statik sayfalar sitemap’te olmalı');
  assert.ok(!r.html.includes('/model/' + modelOff), 'pasif model sitemap’te olmamalı');
});

test('ana sayfa: tek H1, benzersiz başlık/açıklama, canonical, WebSite + MotorcycleDealer', async () => {
  const r = await page('/');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(h1s(r.html), 1, 'ana sayfada tek H1 olmalı');
  assert.ok(/BIONIC\s*MOTOR/i.test(titleOf(r.html)), 'başlıkta marka olmalı');
  assert.ok(/Elektrikli Motosiklet/i.test(titleOf(r.html)), 'başlıkta ana anahtar kelime olmalı');
  assert.ok(descOf(r.html).length >= 100, 'açıklama yeterince uzun olmalı');
  assert.strictEqual(canonicalOf(r.html), base + '/');
  const t = types(r.html);
  assert.ok(t.includes('Organization'), 'Organization yapısal verisi olmalı');
  assert.ok(t.includes('WebSite'));
  assert.ok(t.includes('MotorcycleDealer'));
  const dealer = jsonLd(r.html).find(j => j['@type'] === 'MotorcycleDealer');
  assert.ok(dealer.geo && dealer.geo.latitude, 'konum bilgisi olmalı');
  assert.ok(dealer.address && dealer.address.addressLocality, 'adres/şehir olmalı');
});

test('modeller sayfası: H1 + kategori bağlantıları + ItemList', async () => {
  const r = await page('/modeller');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(h1s(r.html), 1);
  assert.ok(/<h1[^>]*>Motosiklet ve Elektrikli Scooter Modelleri/.test(r.html), 'H1 anahtar kelime içermeli');
  assert.ok(r.html.includes(catB), 'kategori bağlantısı olmalı');
  assert.ok(r.html.includes('/model/' + modelA + '/' + seo.slugify('BM 50 KLASIK')), 'kartlar slug’lı adrese gitmeli');
  assert.ok(types(r.html).includes('ItemList'));
  assert.ok(types(r.html).includes('BreadcrumbList'));
});

test('kategori sayfası: sadece o kategorinin modelleri, kendi başlığı', async () => {
  const r = await page(catB);
  assert.strictEqual(r.status, 200);
  assert.ok(/Elektrikli Scooter Modelleri/.test(titleOf(r.html)), 'kategori başlığı başlık etiketinde olmalı');
  assert.ok(r.html.includes('SR 1'));
  assert.ok(!r.html.includes('BM 50 KLASIK'), 'diğer kategori listelenmemeli');
  const unknown = await page('/modeller/boyle-bir-kategori-yok');
  assert.strictEqual(unknown.status, 404);
});

test('model: eski adres 301 ile slug’lı adrese taşınır', async () => {
  const r = await page('/model/' + modelA);
  assert.strictEqual(r.status, 301);
  assert.strictEqual(r.location, '/model/' + modelA + '/' + seo.slugify('BM 50 KLASIK'));
  const wrong = await page('/model/' + modelA + '/yanlis-slug');
  assert.strictEqual(wrong.status, 301);
  assert.strictEqual(wrong.location, '/model/' + modelA + '/' + seo.slugify('BM 50 KLASIK'));
});

test('model sayfası: Product + Breadcrumb, kanonik adres, fiyat (TL)', async () => {
  const url = '/model/' + modelA + '/' + seo.slugify('BM 50 KLASIK');
  const r = await page(url);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(canonicalOf(r.html), base + url, 'canonical tam adres olmalı');
  assert.strictEqual(h1s(r.html), 1);
  const t = types(r.html);
  assert.ok(t.includes('Product'), 'Product yapısal verisi olmalı');
  assert.ok(t.includes('BreadcrumbList'));
  const p = jsonLd(r.html).find(j => j['@type'] === 'Product');
  assert.strictEqual(p.name, 'BM 50 KLASIK');
  assert.strictEqual(p.sku, 'BN-' + modelA);
  assert.strictEqual(p.offers.price, '12345.00', 'fiyat kuruştan TL’ye çevrilmeli');
  assert.strictEqual(p.offers.priceCurrency, 'TRY');
  assert.ok(String(p.category).includes('Touring'), 'kategori okunabilir olmalı');
  assert.ok(r.html.includes(seo.categoryPath('TOURING')), 'model sayfası kategoriye bağlanmalı');
});

test('fiyatsız model: teklif (offers) yayınlanmaz, sayfa yine açılır', async () => {
  const url = '/model/' + modelB + '/' + seo.slugify('SR 1');
  const r = await page(url);
  assert.strictEqual(r.status, 200);
  const p = jsonLd(r.html).find(j => j['@type'] === 'Product');
  assert.ok(p);
  assert.strictEqual(p.offers, undefined, 'fiyat yoksa offers eklenmemeli');
});

test('pasif model 404 döner', async () => {
  const r = await page('/model/' + modelOff + '/' + seo.slugify('PASIF MODEL'));
  assert.strictEqual(r.status, 404);
});

test('destek sayfası FAQPage yapısal verisi yayınlar', async () => {
  const r = await page('/destek');
  assert.strictEqual(r.status, 200);
  const faq = jsonLd(r.html).find(j => j['@type'] === 'FAQPage');
  assert.ok(faq, 'FAQPage olmalı');
  assert.strictEqual(faq.mainEntity[0]['@type'], 'Question');
  assert.ok(faq.mainEntity[0].acceptedAnswer.text.length > 3);
});

test('her sayfa benzersiz başlık ve açıklama kullanır', async () => {
  const urls = ['/', '/modeller', catB, '/model/' + modelA + '/' + seo.slugify('BM 50 KLASIK'), '/destek', '/iletisim', '/satis-ve-servis'];
  const titles = new Set();
  const descs = new Set();
  for (const u of urls) {
    const r = await page(u);
    assert.strictEqual(r.status, 200, u + ' açılmalı');
    const t = titleOf(r.html);
    const d = descOf(r.html);
    assert.ok(t && d, u + ' için başlık ve açıklama olmalı');
    assert.ok(!titles.has(t), 'başlık tekrar etmemeli: ' + t);
    assert.ok(!descs.has(d), 'açıklama tekrar etmemeli: ' + d);
    titles.add(t);
    descs.add(d);
  }
  assert.ok(titles.size >= 7);
});

test('404 sayfası: 404 durum kodu + noindex; paneller de noindex', async () => {
  const r = await page('/boyle-bir-sayfa-yok');
  assert.strictEqual(r.status, 404);
  assert.ok(/name="robots" content="noindex/.test(r.html));
  const login = await page('/bayi/giris');
  assert.ok(/name="robots" content="noindex/.test(login.html), 'giriş ekranı indekslenmemeli');
});

test('içerik sayfası: SEO başlık/açıklama alanları ve WebPage yapısal verisi', async () => {
  db.prepare("INSERT OR REPLACE INTO pages(slug,title,body,meta_title,meta_description,updated_at) VALUES(?,?,?,?,?,datetime('now'))").run(
    '50-cc-motor-rehberi',
    '50 cc Motor Rehberi',
    '<p>50 cc sınıfı motosikletler hakkında bilmeniz gerekenler.</p>',
    '50 cc Motor Rehberi 2026 | BIONIC MOTOR',
    '50 cc motor modelleri, kullanım avantajları, bakım ve yetkili satış noktaları hakkında rehber.'
  );

  const r = await page('/sayfa/50-cc-motor-rehberi');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(titleOf(r.html), '50 cc Motor Rehberi 2026 | BIONIC MOTOR', 'meta_title kullanılmalı');
  assert.ok(descOf(r.html).includes('50 cc motor modelleri'), 'meta_description kullanılmalı');
  assert.strictEqual(h1s(r.html), 1);
  const t = types(r.html);
  assert.ok(t.includes('WebPage'), 'WebPage yapısal verisi olmalı');
  assert.ok(t.includes('BreadcrumbList'));

  const sm = await page('/sitemap.xml');
  assert.ok(sm.html.includes('<lastmod>'), 'sitemap güncelleme tarihi içermeli');
});
