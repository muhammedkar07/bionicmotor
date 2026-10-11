const { db } = require('../db');

// Cari özet: bakiye = devir + alacaklar - borçlar (bilgi kayıtları bakiyeyi etkilemez)
function accountSummary(firmId, ledger = 'ana') {
  const firm = db.prepare('SELECT devir, devir_parca FROM firms WHERE id=?').get(firmId) || { devir: 0, devir_parca: 0 };
  const devir = ledger === 'parca' ? firm.devir_parca : firm.devir;
  const sum = (where, ...p) => db.prepare(
    `SELECT COALESCE(SUM(amount),0) s FROM account_movements WHERE firm_id=? AND ledger=? AND ${where}`
  ).get(firmId, ledger, ...p).s;
  const sales = sum("kind='borc'");
  const credit = sum("kind='alacak'");
  const card = sum("kind='alacak' AND doc_type='Kredi Kartı Fişi'");
  const pendingChecks = sum("kind='bilgi'");
  const pendingOrders = ledger === 'ana'
    ? db.prepare(`SELECT COALESCE(SUM(i.qty*i.unit_price),0) s FROM orders o JOIN order_items i ON i.order_id=o.id
                  WHERE o.firm_id=? AND o.status='Beklemede'`).get(firmId).s
    : 0;
  const rows = db.prepare(
    'SELECT * FROM account_movements WHERE firm_id=? AND ledger=? ORDER BY date,id').all(firmId, ledger);
  let run = devir;
  rows.forEach(r => {
    if (r.kind === 'borc') run -= r.amount; else if (r.kind === 'alacak') run += r.amount;
    r.balance = run;
  });
  return { devir, sales, card, pendingChecks, pendingOrders, balance: run, rows, credit };
}

module.exports = { accountSummary };
