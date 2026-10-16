'use strict';
// TEMİZ VERİ (demo/sunum): işlemsel ve kullanıcı verilerini siler.
// KORUNUR: admins (yönetici), settings, models, pages, categories, faqs, slides,
//          campaigns, announcements, points (satış/servis noktaları), installments, products.
// SİLİNİR: firms, dealer_users, account_movements, payments, siparişler, garanti, iş emirleri,
//          başvurular, mesajlar, stok hareketleri, audit_log, oturumlar, giriş denemeleri.
//
// Kullanım:  node --env-file=.env scripts/reset-data.js --evet
const { db } = require('../db');

const CLEAR = [
  // çocuk tablolar önce
  'order_items',
  'order_stock_snap',
  'orders',
  'spare_order_items',
  'spare_orders',
  'firm_stock',
  'account_movements',
  'payments',
  'user_firms',
  'dealer_users',
  'warranty_records',
  'work_orders',
  'applications',
  'messages',
  'stock_notify',
  'audit_log',
  'login_attempts',
  'sessions',
  'firms'
];

if (!process.argv.includes('--evet')) {
  console.log('!! Bu işlem firmaları, kullanıcıları, ödemeleri ve cari hareketleri KALICI olarak siler.');
  console.log('   Onaylamak için:  node --env-file=.env scripts/reset-data.js --evet');
  process.exit(1);
}

const counts = {};
for (const t of CLEAR) {
  try {
    counts[t] = db.prepare('SELECT COUNT(*) n FROM ' + t).get().n;
  } catch {
    counts[t] = null; // tablo yok
  }
}
console.log('--- silinecek kayıtlar ---');
for (const t of CLEAR) if (counts[t]) console.log('  ' + t + ': ' + counts[t]);

db.exec('BEGIN');
try {
  for (const t of CLEAR) {
    if (counts[t] === null) continue;
    db.prepare('DELETE FROM ' + t).run();
    try {
      db.prepare('DELETE FROM sqlite_sequence WHERE name=?').run(t); // id sayacını sıfırla
    } catch {
      /* sqlite_sequence yoksa yok say */
    }
  }
  db.exec('COMMIT');
  console.log('TAMAM: veriler temizlendi.');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('HATA, geri alındı: ' + e.message);
  process.exit(1);
}

console.log('--- korunan kayıtlar ---');
for (const t of ['admins', 'models', 'pages', 'settings', 'products', 'points', 'slides', 'campaigns', 'announcements', 'faqs']) {
  try {
    console.log('  ' + t + ': ' + db.prepare('SELECT COUNT(*) n FROM ' + t).get().n);
  } catch {
    /* yok */
  }
}
db.close();
