'use strict';
// SEO DENETİMİ — canlı veya test ortamındaki gerçek sayfaları kontrol eder.
//
// Kullanım:
//   node scripts/seo-audit.js                       → https://bionicmotorsiklet.com
//   node scripts/seo-audit.js https://test.site.com
//   node scripts/seo-audit.js http://127.0.0.1:3100
//
// Kontroller: durum kodları, tek H1, başlık/açıklama uzunluğu ve tekilliği, canonical,
// og:image, JSON-LD geçerliliği, sitemap/robots, slug yönlendirmesi, 404 + noindex.
const BASE = (process.argv[2] || 'https://bionicmotorsiklet.com').replace(/\/+$/, '');

let pass = 0;
const fails = [];
const ok = (cond, label, detail) => {
  if (cond) {
    pass++;
    return true;
  }
  fails.push(label + (detail ? ' · ' + detail : ''));
  return false;
};

async function get(url, opts = {}) {
  const res = await fetch(BASE + url, { redirect: 'manual', headers: opts.headers || {} });
  const html = res.status === 200 ? await res.text() : '';
  return { status: res.status, html, location: res.headers.get('location'), headers: res.headers };
}

const rx = {
  title: /<title>([\s\S]*?)<\/title>/i,
  desc: /<meta name="description" content="([^"]*)"/i,
  canonical: /<link rel="canonical" href="([^"]*)"/i,
  ogImg: /<meta property="og:image" content="([^"]*)"/i,
  robots: /<meta name="robots" content="([^"]*)"/i
};
const pick = (html, re) => (html.match(re) || [])[1] || '';
const jsonLd = html => {
  const out = [];
  const re = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      out.push({ '@type': 'PARSE_ERROR' });
    }
  }
  return out;
};

(async () => {
  console.log('SEO DENETİMİ → ' + BASE + '\n');

  // 1) robots.txt
  const robots = await get('/robots.txt');
  console.log('robots.txt');
  ok(robots.status === 200, 'robots.txt erişilebilir', robots.status);
  const robotsTxt = robots.status === 200 ? await (await fetch(BASE + '/robots.txt')).text() : '';
  ok(/Disallow:\s*\/admin/.test(robotsTxt), 'robots: /admin kapalı');
  ok(/Disallow:\s*\/sifre/.test(robotsTxt), 'robots: /sifre kapalı');
  ok(/Sitemap:\s*https?:\/\/\S+/.test(robotsTxt), 'robots: sitemap bildirilmiş');

  // 2) sitemap.xml
  const sm = await fetch(BASE + '/sitemap.xml');
  const smXml = sm.status === 200 ? await sm.text() : '';
  const locs = [...smXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const paths = locs
    .map(u => {
      try {
        return new URL(u).pathname;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  console.log('\nsitemap.xml');
  ok(sm.status === 200, 'sitemap erişilebilir', sm.status);
  ok(paths.length >= 10, 'sitemap yeterli URL içeriyor', paths.length + ' adres');
  ok(
    paths.some(u => /^\/model\/\d+\/[a-z0-9-]+/.test(u)),
    'sitemap: modeller slug’lı'
  );
  ok(
    paths.some(u => /^\/modeller\/[a-z0-9-]+/.test(u)),
    'sitemap: kategori sayfaları var'
  );

  // 3) Sayfalar
  const home = await get('/');
  const modelsPage = await get('/modeller');
  const titleOf = h => pick(h, rx.title);
  const descOf = h => pick(h, rx.desc);
  const h1Of = h => (h.match(/<h1[\s>]/g) || []).length;
  // Kanonik kaynak (PUBLIC_URL tanımlıysa gerçek alan adı, değilse istek adresi)
  let canonicalOrigin = BASE;
  try {
    canonicalOrigin = new URL(pick(home.html, rx.canonical)).origin;
  } catch {
    /* yok say */
  }

  // Model adresi ve kategori adreslerini sitemap'ten al
  const modelPath = paths.find(u => /^\/model\/\d+\/[a-z0-9-]+/.test(u)) || null;
  const catPath = paths.find(u => /^\/modeller\/[a-z0-9-]+/.test(u)) || null;

  const pages = [
    ['/', 'Ana sayfa'],
    ['/modeller', 'Modeller'],
    ...(catPath ? [[catPath, 'Kategori']] : []),
    ...(modelPath ? [[modelPath, 'Model']] : []),
    ['/destek', 'Destek'],
    ['/iletisim', 'İletişim'],
    ['/satis-ve-servis', 'Satış ve Servis'],
    ['/bayilik-basvurusu', 'Bayilik']
  ];

  console.log('\nSayfalar');
  const seenTitles = new Map();
  const seenDescs = new Map();
  for (const [p, label] of pages) {
    const r = p === '/' ? home : p === '/modeller' ? modelsPage : await get(p);
    if (!ok(r.status === 200, label + ' açılıyor', p + ' → ' + r.status)) continue;
    const t = titleOf(r.html);
    const d = descOf(r.html);
    const c = pick(r.html, rx.canonical);
    const og = pick(r.html, rx.ogImg);
    ok(h1Of(r.html) === 1, label + ': tek H1', 'H1 sayısı ' + h1Of(r.html));
    ok(t.length >= 20 && t.length <= 80, label + ': başlık uzunluğu', t.length + ' kr');
    ok(d.length >= 70 && d.length <= 200, label + ': açıklama uzunluğu', d.length + ' kr');
    ok(!!c && c.startsWith(canonicalOrigin), label + ': canonical doğru', c);
    ok(!!og && /^https?:\/\//.test(og), label + ': og:image var');
    const ld = jsonLd(r.html);
    ok(ld.length > 0 && !ld.some(j => j['@type'] === 'PARSE_ERROR'), label + ': JSON-LD geçerli', ld.length + ' blok');
    ok(t.toLowerCase() !== (seenTitles.get(t) || '').toLowerCase(), label + ': başlık tekrar etmiyor', t);
    ok(d !== seenDescs.get(d), label + ': açıklama tekrar etmiyor');
    seenTitles.set(t, t.toLowerCase());
    seenDescs.set(d, d);
    console.log('   ' + label.padEnd(16) + ' ' + t);
  }

  // 4) Yapısal veri türleri
  console.log('\nYapısal veri (JSON-LD)');
  const homeTypes = jsonLd(home.html).map(j => j['@type']);
  ok(homeTypes.includes('Organization'), 'ana sayfa: Organization');
  ok(homeTypes.includes('WebSite'), 'ana sayfa: WebSite');
  ok(homeTypes.includes('MotorcycleDealer'), 'ana sayfa: MotorcycleDealer (yerel işletme)');
  const support = await get('/destek');
  ok(
    jsonLd(support.html).some(j => j['@type'] === 'FAQPage'),
    'destek: FAQPage'
  );
  if (modelPath) {
    const mp = await get(modelPath);
    const mt = jsonLd(mp.html).map(j => j['@type']);
    ok(mt.includes('Product'), 'model: Product');
    ok(mt.includes('BreadcrumbList'), 'model: BreadcrumbList');
  }

  // 5) Slug yönlendirmesi (eski /model/ID adresi)
  if (modelPath) {
    const id = modelPath.split('/')[2];
    const r = await get('/model/' + id);
    ok(r.status === 301, '/model/' + id + ' → 301 yönlendirme', r.status);
    ok(String(r.location || '').includes('/model/' + id + '/'), '301 hedefi slug’lı adres', r.location);
  }

  // 6) 404 + noindex
  const nf = await get('/seo-denetim-boyle-bir-sayfa-yok-' + Date.now());
  console.log('\n404 / indeksleme');
  ok(nf.status === 404, 'olmayan sayfa 404 döndürüyor', nf.status);
  const nfHtml = nf.status === 200 ? nf.html : '';
  if (nfHtml) ok(/noindex/.test(pick(nfHtml, rx.robots)), '404: noindex');
  const login = await get('/bayi/giris');
  ok(/noindex/.test(pick(login.html, rx.robots)), 'giriş ekranı: noindex');

  // 7) Ana sayfa başlığında marka
  ok(/bionic/i.test(titleOf(home.html)), 'ana sayfa başlığında marka adı');

  console.log('\n' + '='.repeat(58));
  console.log('TOPLAM: ' + (pass + fails.length) + ' kontrol · ' + pass + ' başarılı · ' + fails.length + ' başarısız');
  if (fails.length) {
    console.log('\nSorunlar:');
    fails.forEach(f => console.log('  - ' + f));
    process.exitCode = 1;
  }
  console.log('='.repeat(58));
})();
