'use strict';
// =============================================================================
//  DUMAN TESTİ (SMOKE TEST) — teslim öncesi ve her yükseltme sonrası çalıştırılır.
//
//  Kullanım:
//    node scripts/smoke-test.js [baseUrl]
//    SMOKE_ADMIN_PASS=... node scripts/smoke-test.js https://bionicmotorsiklet.com
//
//  Ortam değişkenleri (varsayılanlar test ortamı içindir):
//    SMOKE_ADMIN_USER / SMOKE_ADMIN_PASS
//    SMOKE_BAYI_CODE  / SMOKE_BAYI_PASS     (varsayılan 10001 / Test1234Ab!x)
//    SMOKE_SERVIS_CODE/ SMOKE_SERVIS_PASS   (varsayılan 20001 / Test1234Ab!x)
//
//  Hiçbir veriyi SİLMEZ; yalnızca okur ve form gönderir (iletişim/başvuru + 1 duyuru).
// =============================================================================
const BASE = (process.argv[2] || process.env.SMOKE_BASE || 'http://127.0.0.1:3000').replace(/\/+$/, '');
// SMOKE_READONLY=1 → veri oluşturan testler atlanır (CANLIDA güvenle çalıştırmak için).
const READONLY = process.env.SMOKE_READONLY === '1';
// SMOKE_SKIP_PANELS=1 → bayi/servis panel testleri atlanır (canlıda test kullanıcısı yoksa).
const SKIP_PANELS = process.env.SMOKE_SKIP_PANELS === '1';
const CFG = {
  adminUser: process.env.SMOKE_ADMIN_USER || 'admin',
  adminPass: process.env.SMOKE_ADMIN_PASS || '',
  bayiCode: process.env.SMOKE_BAYI_CODE || '10001',
  bayiPass: process.env.SMOKE_BAYI_PASS || 'Test1234Ab!x',
  servisCode: process.env.SMOKE_SERVIS_CODE || '20001',
  servisPass: process.env.SMOKE_SERVIS_PASS || 'Test1234Ab!x'
};

const results = [];
const rec = (group, name, ok, detail) => {
  results.push({ group, name, ok: !!ok, detail: detail || '' });
};
let currentGroup = '';
const G = g => {
  currentGroup = g;
  process.stdout.write('\n' + g + '\n');
};
const log = (ok, name, detail) => {
  rec(currentGroup, name, ok, detail);
  process.stdout.write('  ' + (ok ? 'OK  ' : 'FAIL') + '  ' + name + (detail ? '  ·  ' + detail : '') + '\n');
};

function session() {
  const jar = new Map();
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ');
  const store = r => {
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const c of sc) {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  const req = async (path, opts = {}) => {
    const r = await fetch(BASE + path, {
      ...opts,
      headers: { 'accept-language': 'tr', ...(opts.headers || {}), cookie: cookieHeader() },
      redirect: 'manual'
    });
    store(r);
    return r;
  };
  const html = async (path, opts) => (await req(path, opts)).text();
  const csrf = h => (h.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  const form = obj => ({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(obj)
  });
  return { req, html, csrf, form };
}

const okStatus = (s, allow = [200]) => allow.includes(s);

/* ---------------------------------------------------------------- public */
async function testPublic() {
  G('GENEL SİTE (anonim)');
  const s = session();
  const pages = [
    ['/', 'Ana sayfa'],
    ['/modeller', 'Modeller'],
    ['/satis-ve-servis', 'Satış ve servis'],
    ['/destek', 'Destek / SSS'],
    ['/medya', 'Medya'],
    ['/dijital-katalog', 'Dijital katalog'],
    ['/iletisim', 'İletişim'],
    ['/bayilik-basvurusu', 'Bayilik başvurusu'],
    ['/sayfa/kurumsal', 'Kurumsal sayfa'],
    ['/sayfa/kisisel-bilgi-guvenligi', 'KVKK sayfası'],
    ['/robots.txt', 'robots.txt'],
    ['/sitemap.xml', 'sitemap.xml']
  ];
  const bodies = {};
  for (const [p, label] of pages) {
    const r = await s.req(p);
    bodies[p] = r.status === 200 ? await r.text() : '';
    log(okStatus(r.status, [200, 301, 302]), label + ' (' + p + ')', 'HTTP ' + r.status);
  }

  // 404 sayfası
  const nf = await s.req('/kesinlikle-olmayan-sayfa-12345');
  const nfBody = await nf.text();
  log(nf.status === 404 && /bulunamad|404/i.test(nfBody), 'Bilinmeyen sayfa → 404', 'HTTP ' + nf.status);

  // İç bağlantı taraması
  const links = new Set();
  for (const p in bodies) {
    for (const m of bodies[p].matchAll(/(?:href|src|action)="(\/[^"]*)"/g)) {
      const u = m[1].split('#')[0];
      if (u && !u.startsWith('//')) links.add(u);
    }
  }
  const list = [...links].filter(u => !/^\/(static|uploads)\//.test(u)).slice(0, 80);
  let bad = [];
  for (const u of list) {
    const r = await s.req(u);
    if (r.status >= 400) bad.push(u + ' → ' + r.status);
  }
  log(bad.length === 0, 'İç bağlantı taraması (' + list.length + ' bağlantı)', bad.slice(0, 5).join(', '));

  // Statik varlıklar
  const assets = [
    ...new Set(
      [
        ...Object.values(bodies)
          .join('')
          .matchAll(/(?:href|src)="(\/static\/[^"]*)"/g)
      ].map(m => m[1].split('?')[0])
    )
  ];
  let badAssets = [];
  for (const a of assets.slice(0, 30)) {
    const r = await s.req(a);
    if (r.status >= 400) badAssets.push(a + ' → ' + r.status);
  }
  log(badAssets.length === 0, 'Statik varlıklar (' + Math.min(assets.length, 30) + ')', badAssets.join(', '));

  return { s, bodies };
}

/* ----------------------------------------------------------------- forms */
async function testPublicForms() {
  G('GENEL SİTE FORMLARI (KVKK doğrulaması)');
  if (READONLY) {
    log(true, 'Salt-okunur mod: form gönderimi atlandı');
    return;
  }
  const s = session();
  // İletişim: KVKK onayı olmadan gönderim reddedilmeli
  let h = await s.html('/iletisim');
  let r = await s.req('/iletisim', s.form({ _csrf: s.csrf(h), name: 'Duman Test', email: 'duman@test.local', message: 'test', kvkk: '' }));
  let loc = r.headers.get('location') || '';
  h = await s.html(loc || '/iletisim');
  log(r.status === 302 && /KVKK/i.test(h), 'İletişim: KVKK onayı zorunlu', 'HTTP ' + r.status);
  // KVKK ile gönderim kabul edilmeli
  h = await s.html('/iletisim');
  r = await s.req(
    '/iletisim',
    s.form({ _csrf: s.csrf(h), name: 'Duman Test', email: 'duman@test.local', message: 'Duman testi mesajı', kvkk: '1' })
  );
  h = await s.html('/iletisim');
  log(r.status === 302 && /alert-success|alındı/i.test(h), 'İletişim: geçerli gönderim kabul edildi', 'HTTP ' + r.status);

  // Bayilik başvurusu
  h = await s.html('/bayilik-basvurusu');
  r = await s.req(
    '/bayilik-basvurusu',
    s.form({ _csrf: s.csrf(h), name: 'Duman Test', city: 'Mersin', phone: '0555 000 00 00', kvkk: '' })
  );
  h = await s.html('/bayilik-basvurusu');
  log(r.status === 302 && /KVKK/i.test(h), 'Bayilik: KVKK onayı zorunlu', 'HTTP ' + r.status);
  h = await s.html('/bayilik-basvurusu');
  r = await s.req(
    '/bayilik-basvurusu',
    s.form({
      _csrf: s.csrf(h),
      name: 'Duman Test',
      city: 'Mersin',
      district: 'Akdeniz',
      phone: '0555 000 00 00',
      note: 'Duman testi',
      kvkk: '1'
    })
  );
  h = await s.html('/bayilik-basvurusu');
  log(r.status === 302 && /alert-success|alındı/i.test(h), 'Bayilik: geçerli başvuru kabul edildi', 'HTTP ' + r.status);
}

/* ----------------------------------------------------------- auth guards */
async function testGuards() {
  G('YETKİ KONTROLLERİ (oturumsuz erişim engellenmeli)');
  const s = session();
  const guarded = [
    ['/admin', '/admin/giris'],
    ['/admin/r/firms', '/admin/giris'],
    ['/bayi', '/bayi/giris'],
    ['/bayi/hesap-ozeti', '/bayi/giris'],
    ['/bayi/siparisler', '/bayi/giris'],
    ['/servis', '/servis/giris'],
    ['/servis/hesap-ozeti', '/servis/giris'],
    ['/servis/is-emirlerim', '/servis/giris']
  ];
  for (const [path, login] of guarded) {
    const r = await s.req(path);
    const loc = r.headers.get('location') || '';
    log(r.status === 302 && loc.includes(login), path + ' → giriş sayfasına', 'HTTP ' + r.status + ' ' + loc);
  }
  const r = await s.req('/odeme');
  log(r.status === 200, '/odeme erişilebilir (giriş formu)', 'HTTP ' + r.status);
}

/* ----------------------------------------------------------------- admin */
async function testAdmin() {
  G('YÖNETİM PANELİ');
  const s = session();
  if (!CFG.adminPass) {
    log(false, 'Yönetici parolası verilmedi (SMOKE_ADMIN_PASS)');
    return null;
  }
  const gl = await s.html('/admin/giris');
  let r = await s.req('/admin/giris', s.form({ _csrf: s.csrf(gl), username: CFG.adminUser, password: CFG.adminPass }));
  const loc = r.headers.get('location') || '';
  const loggedIn = r.status === 302 && loc.startsWith('/admin') && !loc.includes('/giris');
  log(loggedIn, 'Yönetici girişi', 'HTTP ' + r.status + ' ' + loc);
  if (!loggedIn) return null;

  for (const [p, label] of [
    ['/admin', 'Panel'],
    ['/admin/ayarlar', 'Ayarlar'],
    ['/admin/sifre', 'Şifre değiştir'],
    ['/admin/audit', 'Denetim kaydı'],
    ['/admin/admin-users', 'Yönetici kullanıcıları'],
    ['/admin/stok', 'Araç stokları'],
    ['/admin/stok-parca', 'Yedek parça stokları'],
    ['/admin/test', 'Sistem testi']
  ]) {
    const rr = await s.req(p);
    log(rr.status === 200, label + ' (' + p + ')', 'HTTP ' + rr.status);
  }

  const resources = [
    'firms',
    'users',
    'orders',
    'movements',
    'announcements',
    'products',
    'warranty',
    'workorders',
    'spareorders',
    'payments',
    'slides',
    'campaigns',
    'models',
    'faqs',
    'points',
    'pages',
    'messages',
    'applications'
  ];
  let badList = [],
    badNew = [],
    skippedNew = [];
  for (const k of resources) {
    const a = await s.req('/admin/r/' + k);
    const aBody = a.status === 200 ? await a.text() : '';
    if (a.status !== 200) badList.push(k + '→' + a.status);
    // Salt okunur kaynaklarda (noCreate) "+ Yeni Ekle" yoktur; /new beklenmez.
    if (a.status === 200 && !/\/new"/.test(aBody)) {
      skippedNew.push(k);
      continue;
    }
    const b = await s.req('/admin/r/' + k + '/new');
    if (b.status !== 200) badNew.push(k + '→' + b.status);
  }
  log(badList.length === 0, 'Tüm kaynak listeleri (' + resources.length + ')', badList.join(', '));
  log(badNew.length === 0, 'Tüm "yeni kayıt" formları (' + (resources.length - skippedNew.length) + ')', badNew.join(', '));
  log(true, 'Salt okunur kaynaklar (yeni kayıt yok)', skippedNew.join(', ') || '-');

  // Duyuru oluştur → düzenle → sil (CRUD)
  if (READONLY) {
    log(true, 'Salt-okunur mod: kayıt oluşturma/güncelleme/silme atlandı');
  } else {
    const fl = await s.html('/admin/r/announcements/new');
    const marker = 'DUMAN TEST ' + Date.now();
    r = await s.req('/admin/r/announcements/save', s.form({ _csrf: s.csrf(fl), text: marker, author: 'Duman Test', active: '1' }));
    log(r.status === 302, 'Kayıt oluşturma (duyuru)', 'HTTP ' + r.status);
    const listHtml = await s.html('/admin/r/announcements');
    const idMatch = listHtml.match(new RegExp('/admin/r/announcements/(\\d+)"'));
    if (idMatch) {
      const id = idMatch[1];
      const el = await s.html('/admin/r/announcements/' + id);
      r = await s.req(
        '/admin/r/announcements/save',
        s.form({ _csrf: s.csrf(el), id, text: marker + ' (güncellendi)', author: 'Duman Test', active: '1' })
      );
      log(r.status === 302, 'Kayıt güncelleme', 'HTTP ' + r.status);
      const dl = await s.html('/admin/r/announcements/' + id);
      r = await s.req('/admin/r/announcements/' + id + '/delete', s.form({ _csrf: s.csrf(dl), _method: 'delete' }));
      log(r.status === 302, 'Kayıt silme', 'HTTP ' + r.status);
    } else {
      log(false, 'Oluşturulan kayıt listede bulunamadı');
    }
  }

  // Sistem testi API'si
  const t = await s.req('/admin/test/api', { headers: { accept: 'application/json' } });
  let j = null;
  try {
    j = await t.json();
  } catch {
    /* json değil */
  }
  log(t.status === 200 && j && Array.isArray(j.groups), 'Sistem testi API', 'HTTP ' + t.status);
  if (j && j.groups) {
    const errs = [],
      warns = [];
    for (const g of j.groups)
      for (const it of g.results || []) {
        if (!it.ok) (it.severity === 'warning' ? warns : errs).push(g.name + ' / ' + it.name);
      }
    log(errs.length === 0, 'Sistem testi: hatalar', errs.join(' | ') || 'yok');
    log(true, 'Sistem testi: uyarılar', warns.join(' | ') || 'yok');
  }
  return s;
}

/* ------------------------------------------------------------------ bayi */
async function testBayi() {
  G('BAYİ PANELİ');
  if (SKIP_PANELS) {
    log(true, 'Atlandı (SMOKE_SKIP_PANELS=1)');
    return;
  }
  const s = session();
  const gl = await s.html('/bayi/giris');
  let r = await s.req('/bayi/giris', s.form({ _csrf: s.csrf(gl), code: CFG.bayiCode, password: CFG.bayiPass }));
  const bloc = r.headers.get('location') || '';
  const bOk = r.status === 302 && bloc.startsWith('/bayi') && !bloc.includes('/giris');
  log(bOk, 'Bayi girişi (' + CFG.bayiCode + ')', 'HTTP ' + r.status + ' ' + bloc);
  if (!bOk) return;

  const pages = [
    ['/bayi', 'Anasayfa'],
    ['/bayi/siparisler', 'Sipariş taleplerim'],
    ['/bayi/siparis-olustur', 'Yeni sipariş talebi'],
    ['/bayi/stoklar', 'Stoklarım'],
    ['/bayi/hesap-ozeti', 'Hesap özeti'],
    ['/bayi/hesap-ozeti?from=2026-08-01&to=2026-08-31', 'Hesap özeti (tarih filtreli)'],
    ['/bayi/yedek-parca-ekstre', 'Yedek parça ekstresi'],
    ['/bayi/odeme', 'Online ödeme'],
    ['/bayi/duyurular', 'Duyurular'],
    ['/bayi/fiyat-listesi', 'Fiyat listesi'],
    ['/bayi/garanti', 'Garanti kayıtları'],
    ['/bayi/yedek-parca/yeni', 'Yedek parça siparişi (form)'],
    ['/bayi/yedek-parca-siparisleri', 'Yedek parça siparişlerim'],
    ['/bayi/firma-degistir', 'Firma değiştir']
  ];
  const bad = [];
  for (const [p] of pages) {
    const rr = await s.req(p);
    if (rr.status !== 200) bad.push(p + '→' + rr.status);
  }
  log(bad.length === 0, 'Bayi sayfaları (' + pages.length + ')', bad.join(', '));

  // Sipariş detayı (varsa)
  const orders = await s.html('/bayi/siparisler');
  const om = orders.match(/\/bayi\/siparisler\/(\d+)/);
  if (om) {
    const or = await s.req('/bayi/siparisler/' + om[1]);
    log(or.status === 200, 'Sipariş detayı', 'HTTP ' + or.status);
  }
}

/* ---------------------------------------------------------------- servis */
async function testServis() {
  G('SERVİS PANELİ');
  if (SKIP_PANELS) {
    log(true, 'Atlandı (SMOKE_SKIP_PANELS=1)');
    return;
  }
  const s = session();
  const gl = await s.html('/servis/giris');
  let r = await s.req('/servis/giris', s.form({ _csrf: s.csrf(gl), code: CFG.servisCode, password: CFG.servisPass }));
  const sloc = r.headers.get('location') || '';
  const sOk = r.status === 302 && sloc.startsWith('/servis') && !sloc.includes('/giris');
  log(sOk, 'Servis girişi (' + CFG.servisCode + ')', 'HTTP ' + r.status + ' ' + sloc);
  if (!sOk) return;

  const pages = [
    ['/servis', 'Anasayfa'],
    ['/servis/hesap-ozeti', 'Hesap özeti'],
    ['/servis/yedek-parca-ekstre', 'Yedek parça ekstresi'],
    ['/servis/odeme', 'Online ödeme'],
    ['/servis/garanti', 'Garanti kayıtları'],
    ['/servis/garanti/yeni', 'Yeni garanti kaydı (form)'],
    ['/servis/is-emri/yeni', 'İş emri oluştur (form)'],
    ['/servis/is-emirlerim', 'İş emirlerim'],
    ['/servis/yedek-parca/yeni', 'Yedek parça siparişi (form)'],
    ['/servis/yedek-parca-siparisleri', 'Yedek parça siparişlerim']
  ];
  const bad = [];
  for (const [p] of pages) {
    const rr = await s.req(p);
    if (rr.status !== 200) bad.push(p + '→' + rr.status);
  }
  log(bad.length === 0, 'Servis sayfaları (' + pages.length + ')', bad.join(', '));
}

/* ------------------------------------------------------------------ main */
(async () => {
  console.log('DUMAN TESTİ · ' + BASE);
  try {
    await testPublic();
    await testPublicForms();
    await testGuards();
    await testAdmin();
    await testBayi();
    await testServis();
  } catch (e) {
    rec('GENEL', 'Beklenmeyen hata', false, e.message);
    console.log('\n!! Beklenmeyen hata: ' + e.stack);
  }

  const fails = results.filter(r => !r.ok);
  console.log('\n' + '='.repeat(60));
  console.log('TOPLAM: ' + results.length + ' kontrol · ' + (results.length - fails.length) + ' başarılı · ' + fails.length + ' başarısız');
  if (fails.length) {
    console.log('\nBAŞARISIZ KONTROLLER:');
    for (const f of fails) console.log('  [' + f.group + '] ' + f.name + (f.detail ? '  ·  ' + f.detail : ''));
  }
  console.log('='.repeat(60));
  process.exit(fails.length ? 1 : 0);
})();
