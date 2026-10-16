// Manuel yedek: lib/backup motorunu kullanır (bütünlük kontrolü + rotasyon + şifreleme + off-site).
// Kullanım: npm run backup
const { runBackup } = require('../lib/backup');

const r = runBackup();
if (r.ok) {
  console.log('Yedek alındı: ' + r.file);
  console.log('  boyut: ' + r.bytes + ' bayt · tablo: ' + r.tables + ' · silinen eski: ' + (r.removed || 0));
  if (r.encrypted) console.log('  şifreli kopya: ' + r.encrypted);
  if (r.upload && r.upload.skipped) console.log('  off-site: kapalı (BACKUP_UPLOAD_CMD)');
  else if (r.upload && r.upload.ok) console.log('  off-site: yüklendi');
} else {
  console.error('Yedek BAŞARISIZ: ' + r.error);
  process.exit(1);
}
