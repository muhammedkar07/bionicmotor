'use strict';
// BASELINE: mevcut (temiz) veritabanının tutarlı bir kopyasını alır.
// Sıfırlama (npm run reset) bu dosyaya geri döndürür.
// Kullanım:  node --env-file=.env scripts/baseline.js
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB = path.join(DATA_DIR, 'app.db');
const OUT = process.env.BASELINE_DB || path.join(ROOT, 'data', 'baseline.db');

if (!fs.existsSync(DB)) {
  console.error('Veritabanı bulunamadı: ' + DB);
  process.exit(1);
}
const c = new DatabaseSync(DB);
fs.rmSync(OUT, { force: true });
c.exec("VACUUM INTO '" + OUT.replace(/'/g, "''") + "'"); // tutarlı, WAL dahil tam kopya
c.close();
console.log('Baseline yazıldı: ' + OUT + ' (' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB)');
console.log('Bu dosya "temiz başlangıç"tır; npm run reset bunu geri yükler.');
