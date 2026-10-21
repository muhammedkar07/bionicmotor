const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const compression = require('compression');
const { allSettings, db } = require('./db');
const core = require('./lib/core');
const { UPLOAD_DIR } = require('./lib/upload');
const paratika = require('./lib/paratika');

// Hatalar hem konsola hem de logs/error.log dosyasına yazılır.
const LOG_DIR = path.join(__dirname, 'logs');
function logError(...args) {
  const line = new Date().toISOString() + ' ' + args.map(a => (a && a.stack ? a.stack : String(a))).join(' ') + '\n';
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, 'error.log'), line);
  } catch {
    /* yok say */
  }
  console.error(...args);
}

require('./scripts/seed').ensureSeed();

const app = express();

// Alt yol (subpath) desteği. Ör. BASE_PATH=/bionic → uygulama https://site/bionic/ altında çalışır.
// HTML bağlantıları, sunucu yönlendirmeleri ve ödeme dönüş adresi bu öneki kullanır.
// Boş bırakılırsa (varsayılan) uygulama kökte çalışır ve hiçbir şey değişmez.
const BASE = (process.env.BASE_PATH || '').trim().replace(/\/+$/, '');

app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Üretimde görünümler önbelleğe alınır (EJS her istekte derlemesin).
app.set('view cache', process.env.NODE_ENV === 'production');

// BASE_PATH doluysa, EJS çıktısındaki köke-göreli bağlantıları (href/src/action ve satır içi
// fetch/location) alt yol önekiyle yeniden yazar. Böylece tüm sayfalar /bionic/... üretir.
if (BASE) {
  const ejs = require('ejs');
  const ejsExpr = ejs.__express;
  const rewrite = html =>
    html
      .replace(/\b(href|src|action)=(["'])\/(?!\/)/g, '$1=$2' + BASE + '/')
      .replace(/\b(fetch|location\.assign|location\.replace)\((["'])\/(?!\/)/g, '$1($2' + BASE + '/')
      .replace(/\blocation(\.href)?=(["'])\/(?!\/)/g, 'location$1=$2' + BASE + '/');
  app.engine('ejs', (file, opts, cb) =>
    ejsExpr(file, opts, (err, str) => (err ? cb(err) : cb(null, rewrite(str))))
  );
}
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
// Varlık sürümü: css/js içeriği değişmediği sürece sabit kalır (tarayıcı önbelleği korunur).
function assetVersion() {
  const h = crypto.createHash('md5');
  const walk = dir => {
    let out = [];
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out = out.concat(walk(p));
      else out.push(p);
    }
    return out;
  };
  for (const f of walk(path.join(__dirname, 'public', 'css')).concat(walk(path.join(__dirname, 'public', 'js')))) {
    try {
      const s = fs.statSync(f);
      h.update(f)
        .update(String(s.size))
        .update(String(Math.round(s.mtimeMs)));
    } catch {
      /* yok say */
    }
  }
  return h.digest('hex').slice(0, 8);
}
const ASSET_V = assetVersion();

// CSP form-action izin listesi — ödeme formu kendine POST eder, sunucu 302 ile Paratika'nın
// barındırılan ödeme sayfasına yönlendirir. form-action 'self' tek başına bu yönlendirmeyi
// ENGELLER (tarayıcı net::ERR_ABORTED verir), bu yüzden Paratika adresleri eklenmelidir.
const PAY_FORM_ACTION = (() => {
  const set = new Set(['https://entegrasyon.paratika.com.tr', 'https://vpos.paratika.com.tr']);
  try {
    const c = paratika.cfg();
    for (const u of [c.apiBase, c.hppUrl]) {
      if (u) set.add(new URL(String(u).replace('{token}', 'x')).origin);
    }
  } catch {
    /* varsayılanlar yeterli */
  }
  return [...set].join(' ');
})();

// Yanıt sıkıştırma (gzip/brotli) — metin varlıklarında büyük kazanç.
app.use(compression());

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  const isPanel = /^\/(admin|bayi|servis|odeme)(\/|$)/.test(req.path);
  // HTML sayfaları ASLA önbellekten sunulmaz; aksi halde tarayıcı eski (ör. eski CSP'li) sayfayı
  // gösterip Paratika yönlendirmesini engelleyebilir. Statik varlıklar kendi başlıklarını alır.
  const isStatic = /^\/(static|uploads)(\/|$)/.test(req.path);
  if (!isStatic) res.setHeader('Cache-Control', isPanel ? 'no-store, private' : 'no-cache');
  const isSecure = process.env.COOKIE_SECURE === '1' || req.secure;
  if (isSecure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains; preload');
  // İstek başına rastgele nonce: satır içi <script> blokları yalnızca bu nonce ile çalışır.
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.nonce = nonce;
  const publicCsp = `default-src 'self'; script-src 'self' 'nonce-${nonce}'; script-src-attr 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self'; form-action 'self' ${PAY_FORM_ACTION}; base-uri 'self'; frame-ancestors 'self'; object-src 'none'`;
  const panelCsp = `default-src 'self'; script-src 'self' 'nonce-${nonce}'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https:; connect-src 'self'; form-action 'self' ${PAY_FORM_ACTION}; base-uri 'self'; frame-ancestors 'self'; object-src 'none'`;
  res.setHeader('Content-Security-Policy', isPanel ? panelCsp : publicCsp);
  next();
});

// Yükleme dizini lib/upload tarafından oluşturulur; burada yalnızca statik olarak sunulur.
// Yüklenen dosya adları rastgele olduğundan uzun süreli (immutable) önbellek güvenlidir.
app.use('/static/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

app.use(core.sessionMiddleware);
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
// multipart/form-data yalnızca dosya yükleyen rotalarda kabul edilir. Bu rotalarda CSRF
// kontrolü, gövde Multer ile ayrıştırıldıktan sonra rota içinde yapılır. Tüm diğer
// isteklerde CSRF kontrolü burada, dosya diske yazılmadan önce yapılır.
const MULTIPART_UPLOAD_PATHS = [/^\/admin\/r\/[^/]+\/save$/, /^\/admin\/ayarlar$/, /^\/servis\/is-emri\/yeni$/, /^\/bayi\/is-emri\/yeni$/];
// Paratika dönüş adresi bizim CSRF token'ımızı taşımaz; güvenlik, ödemenin sunucudan
// sunucuya doğrulanmasıyla sağlanır (bkz. routes/odeme.js paratikaResult).
const CSRF_EXEMPT_PATHS = [/^\/odeme\/paratika\/sonuc(\/.*)?$/];
app.use((req, res, next) => {
  if (CSRF_EXEMPT_PATHS.some(re => re.test(req.path))) return next();
  if (!(req.headers['content-type'] || '').startsWith('multipart/form-data')) return core.csrfCheck(req, res, next);
  if (!MULTIPART_UPLOAD_PATHS.some(re => re.test(req.path))) return res.status(415).send('Desteklenmeyen içerik türü.');
  next();
});

app.use((req, res, next) => {
  res.locals.s = allSettings();
  res.locals.csrf = req.csrf;
  res.locals.flash = req.session.flash || null;
  if (req.session.flash) {
    delete req.session.flash;
    req.saveSession();
  }
  res.locals.money = core.fmtMoney;
  res.locals.date = core.fmtDate;
  res.locals.dateSlash = core.fmtDateSlash;
  res.locals.dt = core.fmtDateTime;
  res.locals.v = ASSET_V;
  res.locals.path = req.path;
  res.locals.base = BASE;
  res.locals.origin = process.env.PUBLIC_URL || req.protocol + '://' + req.get('host') + BASE;
  // Sunucu taraflı yönlendirmeleri de alt yol öneki ile üret.
  if (BASE) {
    const _redirect = res.redirect.bind(res);
    res.redirect = function (a, b) {
      let status = 302;
      let url = a;
      if (typeof a !== 'string') {
        status = a;
        url = b;
      }
      if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) url = BASE + url;
      return _redirect(status, url);
    };
  }
  res.locals.files = req.files || [];
  // Güvenli JSON seri  üretici (script bağlamı için < vektörünü \u003c olarak kaçar)
  res.locals.j = obj => {
    try {
      return JSON.stringify(obj == null ? null : obj)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
    } catch (e) {
      return 'null';
    }
  };
  next();
});

app.use('/admin', require('./routes/admin'));
app.use('/sifre', require('./routes/sifre'));
app.use('/bayi', require('./routes/bayi'));
app.use('/odeme', require('./routes/odeme'));
app.use('/servis', require('./routes/servis'));
app.use('/', require('./routes/site'));

app.use((req, res) => res.status(404).render('site/404', { title: 'Sayfa bulunamadı', active: '' }));
app.use((err, req, res, next) => {
  logError(err);
  if (err && err.name === 'MulterError')
    return res
      .status(400)
      .send(
        (err.code === 'LIMIT_FILE_SIZE' ? 'Dosya çok büyük (en fazla 12 MB).' : 'Dosya yükleme hatası: ' + err.message) +
          ' Geri dönüp tekrar deneyin.'
      );
  res.status(500).send('Beklenmeyen bir hata oluştu.');
});
process.on('uncaughtException', logError);
process.on('unhandledRejection', logError);

// BASE_PATH doluysa uygulamayı bu önek altında sunacak dış uygulama (aksi halde app'in kendisi).
const rootApp = BASE
  ? (() => {
      const o = express();
      o.disable('x-powered-by');
      o.use(BASE, app);
      return o;
    })()
  : app;

// Sunucuyu başlatır; zarif kapanış (SIGTERM/SIGINT) ve otomatik bakım işlerini kurar.
function start(port) {
  port = port || process.env.PORT || 3000;
  const server = rootApp.listen(port, () => console.log(`Sunucu çalışıyor: http://localhost:${port}${BASE}`));

  let closing = false;
  const shutdown = sig => {
    if (closing) return;
    closing = true;
    console.log((sig ? '[' + sig + '] ' : '') + 'Sunucu kapatılıyor...');
    server.close(() => {
      try {
        db.close();
      } catch {
        /* yok say */
      }
      process.exit(0);
    });
    const t = setTimeout(() => process.exit(0), 10000);
    if (t.unref) t.unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Açılışta ve periyodik: otomatik onarım + sistem testi (sorunları logs/error.log'a yazar).
  require('./lib/diagnostics').startAutoJobs(() => server.address().port, { log: console.log, error: logError });
  return server;
}

module.exports = Object.assign(rootApp, { start });
if (require.main === module) start(process.env.PORT || 3000);
