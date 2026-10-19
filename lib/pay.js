const crypto = require('crypto');
const { db, tx, syncPaymentCredit, STATUS } = require('../db');
const { parseAmount, AMOUNT_HINT, MAX_AMOUNT_KURUS } = require('./money');
const paratika = require('./paratika');

// Ödemeler yalnızca TL'dir (tutar kuruş). Taksit/komisyon yoktur: taksit seçimi
// Paratika'nın barındırılan ödeme sayfasında yapılır; biz tek çekim tutarını göndeririz.

// Onaylanan bir ödemeyi cariye işler (idempotent). Hem Paratika callback'i hem de
// mutabakat (reconcile) işi bunu kullanır. Kredi işlendiyse true döner.
function collectPayment(paymentId, ref) {
  let credited = false;
  // Firma silinmişse cariye işlenemez (FK). Anlamlı hata ver.
  const p = db.prepare('SELECT firm_id FROM payments WHERE id=?').get(paymentId);
  if (p && p.firm_id && !db.prepare('SELECT 1 FROM firms WHERE id=?').get(p.firm_id)) {
    throw new Error('Ödemenin bağlı olduğu firma bulunamadı (silinmiş olabilir).');
  }
  tx(() => {
    const fresh = db.prepare('SELECT status FROM payments WHERE id=?').get(paymentId);
    if (!fresh || fresh.status === STATUS.COLLECTED) return; // zaten işlenmiş
    db.prepare(
      "UPDATE payments SET status=?, provider_ref=COALESCE(?,provider_ref), paid_at=COALESCE(paid_at,datetime('now')) WHERE id=?"
    ).run(STATUS.COLLECTED, ref || null, paymentId);
    // Kartla ödenen yedek parça siparişi ödendiği için siparişe dönüştürülür.
    const spare = db.prepare('SELECT id FROM spare_orders WHERE payment_id=? AND deleted_at IS NULL').get(paymentId);
    if (spare) db.prepare('UPDATE spare_orders SET status=? WHERE id=? AND status=?').run(STATUS.CONVERTED, spare.id, STATUS.PENDING);
    syncPaymentCredit(paymentId);
    credited = true;
  });
  return credited;
}

function common(b) {
  const kurus = parseAmount(b.amount);
  const amount = kurus === null ? NaN : kurus;
  return { amount, description: String(b.description || '').slice(0, 500) };
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
  ).run(userId, firmId, 'havale', c.amount, 'TL', c.amount, description, 'Tek Çekim', 0, c.amount, 'Talimat Oluşturuldu');
  return { msg: 'Havale / EFT bildiriminiz kaydedildi. Açıklamaya bayi kodunuz ve ad soyadınızı yazdığınızdan emin olun.' };
}

// Kredi kartı ödemesi: kart bilgisi sunucuya gelmez. Paratika'da oturum açılır ve kullanıcı
// barındırılan ödeme sayfasına yönlendirilir. Tahsilat, callback'te sunucu tarafı
// doğrulamasından sonra cariye işlenir.
async function beginCard({ userId, firmId, source, origin, ip, sid }, b) {
  const c = common(b);
  if (!valid(c)) return { error: 'Geçerli bir ödeme tutarı girin. ' + AMOUNT_HINT };

  const orderId = 'BN' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
  // Dönüş adresi: oturum anahtarı YOLDA taşınır (Paratika sorgu parametrelerini dönüşte
  // korumuyor; kendi MERCHANTPAYMENTID alanını gönderiyor). `o` yedek olarak sorguda kalır.
  const returnUrl =
    (origin || '') +
    '/odeme/paratika/sonuc/' +
    encodeURIComponent(sid || '-') +
    '?o=' +
    encodeURIComponent(orderId);
  const amountTl = c.amount / 100;

  // Paratika müşteri/sepet bilgilerini zorunlu tutar; aktif firmadan ve kullanıcıdan türetilir.
  const firm = db.prepare('SELECT name,email,phone FROM firms WHERE id=?').get(firmId) || {};
  const du = db.prepare('SELECT name,email,code FROM dealer_users WHERE id=?').get(userId) || {};
  const label = (c.description || 'Online Ödeme').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Online Ödeme';

  const s = await paratika.startSession({
    orderId,
    amount: amountTl,
    currency: 'TL',
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
      'TL',
      c.amount,
      c.description,
      'Tek Çekim',
      0,
      c.amount,
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
  ).run(userId, firmId, 'talimat', c.amount, 'TL', c.amount, c.description, 'Tek Çekim', 0, c.amount, 'Talimat Oluşturuldu');
  return { msg: 'Ödeme talimatınız oluşturuldu.' };
}

module.exports = { common, havale, beginCard, talimat, collectPayment };
