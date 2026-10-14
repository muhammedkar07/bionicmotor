const fs = require('fs');
const path = require('path');
const { db } = require('../db');

// SQLite'in VACUUM INTO komutu ile tutarlı (WAL dahil) yedek alır; eski yedekleri budar.
const DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const KEEP = +(process.env.BACKUP_KEEP || 10);

function runBackup() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = path.join(DIR, 'app-' + stamp + '.db');
    db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
    const files = fs
      .readdirSync(DIR)
      .filter(f => f.endsWith('.db'))
      .map(f => ({ f, t: fs.statSync(path.join(DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const x of files.slice(KEEP)) {
      try {
        fs.unlinkSync(path.join(DIR, x.f));
      } catch {
        /* yok say */
      }
    }
    return { ok: true, file: out, kept: Math.min(files.length, KEEP) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { runBackup, BACKUP_DIR: DIR, BACKUP_KEEP: KEEP };
