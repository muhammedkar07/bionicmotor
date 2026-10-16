'use strict';
// MUTABAKAT (reconcile): Paratika dönüşü (callback) herhangi bir nedenle ulaşmadıysa
// ("Sanal POS Bekliyor"da kalan) ama Paratika'da ONAYLANMIŞ ödemeleri sorgular ve cariye işler.
// Idempotenttir; callback ile aynı fonksiyonu (collectPayment) kullanır — çift kayıt olmaz.
//
// Kullanım:  node --env-file=.env scripts/reconcile.js
const { db, STATUS, logAudit } = require('../db');
const paratika = require('../lib/paratika');
const { collectPayment } = require('../lib/pay');

async function reconcile({ log = console.log } = {}) {
  const minAge = +(process.env.RECONCILE_MIN_AGE_MIN || 2); // çok taze ödemeleri atla
  const rows = db
    .prepare(
      "SELECT id, provider_order, source FROM payments WHERE provider='paratika' AND status=? " +
        "AND provider_order IS NOT NULL AND datetime(created_at) <= datetime('now', '-" +
        minAge +
        " minutes') ORDER BY id"
    )
    .all(STATUS.POS_PENDING);
  const res = { checked: rows.length, collected: 0, pending: 0, failed: 0 };
  for (const p of rows) {
    try {
      const v = await paratika.query({ orderId: p.provider_order });
      if (v.ok) {
        if (collectPayment(p.id, v.ref)) {
          res.collected++;
          logAudit({ type: 'sistem', name: 'mutabakat' }, 'payment_collected', 'payments', p.id, { provider_order: p.provider_order, via: 'reconcile' }, null);
          log('  ✅ #' + p.id + ' tahsil edildi (' + p.provider_order + ')');
        }
      } else if (v.pending) {
        res.pending++;
      } else {
        res.failed++;
        log('  ❌ #' + p.id + ' onaylanmadı: ' + (v.error || 'bilinmiyor'));
      }
    } catch (e) {
      // Tek bir ödeme hata verse bile döngü devam eder (firma silinmiş vb.).
      res.failed++;
      log('  ⚠ #' + p.id + ' işlenemedi: ' + e.message);
    }
  }
  return res;
}

module.exports = { reconcile };

if (require.main === module) {
  reconcile().then(r => {
    console.log(`Mutabakat: kontrol=${r.checked} tahsil=${r.collected} bekleyen=${r.pending} başarısız=${r.failed}`);
    process.exit(0);
  });
}
