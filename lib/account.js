const { db } = require('../db');

// Cari özet: bakiye = devir + alacaklar - borçlar (bilgi kayıtları bakiyeyi etkilemez)
function accountSummary(firmId, ledger = 'ana') {
  const firm = db.prepare('SELECT devir, devir_parca FROM firms WHERE id=?').get(firmId) || { devir: 0, devir_parca: 0 };
  const devir = ledger === 'parca' ? firm.devir_parca : firm.devir;
  const today = new Date().toISOString().slice(0, 10);
  // Vadesi gelmiş (bugün veya öncesi) çek/senetler "bilgi" olarak girilmiş olsa bile
  // tahsil edilmiş sayılır ve cariye alacak olarak işlenir.
  const effKind = r => (r.kind === 'bilgi' && r.doc_type === 'Çek/Senet' && r.cheque_due && r.cheque_due <= today)
    ? 'alacak' : r.kind;
  const pendingOrders = ledger === 'ana'
    ? db.prepare(`SELECT COALESCE(SUM(i.qty*i.unit_price),0) s FROM orders o JOIN order_items i ON i.order_id=o.id
                  WHERE o.firm_id=? AND o.status='Beklemede'`).get(firmId).s
    : 0;
  const rows = db.prepare(
    'SELECT * FROM account_movements WHERE firm_id=? AND ledger=? ORDER BY date,id').all(firmId, ledger);
  let run = devir, sales = 0, credit = 0, card = 0, pendingChecks = 0;
  rows.forEach(r => {
    const k = effKind(r);
    if (k === 'borc') { run -= r.amount; sales += r.amount; }
    else if (k === 'alacak') {
      run += r.amount; credit += r.amount;
      if (r.doc_type === 'Kredi Kartı Fişi') card += r.amount;
    } else if (r.doc_type === 'Çek/Senet') {
      pendingChecks += r.amount;
    }
    r.kind = k;
    r.balance = run;
  });
  return { devir, sales, card, pendingChecks, pendingOrders, balance: run, rows, credit };
}

module.exports = { accountSummary };
