const express = require('express');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const { allSettings } = require('./db');
const core = require('./lib/core');

require('./scripts/seed').ensureSeed();

const app = express();
app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

const fs = require('fs');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const ALLOWED = { '.jpg': 1, '.jpeg': 1, '.png': 1, '.webp': 1, '.gif': 1, '.pdf': 1 };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) =>
      cb(null, crypto.randomBytes(12).toString('hex') + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) =>
    cb(null, !!ALLOWED[path.extname(file.originalname).toLowerCase()] && /^(image\/|application\/pdf)/.test(file.mimetype))
});

app.use(core.sessionMiddleware);
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(upload.any());
app.use(core.csrfCheck);

app.use((req, res, next) => {
  res.locals.s = allSettings();
  res.locals.csrf = req.csrf;
  res.locals.flash = req.session.flash || null;
  if (req.session.flash) { delete req.session.flash; req.saveSession(); }
  res.locals.money = core.fmtMoney;
  res.locals.date = core.fmtDate;
res.locals.dateSlash = core.fmtDateSlash;
  res.locals.dt = core.fmtDateTime;
  res.locals.path = req.path;
  res.locals.files = req.files || [];
  next();
});

app.use('/admin', require('./routes/admin'));
app.use('/bayi', require('./routes/bayi'));
app.use('/odeme', require('./routes/odeme'));
app.use('/servis', require('./routes/servis'));
app.use('/', require('./routes/site'));

app.use((req, res) => res.status(404).render('site/404', { title: 'Sayfa bulunamadı', active: '' }));
app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) return res.status(400).send('Dosya yükleme hatası: ' + err.message);
  res.status(500).send('Beklenmeyen bir hata oluştu.');
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Sunucu çalışıyor: http://localhost:${port}`));
