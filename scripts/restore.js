// Bir yedekten canlı veritabanını geri yükler.
// Kullanım:
//   node scripts/restore.js                 # en yeni yerel yedeği seçer
//   node scripts/restore.js <yol.db|yol.db.enc>
//   CONFIRM=1 node scripts/restore.js ...   # onay (zorunlu)
//
// Not: Bu betik canlı DB'yi AÇMAZ (kilit sorunu olmasın diye dosya üzerinde çalışır).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ENC_KEY = process.env.BACKUP_ENCRYPT_KEY || '';
const LIVE = path.join(DATA_DIR, 'app.db');

function fail(msg) {
  console.error('HATA: ' + msg);
  process.exit(1);
}

function newest() {
  if (!fs.existsSync(DIR)) return null;
  const files = fs
    .readdirSync(DIR)
    .filter(f => /^app-.*\.db(\.enc)?$/.test(f))
    .map(f => ({ f: path.join(DIR, f), t: fs.statSync(path.join(DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files.length ? files[0].f : null;
}

let src = process.argv[2];
if (!src) src = newest();
if (!src) fail('Yedek dosyası bulunamadı.');
if (!fs.existsSync(src)) fail('Dosya yok: ' + src);

let dbFile = src;
if (src.endsWith('.enc')) {
  if (!ENC_KEY) fail('Şifreli yedek için BACKUP_ENCRYPT_KEY tanımlı olmalı.');
  const buf = fs.readFileSync(src);
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const key = crypto.scryptSync(ENC_KEY, 'bionic-backup', 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  dbFile = path.join(DIR, 'restore-tmp-' + Date.now() + '.db');
  fs.writeFileSync(dbFile, Buffer.concat([d.update(data), d.final()]));
  console.log('Şifreli yedek çözüldü.');
}

try {
  const c = new DatabaseSync(dbFile);
  const chk = c.prepare('PRAGMA integrity_check').get();
  const tables = c.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n;
  c.close();
  const v = chk && (chk.integrity_check || chk['integrity_check']);
  if (v !== 'ok') fail('Yedeğin bütünlük kontrolü başarısız.');
  console.log('Bütünlük OK · ' + tables + ' tablo · kaynak: ' + src);
} catch (e) {
  fail('Yedek açılamadı: ' + e.message);
}

if (process.env.CONFIRM !== '1') {
  console.log('\nUYARI: Canlı veritabanı DEĞİŞTİRİLECEK:');
  console.log('  kaynak : ' + dbFile);
  console.log('  hedef  : ' + LIVE);
  console.log('\nOnaylamak için:  CONFIRM=1 node scripts/restore.js "' + src + '"');
  process.exit(0);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
if (fs.existsSync(LIVE)) {
  const pre = path.join(DIR, 'app-pre-restore-' + new Date().toISOString().replace(/[:.]/g, '-') + '.db');
  fs.copyFileSync(LIVE, pre);
  console.log('Mevcut veritabanı yedeklendi: ' + pre);
}
const tmp = LIVE + '.restoring';
fs.copyFileSync(dbFile, tmp);
fs.renameSync(tmp, LIVE);
for (const ext of ['-wal', '-shm']) {
  try {
    fs.unlinkSync(LIVE + ext);
  } catch {
    /* yok say */
  }
}
if (dbFile.startsWith(path.join(DIR, 'restore-tmp-'))) {
  try {
    fs.unlinkSync(dbFile);
  } catch {
    /* yok say */
  }
}
console.log('Geri yükleme tamamlandı. Sunucuyu yeniden başlatın.');
