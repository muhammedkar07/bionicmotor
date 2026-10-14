const { db } = require('../db');

const addCol = (t, c, d) => {
  try {
    if (
      !db
        .prepare(`PRAGMA table_info(${t})`)
        .all()
        .some(x => x.name === c)
    ) {
      db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`);
    }
  } catch (e) {
    console.log('addCol', t, c, e.message);
  }
};

addCol('warranty_records', 'invoice_no', 'TEXT');
addCol('work_orders', 'type_locked', 'INTEGER NOT NULL DEFAULT 0');
addCol('account_movements', 'bank', 'TEXT');
addCol('account_movements', 'cheque_no', 'TEXT');
addCol('account_movements', 'cheque_type', 'TEXT');
addCol('account_movements', 'cheque_due', 'TEXT');
addCol('account_movements', 'payer_name', 'TEXT');
addCol('spare_orders', 'payer_name', 'TEXT');

db.prepare("UPDATE warranty_records SET warranty_end=date(sale_date,'+2 years') WHERE sale_date IS NOT NULL").run();
db.prepare("UPDATE work_orders SET type_locked=1 WHERE status IN ('Onaylandı','Tamamlandı','Reddedildi')").run();

console.log('migration ok');
