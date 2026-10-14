'use strict';
// Müşteriye göstermek / test etmek için AYRI bir demo veritabanı ile çalıştırır.
// Gerçek verilere (data/) dokunmaz; kart ödemeleri Paratika simülasyon modundadır.
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const demoDir = process.env.DATA_DIR || path.join(root, 'demo-data');
fs.mkdirSync(demoDir, { recursive: true });

process.env.DATA_DIR = demoDir;
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(demoDir, 'uploads');
process.env.SEED_DEMO = process.env.SEED_DEMO || '1';
process.env.PARATIKA_SIMULATE = process.env.PARATIKA_SIMULATE || '1';
process.env.TRUST_PROXY = process.env.TRUST_PROXY || '1';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'DemoAdmin12345!x';
const PORT = process.env.PORT || 3000;

const app = require('../server');
app.start(PORT); // zarif kapanış + otomatik onarım/test işleri dahil
const b = '  ';
console.log('');
console.log(b + '=== DEMO MODU ===');
console.log(b + 'Yönetim:      /admin   ->  admin / ' + process.env.ADMIN_PASSWORD);
console.log(b + 'Bayi paneli:  /bayi    ->  kullanıcı kodu 25895 / demo1234Ab!');
console.log(b + 'Online ödeme: /odeme   ->  demo@bayi.local / demo1234Ab!');
console.log(b + 'Kart ödemeleri Paratika SİMÜLASYON modunda çalışır.');
console.log(b + 'Veri klasörü: ' + demoDir);
console.log(b + 'Müşteriye link için (ayrı terminal): npm run tunnel');
console.log('');
