'use strict';
// DEMO/ÖRNEK İÇERİK TEMİZLİĞİ
// SİLİNİR: örnek modeller (SST125, Cruiser 150, Urban 50) + ürünleri, slaytlar, kampanyalar,
//          duyurular, SSS (faqs), satış/servis noktaları (points), örnek kategoriler.
// KALIR : gerçek modeller + ürünleri (fiyat listesi), sayfalar (yasal/içerik), ayarlar,
//          taksitler, kalan kategoriler, yönetici.
//
// Kullanım:  node --env-file=.env scripts/clean-demo.js --evet
const { db } = require('../db');

const SAMPLE_MODELS = ['SST125', 'Cruiser 150', 'Urban 50'];
const SAMPLE_CATS = ['Scooter', 'Motosiklet'];

if (!process.argv.includes('--evet')) {
  console.log('!! Örnek/demo içerik silinecek (örnek modeller, slaytlar, kampanyalar, duyurular, SSS, noktalar).');
  console.log('   Onaylamak için:  node --env-file=.env scripts/clean-demo.js --evet');
  process.exit(1);
}

const q = (sql, ...a) => db.prepare(sql).run(...a).changes;
const ids = db
  .prepare('SELECT id FROM models WHERE name IN (' + SAMPLE_MODELS.map(() => '?').join(',') + ')')
  .all(...SAMPLE_MODELS)
  .map(r => r.id);

let n = 0;
db.exec('BEGIN');
try {
  if (ids.length) n += q('DELETE FROM products WHERE model_id IN (' + ids.map(() => '?').join(',') + ')', ...ids);
  n += q('DELETE FROM models WHERE name IN (' + SAMPLE_MODELS.map(() => '?').join(',') + ')', ...SAMPLE_MODELS);
  n += q('DELETE FROM categories WHERE name IN (' + SAMPLE_CATS.map(() => '?').join(',') + ')', ...SAMPLE_CATS);
  n += q('DELETE FROM slides');
  n += q('DELETE FROM campaigns');
  n += q('DELETE FROM announcements');
  n += q('DELETE FROM faqs');
  n += q('DELETE FROM points');
  db.exec('COMMIT');
  console.log('Silinen kayıt sayısı (yaklaşık): ' + n);
} catch (e) {
  db.exec('ROLLBACK');
  console.error('HATA, geri alındı: ' + e.message);
  process.exit(1);
}

console.log('--- kalan ---');
for (const t of ['models', 'products', 'categories', 'pages', 'settings', 'slides', 'campaigns', 'announcements', 'faqs', 'points', 'admins']) {
  try {
    console.log('  ' + t + ': ' + db.prepare('SELECT COUNT(*) n FROM ' + t).get().n);
  } catch {
    /* yok */
  }
}
db.close();
