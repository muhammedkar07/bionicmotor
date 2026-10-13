const { db } = require('../db');

function common(b) {
  const amount = Math.round(parseFloat(String(b.amount || '').replace(/\./g, '').replace(',', '.')) * 100) / 100;
  const currency = ['TL', 'USD', 'EUR'].includes(b.currency) ? b.currency : 'TL';
  const inst = db.prepare('SELECT * FROM installments WHERE id=? AND active=1').get(+b.installment_id);
  return { amount, currency, inst, description: String(b.description || '').slice(0, 500) };
}

function havale({ userId, firmId }, b) {
  const c = common(b);
  if (!(c.amount > 0) || c.amount > 10000000) return { error: 'Geçerli bir ödeme tutarı girin.' };
  const payer = String(b.payer_name || '').trim().slice(0, 120);
  if (payer.length < 3) return { error: 'Gönderen hesap ad soyad bilgisini girin.' };
  const description = (c.description ? c.description + ' | ' : '') + 'Gönderen: ' + payer;
  db.prepare(`INSERT INTO payments(user_id,firm_id,kind,amount,currency,description,installment,commission,total,status)
              VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(userId, firmId, 'havale', c.amount, c.currency, description, '-', 0, c.amount, 'Talimat Oluşturuldu');
  return { msg: 'Havale / EFT bildiriminiz kaydedildi. Açıklamaya bayi kodunuz ve ad soyadınızı yazdığınızdan emin olun.' };
}

function card({ userId, firmId }, b) {
  const c = common(b);
  if (!(c.amount > 0) || c.amount > 10000000) return { error: 'Geçerli bir ödeme tutarı girin.' };
  if (!c.inst) return { error: 'Taksit seçeneği seçin.' };
  const holder = String(b.holder || '').trim().slice(0, 80);
  const number = String(b.number || '').replace(/\s/g, '');
  const month = +b.month, year = +b.year, cvc = String(b.cvc || '');
  if (!holder) return { error: 'Kart bilgileri geçersiz.' };
  // Kart numarası doğrulaması test amaçlı şimdilik devre dışı (gerçek POS entegrasyonunda yapılacak).
  const now = new Date();
  if (!(month >= 1 && month <= 12) || year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1))
    return { error: 'Kartın son kullanma tarihi geçersiz.' };
  if (!/^\d{3,4}$/.test(cvc)) return { error: 'CVC geçersiz.' };
  const commission = Math.round(c.amount * c.inst.rate) / 100;
  const total = c.amount + commission;
  db.prepare(`INSERT INTO payments(user_id,firm_id,kind,amount,currency,description,installment,commission,total,card_holder,card_last4,status)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(userId, firmId, 'odeme', c.amount, c.currency, c.description, c.inst.label, commission, total, holder, number.slice(-4), 'Sanal POS Bekliyor');
  return { msg: 'Ödeme talebiniz kaydedildi. (Sanal POS entegrasyonu henüz aktif değil; tahsilat yapılmamıştır.)' };
}

function talimat({ userId, firmId }, b) {
  const c = common(b);
  if (!(c.amount > 0) || c.amount > 10000000) return { error: 'Geçerli bir ödeme tutarı girin.' };
  db.prepare(`INSERT INTO payments(user_id,firm_id,kind,amount,currency,description,installment,commission,total,status)
              VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(userId, firmId, 'talimat', c.amount, c.currency, c.description, c.inst ? c.inst.label : 'Tek Çekim', 0, c.amount, 'Talimat Oluşturuldu');
  return { msg: 'Ödeme talimatınız oluşturuldu.' };
}

module.exports = { common, havale, card, talimat };
