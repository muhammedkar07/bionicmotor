// Sistem teşhisi ve otomatik onarım.
// - runSystemTests: tüm sayfaları/şablonları/veritabanını/ayarları/iş mantığını test eder.
// - autoRepair: güvenli ve idempotent düzeltmeleri uygular (veri kaybı olmadan).
const fsp = require('fs');
const pth = require('path');
const ejsLib = require('ejs');
const { db, get, set, STATUS, syncPaymentCredit } = require('../db');
const { csrfCheck } = require('../lib/core');

function listViews(dir, out) {
  out = out || [];
  for (const e of fsp.readdirSync(dir, { withFileTypes: true })) {
    const p = pth.join(dir, e.name);
    if (e.isDirectory()) listViews(p, out);
    else if (e.name.endsWith('.ejs')) out.push(p);
  }
  return out;
}

async function runSystemTests(req) {
  const groups = [];
  const add = (group, name, ok, detail, severity) => {
    let g = groups.find(x => x.name === group);
    if (!g) {
      g = { name: group, results: [] };
      groups.push(g);
    }
    g.results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail), severity: severity || 'error' });
  };
  const cookie = (req && req.headers && req.headers.cookie) || '';

  // --- Veritabanı ---
  try {
    const integ = db.prepare('PRAGMA integrity_check').get();
    const v = integ && (integ.integrity_check || integ['integrity_check']);
    add('Veritabanı', 'SQLite bütünlük kontrolü', v === 'ok', v);
  } catch (e) {
    add('Veritabanı', 'SQLite bütünlük kontrolü', false, e.message);
  }
  const tables = [
    'settings',
    'sessions',
    'admins',
    'firms',
    'dealer_users',
    'user_firms',
    'orders',
    'order_items',
    'account_movements',
    'products',
    'models',
    'slides',
    'payments',
    'spare_orders',
    'spare_order_items',
    'warranty_records',
    'work_orders',
    'categories',
    'audit_log',
    'login_attempts',
    'firm_stock',
    'order_stock_snap',
    'campaigns'
  ];
  const missingTables = tables.filter(t => !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t));
  add(
    'Veritabanı',
    'Gerekli tablolar',
    missingTables.length === 0,
    missingTables.length ? 'Eksik: ' + missingTables.join(', ') : tables.length + ' tablo tamam'
  );
  const cols = [
    ['payments', 'provider'],
    ['payments', 'provider_ref'],
    ['payments', 'provider_order'],
    ['payments', 'amount_tl'],
    ['payments', 'source'],
    ['orders', 'deleted_at'],
    ['spare_orders', 'deleted_at'],
    ['payments', 'deleted_at'],
    ['account_movements', 'deleted_at'],
    ['products', 'stock'],
    ['products', 'model_id']
  ];
  const missingCols = cols
    .filter(
      ([t, c]) =>
        !db
          .prepare(`PRAGMA table_info(${t})`)
          .all()
          .some(x => x.name === c)
    )
    .map(x => x[0] + '.' + x[1]);
  add('Veritabanı', 'Gerekli kolonlar', missingCols.length === 0, missingCols.length ? 'Eksik: ' + missingCols.join(', ') : 'tamam');

  // --- Kayıtlar ---
  try {
    const c = t => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
    add(
      'Kayıtlar',
      'Yönetici / bayi / ürün / model',
      c('admins') > 0,
      `admin:${c('admins')} bayi:${c('dealer_users')} ürün:${c('products')} model:${c('models')}`
    );
  } catch (e) {
    add('Kayıtlar', 'Kayıt sayıları okunamadı', false, e.message);
  }

  // --- Şablonlar ---
  try {
    const viewsDir = pth.join(__dirname, '..', 'views');
    const files = listViews(viewsDir);
    let bad = 0;
    for (const f of files) {
      try {
        ejsLib.compile(fsp.readFileSync(f, 'utf8'), { filename: f });
      } catch (e) {
        bad++;
        add('Şablonlar (EJS)', pth.relative(viewsDir, f), false, String(e.message).split('\n')[0]);
      }
    }
    add('Şablonlar (EJS)', `Tüm görünümler derlendi (${files.length} dosya)`, bad === 0, bad ? bad + ' hatalı görünüm' : 'hepsi geçerli');
  } catch (e) {
    add('Şablonlar (EJS)', 'Görünümler taranamadı', false, e.message);
  }

  // --- Statik dosyalar ---
  for (const a of [
    'css/site.css',
    'css/admin.css',
    'js/site.js',
    'js/theme.js',
    'js/admin-menu.js',
    'js/admin-diagnostics.js',
    'img/bionic-logo.png'
  ]) {
    const p = pth.join(__dirname, '..', 'public', ...a.split('/'));
    add('Statik Dosyalar', a, fsp.existsSync(p), fsp.existsSync(p) ? 'var' : 'BULUNAMADI');
  }

  // --- İş mantığı ---
  try {
    const { parseAmount } = require('../lib/money');
    const cases = [
      ['12.50', 1250],
      ['1.250,50', 125050],
      ['1250.50', 125050],
      ['1.250', 125000],
      ['1,250.50', null],
      ['abc', null]
    ];
    const bad = cases.filter(([i, exp]) => parseAmount(i) !== exp).map(([i, exp]) => `${i}=>${parseAmount(i)} (beklenen ${exp})`);
    add('İş Mantığı', 'Para ayrıştırma (kuruş)', bad.length === 0, bad.join(', '));
  } catch (e) {
    add('İş Mantığı', 'Para ayrıştırma', false, e.message);
  }
  try {
    const { accountSummary } = require('../lib/account');
    const f = db.prepare('SELECT id FROM firms LIMIT 1').get();
    const a = f ? accountSummary(f.id, 'ana') : null;
    add('İş Mantığı', 'Cari özet hesabı', !f || (a && typeof a.balance === 'number'), f ? 'bakiye: ' + a.balance : 'firma yok');
  } catch (e) {
    add('İş Mantığı', 'Cari özet hesabı', false, e.message);
  }

  // --- Ödeme (Paratika) ---
  try {
    const paratika = require('../lib/paratika');
    const c = paratika.cfg();
    const configured = c.simulate || paratika.isConfigured();
    add(
      'Ödeme (Paratika)',
      'Yapılandırma',
      configured,
      c.simulate
        ? 'SİMÜLASYON modu açık'
        : paratika.isConfigured()
          ? 'üye işyeri bilgileri tanımlı'
          : 'Canlıda PARATIKA_* ortam değişkenlerini tanımlayın (veya test için PARATIKA_SIMULATE=1).',
      'warning'
    );
    add('Ödeme (Paratika)', 'API adresi', /^https?:\/\//.test(c.apiBase), c.apiBase);
    add('Ödeme (Paratika)', 'Ödeme sayfası adresi ({token})', /\{token\}/.test(c.hppUrl), c.hppUrl);
    // Canlı API kullanıcısının işlem sorgulama yetkisi var mı? (Yoksa ödemeler cariye işlenemez.)
    if (!c.simulate && paratika.isConfigured()) {
      const probe = await paratika.query({ orderId: 'PERMCHECK' + Date.now() });
      add(
        'Ödeme (Paratika)',
        'İşlem sorgulama (QUERYTRANSACTION) yetkisi',
        !probe.config,
        probe.config
          ? 'API kullanıcısında bu yetki YOK — ödemeler cariye işlenemez. Paratika paneli → API kullanıcıları → "İşlem Sorgulama" iznini verin. (' +
            (probe.error || 'ERR10082') +
            ')'
          : 'API kullanıcısı işlem sorgulayabiliyor',
        'warning'
      );
    }
  } catch (e) {
    add('Ödeme (Paratika)', 'Modül yüklenemedi', false, e.message);
  }

  // --- E-posta (şifre sıfırlama) ---
  try {
    const mail = require('../lib/mail');
    const m = mail.cfg();
    const ok = mail.configured();
    add(
      'E-posta',
      'SMTP yapılandırması',
      ok,
      ok
        ? m.host + ':' + m.port + (m.secure ? ' (SSL)' : ' (STARTTLS)') + ' · gönderen: ' + m.from
        : 'Tanımlı değil — "Şifremi Unuttum" e-postası gönderilemez. .env: SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM',
      'warning'
    );
  } catch (e) {
    add('E-posta', 'Modül yüklenemedi', false, e.message);
  }

  // --- Güvenlik ---
  add('Güvenlik', 'CSRF koruması etkin', typeof csrfCheck === 'function');
  try {
    const n = db.prepare('SELECT COUNT(*) n FROM admins').get().n;
    add('Güvenlik', 'Yönetici hesabı var', n > 0, n + ' yönetici');
  } catch (e) {
    add('Güvenlik', 'Yönetici hesabı', false, e.message);
  }
  try {
    db.exec('BEGIN');
    db.exec('ROLLBACK');
    add('Güvenlik', 'İşlem (transaction) desteği', true);
  } catch (e) {
    add('Güvenlik', 'İşlem (transaction) desteği', false, e.message);
  }

  // --- Ayarlar ---
  try {
    add('Ayarlar', 'Marka bilgisi', !!(get('brand_1') || get('brand_2')), (get('brand_1') || '') + (get('brand_2') || ''));
    add('Ayarlar', 'İletişim telefonu', !!get('phone'), get('phone') || 'boş');
  } catch (e) {
    add('Ayarlar', 'Ayarlar okunamadı', false, e.message);
  }

  // --- Yedekleme ---
  try {
    const bk = require('./backup');
    const st = bk.lastStatus();
    const ok = st.status === 'ok';
    add(
      'Yedekleme',
      'Son yedek durumu',
      ok,
      ok ? st.status + ' · ' + (st.file || '') : st.status || 'henüz yedek yok (açılışta oluşturulur)',
      st.status === 'error' ? 'error' : 'warning'
    );
    const fresh = st.time && Date.now() - new Date(st.time).getTime() < 3 * 3600 * 1000;
    add('Yedekleme', 'Yedek tazeliği (≤3 saat)', !!fresh, st.time ? 'son: ' + st.time : 'yok', 'warning');
    const v = bk.verifyLatest();
    add(
      'Yedekleme',
      'Yedek bütünlüğü',
      v.ok,
      v.ok ? v.tables + ' tablo doğrulandı' : v.error || 'bozuk',
      v.error === 'Yedek bulunamadı' ? 'warning' : 'error'
    );
    add('Yedekleme', 'Şifreleme', st.encrypted, st.encrypted ? 'açık (AES-256-GCM)' : 'kapalı — BACKUP_ENCRYPT_KEY ile açın', 'warning');
    add(
      'Yedekleme',
      'Off-site yedek',
      st.offsite,
      st.offsite ? 'yapılandırıldı' : 'kapalı — BACKUP_UPLOAD_CMD (S3/rclone) ile açın',
      'warning'
    );
  } catch (e) {
    add('Yedekleme', 'Yedekleme modülü', false, e.message);
  }

  // --- Sayfalar (HTTP) ---
  try {
    const port = (req && req.socket && req.socket.localPort) || process.env.PORT || 3000;
    const basePath = (process.env.BASE_PATH || '').trim().replace(/\/+$/, '');
    const base = 'http://127.0.0.1:' + port + basePath;
    const routes = [
      { path: '/', markers: ['id="slider"', 'hero-in'] },
      { path: '/modeller' },
      { path: '/satis-ve-servis' },
      { path: '/iletisim' },
      { path: '/destek' },
      { path: '/bayilik-basvurusu' },
      { path: '/sayfa/kurumsal' },
      { path: '/admin/giris', status: 200 },
      { path: '/admin', auth: true, marker: 'class="side"' },
      { path: '/admin/r/firms', auth: true },
      { path: '/admin/r/orders', auth: true },
      { path: '/admin/r/products', auth: true },
      { path: '/admin/r/payments', auth: true },
      { path: '/admin/r/movements', auth: true },
      { path: '/admin/r/models', auth: true },
      { path: '/admin/stok', auth: true },
      { path: '/admin/stok-parca', auth: true },
      { path: '/admin/ayarlar', auth: true },
      { path: '/admin/admin-users', auth: true },
      { path: '/bayi/giris', status: 200 },
      { path: '/servis/giris', status: 200 },
      { path: '/odeme', status: 200 },
      { path: '/bayi', status: 302 },
      { path: '/servis', status: 302 },
      { path: '/olmayan-sayfa-xyz', status: 404 }
    ];
    for (const r of routes) {
      const expected = Array.isArray(r.status) ? r.status : [r.status != null ? r.status : r.auth && !cookie ? 302 : 200];
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(base + r.path, {
          redirect: 'manual',
          signal: ctrl.signal,
          headers: r.auth && cookie ? { cookie } : {}
        });
        clearTimeout(to);
        let ok = expected.includes(res.status);
        let detail = 'HTTP ' + res.status + (!ok ? ' (beklenen ' + expected.join('/') + ')' : '');
        if (ok && r.markers && res.status === 200) {
          // Birden çok kabul edilebilir işaret (ör. ana sayfa: slider ya da hero)
          const html = await res.text();
          if (!r.markers.some(m => html.includes(m))) {
            ok = false;
            detail += ' · içerikte ' + r.markers.map(m => '"' + m + '"').join(' veya ') + ' yok';
          }
        } else if (ok && r.marker && res.status === 200) {
          const html = await res.text();
          if (!html.includes(r.marker)) {
            ok = false;
            detail += ' · içerikte "' + r.marker + '" yok';
          }
        }
        add('Sayfalar (HTTP)', r.path, ok, detail);
      } catch (e) {
        add('Sayfalar (HTTP)', r.path, false, e.message);
      }
    }
  } catch (e) {
    add('Sayfalar (HTTP)', 'Rota testleri çalıştırılamadı', false, e.message);
  }

  const ok = groups.every(g => g.results.every(r => r.ok || r.severity === 'warning'));
  return { ok, groups, time: new Date().toISOString() };
}

// Güvenli, idempotent otomatik onarımlar. Veri silmez; yalnızca eksikleri tamamlar/uyumlar.
function autoRepair() {
  const repairs = [];

  // 1) Ürün kategorilerini categories tablosuna senkronla
  try {
    const before = db.prepare('SELECT COUNT(*) n FROM categories').get().n;
    db.exec(
      "INSERT OR IGNORE INTO categories(name) SELECT DISTINCT TRIM(category) FROM products WHERE category IS NOT NULL AND TRIM(category)<>''"
    );
    const after = db.prepare('SELECT COUNT(*) n FROM categories').get().n;
    repairs.push({ name: 'Kategori listesi senkronu', fixed: after > before, detail: after - before + ' kategori eklendi' });
  } catch (e) {
    repairs.push({ name: 'Kategori listesi senkronu', fixed: false, detail: e.message });
  }

  // 2) Eksik temel ayarları tamamla (mevcut değerler korunur)
  try {
    const defaults = {
      brand_1: 'Bionic ',
      brand_2: 'Motor',
      phone: '0544 733 73 73'
    };
    const filled = [];
    for (const [k, v] of Object.entries(defaults))
      if (!get(k)) {
        set(k, v);
        filled.push(k);
      }
    repairs.push({
      name: 'Varsayılan ayarlar',
      fixed: filled.length > 0,
      detail: filled.length ? filled.join(', ') + ' dolduruldu' : 'eksik yok'
    });
  } catch (e) {
    repairs.push({ name: 'Varsayılan ayarlar', fixed: false, detail: e.message });
  }

  // 3) Standart içerik sayfaları (kurumsal, iptal-iade vb.) eksikse ekle
  try {
    const std = [
      ['kurumsal', 'Kurumsal', '<p>Şirketimiz hakkında bilgileri yönetim panelinden düzenleyebilirsiniz.</p>'],
      ['dijital-katalog', 'Dijital Katalog', '<p>Dijital katalog yakında.</p>'],
      ['medya', 'Medya', '<p>Medya içerikleri yakında.</p>'],
      ['garanti', 'Garanti İşlemleri', '<p>Garanti işlemleri hakkında bilgi.</p>'],
      ['bakim-onarim', 'Bakım ve Onarım İşlemleri', '<p>Bakım ve onarım hakkında bilgi.</p>'],
      ['kisisel-bilgi-guvenligi', 'Kişisel Bilgi Güvenliği', '<p>Kişisel verileriniz yasal mevzuata uygun olarak korunur.</p>'],
      ['iptal-iade', 'İptal & İade', '<p>İptal ve iade koşulları.</p>'],
      ['hizmet-sozlesmesi', 'Hizmet Sözleşmesi', '<p>Hizmet sözleşmesi metni.</p>']
    ];
    const ins = db.prepare('INSERT OR IGNORE INTO pages(slug,title,body) VALUES(?,?,?)');
    let added = 0;
    for (const [slug, title, body] of std) {
      if (!db.prepare('SELECT 1 FROM pages WHERE slug=?').get(slug)) {
        ins.run(slug, title, body);
        added++;
      }
    }
    repairs.push({ name: 'Standart sayfalar', fixed: added > 0, detail: added ? added + ' sayfa eklendi' : 'eksik yok' });
  } catch (e) {
    repairs.push({ name: 'Standart sayfalar', fixed: false, detail: e.message });
  }

  // 4) Kampanyalar boşsa, hero dışı slaytlardan bir kez türet (mevcut kampanya bölümü kaybolmasın)
  try {
    const n = db.prepare('SELECT COUNT(*) n FROM campaigns').get().n;
    if (n === 0) {
      const extra = db
        .prepare('SELECT image,title,subtitle,old_price,new_price,link,sort FROM slides WHERE active=1 ORDER BY sort,id LIMIT -1 OFFSET 1')
        .all();
      if (extra.length) {
        const ins = db.prepare('INSERT INTO campaigns(image,title,subtitle,old_price,new_price,link,sort) VALUES(?,?,?,?,?,?,?)');
        for (const s of extra) ins.run(s.image, s.title || 'Kampanya', s.subtitle, s.old_price, s.new_price, s.link, s.sort);
        repairs.push({ name: 'Kampanyalar', fixed: true, detail: extra.length + ' kampanya slaytlardan oluşturuldu' });
      } else {
        repairs.push({ name: 'Kampanyalar', fixed: false, detail: 'kaynak slayt yok' });
      }
    } else {
      repairs.push({ name: 'Kampanyalar', fixed: false, detail: n + ' kampanya mevcut' });
    }
  } catch (e) {
    repairs.push({ name: 'Kampanyalar', fixed: false, detail: e.message });
  }

  // 5) Süresi geçen kampanyaları sil (anasayfadan otomatik kalkar, kaydı silinir)
  try {
    const del = db.prepare("DELETE FROM campaigns WHERE end_date IS NOT NULL AND end_date<>'' AND end_date < date('now')").run().changes;
    repairs.push({ name: 'Süresi geçen kampanyalar', fixed: del > 0, detail: del ? del + ' kampanya silindi' : 'yok' });
  } catch (e) {
    repairs.push({ name: 'Süresi geçen kampanyalar', fixed: false, detail: e.message });
  }

  // 4) Onaylı/tahsil edilmiş ama cariye işlenmemiş ödemeleri cariye yansıt (idempotent).
  // Yedek parça siparişine bağlı ödemeler HARİÇ: onların cari kaydı sipariş üzerinden oluşur
  // (payments.movement_id bilinçli olarak boş kalır) — aksi halde her onarımda aynı kayıt
  // yeniden "işlenmiş" gibi görünüp yanıltıcı bir onarım sayısı üretiyordu.
  try {
    const rows = db
      .prepare(
        `SELECT p.id FROM payments p
          WHERE p.deleted_at IS NULL AND p.movement_id IS NULL AND p.status IN (?,?)
            AND NOT EXISTS (SELECT 1 FROM spare_orders so WHERE so.payment_id=p.id AND so.deleted_at IS NULL)`
      )
      .all(STATUS.APPROVED, STATUS.COLLECTED);
    let n = 0;
    for (const r of rows) {
      try {
        syncPaymentCredit(r.id);
        // Yalnızca GERÇEKTEN cari kaydı oluştuysa "onarıldı" say
        const after = db.prepare('SELECT movement_id FROM payments WHERE id=?').get(r.id);
        if (after && after.movement_id) n++;
      } catch {
        /* yok say */
      }
    }
    repairs.push({ name: 'Ödeme → cari eşitleme', fixed: n > 0, detail: n ? n + ' ödeme cariye işlendi' : 'eksik yok' });
  } catch (e) {
    repairs.push({ name: 'Ödeme → cari eşitleme', fixed: false, detail: e.message });
  }

  // 5) Süresi dolmuş oturumlar ve eski giriş denemeleri
  try {
    const s = db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()).changes;
    const a = db.prepare('DELETE FROM login_attempts WHERE at<?').run(Date.now() - 24 * 3600 * 1000).changes;
    repairs.push({ name: 'Oturum / deneme temizliği', fixed: s + a > 0, detail: s + a + ' kayıt temizlendi' });
  } catch (e) {
    repairs.push({ name: 'Oturum / deneme temizliği', fixed: false, detail: e.message });
  }

  const fixedCount = repairs.filter(r => r.fixed).length;
  return { time: new Date().toISOString(), fixedCount, repairs };
}

// Açılışta ve periyodik olarak otomatik onarım + sistem testi çalıştırır.
// server.js (npm start) ve scripts/demo.js tarafından çağrılır.
function startAutoJobs(getPort, opts) {
  opts = opts || {};
  const log =
    opts.log ||
    function (m) {
      console.log(m);
    };
  const error =
    opts.error ||
    function (m) {
      console.error(m);
    };

  const runRepair = () => {
    try {
      const r = autoRepair();
      if (r.fixedCount > 0)
        log(
          '[otomatik onarım] ' +
            r.fixedCount +
            ' düzeltme: ' +
            r.repairs
              .filter(x => x.fixed)
              .map(x => x.name)
              .join(', ')
        );
      return r;
    } catch (e) {
      error(e && e.stack ? e.stack : String(e));
      return null;
    }
  };
  runRepair();
  const repairTimer = setInterval(runRepair, 30 * 60 * 1000);
  if (repairTimer.unref) repairTimer.unref();

  const runDiag = async () => {
    try {
      const res = await runSystemTests({ headers: {}, socket: { localPort: getPort() } });
      if (!res.ok) {
        const fails = [];
        for (const g of res.groups) for (const r of g.results) if (!r.ok) fails.push('[' + g.name + '] ' + r.name + ' => ' + r.detail);
        error('Sistem testi uyarıları: ' + fails.join(' | '));
      }
      return res;
    } catch (e) {
      error(e && e.stack ? e.stack : String(e));
      return null;
    }
  };
  const startupDiag = setTimeout(runDiag, 5000);
  if (startupDiag.unref) startupDiag.unref();
  const diagTimer = setInterval(runDiag, 6 * 60 * 60 * 1000);
  if (diagTimer.unref) diagTimer.unref();

  // Otomatik yedek: açılışta + saatlik; günde bir bütünlük doğrulaması (veri kaybına karşı).
  const backupLib = require('./backup');
  const doBackup = () => {
    try {
      const b = backupLib.runBackup();
      if (b.ok)
        log(
          '[yedek] ' +
            pth.basename(b.file || '') +
            ' · ' +
            (b.removed || 0) +
            ' eski silindi' +
            (b.encrypted ? ' · şifreli' : '') +
            (b.upload && b.upload.skipped ? ' · off-site kapalı' : '')
        );
      else error('[yedek] başarısız: ' + b.error);
      return b;
    } catch (e) {
      error(e && e.stack ? e.stack : String(e));
      return null;
    }
  };
  const doVerify = () => {
    try {
      const v = backupLib.verifyLatest();
      if (!v.ok) error('[yedek doğrulama] ' + (v.error || 'bozuk yedek'));
      return v;
    } catch (e) {
      error(e && e.stack ? e.stack : String(e));
      return null;
    }
  };
  const startupBackup = setTimeout(() => {
    doBackup();
    doVerify();
  }, 15000);
  if (startupBackup.unref) startupBackup.unref();
  const backupTimer = setInterval(doBackup, 60 * 60 * 1000); // saatlik
  if (backupTimer.unref) backupTimer.unref();
  const verifyTimer = setInterval(doVerify, 24 * 60 * 60 * 1000); // günlük doğrulama
  if (verifyTimer.unref) verifyTimer.unref();

  // Paratika mutabakat: dönüşü (callback) kaçmış ama Paratika'da onaylanmış ödemeleri
  // cariye işler. Ayrıca SÜRESİ DOLAN bekleyen kayıtları düşürür (bkz. scripts/reconcile.js):
  // kullanıcı ödeme sayfasından vazgeçtiyse kayıt "Sanal POS Bekliyor" olarak takılı kalmaz.
  const doReconcile = () => {
    try {
      const { reconcile } = require('../scripts/reconcile');
      return reconcile({ log: m => log('[mutabakat]' + m) })
        .then(r => {
          if (r.collected) log('[mutabakat] ' + r.collected + ' ödeme cariye işlendi');
          if (r.expired) log('[mutabakat] ' + r.expired + ' süresi dolan ödeme iptal edildi');
          return r;
        })
        .catch(e => error(e && e.stack ? e.stack : String(e)));
    } catch (e) {
      error(e && e.stack ? e.stack : String(e));
      return null;
    }
  };
  const recTimer = setInterval(doReconcile, 60 * 1000); // dakikada bir (süre dolumu için)
  if (recTimer.unref) recTimer.unref();
  // Açılıştan kısa süre sonra da bir kez çalıştır (callback kaçmış ödemeleri yakala).
  const startupReconcile = setTimeout(doReconcile, 25000);
  if (startupReconcile.unref) startupReconcile.unref();

  return { runRepair, runDiag, doBackup, doVerify, doReconcile };
}

module.exports = { runSystemTests, autoRepair, startAutoJobs, listViews };
