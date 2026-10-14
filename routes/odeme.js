const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, tx, syncPaymentCredit, STATUS, logAudit } = require('../db');
const { flash, throttle, regenerate, publicOrigin } = require('../lib/core');
const pay = require('../lib/pay');
const paratika = require('../lib/paratika');

const DUMMY = bcrypt.hashSync('x', 10);

const payUser = req => {
  const p = req.session.pay;
  return (p && db.prepare('SELECT * FROM dealer_users WHERE id=? AND active=1').get(p.userId)) || null;
};

// Giriş artık ödeme sayfasının (/odeme) kendisinde yapılır.
router.get('/giris', (req, res) => res.redirect('/odeme'));

router.post('/giris', (req, res) => {
  const email = String(req.body.email || '')
    .trim()
    .toLowerCase()
    .slice(0, 160);
  const pass = String(req.body.password || '').slice(0, 200);
  const t = throttle('odeme:' + req.ip + ':' + email);
  if (t.blocked) {
    flash(req, 'danger', 'Çok fazla hatalı deneme. Daha sonra tekrar deneyin.');
    return res.redirect('/odeme');
  }
  const u = db.prepare('SELECT * FROM dealer_users WHERE lower(email)=? AND active=1').get(email);
  const ok = bcrypt.compareSync(pass, u ? u.password_hash : DUMMY) && u;
  const firm =
    ok &&
    db.prepare('SELECT f.id FROM firms f JOIN user_firms uf ON uf.firm_id=f.id WHERE uf.user_id=? AND f.active=1 ORDER BY f.id').get(u.id);
  if (!ok || !firm) {
    t.hit();
    logAudit({ type: 'odeme', name: email }, 'login_failed', 'dealer_user', null, null, req.ip);
    flash(req, 'danger', 'E-posta veya şifre hatalı.');
    return res.redirect('/odeme');
  }
  t.reset();
  regenerate(req, res, 'pay');
  req.session.pay = { userId: u.id, firmId: firm.id };
  req.saveSession();
  logAudit({ type: 'odeme', id: u.id, name: email }, 'login', 'dealer_user', u.id, { firm: firm.id }, req.ip);
  res.redirect('/odeme');
});

router.post('/cikis', (req, res) => {
  const u = payUser(req);
  if (u) logAudit({ type: 'odeme', id: u.id, name: u.email || u.code }, 'logout', 'dealer_user', u.id, null, req.ip);
  regenerate(req, res, 'pay');
  res.redirect('/odeme');
});

// Aktif firma seçimi (kullanıcının birden çok firması varsa ödeme doğru carisine işlenir).
router.post('/firma-degistir', (req, res) => {
  const u = payUser(req);
  if (!u) return res.redirect('/odeme');
  const f = db
    .prepare('SELECT f.id FROM firms f JOIN user_firms uf ON uf.firm_id=f.id WHERE uf.user_id=? AND f.id=? AND f.active=1')
    .get(u.id, +req.body.firm_id);
  if (f) {
    req.session.pay.firmId = f.id;
    req.saveSession();
  }
  res.redirect('/odeme');
});

// ---- Paratika dönüş/callback ----
// Kullanıcıya asla güvenilmez: ödeme durumu sunucudan sunucuya `query` ile doğrulanır.
// Tüm paneller (bayi/servis/odeme) için TEK callback adresi kullanılır.
async function paratikaResult(req, res) {
  const b = Object.assign({}, req.query, req.body);
  const orderId = b.o || b.orderId || b.ORDER_ID || b.order_id || b.orderid;
  const payment = orderId ? db.prepare('SELECT * FROM payments WHERE provider_order=?').get(String(orderId)) : null;
  const spare = payment ? db.prepare('SELECT id FROM spare_orders WHERE payment_id=? AND deleted_at IS NULL').get(payment.id) : null;
  const back = (p, type, msg) => {
    if (req.session) flash(req, type, msg);
    const target = spare
      ? p && p.source === 'servis'
        ? '/servis/yedek-parca-siparisleri'
        : '/bayi/yedek-parca-siparisleri'
      : p && p.source === 'bayi'
        ? '/bayi/odeme'
        : p && p.source === 'servis'
          ? '/servis/odeme'
          : '/odeme';
    res.redirect(target);
  };
  if (!payment) return back(null, 'danger', 'Ödeme kaydı bulunamadı.');
  if (payment.status === STATUS.COLLECTED) return back(payment, 'success', 'Bu ödeme zaten tahsil edilmiş.');

  const v = await paratika.query({ orderId: payment.provider_order });
  if (v.ok) {
    tx(() => {
      const fresh = db.prepare('SELECT status FROM payments WHERE id=?').get(payment.id);
      if (fresh && fresh.status === STATUS.COLLECTED) return; // yarış durumunda çift işleme engeli
      db.prepare(
        "UPDATE payments SET status=?, provider_ref=COALESCE(?,provider_ref), paid_at=COALESCE(paid_at,datetime('now')) WHERE id=?"
      ).run(STATUS.COLLECTED, v.ref || null, payment.id);
      // Kartla ödenen yedek parça siparişi artık ödendiği için siparişe dönüştürülür;
      // syncPaymentCredit -> syncOrderDebit borcu ve alacağı birlikte işler.
      if (spare) db.prepare('UPDATE spare_orders SET status=? WHERE id=? AND status=?').run(STATUS.CONVERTED, spare.id, STATUS.PENDING);
      syncPaymentCredit(payment.id);
    });
    logAudit(
      { type: payment.source === 'servis' ? 'servis' : payment.source === 'bayi' ? 'bayi' : 'odeme', id: payment.user_id, name: null },
      'payment_collected',
      'payments',
      payment.id,
      { amount: payment.amount, provider_order: payment.provider_order, firm: payment.firm_id },
      req.ip
    );
    return back(payment, 'success', 'Ödemeniz başarıyla alındı ve hesabınıza işlendi.');
  }
  db.prepare('UPDATE payments SET status=? WHERE id=? AND status=?').run('İptal', payment.id, STATUS.POS_PENDING);
  logAudit({ type: 'sistem', name: 'paratika' }, 'payment_failed', 'payments', payment.id, { error: v.error || null }, req.ip);
  return back(payment, 'danger', 'Ödeme tamamlanamadı: ' + (v.error || 'bilinmeyen hata'));
}
router.get('/paratika/sonuc', paratikaResult);
router.post('/paratika/sonuc', paratikaResult);

router.get('/', (req, res) => {
  const u = payUser(req);
  if (!u) return res.render('odeme/login', { title: 'Üye Girişi', pu: null });
  res.locals.pu = u;
  const firms = db
    .prepare('SELECT f.id, f.name FROM firms f JOIN user_firms uf ON uf.firm_id=f.id WHERE uf.user_id=? AND f.active=1 ORDER BY f.name')
    .all(u.id);
  const inst = db.prepare('SELECT * FROM installments WHERE active=1 ORDER BY count').all();
  res.render('odeme/pay', { title: 'Ödeme Ekranı', inst, firms, firmId: req.session.pay.firmId });
});

router.use((req, res, next) => {
  const u = payUser(req);
  if (!u) return res.redirect('/odeme');
  res.locals.pu = u;
  next();
});

const payCtx = (req, res) => ({ userId: res.locals.pu.id, firmId: req.session.pay.firmId, source: 'odeme', origin: publicOrigin(req) });

router.post('/ode', async (req, res) => {
  const b = req.body;
  const method = ['kart', 'havale'].includes(b.method) ? b.method : 'kart';
  if (method === 'havale') {
    const r = pay.havale(payCtx(req, res), b);
    if (!r.error)
      logAudit({ type: 'odeme', id: res.locals.pu.id, name: res.locals.pu.email }, 'create', 'payments', null, { kind: 'havale' }, req.ip);
    flash(req, r.error ? 'danger' : 'success', r.error || r.msg);
    return res.redirect('/odeme');
  }
  try {
    const r = await pay.beginCard(payCtx(req, res), b);
    if (r.error) {
      flash(req, 'danger', r.error);
      return res.redirect('/odeme');
    }
    logAudit(
      { type: 'odeme', id: res.locals.pu.id, name: res.locals.pu.email },
      'create',
      'payments',
      r.paymentId,
      { kind: 'kart' },
      req.ip
    );
    res.redirect(r.redirect);
  } catch (e) {
    flash(req, 'danger', 'Ödeme başlatılamadı: ' + e.message);
    res.redirect('/odeme');
  }
});

router.post('/talimat', (req, res) => {
  const r = pay.talimat(payCtx(req, res), req.body);
  if (!r.error)
    logAudit({ type: 'odeme', id: res.locals.pu.id, name: res.locals.pu.email }, 'create', 'payments', null, { kind: 'talimat' }, req.ip);
  flash(req, r.error ? 'danger' : 'success', r.error || r.msg);
  res.redirect('/odeme');
});

module.exports = router;
