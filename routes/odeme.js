const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { flash, throttle, regenerate, luhn } = require('../lib/core');
const pay = require('../lib/pay');

const DUMMY = bcrypt.hashSync('x', 10);

const payUser = req => {
  const p = req.session.pay;
  return (p && db.prepare('SELECT * FROM dealer_users WHERE id=? AND active=1').get(p.userId)) || null;
};

// Giriş artık ödeme sayfasının (/odeme) kendisinde yapılır.
router.get('/giris', (req, res) => res.redirect('/odeme'));

router.post('/giris', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 160);
  const pass = String(req.body.password || '').slice(0, 200);
  const t = throttle('odeme:' + req.ip + ':' + email);
  if (t.blocked) { flash(req, 'danger', 'Çok fazla hatalı deneme. Daha sonra tekrar deneyin.'); return res.redirect('/odeme'); }
  const u = db.prepare('SELECT * FROM dealer_users WHERE lower(email)=? AND active=1').get(email);
  const ok = bcrypt.compareSync(pass, u ? u.password_hash : DUMMY) && u;
  const firm = ok && db.prepare(
    'SELECT f.id FROM firms f JOIN user_firms uf ON uf.firm_id=f.id WHERE uf.user_id=? AND f.active=1 ORDER BY f.id').get(u.id);
  if (!ok || !firm) { t.hit(); flash(req, 'danger', 'E-posta veya şifre hatalı.'); return res.redirect('/odeme'); }
  t.reset();
  regenerate(req, res, 'pay');
  req.session.pay = { userId: u.id, firmId: firm.id };
  req.saveSession();
  res.redirect('/odeme');
});

router.post('/cikis', (req, res) => { regenerate(req, res, 'pay'); res.redirect('/odeme'); });

router.get('/', (req, res) => {
  const u = payUser(req);
  if (!u) return res.render('odeme/login', { title: 'Üye Girişi', pu: null });
  res.locals.pu = u;
  const inst = db.prepare('SELECT * FROM installments WHERE active=1 ORDER BY count').all();
  res.render('odeme/pay', { title: 'Ödeme Ekranı', inst });
});

router.use((req, res, next) => {
  const u = payUser(req);
  if (!u) return res.redirect('/odeme');
  res.locals.pu = u;
  next();
});

const payCtx = (req, res) => ({ userId: res.locals.pu.id, firmId: req.session.pay.firmId });

router.post('/ode', (req, res) => {
  const b = req.body;
  const method = ['kart', 'havale'].includes(b.method) ? b.method : 'kart';
  const r = method === 'havale' ? pay.havale(payCtx(req, res), b) : pay.card(payCtx(req, res), b);
  flash(req, r.error ? 'danger' : 'success', r.error || r.msg);
  res.redirect('/odeme');
});

router.post('/talimat', (req, res) => {
  const r = pay.talimat(payCtx(req, res), req.body);
  flash(req, r.error ? 'danger' : 'success', r.error || r.msg);
  res.redirect('/odeme');
});

module.exports = router;
