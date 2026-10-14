const crypto = require('crypto');
const fs = require('fs');
const { db } = require('../db');

const SESSION_TTL = 1000 * 60 * 60 * 8;

const fmtMoney = (n, d = 0) =>
  Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 2) });
const fmtDate = s => {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
};
const fmtDateTime = s => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}` : fmtDate(s);
};
// Garanti bitiş tarihi gibi alanlar için gg/aa/yyyy biçimi.
const fmtDateSlash = s => {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
};
// YYYY-MM-DD tarihine saat dilimi kayması olmadan yıl ekler.
const addYears = (dateStr, years) => {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1] + years, +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10);
};

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// Oturum: çerezde yalnızca rastgele kimlik; veri veritabanında tutulur.
function sessionMiddleware(req, res, next) {
  const cookies = parseCookies(req);
  let row = cookies.sid && db.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').get(cookies.sid, Date.now());
  if (!row) {
    const id = crypto.randomBytes(32).toString('hex');
    const csrf = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions(id,data,csrf,expires) VALUES(?,?,?,?)').run(id, '{}', csrf, Date.now() + SESSION_TTL);
    row = { id, data: '{}', csrf };
    const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `sid=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}`);
  }
  req.sid = row.id;
  req.csrf = row.csrf;
  req.session = JSON.parse(row.data);
  const before = row.data;
  res.on('finish', () => {
    const now = JSON.stringify(req.session);
    if (now !== before) db.prepare('UPDATE sessions SET data=? WHERE id=?').run(now, req.sid);
  });
  // data kaydı yanıt gönderilmeden önce de yapılabilsin diye
  req.saveSession = () => db.prepare('UPDATE sessions SET data=? WHERE id=?').run(JSON.stringify(req.session), req.sid);
  next();
}

// Sabit süreli karşılaştırma: token uzunluğu sızsa bile içerik zamanlamadan çıkarılamaz.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a == null ? '' : a), 'utf8');
  const bb = Buffer.from(String(b == null ? '' : b), 'utf8');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function csrfCheck(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = (req.body && req.body._csrf) || (req.query && req.query._csrf) || req.headers['x-csrf-token'];
  if (!safeEqual(token, req.csrf)) {
    // CSRF reddedilse bile yüklenen dosyalar diskte kalmamalı.
    const files = Array.isArray(req.files) ? req.files
      : req.files && typeof req.files === 'object' ? Object.values(req.files).flat()
        : req.file ? [req.file] : [];
    for (const f of files) { try { fs.unlinkSync(f.path); } catch { /* yok say */ } }
    return res.status(403).send('Geçersiz istek (CSRF). Sayfayı yenileyip tekrar deneyin.');
  }
  next();
}

// ---- Parola politikası ----
// En az 14 karakter; en az bir büyük harf, bir küçük harf, bir rakam ve bir simge.
const PASSWORD_MIN = 14;
function passwordError(password) {
  const s = String(password == null ? '' : password);
  if (s.length < PASSWORD_MIN) return `Parola en az ${PASSWORD_MIN} karakter olmalıdır.`;
  if (s.length > 200) return 'Parola en fazla 200 karakter olabilir.';
  if (!/[A-ZÇĞİÖŞÜ]/.test(s)) return 'Parola en az bir büyük harf içermelidir.';
  if (!/[a-zçğıöşü]/.test(s)) return 'Parola en az bir küçük harf içermelidir.';
  if (!/[0-9]/.test(s)) return 'Parola en az bir rakam içermelidir.';
  if (!/[^0-9A-Za-zÇĞİÖŞÜçğıöşü]/.test(s)) return 'Parola en az bir simge (ör. ! @ # $ % ?) içermelidir.';
  return null;
}

function flash(req, type, msg) { req.session.flash = { type, msg }; req.saveSession(); }

// Basit giriş denemesi sınırlaması (veritabanı tabanlı; yeniden başlatmada sıfırlanmaz).
// Anahtar genelde "<alan>:<ip>:<kullanıcı kodu>" olduğundan aynı IP'yi paylaşan farklı
// kullanıcılar birbirini kilitlemez.
function throttle(key, max = 8, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  db.prepare('DELETE FROM login_attempts WHERE key=? AND at<?').run(key, now - windowMs);
  const count = db.prepare('SELECT COUNT(*) c FROM login_attempts WHERE key=?').get(key).c;
  return {
    blocked: count >= max,
    hit: () => db.prepare('INSERT INTO login_attempts(key,at) VALUES(?,?)').run(key, Date.now()),
    reset: () => db.prepare('DELETE FROM login_attempts WHERE key=?').run(key)
  };
}

// Süresi dolmuş oturumları ve eski giriş denemelerini periyodik olarak temizle.
function purgeOld() {
  try {
    db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    db.prepare('DELETE FROM login_attempts WHERE at<?').run(Date.now() - 24 * 60 * 60 * 1000);
  } catch { /* yok say */ }
}
purgeOld();
const purgeTimer = setInterval(purgeOld, 60 * 60 * 1000);
if (purgeTimer.unref) purgeTimer.unref();

const AREAS = ['admin', 'dealer', 'pay', 'servis'];
// Yönetim, bayi ve ödeme oturumları aynı çerezi paylaşır; bir alanda giriş/çıkış diğerlerini etkilemez.
function regenerate(req, res, area) {
  const keep = {};
  if (area) AREAS.filter(k => k !== area && req.session[k]).forEach(k => { keep[k] = req.session[k]; });
  db.prepare('DELETE FROM sessions WHERE id=?').run(req.sid);
  const id = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions(id,data,csrf,expires) VALUES(?,?,?,?)').run(id, JSON.stringify(keep), csrf, Date.now() + SESSION_TTL);
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}`);
  req.sid = id; req.csrf = csrf; req.session = keep;
}

const luhn = num => {
  const d = String(num).replace(/\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = +d[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
};

module.exports = { fmtMoney, fmtDate, fmtDateTime, fmtDateSlash, addYears, sessionMiddleware, csrfCheck, flash, throttle, regenerate, purgeOld, luhn, SESSION_TTL, passwordError, PASSWORD_MIN };
