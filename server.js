const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const compression = require('compression');
const { allSettings, db } = require('./db');
const core = require('./lib/core');
const { UPLOAD_DIR } = require('./lib/upload');

// Hatalar hem konsola hem de logs/error.log dosyasına yazılır.
const LOG_DIR = path.join(__dirname, 'logs');
function logError(...args) {
  const line = new Date().toISOString() + ' ' +
    args.map(a => (a && a.stack) ? a.stack : String(a)).join(' ') + '\n';
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.appendFileSync(path.join(LOG_DIR, 'error.log'), line); } catch { /* yok say */ }
  console.error(...args);
}

require('./scripts/seed').ensureSeed();

const app = express();
app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Üretimde görünümler önbelleğe alınır (EJS her istekte derlemesin).
app.set('view cache', process.env.NODE_ENV === 'production');
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
// Varlık sürümü: css/js içeriği değişmediği sürece sabit kalır (tarayıcı önbelleği korunur).
function assetVersion() {
  const h = crypto.createHash('md5');
  const walk = dir => {
    let out = [];
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out = out.concat(walk(p)); else out.push(p);
    }
    return out;
  };
  for (const f of walk(path.join(__dirname, 'public', 'css')).concat(walk(path.join(__dirname, 'public', 'js')))) {
    try { const s = fs.statSync(f); h.update(f).update(String(s.size)).update(String(Math.round(s.mtimeMs))); } catch { /* yok say */ }
  }
  return h.digest('hex').slice(0, 8);
}
const ASSET_V = assetVersion();

// Yanıt sıkıştırma (gzip/brotli) — metin varlıklarında büyük kazanç.
app.use(compression());

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  const isPanel = /^\/(admin|bayi|servis|odeme)(\/|$)/.test(req.path);
  if (isPanel) res.setHeader('Cache-Control', 'no-store, private');
  const isSecure = process.env.COOKIE_SECURE === '1' || req.secure;
  if (isSecure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains; preload');
  const publicCsp = "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'self'; object-src 'none'";
  const panelCsp = "default-src 'self'; script-src 'self' 'unsafe-inline'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https:; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'self'; object-src 'none'";
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
const MULTIPART_UPLOAD_PATHS = [
  /^\/admin\/r\/[^/]+\/save$/, /^\/admin\/ayarlar$/, /^\/servis\/is-emri\/yeni$/, /^\/bayi\/is-emri\/yeni$/];
// Paratika dönüş adresi bizim CSRF token'ımızı taşımaz; güvenlik, ödemenin sunucudan
// sunucuya doğrulanmasıyla sağlanır (bkz. routes/odeme.js paratikaResult).
const CSRF_EXEMPT_PATHS = [/^\/odeme\/paratika\/sonuc$/];
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
  if (req.session.flash) { delete req.session.flash; req.saveSession(); }
  res.locals.money = core.fmtMoney;
  res.locals.date = core.fmtDate;
  res.locals.dateSlash = core.fmtDateSlash;
  res.locals.dt = core.fmtDateTime;
  res.locals.v = ASSET_V;
  res.locals.path = req.path;
  res.locals.origin = process.env.PUBLIC_URL || (req.protocol + '://' + req.get('host'));
  res.locals.files = req.files || [];
  // Güvenli JSON seri  üretici (script bağlamı için < vektörünü \u003c olarak kaçar)
  res.locals.j = (obj) => {
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
app.use('/bayi', require('./routes/bayi'));
app.use('/odeme', require('./routes/odeme'));
app.use('/servis', require('./routes/servis'));
app.use('/', require('./routes/site'));

app.use((req, res) => res.status(404).render('site/404', { title: 'Sayfa bulunamadı', active: '' }));
app.use((err, req, res, next) => {
  logError(err);
  if (err && err.name === 'MulterError') return res.status(400).send('Dosya yükleme hatası: ' + err.message);
  res.status(500).send('Beklenmeyen bir hata oluştu.');
});
process.on('uncaughtException', logError);
process.on('unhandledRejection', logError);

// Sunucuyu başlatır; zarif kapanış (SIGTERM/SIGINT) ve otomatik bakım işlerini kurar.
function start(port) {
  port = port || process.env.PORT || 3000;
  const server = app.listen(port, () => console.log(`Sunucu çalışıyor: http://localhost:${port}`));

  let closing = false;
  const shutdown = sig => {
    if (closing) return;
    closing = true;
    console.log((sig ? '[' + sig + '] ' : '') + 'Sunucu kapatılıyor...');
    server.close(() => {
      try { db.close(); } catch { /* yok say */ }
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

module.exports = app;
module.exports.start = start;
if (require.main === module) start(process.env.PORT || 3000);
