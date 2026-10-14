const express = require('express');
const path = require('path');
const fs = require('fs');
const { allSettings } = require('./db');
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
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
// Statik varlıkların tarayıcı önbelleğini her sunucu başlangıcında tazeler.
const ASSET_V = Date.now().toString(36);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  const isPanel = /^\/(admin|bayi|servis|odeme)(\/|$)/.test(req.path);
  if (isPanel) res.setHeader('Cache-Control', 'no-store, private');
  const isSecure = process.env.COOKIE_SECURE === '1' || req.secure;
  if (isSecure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains; preload');
  const publicCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'self'; object-src 'none'";
  const panelCsp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https:; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'self'; object-src 'none'";
  res.setHeader('Content-Security-Policy', isPanel ? panelCsp : publicCsp);
  next();
});

// Yükleme dizini lib/upload tarafından oluşturulur; burada yalnızca statik olarak sunulur.
app.use('/static/uploads', express.static(UPLOAD_DIR, { maxAge: '1h' }));
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

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

module.exports = app;
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Sunucu çalışıyor: http://localhost:${port}`));
}
