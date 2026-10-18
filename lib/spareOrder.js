const crypto = require('crypto');
const { db, tx, syncOrderDebit, STATUS } = require('../db');
const paratika = require('./paratika');

// Yedek parça siparişi akışında bayi ve servis panellerinin paylaştığı yardımcılar.
// Admin tarafından belirlenen maksimum alım adedini aşan satır var mı?
function checkMaxQty(lines) {
  const agg = {};
  for (const l of lines) agg[l.p.id] = (agg[l.p.id] || 0) + l.qty;
  for (const l of lines) {
    const max = +l.p.max_qty || 0;
    if (max > 0 && agg[l.p.id] > max) return `"${l.p.name}" için en fazla ${max} adet sipariş verebilirsiniz.`;
  }
  return null;
}

// Kartla ödenen yedek parça siparişi: kart bilgisi sunucuya gelmez; Paratika'da oturum açılır,
// sipariş "Beklemede" olarak kaydedilir ve kullanıcı ödeme sayfasına yönlendirilir. Ödeme
// callback'te doğrulanınca sipariş "Siparişe Dönüştürüldü" yapılır ve cari borç/alacak işlenir.
async function createSpareCardOrder({ userId, firmId, source, origin, ip, sid, no, note, payer, applied, method, lines, payable }) {
  const providerOrder = 'BN' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
  // `s`: banka dönüşünde oturumu geri yüklemek için (çapraz-site POST'ta çerez gelmez).
  const returnUrl =
    (origin || '') + '/odeme/paratika/sonuc?o=' + encodeURIComponent(providerOrder) + (sid ? '&s=' + encodeURIComponent(sid) : '');
  const amountTl = payable / 100;
  const label = 'Yedek Parça Siparişi #' + no;

  // Paratika müşteri/sepet bilgilerini zorunlu tutar.
  const firm = db.prepare('SELECT name,email,phone FROM firms WHERE id=?').get(firmId) || {};
  const du = db.prepare('SELECT name,email,code FROM dealer_users WHERE id=?').get(userId) || {};

  const s = await paratika.startSession({
    orderId: providerOrder,
    amount: amountTl,
    currency: 'TL',
    returnUrl,
    customer: 'F' + firmId,
    customerName: du.name || firm.name || 'Musteri',
    customerEmail: du.email || firm.email || 'musteri@example.com',
    customerPhone: firm.phone || '0000000000',
    customerIp: ip || '127.0.0.1',
    orderItems: [{ productCode: 'PARC', name: label, description: label, quantity: 1, amount: Number(amountTl.toFixed(2)) }],
    description: label
  });
  if (s.error) return { error: s.error };

  let oid;
  tx(() => {
    oid = db
      .prepare(
        `INSERT INTO spare_orders(firm_id,user_id,no,status,note,request_date,pay_method,payer_name,balance_applied)
        VALUES(?,?,?,?,?,date('now'),?,?,?)`
      )
      .run(firmId, userId, no, STATUS.PENDING, note, method, payer || null, applied).lastInsertRowid;
    const ins = db.prepare('INSERT INTO spare_order_items(order_id,part_code,part_name,qty,unit_price) VALUES(?,?,?,?,?)');
    lines.forEach(l => ins.run(oid, l.p.code, l.p.name, l.qty, l.p.price));
    const payId = db
      .prepare(
        `INSERT INTO payments(user_id,firm_id,kind,amount,currency,amount_tl,description,installment,commission,total,status,provider,provider_ref,provider_order,source)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        userId,
        firmId,
        'odeme',
        payable,
        'TL',
        payable,
        'Yedek Parça Siparişi #' + no,
        'Tek Çekim',
        0,
        payable,
        STATUS.POS_PENDING,
        'paratika',
        s.token || null,
        providerOrder,
        source
      ).lastInsertRowid;
    db.prepare('UPDATE spare_orders SET payment_id=? WHERE id=?').run(payId, oid);
    syncOrderDebit('spare_orders', 'spare_order_items', oid, 'parca');
  });
  return { redirect: s.redirectUrl, orderId: oid };
}

module.exports = { checkMaxQty, createSpareCardOrder };
