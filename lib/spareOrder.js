// Yedek parça siparişi akışında bayi ve servis panellerinin paylaştığı yardımcılar.
const { db } = require('../db');

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

// Kart bilgilerini doğrular. Geçerliyse { inst, holder, last4 }, değilse { error } döner.
// Not: gerçek sanal POS entegrasyonu olmadığı için kart numarası sunucuda saklanmaz,
// yalnızca son 4 hane tutulur ve ödeme "Sanal POS Bekliyor" durumunda kaydedilir.
function validateCard(b) {
  const inst = db.prepare('SELECT * FROM installments WHERE id=? AND active=1').get(+b.installment_id);
  const holder = String(b.holder || '').trim().slice(0, 80);
  const number = String(b.number || '').replace(/\s/g, '');
  const month = +b.month, year = +b.year, cvc = String(b.cvc || '');
  const now = new Date();
  if (!inst) return { error: 'Taksit seçeneği seçin.' };
  if (!holder) return { error: 'Kart bilgileri geçersiz.' };
  if (!(month >= 1 && month <= 12) || year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1))
    return { error: 'Kartın son kullanma tarihi geçersiz.' };
  if (!/^\d{3,4}$/.test(cvc)) return { error: 'CVC geçersiz.' };
  return { inst, holder, last4: number.slice(-4) };
}

module.exports = { checkMaxQty, validateCard };
