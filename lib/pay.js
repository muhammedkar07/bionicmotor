const crypto = require('crypto');
const { db, tx, syncPaymentCredit, STATUS } = require('../db');
const { parseAmount, AMOUNT_HINT, MAX_AMOUNT_KURUS } = require('./money');
const paratika = require('./paratika');

// Ödemeler yalnızca TL'dir (tutar kuruş). Taksit seçimi Paratika'nın barındırılan ödeme
// sayfasında yapılır; seçilen taksit sayısı ödeme onayından sonra Paratika'dan
// (QUERYTRANSACTION → installmentCount) okunup kayda/dekonta yazılır.

// Taksit sayısını dekontta gösterilecek metne çevirir: 1 → Tek Çekim, 6 → 6 Taksit.
function installmentLabel(n) {
  const c = Number.parseInt(n, 10);
  if (!Number.isFinite(c) || c < 1) return null;
  return c === 1 ? 'Tek Çekim' : c + ' Taksit';
}

// Onaylanan bir ödemeyi cariye işler (idempotent). Hem Paratika callback'i hem de
// mutabakat (reconcile) işi bunu kullanır. `info` Paratika doğrulama yanıtıdır
// ({ installment, commissionRate }); taksit bilgisi varsa kayda yazılır.
// Kredi işlendiyse true döner.
function collectPayment(paymentId, ref, info) {
  let credited = false;
  const label = installmentLabel(info && info.installment);
  // Firma silinmişse cariye işlenemez (FK). Anlamlı hata ver.
  const p = db.prepare('SELECT firm_id FROM payments WHERE id=?').get(paymentId);
  if (p && p.firm_id && !db.prepare('SELECT 1 FROM firms WHERE id=?').get(p.firm_id)) {
    throw new Error('Ödemenin bağlı olduğu firma bulunamadı (silinmiş olabilir).');
  }
  tx(() => {
    const fresh = db.prepare('SELECT status FROM payments WHERE id=?').get(paymentId);
    if (!fresh) return;
    const already = fresh.status === STATUS.COLLECTED;
    // Taksit bilgisi, ödeme daha önce tahsil edilmiş olsa bile güncellenir (geçmiş kayıt düzeltmesi).
    db.prepare(
      `UPDATE payments SET status=?, provider_ref=COALESCE(?,provider_ref),
         installment=COALESCE(?,installment), paid_at=COALESCE(paid_at,datetime('now')) WHERE id=?`
    ).run(STATUS.COLLECTED, ref || null, label, paymentId);
    if (already) return; // zaten işlenmiş
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

// Nakit / Havale-EFT BİLDİRİMİ: tahsilat online yapılmaz. Kayıt "Talimat Oluşturuldu"
// durumuyla açılır ve yöneticinin onayı beklenir. Yönetici kaydı "Tahsil Edildi" (veya
// "Onaylandı") yaptığında tutar otomatik olarak cariye alacak işlenir (bkz. syncPaymentCredit).
const MANUAL = {
  havale: { label: 'Havale / EFT', needPayer: true },
  nakit: { label: 'Nakit', needPayer: false }
};

function manual({ userId, firmId }, b, kind = 'havale') {
  const m = MANUAL[kind];
  if (!m) return { error: 'Geçersiz ödeme yöntemi.' };
  const c = common(b);
  if (!valid(c)) return { error: 'Geçerli bir ödeme tutarı girin. ' + AMOUNT_HINT };
  let description = c.description;
  if (m.needPayer) {
    const payer = String(b.payer_name || '')
      .trim()
      .slice(0, 120);
    if (payer.length < 3) return { error: 'Gönderen hesap ad soyad bilgisini girin.' };
    description = (description ? description + ' | ' : '') + 'Gönderen: ' + payer;
  } else {
    description = (description ? description + ' | ' : '') + 'Nakit ödeme bildirimi (elden/şube)';
  }
  db.prepare(
    `INSERT INTO payments(user_id,firm_id,kind,amount,currency,amount_tl,description,installment,commission,total,status)
              VALUES(?,?,?,?,?,?,?,?,?,?,?)`
  ).run(userId, firmId, kind, c.amount, 'TL', c.amount, description, 'Tek Çekim', 0, c.amount, 'Talimat Oluşturuldu');
  return {
    msg:
      kind === 'nakit'
        ? 'Nakit ödeme bildiriminiz kaydedildi. Yönetici onayından sonra tutar hesabınıza alacak işlenecektir.'
        : 'Havale / EFT bildiriminiz kaydedildi. Yönetici onayından sonra tutar hesabınıza alacak işlenecektir. Açıklamaya bayi kodunuzu ve ad soyadınızı yazdığınızdan emin olun.'
  };
}

// Geriye dönük uyumluluk
function havale(ctx, b) {
  return manual(ctx, b, 'havale');
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
  const returnUrl = (origin || '') + '/odeme/paratika/sonuc/' + encodeURIComponent(sid || '-') + '?o=' + encodeURIComponent(orderId);
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

module.exports = { common, havale, manual, beginCard, talimat, collectPayment, installmentLabel };
