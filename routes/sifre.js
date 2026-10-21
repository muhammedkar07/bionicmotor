'use strict';
// ŞİFRE SIFIRLAMA (bayi / servis / online ödeme panelleri)
//
// Akış:
//   1) /sifre/unuttum        → e-posta adresi alınır
//   2) Kayıtlı + aktif kullanıcı varsa e-postaya tek kullanımlık bağlantı gönderilir
//      (kayıtlı değilse HİÇBİR e-posta gönderilmez; kullanıcıya yine aynı bilgi mesajı verilir)
//   3) /sifre/sifirla/<token> → yeni parola belirlenir, veritabanındaki parola güncellenir,
//      tüm eski oturumlar kapatılır ve bağlantı geçersiz olur.
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, tx, logAudit } = require('../db');
const { flash, throttle, publicOrigin, passwordError, PASSWORD_MIN } = require('../lib/core');
const mail = require('../lib/mail');

const router = express.Router();

const TTL_MIN = 60;
const PANELS = {
  bayi: { label: 'Bayi Paneli', login: '/bayi/giris' },
  servis: { label: 'Servis Paneli', login: '/servis/giris' },
  odeme: { label: 'Online Ödeme', login: '/odeme' }
};
const panelOf = p => {
  const k = String(p || '').toLowerCase();
  return PANELS[k] ? k : 'bayi';
};
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const validEmail = s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

// E-posta adresinin sistemde kayıtlı olup olmadığını DIŞARIYA sızdırmayan tek mesaj.
const GENERIC_MSG =
  'E-posta adresiniz sistemde kayıtlıysa şifre sıfırlama bağlantısı gönderilmiştir. Gelen kutunuzu ve spam klasörünü kontrol edin.';

function renderUnuttum(res, p) {
  res.render('sifre/unuttum', {
    title: 'Şifremi Unuttum',
    panel: p,
    panelLabel: PANELS[p].label,
    loginUrl: PANELS[p].login,
    mailOn: mail.enabled()
  });
}

router.get('/unuttum', (req, res) => {
  renderUnuttum(res, panelOf(req.query.p));
});

router.post('/unuttum', async (req, res) => {
  const p = panelOf(req.body.p || req.query.p);
  const email = String(req.body.email || '')
    .trim()
    .toLowerCase()
    .slice(0, 160);

  // Aynı IP'den dakikalar içinde onlarca mail tetiklenmesini engelle
  const t = throttle('reset:' + req.ip, 10, 30 * 60 * 1000);
  if (t.blocked) {
    flash(req, 'danger', 'Çok fazla talep gönderildi. Lütfen 30 dakika sonra tekrar deneyin.');
    return res.redirect('/sifre/unuttum?p=' + p);
  }
  if (!validEmail(email)) {
    flash(req, 'danger', 'Geçerli bir e-posta adresi girin.');
    return res.redirect('/sifre/unuttum?p=' + p);
  }
  t.hit();

  // Yalnızca kayıtlı ve aktif kullanıcıya gönderilir.
  const u = db.prepare('SELECT id, code, name, email FROM dealer_users WHERE lower(email)=? AND active=1').get(email);
  if (!u) {
    logAudit({ type: 'sistem', name: 'sifre' }, 'password_reset_request', 'dealer_user', null, { email, found: false }, req.ip);
    flash(req, 'info', GENERIC_MSG);
    return res.redirect('/sifre/unuttum?p=' + p);
  }

  if (!mail.enabled()) {
    logAudit({ type: 'sistem', name: 'sifre' }, 'password_reset_failed', 'dealer_user', u.id, { reason: 'smtp_not_configured' }, req.ip);
    flash(req, 'danger', 'E-posta gönderimi yapılandırılmamış. Lütfen bizimle iletişime geçin.');
    return res.redirect('/sifre/unuttum?p=' + p);
  }

  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM password_resets WHERE user_id=? AND used_at IS NULL').run(u.id);
  db.prepare("INSERT INTO password_resets(user_id,token_hash,expires_at,ip) VALUES(?,?,datetime('now','+" + TTL_MIN + " minutes'),?)").run(
    u.id,
    hashToken(token),
    req.ip
  );

  const link = publicOrigin(req) + '/sifre/sifirla/' + token + '?p=' + p;
  const site = res.locals.s || {};
  const content = mail.resetMail({ name: u.name, link, minutes: TTL_MIN, panel: PANELS[p].label, site });
  const sent = await mail.send({ to: u.email, replyTo: site.email || undefined, ...content });

  logAudit(
    { type: 'sistem', name: 'sifre' },
    sent.ok ? 'password_reset_request' : 'password_reset_failed',
    'dealer_user',
    u.id,
    { email: u.email, sent: !!sent.ok, error: sent.ok ? null : sent.error },
    req.ip
  );

  if (!sent.ok) {
    flash(req, 'danger', 'E-posta gönderilemedi. Lütfen birkaç dakika sonra tekrar deneyin veya bizimle iletişime geçin.');
    return res.redirect('/sifre/unuttum?p=' + p);
  }
  flash(req, 'success', GENERIC_MSG);
  res.redirect('/sifre/unuttum?p=' + p);
});

function resetRow(token) {
  if (!token || String(token).length < 20) return null;
  return db
    .prepare(
      `SELECT r.id, r.user_id, r.expires_at, u.name, u.code, u.email
         FROM password_resets r JOIN dealer_users u ON u.id=r.user_id
        WHERE r.token_hash=? AND r.used_at IS NULL AND r.expires_at > datetime('now') AND u.active=1`
    )
    .get(hashToken(token));
}

function renderReset(res, p, row, token) {
  res.render('sifre/sifirla', {
    title: 'Yeni Şifre Belirle',
    panel: p,
    panelLabel: PANELS[p].label,
    loginUrl: PANELS[p].login,
    token,
    row,
    minLen: PASSWORD_MIN
  });
}

router.get('/sifirla/:token', (req, res) => {
  const p = panelOf(req.query.p);
  const row = resetRow(req.params.token);
  if (!row) return res.status(410).render('sifre/gecersiz', { title: 'Bağlantı geçersiz', panel: p, loginUrl: PANELS[p].login });
  renderReset(res, p, row, req.params.token);
});

router.post('/sifirla/:token', (req, res) => {
  const p = panelOf(req.body.p || req.query.p);
  const row = resetRow(req.params.token);
  if (!row) return res.status(410).render('sifre/gecersiz', { title: 'Bağlantı geçersiz', panel: p, loginUrl: PANELS[p].login });

  const pass = String(req.body.password || '');
  const pass2 = String(req.body.password2 || '');
  const pe = passwordError(pass);
  if (pe) {
    flash(req, 'danger', pe);
    return res.redirect('/sifre/sifirla/' + req.params.token + '?p=' + p);
  }
  if (pass !== pass2) {
    flash(req, 'danger', 'Şifreler birbiriyle eşleşmiyor.');
    return res.redirect('/sifre/sifirla/' + req.params.token + '?p=' + p);
  }

  const hash = bcrypt.hashSync(pass, 12);
  tx(() => {
    db.prepare('UPDATE dealer_users SET password_hash=? WHERE id=?').run(hash, row.user_id);
    db.prepare("UPDATE password_resets SET used_at=datetime('now') WHERE id=?").run(row.id);
    // Kalan tüm sıfırlama bağlantıları geçersiz
    db.prepare('DELETE FROM password_resets WHERE user_id=? AND id<>?').run(row.user_id, row.id);
  });
  // Güvenlik: bu kullanıcının açık oturumlarını kapat (eski şifreyle açılmış olabilir)
  db.prepare('DELETE FROM sessions WHERE data LIKE ? OR data LIKE ?').run(
    '%"userId":' + row.user_id + ',%',
    '%"userId":' + row.user_id + '}%'
  );

  logAudit({ type: 'sistem', name: 'sifre' }, 'password_reset', 'dealer_user', row.user_id, { email: row.email, panel: p }, req.ip);
  flash(req, 'success', 'Şifreniz güncellendi. Yeni şifrenizle giriş yapabilirsiniz.');
  res.redirect(PANELS[p].login);
});

module.exports = router;
