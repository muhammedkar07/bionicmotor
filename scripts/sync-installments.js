'use strict';
// GEÇMİŞ TAKSİT DÜZELTMESİ: Daha önce taksit bilgisi kaydedilmediği için dekontunda
// "Tek Çekim" görünen Paratika ödemelerini kaynaktan (QUERYTRANSACTION → installmentCount)
// doğrulayıp günceller. Yalnızca TAHSİL EDİLMİŞ (Tahsil Edildi) kart ödemelerine dokunur;
// tutar/cari kayıtlar DEĞİŞMEZ.
//
// Kullanım: node --env-file=.env scripts/sync-installments.js [--dry-run]
const { db, STATUS, logAudit } = require('../db');
const paratika = require('../lib/paratika');
const { installmentLabel } = require('../lib/pay');

async function syncInstallments({ dry = false, log = console.log } = {}) {
  const rows = db
    .prepare(
      `SELECT id, provider_order, installment FROM payments
        WHERE provider='paratika' AND provider_order IS NOT NULL AND status=? AND deleted_at IS NULL
        ORDER BY id`
    )
    .all(STATUS.COLLECTED);

  const res = { checked: rows.length, changed: 0, skipped: 0, failed: 0 };
  for (const p of rows) {
    const v = await paratika.query({ orderId: p.provider_order });
    if (!v.ok) {
      res.failed++;
      log('  ⚠ #' + p.id + ' doğrulanamadı: ' + (v.error || 'bilinmeyen hata'));
      continue;
    }
    const label = installmentLabel(v.installment);
    if (!label) {
      res.skipped++;
      log('  – #' + p.id + ' taksit bilgisi yanıtta yok, atlandı');
      continue;
    }
    if (label === p.installment) {
      res.skipped++;
      continue;
    }
    res.changed++;
    log('  ' + (dry ? '•' : '✔') + ' #' + p.id + ' ' + (p.installment || '(boş)') + ' → ' + label);
    if (dry) continue;
    db.prepare('UPDATE payments SET installment=? WHERE id=?').run(label, p.id);
    logAudit(
      { type: 'sistem', name: 'taksit-senkron' },
      'installment_synced',
      'payments',
      p.id,
      { from: p.installment || null, to: label, provider_order: p.provider_order },
      null
    );
  }
  return res;
}

module.exports = { syncInstallments };

if (require.main === module) {
  syncInstallments({ dry: process.argv.includes('--dry-run') }).then(r => {
    console.log(`Taksit senkronu: kontrol=${r.checked} güncellenen=${r.changed} atlanan=${r.skipped} hata=${r.failed}`);
    process.exit(0);
  });
}
