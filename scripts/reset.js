'use strict';
// SIFIRLAMA: veritabanını data/baseline.db (temiz başlangıç) hâline döndürür.
// Önce baseline alınmış olmalı:  node --env-file=.env scripts/baseline.js
// Sıfırla:                       node --env-file=.env scripts/reset.js --evet
//
// Güvenlik: mevcut veritabanı önce BACKUP_DIR'e kopyalanır (pre-reset-*.db).
// Uygulama çalışıyorsa (PM2) durdurulup sonra yeniden başlatılır.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB = path.join(DATA_DIR, 'app.db');
const BASELINE = process.env.BASELINE_DB || path.join(ROOT, 'data', 'baseline.db');
const BK_DIR = process.env.BACKUP_DIR || path.join(ROOT, 'backups');
const APP = process.env.PM2_APP || 'bionic';

// GÜVENLİK: Canlı ortamda veri silme KAPALIDIR. Bu ortam canlıya benziyorsa (DATA_DIR/PM2_APP
// içinde "test/staging" geçmiyorsa) ek onay istenir: ALLOW_PROD_RESET=1
const looksProd = !/test|staging/i.test(DATA_DIR) && !/test|staging/i.test(process.env.PM2_APP || '');
if (looksProd && process.env.ALLOW_PROD_RESET !== '1') {
  console.error('!! Bu ortam CANLI görünüyor: ' + DATA_DIR);
  console.error('   Canlıda veri silme/geri yükleme KAPALI (gerçek müşteri verisi korunuyor).');
  console.error('   Gerçekten istiyorsanız:  ALLOW_PROD_RESET=1 node --env-file=.env scripts/reset.js --evet');
  process.exit(1);
}

const pm = args => {
  try {
    execFileSync('pm2', args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

if (!process.argv.includes('--evet')) {
  console.log('!! Veritabanı "temiz başlangıç" (baseline) hâline döndürülecek; mevcut veriler gidecek.');
  console.log('   Onaylamak için:  node --env-file=.env scripts/reset.js --evet');
  process.exit(1);
}
if (!fs.existsSync(BASELINE)) {
  console.error('Baseline bulunamadı: ' + BASELINE);
  console.error('Önce:  node --env-file=.env scripts/baseline.js');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const wasRunning = pm(['stop', APP]); // çalışıyorsa durdur

// 1) Güvenlik yedeği (mevcut hâl)
fs.mkdirSync(BK_DIR, { recursive: true });
for (const ext of ['', '-wal', '-shm']) {
  const f = DB + ext;
  if (fs.existsSync(f)) fs.copyFileSync(f, path.join(BK_DIR, 'pre-reset-' + stamp + '.db' + ext));
}
console.log('Güvenlik yedeği: ' + path.join(BK_DIR, 'pre-reset-' + stamp + '.db'));

// 2) Baseline'ı yerleştir (WAL/SHM temizle)
for (const ext of ['', '-wal', '-shm']) {
  const f = DB + ext;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
fs.copyFileSync(BASELINE, DB);
console.log('Sıfırlandı → ' + DB + ' (' + (fs.statSync(DB).size / 1024).toFixed(0) + ' KB)');

// 3) ADMIN_PASSWORD verilmişse yönetici parolasını ona göre güncelle (baseline'daki parolayı ez)
try {
  if (process.env.ADMIN_PASSWORD) {
    const { DatabaseSync } = require('node:sqlite');
    const bcrypt = require('bcryptjs');
    const d = new DatabaseSync(DB);
    d.prepare('UPDATE admins SET password_hash=? WHERE username=?').run(bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10), 'admin');
    d.close();
    console.log('Yönetici parolası ADMIN_PASSWORD ile güncellendi.');
  }
} catch (e) {
  console.log('Not: yönetici parolası güncellenemedi (' + e.message + ')');
}

if (wasRunning) pm(['start', APP]);
console.log('Bitti.' + (wasRunning ? ' Uygulama yeniden başlatıldı.' : ' Uygulamayı başlatın: pm2 start ' + APP));
