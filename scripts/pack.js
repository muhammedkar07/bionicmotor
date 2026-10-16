'use strict';
// Tam taşıma/yedek paketi: KOD + VERİ (db + yüklenen görseller) + .env
//   çıktı: <BACKUP_DIR>/full-<zaman>.tar.gz  →  içinde bionic/{app,data,.env}
//
// Kullanım:
//   sunucuda:  node --env-file=.env scripts/pack.js
//   yerelde:   node scripts/pack.js
//
// Taşıma (yeni sunucuya):
//   tar -xzf full-XXXX.tar.gz        (bionic/app, bionic/data, bionic/.env çıkar)
//   app -> /var/www/bionic , data -> /var/lib/bionic/data , .env -> /var/www/bionic/.env
//   npm ci --omit=dev && pm2 start ecosystem.config.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const OUT_DIR = process.env.BACKUP_DIR || path.join(ROOT, 'backups');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bionic-pack-'));
const bundle = path.join(tmp, 'bionic');
fs.mkdirSync(bundle, { recursive: true });

const SKIP = [
  /node_modules/,
  /[\\/]\.git([\\/]|$)/,
  /[\\/]backups([\\/]|$)/,
  /[\\/]logs([\\/]|$)/,
  /[\\/]demo-data([\\/]|$)/,
  /[\\/][^\\/]+\.tar\.gz$/
];
const copy = (src, dst) => {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dst, { recursive: true, filter: s => !SKIP.some(re => re.test(s)) });
};

copy(ROOT, path.join(bundle, 'app')); // kod
copy(DATA_DIR, path.join(bundle, 'data')); // db + yüklenen dosyalar
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) fs.copyFileSync(envFile, path.join(bundle, '.env'));

fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, 'full-' + stamp + '.tar.gz');
execFileSync('tar', ['-czf', out, '-C', tmp, 'bionic'], { stdio: 'ignore' });
fs.rmSync(tmp, { recursive: true, force: true });

const mb = (fs.statSync(out).size / 1048576).toFixed(1);
console.log('Tam paket hazır: ' + out + ' (' + mb + ' MB)');
console.log('İçerik: bionic/app (kod) · bionic/data (veritabanı + yüklemeler) · bionic/.env');
