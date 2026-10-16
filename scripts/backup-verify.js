// En yeni yerel yedeğin bütünlüğünü doğrular (restore provası yerine hafif kontrol).
// Kullanım: npm run backup:verify
const { verifyLatest, lastStatus, BACKUP_DIR } = require('../lib/backup');

const st = lastStatus();
console.log('Yedek klasörü: ' + BACKUP_DIR + ' · ' + st.count + ' yedek');
console.log('Son yedek: ' + (st.time || '-') + ' · durum: ' + (st.status || '-'));
const v = verifyLatest();
if (v.ok) {
  console.log('DOĞRULAMA OK · dosya: ' + v.file + ' · tablo: ' + v.tables);
} else {
  console.error('DOĞRULAMA HATASI: ' + (v.error || 'bilinmeyen'));
  process.exit(1);
}
