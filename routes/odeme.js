const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, STATUS, logAudit } = require('../db');
const { flash, throttle, regenerate, publicOrigin, resumeSession } = require('../lib/core');
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
// Dönüş adresi: /odeme/paratika/sonuc/<oturum-anahtarı>?o=<sipariş>
// (anahtar YOLDA çünkü Paratika sorgu parametrelerini dönüşte korumuyor.)
async function paratikaResult(req, res) {
  const b = Object.assign({}, req.query, req.body);
  const orderId = b.o || b.orderId || b.ORDER_ID || b.order_id || b.orderid || b.merchantPaymentId || b.MERCHANTPAYMENTID;
  const payment = orderId ? db.prepare('SELECT * FROM payments WHERE provider_order=?').get(String(orderId)) : null;
  // Banka dönüşü çapraz-site POST olabildiği için tarayıcı çerezi göndermiyor ve panel oturumu
  // "kayboluyor". Yoldaki tek kullanımlık anahtarla yalnızca BU ödemenin sahibi için geri yüklenir.
  const token = String((req.params && req.params.s) || b.s || '').slice(0, 128);
  let restored = false;
  if (payment && token && token !== '-') restored = resumeSession(req, res, token, payment.user_id);

  const hasPanel = !!(req.session && (req.session.dealer || req.session.servis));
  // Ödeme sonrası: bayi/servis → hesap hareketleri (orada dekont bağlantısı çıkar),
  // diğer → ana sayfa. Oturum geri yüklenemediyse dekont sayfasına yönlendirilir
  // (kullanıcı oradan giriş yapabilir; giriş ekranına "çıkış yapmış gibi" düşmez).
  const back = (p, type, msg, withReceipt) => {
    if (req.session) flash(req, type, msg);
    const src = p && p.source;
    const acct = src === 'servis' ? '/servis/hesap-ozeti' : src === 'bayi' ? '/bayi/hesap-ozeti' : '/';
    if (withReceipt && p) {
      if ((src === 'bayi' || src === 'servis') && !hasPanel)
        return res.redirect('/odeme/dekont/' + p.id + '?o=' + encodeURIComponent(p.provider_order || ''));
      return res.redirect(acct + '?odeme=' + p.id);
    }
    return res.redirect(acct);
  };
  if (!payment) return back(null, 'danger', 'Ödeme kaydı bulunamadı.');

  // Tanı: dönüşün nasıl geldiğini denetim kaydına yaz (ileride sorun çıkarsa görülebilsin).
  logAudit(
    { type: 'sistem', name: 'paratika' },
    'payment_return',
    'payments',
    payment.id,
    {
      method: req.method,
      path_token: !!(req.params && req.params.s),
      query_token: !!b.s,
      restored,
      has_panel: hasPanel
    },
    req.ip
  );

  const done = (p, msg) => back(p, 'success', msg, true);
  if (payment.status === STATUS.COLLECTED) return done(payment, 'Bu ödeme zaten tahsil edilmiş.');

  const v = await paratika.query({ orderId: payment.provider_order });
  if (v.ok) {
    pay.collectPayment(payment.id, v.ref); // idempotent: cariye alacak işler
    logAudit(
      { type: payment.source === 'servis' ? 'servis' : payment.source === 'bayi' ? 'bayi' : 'odeme', id: payment.user_id, name: null },
      'payment_collected',
      'payments',
      payment.id,
      { amount: payment.amount, provider_order: payment.provider_order, firm: payment.firm_id },
      req.ip
    );
    return done(payment, 'Ödemeniz başarıyla alındı ve hesabınıza işlendi.');
  }
  if (v.pending) {
    // Sonuç henüz kesinleşmedi: iptal etme, kullanıcıya bilgi ver (durum POS_PENDING kalır).
    logAudit({ type: 'sistem', name: 'paratika' }, 'payment_pending', 'payments', payment.id, null, req.ip);
    return back(payment, 'warning', 'Ödeme sonucu henüz kesinleşmedi. Kısa süre sonra tekrar kontrol edin.');
  }
  if (v.config) {
    // Doğrulama yapılamadı (API yetkisi/yapılandırma): ödeme İPTAL EDİLMEZ. Müşteri ödemiş
    // olabilir; kayıt "Sanal POS Bekliyor" olarak kalır, mutabakat yetki düzelince işler.
    logAudit(
      { type: 'sistem', name: 'paratika' },
      'payment_verify_denied',
      'payments',
      payment.id,
      { error: v.error || null, provider_order: payment.provider_order },
      req.ip
    );
    return back(
      payment,
      'warning',
      'Ödemeniz alınmış olabilir; şu an doğrulanamadı ve kaydınız sistemde bekletiliyor. En kısa sürede hesabınıza işlenecektir. Bilgi: ' +
        (v.error || 'doğrulama yapılamadı')
    );
  }
  db.prepare('UPDATE payments SET status=? WHERE id=? AND status=?').run('İptal', payment.id, STATUS.POS_PENDING);
  logAudit({ type: 'sistem', name: 'paratika' }, 'payment_failed', 'payments', payment.id, { error: v.error || null }, req.ip);
  return back(payment, 'danger', 'Ödeme tamamlanamadı: ' + (v.error || 'bilinmeyen hata'));
}
router.get('/paratika/sonuc', paratikaResult);
router.post('/paratika/sonuc', paratikaResult);
// Oturum anahtarı yolda taşınan dönüş (Paratika sorgu parametrelerini korumadığı için asıl yol)
router.get('/paratika/sonuc/:s', paratikaResult);
router.post('/paratika/sonuc/:s', paratikaResult);

// ---- Ödeme dekontu (yazdırılabilir) ----
// Erişim: ödemenin sahibi (bayi/servis/odeme oturumu) VEYA yönetici VEYA sipariş anahtarı (o=).
router.get('/dekont/:id', (req, res) => {
  const id = +req.params.id || 0;
  const p = id ? db.prepare('SELECT * FROM payments WHERE id=?').get(id) : null;
  if (!p) return res.status(404).send('Dekont bulunamadı.');
  const s = req.session || {};
  // Ödemenin sahibi kullanıcı VEYA aynı firmanın kullanıcısı (hesap ekstresi firmaya ait)
  // VEYA yönetici VEYA sipariş anahtarı (o=).
  const firmOfSession =
    (s.dealer && s.dealer.firmId) || (s.servis && s.servis.firmId) || (s.pay && s.pay.firmId) || null;
  const owner = !!(
    (s.dealer && s.dealer.userId === p.user_id) ||
    (s.servis && s.servis.userId === p.user_id) ||
    (s.pay && s.pay.userId === p.user_id) ||
    (firmOfSession && Number(firmOfSession) === Number(p.firm_id))
  );
  const byKey = !!(req.query.o && String(req.query.o) === String(p.provider_order || ''));
  if (!owner && !byKey && !s.admin) return res.status(403).send('Bu dekontu görüntüleme yetkiniz yok.');
  const firm = db.prepare('SELECT name, code, city, phone, email FROM firms WHERE id=?').get(p.firm_id) || {};
  const user = db.prepare('SELECT name, email, code FROM dealer_users WHERE id=?').get(p.user_id) || {};
  res.render('odeme/dekont', { title: 'Ödeme Dekontu', p, firm, user, layout: false });
});

router.get('/', (req, res) => {
  const u = payUser(req);
  if (!u) return res.render('odeme/login', { title: 'Üye Girişi', pu: null });
  res.locals.pu = u;
  const firms = db
    .prepare('SELECT f.id, f.name FROM firms f JOIN user_firms uf ON uf.firm_id=f.id WHERE uf.user_id=? AND f.active=1 ORDER BY f.name')
    .all(u.id);
  res.render('odeme/pay', { title: 'Ödeme Ekranı', firms, firmId: req.session.pay.firmId });
});

router.use((req, res, next) => {
  const u = payUser(req);
  if (!u) return res.redirect('/odeme');
  res.locals.pu = u;
  next();
});

const payCtx = (req, res) => ({
  userId: res.locals.pu.id,
  firmId: req.session.pay.firmId,
  source: 'odeme',
  origin: publicOrigin(req),
  ip: req.ip,
  sid: req.sid
});

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
