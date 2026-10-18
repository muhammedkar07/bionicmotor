'use strict';
// MUTABAKAT (reconcile): Paratika dönüşü (callback) herhangi bir nedenle ulaşmadıysa
// ("Sanal POS Bekliyor"da kalan) ama Paratika'da ONAYLANMIŞ ödemeleri sorgular ve cariye işler.
// Idempotenttir; callback ile aynı fonksiyonu (collectPayment) kullanır — çift kayıt olmaz.
//
// Ayrıca SÜRESİ DOLAN kayıtları düşürür: kullanıcı ödeme sayfasını açıp vazgeçtiyse kayıt
// sonsuza kadar "bekliyor" kalmaz.
//   PAYMENT_EXPIRE_MIN     (varsayılan 3)  : Paratika'da hiç işlem denemesi yoksa bu süre sonra İptal
//   PAYMENT_EXPIRE_MAX_MIN (varsayılan 30) : İşlem denemesi var ama hâlâ sonuçlanmadıysa bu süre sonra İptal
//   RECONCILE_MIN_AGE_MIN  (varsayılan 2)  : Çok taze ödemeler atlanır (3D adımı sürüyor olabilir)
//
// GÜVENLİK: Paratika'da onaylanmış bir ödeme ASLA düşürülmez; süresi dolan bir kayıt sonradan
// onaylanırsa callback/mutabakat yine de cariye işler (collectPayment durumdan bağımsız çalışır).
//
// Kullanım:  node --env-file=.env scripts/reconcile.js
const { db, STATUS, logAudit } = require('../db');
const paratika = require('../lib/paratika');
const { collectPayment } = require('../lib/pay');

const ageMinutes = createdAt => {
  const t = Date.parse(String(createdAt || '').replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return 1e9;
  return (Date.now() - t) / 60000;
};

async function reconcile({ log = console.log } = {}) {
  const minAge = +(process.env.RECONCILE_MIN_AGE_MIN || 2);
  const expireMin = +(process.env.PAYMENT_EXPIRE_MIN || 3);
  const expireMax = +(process.env.PAYMENT_EXPIRE_MAX_MIN || 30);
  // Süresi dolup İptal edilmiş kayıtlar da bir süre izlenir: kullanıcı 3D adımını geç
  // tamamlar da dönüş (callback) kaybolursa tahsilat yine de cariye işlenmelidir.
  const lateCheckH = +(process.env.PAYMENT_LATE_CHECK_HOURS || 6);
  const rows = db
    .prepare(
      `SELECT id, provider_order, source, created_at, status FROM payments
        WHERE provider='paratika' AND provider_order IS NOT NULL AND deleted_at IS NULL
          AND ( (status=? AND datetime(created_at) <= datetime('now', ?))
             OR (status=? AND datetime(created_at) >= datetime('now', ?)) )
        ORDER BY id`
    )
    .all(STATUS.POS_PENDING, '-' + minAge + ' minutes', STATUS.CANCELLED, '-' + lateCheckH + ' hours');
  const res = { checked: rows.length, collected: 0, pending: 0, failed: 0, expired: 0, orders_cancelled: 0 };

  // Ödemeye bağlı yedek parça siparişi "Beklemede" kaldıysa onu da iptal eder: kullanıcı
  // "Onayla ve Öde" deyip ödemeyi tamamlamadan çıktıysa yarım sipariş listede takılı kalmasın.
  // Idempotenttir; yalnızca hâlâ "Beklemede" olan siparişi değiştirir.
  const cancelLinkedSpareOrder = paymentId => {
    const so = db
      .prepare('SELECT id, no FROM spare_orders WHERE payment_id=? AND status=? AND deleted_at IS NULL')
      .get(paymentId, STATUS.PENDING);
    if (!so) return null;
    const n = db.prepare('UPDATE spare_orders SET status=? WHERE id=? AND status=?').run(STATUS.CANCELLED, so.id, STATUS.PENDING).changes;
    if (!n) return null;
    res.orders_cancelled++;
    logAudit(
      { type: 'sistem', name: 'mutabakat' },
      'spare_order_cancelled',
      'spare_orders',
      so.id,
      { payment: paymentId, reason: 'ödeme tamamlanmadı' },
      null
    );
    return so;
  };

  for (const p of rows) {
    const cancelled = p.status === STATUS.CANCELLED;
    try {
      const v = await paratika.query({ orderId: p.provider_order });

      if (v.ok) {
        if (collectPayment(p.id, v.ref)) {
          res.collected++;
          logAudit(
            { type: 'sistem', name: 'mutabakat' },
            'payment_collected',
            'payments',
            p.id,
            { provider_order: p.provider_order, via: cancelled ? 'reconcile-late' : 'reconcile' },
            null
          );
          log('  ✅ #' + p.id + (cancelled ? ' GECİKMİŞ ONAY → tahsil edildi' : ' tahsil edildi') + ' (' + p.provider_order + ')');
        }
        continue;
      }

      // Daha önce iptal edilmiş kayıt: onay yoksa YENİDEN iptal edilmez; ancak o ödemeye bağlı
      // yarım kalmış bir yedek parça siparişi varsa temizlenir (eski kayıtlar için de idempotent).
      if (cancelled) {
        const so = cancelLinkedSpareOrder(p.id);
        if (so) log('  ⏱ #' + p.id + ' (iptal) → bağlı yedek parça siparişi ' + so.no + ' da iptal edildi');
        continue;
      }

      // Yetki/yapılandırma hatası: durum BELİRSİZ — kaydı düşürme, sonra tekrar denenir.
      if (v.config) {
        res.failed++;
        log('  ⚠ #' + p.id + ' doğrulanamadı (yapılandırma): ' + (v.error || ''));
        continue;
      }

      if (v.pending) {
        const age = ageMinutes(p.created_at);
        // Paratika'da hiç deneme yok → kısa süre sonra düş. Deneme var ama sonuçlanmadı → uzun süre sonra düş.
        const expired = (v.noTxn && age >= expireMin) || age >= expireMax;
        if (expired) {
          const changed = db
            .prepare('UPDATE payments SET status=? WHERE id=? AND status=?')
            .run(STATUS.CANCELLED, p.id, STATUS.POS_PENDING).changes;
          if (changed) {
            res.expired++;
            logAudit(
              { type: 'sistem', name: 'mutabakat' },
              'payment_expired',
              'payments',
              p.id,
              { provider_order: p.provider_order, age_min: Math.round(age), no_txn: !!v.noTxn, via: 'reconcile' },
              null
            );
            const so = cancelLinkedSpareOrder(p.id);
            log(
              '  ⏱ #' + p.id + ' süresi doldu → İptal (' + Math.round(age) + ' dk, işlem denemesi: ' + (v.noTxn ? 'yok' : 'var') + ')' +
                (so ? ' · yedek parça siparişi ' + so.no + ' da iptal edildi' : '')
            );
          }
        } else {
          res.pending++;
        }
        continue;
      }

      // Kesin başarısız işlem (FA): kaydı İptal et (varsa bağlı yedek parça siparişiyle birlikte).
      const changed = db.prepare('UPDATE payments SET status=? WHERE id=? AND status=?').run(STATUS.CANCELLED, p.id, STATUS.POS_PENDING).changes;
      res.failed++;
      if (changed) {
        logAudit({ type: 'sistem', name: 'mutabakat' }, 'payment_failed', 'payments', p.id, { provider_order: p.provider_order, error: v.error || null }, null);
        const so = cancelLinkedSpareOrder(p.id);
        if (so) log('     ↳ yedek parça siparişi ' + so.no + ' da iptal edildi');
      }
      log('  ❌ #' + p.id + ' onaylanmadı: ' + (v.error || 'bilinmiyor'));
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
    console.log(
      `Mutabakat: kontrol=${r.checked} tahsil=${r.collected} bekleyen=${r.pending} süresi dolan=${r.expired} başarısız=${r.failed}`
    );
    process.exit(0);
  });
}
