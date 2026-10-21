const { db } = require('../db');

// Cari özet: bakiye = devir + borçlar - alacaklar (bilgi kayıtları bakiyeyi etkilemez).
// Pozitif bakiye: bayinin bize borcu vardır. Ödeme (alacak) bakiyeyi düşürür.
// Vadesi gelmiş çek/senet otomatik olarak tahsil edilmiş SAYILMAZ; karşılıksız çek riskine
// karşı tahsil durumu yalnızca yöneticinin kaydı "bilgi"den "alacak"a çevirmesiyle değişir.
//
// opts.from / opts.to ('YYYY-MM-DD') verilirse yalnızca o tarih aralığındaki hareketler listelenir;
// dönem başı bakiye (opening) = devir + aralıktan ÖNCEKİ hareketlerin neti.
function accountSummary(firmId, ledger = 'ana', opts = {}) {
  const from = String(opts.from || '').slice(0, 10);
  const to = String(opts.to || '').slice(0, 10);
  const firm = db.prepare('SELECT devir, devir_parca FROM firms WHERE id=?').get(firmId) || { devir: 0, devir_parca: 0 };
  const devir = ledger === 'parca' ? firm.devir_parca : firm.devir;
  const pendingOrders =
    ledger === 'ana'
      ? db
          .prepare(
            `SELECT COALESCE(SUM(i.qty*i.unit_price),0) s FROM orders o JOIN order_items i ON i.order_id=o.id
                  WHERE o.firm_id=? AND o.deleted_at IS NULL AND o.status='Beklemede'`
          )
          .get(firmId).s
      : 0;
  const all = db
    .prepare('SELECT * FROM account_movements WHERE firm_id=? AND ledger=? AND deleted_at IS NULL ORDER BY date,id')
    .all(firmId, ledger);

  const net = r => (r.kind === 'borc' ? r.amount : r.kind === 'alacak' ? -r.amount : 0);
  let opening = devir;
  if (from) for (const r of all) if (r.date < from) opening += net(r);

  const rows = all.filter(r => (!from || r.date >= from) && (!to || r.date <= to));
  let run = opening,
    sales = 0,
    credit = 0,
    card = 0,
    pendingChecks = 0;
  rows.forEach(r => {
    const k = r.kind;
    if (k === 'borc') {
      run += r.amount;
      sales += r.amount;
    } else if (k === 'alacak') {
      run -= r.amount;
      credit += r.amount;
      if (r.doc_type === 'Kredi Kartı Fişi' || r.doc_type === 'Kart') card += r.amount;
    } else if (r.doc_type === 'Çek/Senet') {
      pendingChecks += r.amount;
    }
    r.balance = run;
  });
  // Her harekete bağlı ödeme varsa DEKONT bağlantısını ekle (tabloda "Dekont" sütunu)
  if (rows.length) {
    const ids = rows.map(r => r.id);
    const map = new Map();
    db.prepare(
      `SELECT id, movement_id FROM payments WHERE movement_id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL`
    )
      .all(...ids)
      .forEach(p => map.set(p.movement_id, p.id));
    rows.forEach(r => {
      const pid = map.get(r.id);
      r.receipt = pid ? '/odeme/dekont/' + pid : null;
    });
  }
  return { devir, opening, sales, card, pendingChecks, pendingOrders, balance: run, rows, credit, from, to };
}
// Birden çok firmanın (veya seçili tek firmanın) ana + yedek parça hesaplarını toplar.
// opts.from / opts.to verilirse yalnızca o tarih aralığındaki hareketler ve dönem başı bakiyeler toplanır.
function overallSummary(firmId = null, opts = {}) {
  const ids = firmId
    ? [firmId]
    : db
        .prepare('SELECT id FROM firms')
        .all()
        .map(r => r.id);
  const out = {
    devir: 0,
    opening: 0,
    sales: 0,
    card: 0,
    pendingChecks: 0,
    pendingOrders: 0,
    credit: 0,
    balance: 0,
    firms: ids.length
  };
  for (const id of ids) {
    for (const ledger of ['ana', 'parca']) {
      const a = accountSummary(id, ledger, opts);
      out.devir += a.devir;
      out.opening += a.opening;
      out.sales += a.sales;
      out.card += a.card;
      out.pendingChecks += a.pendingChecks;
      out.pendingOrders += a.pendingOrders;
      out.credit += a.credit;
      out.balance += a.balance;
    }
  }
  return out;
}

module.exports = { accountSummary, overallSummary };
