const path = require('path');
const fs = require('fs');
const { db } = require('../db');

// SQLite'in VACUUM INTO komutu ile tutarlı (WAL dahil) bir yedek kopyası üretir.
// Kullanım: npm run backup  ya da  node scripts/backup.js <hedef.db>
const dir = path.join(__dirname, '..', 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.resolve(process.argv[2] || path.join(dir, `app-${stamp}.db`));

db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
console.log('Yedek alındı: ' + out);
