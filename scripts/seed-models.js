'use strict';
// Modelleri data/models-seed.json dosyasından veritabanına yükler.
// Idempotent'tir: aynı isimde model varsa atlar (tekrar çalıştırmak güvenlidir).
// Kullanım:  node scripts/seed-models.js        (DATA_DIR'e göre mevcut veritabanına yazar)
const fs = require('fs');
const path = require('path');
const { db } = require('../db');

const file = path.join(__dirname, '..', 'data', 'models-seed.json');
if (!fs.existsSync(file)) {
  console.error('Bulunamadı: ' + file);
  process.exit(1);
}
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));

const exists = db.prepare('SELECT id FROM models WHERE name=?');
const ins = db.prepare(
  'INSERT INTO models(name,category,cc,power,gearbox,description,image,price,sort,active) VALUES(?,?,?,?,?,?,?,?,?,?)'
);

let added = 0;
let skipped = 0;
for (const m of rows) {
  if (exists.get(m.name)) {
    skipped++;
    continue;
  }
  ins.run(
    m.name,
    m.category || '',
    m.cc || '',
    m.power || '',
    m.gearbox || '',
    m.description || '',
    m.image || '',
    m.price || 0,
    m.sort || 0,
    m.active === 0 ? 0 : 1
  );
  added++;
}
console.log(`Modeller yüklendi: eklenen=${added} atlanan=${skipped} (toplam ${rows.length})`);
db.close();
