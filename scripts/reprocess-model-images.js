'use strict';
// MEVCUT MODEL GÖRSELLERİNİ YENİDEN İŞLE: kapalı beyaz alanları temizle, yeni dosya üret.
// - Orijinal dosyalar SİLİNMEZ (geri dönüş için korunur)
// - DB'deki models.image yeni dosyaya yönlendirilir
// Kullanım: node --env-file=.env scripts/reprocess-model-images.js --evet
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const { db } = require('../db');
const { UPLOAD_DIR, removeBackground } = require('../lib/upload');

if (!process.argv.includes('--evet')) {
  console.log('!! Model görselleri yeniden işlenecek (yeni dosya üretilir, orijinaller korunur).');
  console.log('   Onaylamak için: node --env-file=.env scripts/reprocess-model-images.js --evet');
  process.exit(1);
}

const PUB = path.join(__dirname, '..', 'public');
const absOf = p => {
  if (!p) return null;
  if (p.startsWith('/static/uploads/')) return path.join(UPLOAD_DIR, path.basename(p));
  if (p.startsWith('/static/')) return path.join(PUB, p.replace('/static/', ''));
  return null;
};

(async () => {
  const rows = db.prepare("SELECT id, name, image FROM models WHERE image IS NOT NULL AND TRIM(image) <> '' ORDER BY sort, id").all();
  console.log('işlenecek model:', rows.length, '\n');
  const res = [];
  for (const m of rows) {
    const src = absOf(m.image);
    const rec = { id: m.id, ad: (m.name || '').slice(0, 20), once: '-', sonra: '-', durum: '' };
    if (!src || !fs.existsSync(src)) {
      rec.durum = 'DOSYA YOK';
      res.push(rec);
      continue;
    }
    let work = null;
    try {
      // Orijinali BOZMADAN kopyala (şeffaf piksellerin RGB'si korunsun → arka plan rengi
      // doğru tespit edilsin), önce arka planı temizle, sonra boyutlandır.
      const base = crypto.randomBytes(12).toString('hex');
      const ext = path.extname(src).toLowerCase() || '.png';
      work = path.join(UPLOAD_DIR, base + ext);
      fs.copyFileSync(src, work);
      const file = { path: work, filename: path.basename(work), mimetype: 'image/png' };
      const changed = await removeBackground(file);
      if (!changed) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* yok say */
        }
        rec.durum = 'değişiklik yok';
        res.push(rec);
        continue;
      }
      const finalPath = path.join(UPLOAD_DIR, base + '-s.png');
      await sharp(file.path, { failOn: 'none' })
        .resize({ width: 1600, withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toFile(finalPath);
      if (file.path !== finalPath) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* yok say */
        }
      }
      const newPath = '/static/uploads/' + path.basename(finalPath);
      db.prepare('UPDATE models SET image=? WHERE id=?').run(newPath, m.id);
      rec.once = path.basename(src);
      rec.sonra = path.basename(finalPath);
      rec.durum = 'TEMİZLENDİ ✅';
      res.push(rec);
    } catch (e) {
      // Yarım kalan geçici dosyayı temizle
      try {
        if (work && fs.existsSync(work)) fs.unlinkSync(work);
      } catch {
        /* yok say */
      }
      rec.durum = 'HATA: ' + e.message.slice(0, 40);
      res.push(rec);
    }
  }
  console.log('--- sonuç ---');
  console.table(res.map(r => ({ id: r.id, model: r.ad, durum: r.durum })));
  const ok = res.filter(r => r.durum.startsWith('TEMİZLENDİ')).length;
  console.log(
    '\n temizlenen:',
    ok,
    '| değişiklik yok:',
    res.filter(r => r.durum === 'değişiklik yok').length,
    '| hata:',
    res.filter(r => r.durum.startsWith('HATA')).length
  );
  db.close();
})();
