const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Veritabanı klasörü DATA_DIR ortam değişkeniyle yapılandırılabilir. Render/Railway gibi
// platformlarda kalıcı disk (volume) bağlayıp DATA_DIR'ı o yola verirseniz veriler
// her deploy'da silinmez.
const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(path.join(dir, 'app.db'));
const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, 'public', 'uploads');
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', csrf TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS firms (
  id INTEGER PRIMARY KEY, code TEXT, name TEXT NOT NULL, city TEXT, phone TEXT, email TEXT,
  devir REAL NOT NULL DEFAULT 0, devir_parca REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS dealer_users (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, email TEXT UNIQUE, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, ann_seen_at TEXT);
CREATE TABLE IF NOT EXISTS user_firms (
  user_id INTEGER NOT NULL REFERENCES dealer_users(id) ON DELETE CASCADE,
  firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, firm_id));
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  request_date TEXT, request_no TEXT, delivery_type TEXT, status TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_name TEXT, qty REAL, unit_price REAL);
CREATE TABLE IF NOT EXISTS account_movements (
  id INTEGER PRIMARY KEY, firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  ledger TEXT NOT NULL DEFAULT 'ana', date TEXT, doc_no TEXT, doc_type TEXT,
  kind TEXT NOT NULL, amount REAL NOT NULL, has_detail INTEGER NOT NULL DEFAULT 0,
  bank TEXT, cheque_no TEXT, cheque_type TEXT, cheque_due TEXT, payer_name TEXT);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY, text TEXT NOT NULL, author TEXT, sort INTEGER DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'arac', code TEXT, name TEXT NOT NULL,
  category TEXT, price REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT, cc TEXT, power TEXT, gearbox TEXT,
  description TEXT, image TEXT, price REAL, sort INTEGER DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS slides (
  id INTEGER PRIMARY KEY, image TEXT, title TEXT, subtitle TEXT, old_price TEXT, new_price TEXT,
  bg TEXT, link TEXT, sort INTEGER DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY, question TEXT NOT NULL, answer TEXT, sort INTEGER DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS points (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT, city TEXT, address TEXT, phone TEXT,
  active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS pages (
  slug TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, name TEXT, email TEXT, phone TEXT, message TEXT,
  is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY, name TEXT, city TEXT, district TEXT, phone TEXT, note TEXT,
  status TEXT NOT NULL DEFAULT 'Yeni', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS installments (
  id INTEGER PRIMARY KEY, label TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1,
  rate REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, user_id INTEGER, firm_id INTEGER, kind TEXT, amount REAL, currency TEXT,
  description TEXT, installment TEXT, commission REAL, total REAL, card_holder TEXT, card_last4 TEXT,
  status TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS warranty_records (
  id INTEGER PRIMARY KEY, firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  serial_no TEXT, model TEXT, customer TEXT, sale_date TEXT, warranty_end TEXT, status TEXT, invoice_no TEXT);
CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY, firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id INTEGER, no TEXT, serial_no TEXT, model TEXT, km TEXT, type TEXT, description TEXT,
  image TEXT, status TEXT NOT NULL DEFAULT 'Beklemede', admin_note TEXT,
  type_locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS spare_orders (
  id INTEGER PRIMARY KEY, firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id INTEGER, no TEXT, status TEXT NOT NULL DEFAULT 'Beklemede', note TEXT,
  payer_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS spare_order_items (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES spare_orders(id) ON DELETE CASCADE,
  part_code TEXT, part_name TEXT, qty REAL, unit_price REAL);
`);

const get = (key, def = '') => {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return r ? r.value : def;
};
const set = (key, value) =>
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, String(value ?? ''));
const allSettings = () => Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, r.value]));
const addCol = (table, col, def) => {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
db.exec('CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)');
db.exec("INSERT OR IGNORE INTO categories(name) SELECT DISTINCT TRIM(category) FROM products WHERE category IS NOT NULL AND TRIM(category)<>''");
addCol('account_movements', 'receipt', 'TEXT');
addCol('orders', 'delivery_date', 'TEXT');
addCol('orders', 'movement_id', 'INTEGER');
addCol('spare_orders', 'request_date', 'TEXT');
addCol('spare_orders', 'delivery_date', 'TEXT');
addCol('spare_orders', 'delivery_method', 'TEXT');
addCol('spare_orders', 'movement_id', 'INTEGER');
addCol('spare_orders', 'pay_method', 'TEXT');
addCol('spare_orders', 'payment_id', 'INTEGER');
addCol('spare_orders', 'pay_movement_id', 'INTEGER');
addCol('spare_orders', 'payer_name', 'TEXT');
addCol('warranty_records', 'invoice_no', 'TEXT');
addCol('work_orders', 'type_locked', 'INTEGER NOT NULL DEFAULT 0');
addCol('dealer_users', 'role', "TEXT NOT NULL DEFAULT 'bayi'");
addCol('account_movements', 'bank', 'TEXT');
addCol('account_movements', 'cheque_no', 'TEXT');
addCol('account_movements', 'cheque_type', 'TEXT');
addCol('account_movements', 'cheque_due', 'TEXT');
addCol('account_movements', 'payer_name', 'TEXT');
db.exec("UPDATE spare_orders SET request_date=date(created_at) WHERE request_date IS NULL");
addCol('products', 'stock', 'REAL NOT NULL DEFAULT 0');
addCol('products', 'model_id', 'INTEGER');
addCol('products', 'max_qty', 'REAL');
db.exec(`CREATE TABLE IF NOT EXISTS stock_notify (
  product_id INTEGER NOT NULL,
  firm_id INTEGER NOT NULL,
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (product_id, firm_id));`);
db.exec(`CREATE TABLE IF NOT EXISTS firm_stock (
  firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (firm_id, product_id));
CREATE TABLE IF NOT EXISTS order_stock_snap (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  qty REAL NOT NULL,
  firm_id INTEGER NOT NULL);`);

// Eski şemada order_id birincil anahtardı; bir sipariş birden çok ürün içerebildiği
// için satır eklenirken "UNIQUE constraint failed: order_stock_snap.order_id"
// hatası oluşuyordu. Mevcut veriler korunarak yeni şemaya taşınır.
const snapCols = db.prepare('PRAGMA table_info(order_stock_snap)').all();
if (snapCols.length && !snapCols.some(c => c.name === 'id')) {
  db.exec(`ALTER TABLE order_stock_snap RENAME TO order_stock_snap_old;
    CREATE TABLE order_stock_snap (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL, qty REAL NOT NULL, firm_id INTEGER NOT NULL);
    INSERT INTO order_stock_snap(order_id,product_id,qty,firm_id) SELECT order_id,product_id,qty,firm_id FROM order_stock_snap_old;
    DROP TABLE order_stock_snap_old;`);
}

// ÖTV kaldırıldı: eski ayar kaydı varsa temizlenir.
db.prepare("DELETE FROM settings WHERE key='otv_rate'").run();

// Varsayılan logo artık paket içinde kalıcı public/img klasöründedir
// (public/uploads git'ten hariç tutulduğu için eski değer bozuk kalırdı).
if (get('logo_image') && get('logo_image').startsWith('/static/uploads/') &&
    !fs.existsSync(path.join(uploadsDir, path.basename(get('logo_image'))))) {
  set('logo_image', '/static/img/bionic-logo.png');
}

// Sıradaki otomatik numara (yalnızca rakamlardan oluşan değerler dikkate alınır)
const nextNo = (table, col) =>
  (db.prepare(`SELECT MAX(CAST(${col} AS INTEGER)) m FROM ${table} WHERE ${col} GLOB '[0-9]*' AND ${col} NOT GLOB '*[^0-9]*'`).get().m || 0) + 1;
const nextFirmCode = () => {
  const m = db.prepare("SELECT MAX(CAST(SUBSTR(code,8) AS INTEGER)) m FROM firms WHERE code GLOB '120.01.[0-9]*'").get().m || 0;
  return '120.01.' + String(m + 1).padStart(3, '0');
};

// Siparişe dönüştürülünce bayinin cari hesabına borç yazar; durum geri alınırsa kaydı siler
function syncOrderDebit(table, itemsTable, id, ledger) {
  const o = db.prepare(`SELECT * FROM ${table} WHERE rowid=?`).get(id);
  if (!o) return null;
  const hasPay = table === 'spare_orders';
  // Beklemede/İptal dışındaki durumlar "onaylanmış" sayılır.
  const cancelled = ['İptal', 'İptal Edildi'].includes(o.status);
  const active = !['Beklemede', 'İptal', 'İptal Edildi'].includes(o.status);
  if (!active) {
    if (o.movement_id) db.prepare('DELETE FROM account_movements WHERE id=?').run(o.movement_id);
    if (hasPay && o.pay_movement_id) db.prepare('DELETE FROM account_movements WHERE id=?').run(o.pay_movement_id);
    db.prepare(`UPDATE ${table} SET movement_id=NULL${hasPay ? ',pay_movement_id=NULL' : ''} WHERE rowid=?`).run(id);
    return null;
  }
  const total = db.prepare(`SELECT COALESCE(SUM(qty*unit_price),0) t FROM ${itemsTable} WHERE order_id=?`).get(id).t;
  const no = o.request_no || o.no;
  const date = new Date().toISOString().slice(0, 10);
  const ins = (docNo, docType, kind, amt = total) => db.prepare('INSERT INTO account_movements(firm_id,ledger,date,doc_no,doc_type,kind,amount,has_detail) VALUES(?,?,?,?,?,?,?,0)')
    .run(o.firm_id, ledger, date, docNo, docType, kind, amt).lastInsertRowid;
  if (o.movement_id) {
    db.prepare('UPDATE account_movements SET amount=? WHERE id=?').run(total, o.movement_id);
  } else if (total > 0) {
    const mid = ins('SIP-' + no, ledger === 'parca' ? 'Yedek Parça Siparişi' : 'Sipariş', 'borc');
    db.prepare(`UPDATE ${table} SET movement_id=? WHERE rowid=?`).run(mid, id);
  }
  // Onaylanan siparişin ödemesi alacak olarak işlenir. Kart ödemesi (payment_id)
  // tutarı sabit kalır; nakit/havale ise sipariş onaylandığında alacak yazılır.
  if (hasPay) {
    let payAmount = null, payType = null;
    if (o.payment_id) {
      const pay = db.prepare('SELECT amount FROM payments WHERE id=?').get(o.payment_id);
      payAmount = pay ? pay.amount : total;
      payType = 'Kredi Kartı Fişi';
    } else if (['Kredi Kartı', 'Nakit', 'Havale / EFT'].includes(o.pay_method)) {
      payAmount = total;
      payType = o.pay_method;
    }
    if (payAmount > 0) {
      if (o.pay_movement_id) {
        db.prepare('UPDATE account_movements SET amount=? WHERE id=?').run(payAmount, o.pay_movement_id);
      } else {
        const pid = ins('ODM-' + no, payType, 'alacak', payAmount);
        db.prepare(`UPDATE ${table} SET pay_movement_id=? WHERE rowid=?`).run(pid, id);
      }
    } else if (o.pay_movement_id) {
      db.prepare('DELETE FROM account_movements WHERE id=?').run(o.pay_movement_id);
      db.prepare(`UPDATE ${table} SET pay_movement_id=NULL WHERE rowid=?`).run(id);
    }
  }
  return total;
}
// Sipariş 'Siparişe Dönüştürüldü' olunca genel merkez stoğundan düşer, bayinin stoğuna eklenir.
// Önceki etki tersine çevrilir, sonra güncel satırlara göre yeniden uygulanır (satır/adet değişiklikleri tutarlı).
function syncOrderStock(orderId) {
  const o = db.prepare('SELECT * FROM orders WHERE rowid=?').get(orderId);
  if (!o) return;
  const converted = o.status === 'Siparişe Dönüştürüldü';
  const stmt = db.prepare('SELECT * FROM order_stock_snap WHERE order_id=?');
  for (const s of stmt.all(orderId)) {
    db.prepare('UPDATE products SET stock=MAX(0, COALESCE(stock,0)+?) WHERE id=?').run(s.qty, s.product_id);
    db.prepare('UPDATE firm_stock SET qty=MAX(0, qty-?) WHERE firm_id=? AND product_id=?').run(s.qty, s.firm_id, s.product_id);
  }
  db.prepare('DELETE FROM order_stock_snap WHERE order_id=?').run(orderId);
  if (!converted) return;
  const agg = {};
  for (const i of db.prepare('SELECT product_name, qty FROM order_items WHERE order_id=?').all(orderId)) {
    const q = +i.qty;
    if (q > 0 && i.product_name) agg[i.product_name] = (agg[i.product_name] || 0) + q;
  }
  const apply = db.prepare('INSERT INTO order_stock_snap(order_id, product_id, qty, firm_id) VALUES(?,?,?,?)');
  for (const [name, qty] of Object.entries(agg)) {
    const p = db.prepare('SELECT id FROM products WHERE name=? AND active=1').get(name);
    if (!p) continue;
    db.prepare('UPDATE products SET stock=MAX(0, COALESCE(stock,0)-?) WHERE id=?').run(qty, p.id);
    db.prepare('INSERT INTO firm_stock(firm_id,product_id,qty) VALUES(?,?,?) ON CONFLICT(firm_id,product_id) DO UPDATE SET qty=qty+excluded.qty')
      .run(o.firm_id, p.id, qty);
    apply.run(orderId, p.id, qty, o.firm_id);
  }
}
function revertOrderStock(orderId) {
  for (const s of db.prepare('SELECT * FROM order_stock_snap WHERE order_id=?').all(orderId)) {
    db.prepare('UPDATE products SET stock=MAX(0, COALESCE(stock,0)+?) WHERE id=?').run(s.qty, s.product_id);
    db.prepare('UPDATE firm_stock SET qty=MAX(0, qty-?) WHERE firm_id=? AND product_id=?').run(s.qty, s.firm_id, s.product_id);
  }
  db.prepare('DELETE FROM order_stock_snap WHERE order_id=?').run(orderId);
}
addCol('payments', 'movement_id', 'INTEGER');
// Online ödeme "Tahsil Edildi" olunca firmanın ana carisine alacak olarak işlenir.
// Yedek parça siparişine bağlı ödemeler sipariş cari kaydı (syncOrderDebit) tarafından zaten işlenir.
function syncPaymentCredit(paymentId) {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
  if (!p) return;
  if (db.prepare('SELECT 1 FROM spare_orders WHERE payment_id=?').get(paymentId)) return;
  const completed = p.status === 'Onaylandı' || p.status === 'Tahsil Edildi';
  if (!completed) {
    if (p.movement_id) {
      db.prepare('DELETE FROM account_movements WHERE id=?').run(p.movement_id);
      db.prepare('UPDATE payments SET movement_id=NULL WHERE id=?').run(paymentId);
    }
    return;
  }
  const amt = Math.round(p.total * 100) / 100;
  if (!(amt > 0)) return;
  if (p.movement_id) {
    db.prepare('UPDATE account_movements SET amount=? WHERE id=?').run(amt, p.movement_id);
  } else {
    const docType = p.kind === 'odeme' ? 'Kredi Kartı Fişi' : 'Nakit';
    const mid = db.prepare("INSERT INTO account_movements(firm_id,ledger,date,doc_no,doc_type,kind,amount,has_detail) VALUES(?,?,date('now'),?,?,?,?,0)")
      .run(p.firm_id, 'ana', 'POS-' + p.id, docType, 'alacak', amt).lastInsertRowid;
    db.prepare('UPDATE payments SET movement_id=? WHERE id=?').run(mid, paymentId);
  }
}
function revertPaymentCredit(paymentId) {
  const p = db.prepare('SELECT movement_id FROM payments WHERE id=?').get(paymentId);
  if (p && p.movement_id) db.prepare('DELETE FROM account_movements WHERE id=?').run(p.movement_id);
}
const nextUserCode = firmId => {
  const prefix = String(firmId).padStart(3, '0');
  const m = db.prepare("SELECT MAX(CAST(SUBSTR(code,4) AS INTEGER)) m FROM dealer_users WHERE code GLOB ? AND LENGTH(code)=5").get(prefix + '[0-9][0-9]').m || 0;
  let n = m + 1, code;
  do { code = prefix + String(n++).padStart(2, '0'); } while (db.prepare('SELECT 1 FROM dealer_users WHERE code=?').get(code));
  return code;
};

const tx = fn => {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
};

// Onaylanmış/tahsil edilmiş fakat cari hesaba işlenmemiş eski ödemeleri yansıt (idempotent).
for (const r of db.prepare("SELECT id FROM payments WHERE movement_id IS NULL AND status IN ('Onaylandı','Tahsil Edildi')").all()) {
  try { syncPaymentCredit(r.id); } catch {}
}

module.exports = { db, get, set, allSettings, tx, nextNo, nextFirmCode, nextUserCode, syncOrderDebit, syncOrderStock, revertOrderStock, syncPaymentCredit, revertPaymentCredit };
