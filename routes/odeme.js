const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { flash, throttle, regenerate, luhn } = require('../lib/core');

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

function parseCommon(req) {
  const b = req.body;
  const amount = Math.round(parseFloat(String(b.amount || '').replace(/\./g, '').replace(',', '.')) * 100) / 100;
  const currency = ['TL', 'USD', 'EUR'].includes(b.currency) ? b.currency : 'TL';
  const inst = db.prepare('SELECT * FROM installments WHERE id=? AND active=1').get(+b.installment_id);
  return { amount, currency, inst, description: String(b.description || '').slice(0, 500) };
}

router.post('/ode', (req, res) => {
  const c = parseCommon(req), b = req.body;
  const back = m => { flash(req, 'danger', m); return res.redirect('/odeme'); };
  if (!(c.amount > 0) || c.amount > 10000000) return back('Geçerli bir ödeme tutarı girin.');
  const method = ['kart', 'havale'].includes(b.method) ? b.method : 'kart';
  if (method === 'havale') {
    const payer = String(b.payer_name || '').trim().slice(0, 120);
    if (payer.length < 3) return back('Gönderen hesap ad soyad bilgisini girin.');
    const description = (c.description ? c.description + ' | ' : '') + 'Gönderen: ' + payer;
    db.prepare(`INSERT INTO payments(user_id,firm_id,kind,amount,currency,description,installment,commission,total,status)
                VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(res.locals.pu.id, req.session.pay.firmId, 'havale', c.amount, c.currency, description,
        '-', 0, c.amount, 'Talimat Oluşturuldu');
    flash(req, 'success', 'Havale / EFT bildiriminiz kaydedildi. Açıklamaya bayi kodunuz ve ad soyadınızı yazdığınızdan emin olun.');
    return res.redirect('/odeme');
  }
  if (!c.inst) return back('Taksit seçeneği seçin.');
  const holder = String(b.holder || '').trim().slice(0, 80);
  const number = String(b.number || '').replace(/\s/g, '');
  const month = +b.month, year = +b.year, cvc = String(b.cvc || '');
  if (!holder) return back('Kart bilgileri geçersiz.');
  // Kart numarası doğrulaması test amaçlı şimdilik devre dışı bırakıldı (gerçek POS entegrasyonunda yapılacak).
  const now = new Date();
  if (!(month >= 1 && month <= 12) || year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1))
    return back('Kartın son kullanma tarihi geçersiz.');
  if (!/^\d{3,4}$/.test(cvc)) return back('CVC geçersiz.');
  const commission = Math.round(c.amount * c.inst.rate) / 100;
  const total = c.amount + commission;
  // Kart no / CVC kaydedilmez. Gerçek sanal POS entegrasyonu bu noktada yapılacak.
  db.prepare(`INSERT INTO payments(user_id,firm_id,kind,amount,currency,description,installment,commission,total,card_holder,card_last4,status)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(res.locals.pu.id, req.session.pay.firmId, 'odeme', c.amount, c.currency, c.description, c.inst.label, commission, total,
      holder, number.slice(-4), 'Sanal POS Bekliyor');
  flash(req, 'success', 'Ödeme talebiniz kaydedildi. (Sanal POS entegrasyonu henüz aktif değil; tahsilat yapılmamıştır.)');
  res.redirect('/odeme');
});

router.post('/talimat', (req, res) => {
  const c = parseCommon(req);
  if (!(c.amount > 0) || c.amount > 10000000) { flash(req, 'danger', 'Geçerli bir ödeme tutarı girin.'); return res.redirect('/odeme'); }
  db.prepare(`INSERT INTO payments(user_id,firm_id,kind,amount,currency,description,installment,commission,total,status)
              VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(res.locals.pu.id, req.session.pay.firmId, 'talimat', c.amount, c.currency, c.description,
      c.inst ? c.inst.label : 'Tek Çekim', 0, c.amount, 'Talimat Oluşturuldu');
  flash(req, 'success', 'Ödeme talimatınız oluşturuldu.');
  res.redirect('/odeme');
});

module.exports = router;
