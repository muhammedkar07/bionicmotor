const {db} = require('../db');
const cols = db.prepare('PRAGMA table_info(dealer_users)').all();
if(!cols.some(c=>c.name==='role')){
  db.exec("ALTER TABLE dealer_users ADD COLUMN role TEXT NOT NULL DEFAULT 'bayi'");
}
db.exec("UPDATE dealer_users SET role='bayi' WHERE role IS NULL OR role=''");
console.table(db.prepare('SELECT id,code,email,name,role,active FROM dealer_users').all());
