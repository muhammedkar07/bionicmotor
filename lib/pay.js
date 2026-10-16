const crypto = require('crypto');
const { db, get, STATUS } = require('../db');
const { parseAmount, AMOUNT_HINT, MAX_AMOUNT_KURUS } = require('./money');
const paratika = require('./paratika');

// Döviz ödemelerin TL karşılığı (kuruş) — kurlar ayarlardan alınır.
function toKurus(amount, currency) {
  const rate = currency === 'USD' ? parseFloat(get('usd_rate')) : currency === 'EUR' ? parseFloat(get('eur_rate')) : 1;
  return Math.round(amount * (rate > 0 ? rate : 1));
}

function common(b) {
  const kurus = parseAmount(b.amount);
  const amount = kurus === null ? NaN : kurus;
  const currency = ['TL', 'USD', 'EUR'].includes(b.currency) ? b.currency : 'TL';
  const inst = db.prepare('SELECT * FROM installments WHERE id=? AND active=1').get(+b.installment_id);
  return { amount, currency, inst, description: String(b.description || '').slice(0, 500) };
}

function valid(c) {
  return c.amount > 0 && c.amount <= MAX_AMOUNT_KURUS;
}

function havale({ userId, firmId }, b) {
  const c = common(b);
  if (!valid(c)) return { error: 'Geçerli bir ödeme tutarı girin. ' + AMOUNT_HINT };
  const payer = String(b.payer_name || '')
    .trim()
    .slice(0, 120);
  if (payer.length < 3) return { error: 'Gönderen hesap ad soyad bilgisini girin.' };
  const description = (c.description ? c.description + ' | ' : '') + 'Gönderen: ' + payer;
  db.prepare(
    `INSERT INTO payments(user_id,firm_id,kind,amount,currency,amount_tl,description,installment,commission,total,status)
              VALUES(?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    userId,
    firmId,
    'havale',
    c.amount,
    c.currency,
    toKurus(c.amount, c.currency),
    description,
    '-',
    0,
    c.amount,
    'Talimat Oluşturuldu'
  );
  return { msg: 'Havale / EFT bildiriminiz kaydedildi. Açıklamaya bayi kodunuz ve ad soyadınızı yazdığınızdan emin olun.' };
}

// Kredi kartı ödemesi: kart bilgisi sunucuya gelmez. Paratika'da oturum açılır ve kullanıcı
// barındırılan ödeme sayfasına yönlendirilir. Tahsilat, callback'te sunucu tarafı
// doğrulamasından sonra cariye işlenir.
async function beginCard({ userId, firmId, source, origin, ip }, b) {
  const c = common(b);
  if (!valid(c)) return { error: 'Geçerli bir ödeme tutarı girin. ' + AMOUNT_HINT };
  if (!c.inst) return { error: 'Taksit seçeneği seçin.' };

  const commission = Math.round((c.amount * c.inst.rate) / 100);
  const total = c.amount + commission;
  const orderId = 'BN' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
  const returnUrl = (origin || '') + '/odeme/paratika/sonuc?o=' + encodeURIComponent(orderId);
  const amountTl = total / 100;

  // Paratika müşteri/sepet bilgilerini zorunlu tutar; aktif firmadan ve kullanıcıdan türetilir.
  const firm = db.prepare('SELECT name,email,phone FROM firms WHERE id=?').get(firmId) || {};
  const du = db.prepare('SELECT name,email,code FROM dealer_users WHERE id=?').get(userId) || {};
  const label = (c.description || 'Online Ödeme').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Online Ödeme';

  const s = await paratika.startSession({
    orderId,
    amount: amountTl,
    currency: c.currency,
    returnUrl,
    customer: 'F' + firmId,
    customerName: du.name || firm.name || 'Musteri',
    customerEmail: du.email || firm.email || 'musteri@example.com',
    customerPhone: firm.phone || '0000000000',
    customerIp: ip || '127.0.0.1',
    orderItems: [{ productCode: 'ODEME', name: label, description: label, quantity: 1, amount: Number(amountTl.toFixed(2)) }],
    description: c.description
  });
  if (s.error) return { error: s.error };

  const pid = db
    .prepare(
      `INSERT INTO payments(user_id,firm_id,kind,amount,currency,amount_tl,description,installment,commission,total,status,provider,provider_ref,provider_order,source)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      userId,
      firmId,
      'odeme',
      c.amount,
      c.currency,
      toKurus(c.amount, c.currency),
      c.description,
      c.inst.label,
      commission,
      total,
      STATUS.POS_PENDING,
      'paratika',
      s.token || null,
      orderId,
      source || 'odeme'
    ).lastInsertRowid;
  return { redirect: s.redirectUrl, paymentId: pid };
}

function talimat({ userId, firmId }, b) {
  const c = common(b);
  if (!valid(c)) return { error: 'Geçerli bir ödeme tutarı girin. ' + AMOUNT_HINT };
  db.prepare(
    `INSERT INTO payments(user_id,firm_id,kind,amount,currency,amount_tl,description,installment,commission,total,status)
              VALUES(?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    userId,
    firmId,
    'talimat',
    c.amount,
    c.currency,
    toKurus(c.amount, c.currency),
    c.description,
    c.inst ? c.inst.label : 'Tek Çekim',
    0,
    c.amount,
    'Talimat Oluşturuldu'
  );
  return { msg: 'Ödeme talimatınız oluşturuldu.' };
}

module.exports = { common, havale, beginCard, talimat };
