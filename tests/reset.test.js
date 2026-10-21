'use strict';
// ŞİFRE SIFIRLAMA testleri.
// E-posta GÖNDERİLMEZ: MAIL_CAPTURE_FILE tanımlı olduğu için iletiler dosyaya yazılır
// (lib/mail.js) ve testte bağlantı buradan okunur.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bionic-reset-'));
const MAIL_FILE = path.join(TMP, 'mail.json');
process.env.DATA_DIR = TMP;
process.env.UPLOAD_DIR = path.join(TMP, 'uploads');
process.env.ADMIN_PASSWORD = 'TestAdmin1234!xy';
process.env.SEED_DEMO = '0';
process.env.NODE_ENV = 'test';
process.env.MAIL_CAPTURE_FILE = MAIL_FILE;
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.SMTP_FROM;

const app = require('../server');
const { db } = require('../db');

let server, base;
test.before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => {
  server && server.close();
});

// ---- HTTP yardımcıları ----
const sidOf = res => {
  const m = (res.headers.get('set-cookie') || '').match(/sid=([^;]+)/);
  return m ? 'sid=' + m[1] : '';
};
const csrfOf = html => {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : '';
};
async function get(url, cookie) {
  const res = await fetch(base + url, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  const html = res.status === 200 ? await res.text() : '';
  return { res, html, cookie: sidOf(res) || cookie };
}
async function postForm(url, fields, cookie) {
  return fetch(base + url, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: cookie || '', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields)
  });
}

const NEW = 'YeniParola456!y';
const OLD = 'EskiParola123!x';

let seq = 0;
function newUser(email, { active = 1 } = {}) {
  const code = 'R' + Date.now().toString(36) + ++seq;
  return Number(
    db
      .prepare("INSERT INTO dealer_users(code,email,name,password_hash,active,role) VALUES(?,?,?,?,?,'bayi')")
      .run(code, email, 'Test Kullanıcı ' + seq, bcrypt.hashSync(OLD, 10), active).lastInsertRowid
  );
}
const mails = () => {
  try {
    return JSON.parse(fs.readFileSync(MAIL_FILE, 'utf8')) || [];
  } catch {
    return [];
  }
};
const clearMails = () => {
  try {
    fs.unlinkSync(MAIL_FILE);
  } catch {
    /* yok */
  }
};
const resetThrottle = () => db.prepare("DELETE FROM login_attempts WHERE key LIKE 'reset:%'").run();
const tokenOf = m => (String((m && m.text) || '').match(/\/sifre\/sifirla\/([a-f0-9]{64})/) || [])[1];

async function requestReset(email) {
  const g = await get('/sifre/unuttum?p=bayi');
  const res = await postForm('/sifre/unuttum', { email, p: 'bayi', _csrf: csrfOf(g.html) }, g.cookie);
  return { res, cookie: sidOf(res) || g.cookie };
}

test('sayfa açılır: giriş ekranlarında "Şifremi Unuttum" bağlantısı var', async () => {
  for (const p of ['/bayi/giris', '/servis/giris', '/odeme']) {
    const g = await get(p);
    assert.strictEqual(g.res.status, 200, p + ' açılmalı');
    assert.ok(g.html.includes('/sifre/unuttum'), p + ' sayfasında sıfırlama bağlantısı olmalı');
  }
  const f = await get('/sifre/unuttum?p=bayi');
  assert.strictEqual(f.res.status, 200);
  assert.ok(f.html.includes('name="email"'), 'e-posta alanı olmalı');
});

test('kayıtlı OLMAYAN e-posta için e-posta gönderilmez, bağlantı üretilmez', async () => {
  clearMails();
  resetThrottle();
  const before = db.prepare('SELECT COUNT(*) c FROM password_resets').get().c;
  const { res } = await requestReset('kayitsiz@firma.local');
  assert.strictEqual(res.status, 302);
  assert.strictEqual(mails().length, 0, 'kayıtsız adrese mail gitmemeli');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM password_resets').get().c, before, 'bağlantı üretilmemeli');
});

test('kayıtlı e-posta için tek kullanımlık bağlantı e-postayla gönderilir', async () => {
  clearMails();
  resetThrottle();
  const id = newUser('uye@firma.local');
  const { res } = await requestReset('UYE@Firma.Local'); // büyük/küçük harf duyarsız
  assert.strictEqual(res.status, 302);

  const m = mails();
  assert.strictEqual(m.length, 1, 'tek e-posta gönderilmeli');
  assert.strictEqual(m[0].to, 'uye@firma.local');
  assert.ok(/sıfırlama/i.test(m[0].subject), 'konu şifre sıfırlama olmalı');

  const token = tokenOf(m[0]);
  assert.ok(token && token.length === 64, 'bağlantıda 64 karakterlik token olmalı');
  const row = db.prepare('SELECT * FROM password_resets WHERE user_id=?').get(id);
  assert.ok(row, 'token kaydı oluşmalı');
  assert.strictEqual(row.used_at, null);
  const stored = db.prepare('SELECT token_hash FROM password_resets WHERE user_id=?').get(id).token_hash;
  assert.notStrictEqual(stored, token, 'token düz metin saklanmamalı (hash)');

  // Form açılır
  const form = await get('/sifre/sifirla/' + token + '?p=bayi');
  assert.strictEqual(form.res.status, 200, 'geçerli bağlantı formu açmalı');
  assert.ok(form.html.includes('name="password2"'), 'parola tekrar alanı olmalı');
});

test('zayıf parola ve eşleşmeyen parola reddedilir', async () => {
  clearMails();
  resetThrottle();
  const id = newUser('zayif@firma.local');
  await requestReset('zayif@firma.local');
  const token = tokenOf(mails()[0]);
  const form = await get('/sifre/sifirla/' + token + '?p=bayi');
  const csrf = csrfOf(form.html);

  const weak = await postForm('/sifre/sifirla/' + token, { password: 'kisa', password2: 'kisa', p: 'bayi', _csrf: csrf }, form.cookie);
  assert.strictEqual(weak.status, 302, 'hata ile forma dönmeli');
  let u = db.prepare('SELECT password_hash FROM dealer_users WHERE id=?').get(id);
  assert.ok(bcrypt.compareSync(OLD, u.password_hash), 'zayıf parola kaydedilmemeli');

  const mismatch = await postForm('/sifre/sifirla/' + token, { password: NEW, password2: NEW + 'x', p: 'bayi', _csrf: csrf }, form.cookie);
  assert.strictEqual(mismatch.status, 302);
  u = db.prepare('SELECT password_hash FROM dealer_users WHERE id=?').get(id);
  assert.ok(bcrypt.compareSync(OLD, u.password_hash), 'eşleşmeyen parola kaydedilmemeli');
});

test('geçerli parola güncellenir; eski oturumlar kapanır; bağlantı tek kullanımlıktır', async () => {
  clearMails();
  resetThrottle();
  const id = newUser('yeni@firma.local');
  // Kullanıcının açık bir oturumu var (eski parolayla açılmış)
  db.prepare('INSERT INTO sessions(id,data,csrf,expires) VALUES(?,?,?,?)').run(
    'test-session-' + id,
    JSON.stringify({ bayi: { userId: id, firmId: 1 } }),
    'c',
    Date.now() + 3600000
  );

  await requestReset('yeni@firma.local');
  const token = tokenOf(mails()[0]);
  const form = await get('/sifre/sifirla/' + token + '?p=bayi');
  const res = await postForm(
    '/sifre/sifirla/' + token,
    { password: NEW, password2: NEW, p: 'bayi', _csrf: csrfOf(form.html) },
    form.cookie
  );
  assert.strictEqual(res.status, 302, 'başarılı olunca giriş ekranına dönmeli');
  assert.ok(String(res.headers.get('location')).includes('/bayi/giris'), 'bayi girişine yönlenmeli');

  const u = db.prepare('SELECT password_hash FROM dealer_users WHERE id=?').get(id);
  assert.ok(bcrypt.compareSync(NEW, u.password_hash), 'YENİ parola veritabanında olmalı');
  assert.ok(!bcrypt.compareSync(OLD, u.password_hash), 'eski parola artık geçersiz olmalı');

  const row = db.prepare('SELECT * FROM password_resets WHERE user_id=?').get(id);
  assert.ok(row.used_at, 'token kullanıldı olarak işaretlenmeli');
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) c FROM sessions WHERE id=?').get('test-session-' + id).c,
    0,
    'eski oturum kapatılmalı'
  );

  // Aynı bağlantı ikinci kez kullanılamaz
  const again = await get('/sifre/sifirla/' + token + '?p=bayi');
  assert.strictEqual(again.res.status, 410, 'kullanılmış bağlantı geçersiz olmalı');
  const again2 = await postForm(
    '/sifre/sifirla/' + token,
    { password: 'BaskaParola789!z', password2: 'BaskaParola789!z', p: 'bayi', _csrf: csrfOf(form.html) },
    form.cookie
  );
  assert.strictEqual(again2.status, 410, 'kullanılmış bağlantıyla parola değiştirilememeli');
});

test('süresi dolmuş bağlantı çalışmaz', async () => {
  clearMails();
  resetThrottle();
  const id = newUser('sure@firma.local');
  await requestReset('sure@firma.local');
  const token = tokenOf(mails()[0]);
  db.prepare("UPDATE password_resets SET expires_at=datetime('now','-1 minute') WHERE user_id=?").run(id);
  const g = await get('/sifre/sifirla/' + token + '?p=bayi');
  assert.strictEqual(g.res.status, 410);
});

test('rastgele/başka token ile parola değiştirilemez', async () => {
  const fake = 'a'.repeat(64);
  const g = await get('/sifre/sifirla/' + fake + '?p=bayi');
  assert.strictEqual(g.res.status, 410);
});

test('pasif (kapatılmış) kullanıcıya bağlantı gönderilmez', async () => {
  clearMails();
  resetThrottle();
  newUser('pasif@firma.local', { active: 0 });
  await requestReset('pasif@firma.local');
  assert.strictEqual(mails().length, 0, 'pasif kullanıcıya mail gitmemeli');
});

test('yeni istek eski bağlantıyı geçersiz kılar', async () => {
  clearMails();
  resetThrottle();
  const id = newUser('ikinci@firma.local');
  await requestReset('ikinci@firma.local');
  const first = tokenOf(mails()[0]);
  await requestReset('ikinci@firma.local');
  const second = tokenOf(mails()[1]);
  assert.notStrictEqual(first, second);
  assert.strictEqual((await get('/sifre/sifirla/' + first + '?p=bayi')).res.status, 410, 'eski bağlantı geçersiz olmalı');
  assert.strictEqual((await get('/sifre/sifirla/' + second + '?p=bayi')).res.status, 200, 'yeni bağlantı çalışmalı');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM password_resets WHERE user_id=?').get(id).c, 1, 'tek aktif token kalmalı');
});
