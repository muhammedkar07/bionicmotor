const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { db, get, set } = require('../db');

// SQLite'in VACUUM INTO komutu ile tutarlı (WAL dahil) yedek alır.
// - Şifreleme (BACKUP_ENCRYPT_KEY) ve off-site yükleme (BACKUP_UPLOAD_CMD) opsiyoneldir.
// - Rotasyon: son N saatlik + her günün en yenisi (30 gün) + her ayın en yenisi (12 ay).
const DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const ENC_KEY = process.env.BACKUP_ENCRYPT_KEY || '';
const UPLOAD_CMD = process.env.BACKUP_UPLOAD_CMD || '';
const HOURLY_KEEP = +(process.env.BACKUP_HOURLY_KEEP || 24);
const DAILY_KEEP = +(process.env.BACKUP_DAILY_KEEP || 30);
const MONTHLY_KEEP = +(process.env.BACKUP_MONTHLY_KEEP || 12);
// Yüklenen dosyalar (görseller) — veritabanının yanında o da yedeklenir.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'public', 'uploads');

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const DB_RE = /^app-.*\.db$/;
const UP_RE = /^uploads-.*\.tar\.gz$/;
const list = (re = DB_RE) => {
  try {
    return fs
      .readdirSync(DIR)
      .filter(f => re.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
  } catch {
    return [];
  }
};

function integrityCheck(file) {
  try {
    const c = new DatabaseSync(file);
    const r = c.prepare('PRAGMA integrity_check').get();
    const tables = c.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n;
    c.close();
    const v = r && (r.integrity_check || r['integrity_check']);
    return { ok: v === 'ok', tables };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function encryptFile(file) {
  const key = crypto.scryptSync(ENC_KEY, 'bionic-backup', 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(fs.readFileSync(file)), cipher.final()]);
  const out = file + '.enc';
  fs.writeFileSync(out, Buffer.concat([iv, cipher.getAuthTag(), enc]));
  return out;
}

function upload(file) {
  if (!UPLOAD_CMD) return { ok: true, skipped: true };
  try {
    execSync(UPLOAD_CMD.replace(/\{file\}/g, file), { stdio: 'ignore', timeout: 10 * 60 * 1000 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Yüklenen dosyaları (upload klasörü) tek bir tar.gz arşivine alır. Klasör yok/boşsa null döner.
function archiveUploads(out) {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) return null;
    if (fs.readdirSync(UPLOAD_DIR).length === 0) return null;
    const parent = path.dirname(UPLOAD_DIR);
    const name = path.basename(UPLOAD_DIR);
    execFileSync('tar', ['-czf', out, '-C', parent, name], { stdio: 'ignore', timeout: 10 * 60 * 1000 });
    return fs.existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

function removeFile(f) {
  try {
    fs.unlinkSync(path.join(DIR, f));
  } catch {
    /* yok say */
  }
  try {
    fs.unlinkSync(path.join(DIR, f + '.enc'));
  } catch {
    /* yok say */
  }
}

function prune(re = DB_RE) {
  const now = Date.now();
  const files = list(re);
  const keep = new Set();
  // 1) en yeni HOURLY_KEEP yedek
  files.slice(0, HOURLY_KEEP).forEach(x => keep.add(x.f));
  // 2) son DAILY_KEEP günde, her günün en yenisi
  const seenDay = new Set();
  for (const x of files) {
    if (now - x.t > DAILY_KEEP * 86400000) continue;
    const d = new Date(x.t).toISOString().slice(0, 10);
    if (!seenDay.has(d)) {
      seenDay.add(d);
      keep.add(x.f);
    }
  }
  // 3) son MONTHLY_KEEP ayda, her ayın en yenisi
  const seenMonth = new Set();
  for (const x of files) {
    if (now - x.t > MONTHLY_KEEP * 31 * 86400000) continue;
    const m = new Date(x.t).toISOString().slice(0, 7);
    if (!seenMonth.has(m)) {
      seenMonth.add(m);
      keep.add(x.f);
    }
  }
  let removed = 0;
  for (const x of files) {
    if (!keep.has(x.f)) {
      removeFile(x.f);
      removed++;
    }
  }
  return removed;
}

// Yedek alır (rotasyon + opsiyonel şifreleme/off-site). Sonuç: { ok, file, bytes, ... }
function runBackup() {
  const result = { ok: false, time: new Date().toISOString() };
  try {
    fs.mkdirSync(DIR, { recursive: true });
    let out = path.join(DIR, 'app-' + stamp() + '.db');
    // Aynı saniyede çakışmayı önle
    let i = 1;
    while (fs.existsSync(out)) out = path.join(DIR, 'app-' + stamp() + '-' + i++ + '.db');
    db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
    result.file = out;
    result.bytes = fs.statSync(out).size;

    const chk = integrityCheck(out);
    if (!chk.ok) throw new Error('Yedek bütünlük kontrolünden geçemedi: ' + (chk.error || ''));
    result.tables = chk.tables;

    let uploadFile = out;
    if (ENC_KEY) {
      uploadFile = encryptFile(out);
      result.encrypted = uploadFile;
    }
    const up = upload(uploadFile);
    result.upload = up;
    if (!up.ok) result.error = 'Off-site yükleme başarısız: ' + up.error;

    // Yüklenen dosyaları (görseller) da yedekle.
    const uArc = archiveUploads(path.join(DIR, 'uploads-' + stamp() + '.tar.gz'));
    if (uArc) {
      result.uploadsBytes = fs.statSync(uArc).size;
      let uUpFile = uArc;
      if (ENC_KEY) uUpFile = encryptFile(uArc);
      const up2 = upload(uUpFile);
      if (!up2.ok) result.error = (result.error ? result.error + ' | ' : '') + 'Görsel yedeği yüklenemedi: ' + up2.error;
    }

    result.removed = prune(DB_RE) + prune(UP_RE);
    result.ok = up.ok || up.skipped;
  } catch (e) {
    result.error = e.message;
  }
  set('backup_last_time', result.time);
  set('backup_last_status', result.ok ? 'ok' : 'error');
  set('backup_last_file', path.basename(result.file || ''));
  set(
    'backup_last_detail',
    (result.ok ? 'ok' : result.error || 'hata') +
      (result.encrypted ? ' · şifreli' : '') +
      (result.upload && result.upload.skipped ? ' · off-site kapalı' : result.upload && result.upload.ok ? ' · off-site yüklendi' : '')
  );
  return result;
}

// En yeni yerel yedeğin bütünlüğünü doğrular (restore provası yerine hafif kontrol).
function verifyLatest() {
  try {
    const files = list();
    if (!files.length) return { ok: false, error: 'Yedek bulunamadı' };
    const f = files[0];
    const chk = integrityCheck(path.join(DIR, f.f));
    const res = { ok: chk.ok, file: f.f, tables: chk.tables, error: chk.error };
    set('backup_verify_time', new Date().toISOString());
    set('backup_verify_status', chk.ok ? 'ok' : 'error');
    return res;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function lastStatus() {
  return {
    time: get('backup_last_time') || null,
    status: get('backup_last_status') || null,
    file: get('backup_last_file') || null,
    detail: get('backup_last_detail') || null,
    verifyTime: get('backup_verify_time') || null,
    verifyStatus: get('backup_verify_status') || null,
    encrypted: !!ENC_KEY,
    offsite: !!UPLOAD_CMD,
    dir: DIR,
    count: list(DB_RE).length,
    uploadsCount: list(UP_RE).length
  };
}

module.exports = { runBackup, verifyLatest, lastStatus, BACKUP_DIR: DIR };
