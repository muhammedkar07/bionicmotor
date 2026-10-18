'use strict';
// MUTABAKAT / SÜRE DOLUMU testleri.
// Paratika'ya AĞ İSTEĞİ YAPILMAZ: lib/paratika.query fonksiyonu test boyunca taklit edilir.
// Böylece "onaylı ödeme cariye işlenir", "onaysız + süresi dolmuş ödeme İptal edilir" ve
// "gecikmiş onay yine de tahsil edilir" davranışları deterministik olarak doğrulanır.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bionic-recon-'));
process.env.DATA_DIR = TMP;
process.env.UPLOAD_DIR = path.join(TMP, 'uploads');
process.env.ADMIN_PASSWORD = 'TestAdmin1234!xy';
process.env.NODE_ENV = 'test';
process.env.PARATIKA_SIMULATE = '0';

const { db, STATUS } = require('../db');
const paratika = require('../lib/paratika');
const { reconcile } = require('../scripts/reconcile');
const { accountSummary } = require('../lib/account');

// Mutabakat TÜM bekleyen/iptal kayıtları taradığı için her test kendi verisiyle başlar.
const reset = () => {
  db.prepare('DELETE FROM account_movements').run();
  db.prepare('DELETE FROM payments').run();
  db.prepare('DELETE FROM firms').run();
};
const firm = () =>
  Number(
    db
      .prepare("INSERT INTO firms(code,name,devir) VALUES(?,?,0)")
      .run('R' + Date.now() + Math.round(Math.random() * 1e6), 'RECON FIRM').lastInsertRowid
  );
const addPayment = (firmId, order, minutesAgo) =>
  Number(
    db
      .prepare(
        `INSERT INTO payments(firm_id,kind,amount,currency,amount_tl,status,provider,provider_order,source,created_at)
         VALUES(?,'odeme',100000,'TL',100000,?,'paratika',?,'odeme',datetime('now',?))`
      )
      .run(firmId, STATUS.POS_PENDING, order, '-' + minutesAgo + ' minutes').lastInsertRowid
  );
const statusOf = id => db.prepare('SELECT status FROM payments WHERE id=?').get(id).status;

const withQuery = async (fn, impl) => {
  const orig = paratika.query;
  paratika.query = impl;
  try {
    return await fn();
  } finally {
    paratika.query = orig;
  }
};

test('mutabakat: onaylı ödeme cariye işlenir, onaysız+süresi dolmuş ödeme İptal edilir', async () => {
  reset();
  const f = firm();
  const paid = addPayment(f, 'R-PAID', 10);
  const stale = addPayment(f, 'R-STALE', 10);
  const inProgress = addPayment(f, 'R-PROGRESS', 10);
  const young = addPayment(f, 'R-YOUNG', 0);

  const r = await withQuery(() => reconcile({ log: () => {} }), async ({ orderId }) => {
    if (orderId === 'R-PAID') return { ok: true, ref: 'PGREF1', status: 'AP' };
    if (orderId === 'R-PROGRESS') return { ok: false, pending: true, noTxn: false, error: 'işlemde' };
    return { ok: false, pending: true, noTxn: true, error: 'sonuç yok' };
  });

  assert.strictEqual(statusOf(paid), STATUS.COLLECTED, 'onaylı ödeme tahsil edilmeli');
  assert.strictEqual(statusOf(stale), STATUS.CANCELLED, 'işlem denemesi olmayan eski kayıt iptal edilmeli');
  assert.strictEqual(statusOf(inProgress), STATUS.POS_PENDING, 'işlem denemesi olan kayıt beklemede kalmalı');
  assert.strictEqual(statusOf(young), STATUS.POS_PENDING, 'çok taze ödeme atlanmalı');
  assert.strictEqual(r.collected, 1, 'bir ödeme tahsil edilmeli');
  assert.strictEqual(r.expired, 1, 'bir ödeme süresi dolmalı');

  const mv = db.prepare("SELECT * FROM account_movements WHERE firm_id=? AND kind='alacak'").all(f);
  assert.strictEqual(mv.length, 1, 'yalnızca onaylı ödeme için cari hareket');
  assert.strictEqual(mv[0].amount, 100000, 'hareket tutarı ödeme tutarına eşit');
  assert.strictEqual(mv[0].doc_type, 'Kredi Kartı Fişi');
  assert.strictEqual(accountSummary(f, 'ana').balance, -100000, 'cari alacak (negatif bakiye)');
});

test('mutabakat: yapılandırma hatasında kayıt düşürülmez', async () => {
  reset();
  const f = firm();
  const p = addPayment(f, 'R-CONF', 10);
  const r = await withQuery(() => reconcile({ log: () => {} }), async () => ({ ok: false, config: true, error: 'yetki yok' }));
  assert.strictEqual(statusOf(p), STATUS.POS_PENDING, 'yapılandırma hatasında kayıt beklemede kalmalı');
  assert.strictEqual(r.expired, 0);
  assert.strictEqual(r.failed, 1);
  assert.strictEqual(r.collected, 0);
});

test('mutabakat: süresi dolan kayıt sonradan onaylanırsa yine de cariye işlenir', async () => {
  reset();
  const f = firm();
  const p = addPayment(f, 'R-LATE', 10);
  // 1) hiç işlem denemesi yok → İptal
  await withQuery(() => reconcile({ log: () => {} }), async () => ({ ok: false, pending: true, noTxn: true }));
  assert.strictEqual(statusOf(p), STATUS.CANCELLED, 'önce iptal edilmeli');
  // 2) gecikmiş onay → tahsil edilmeli (durumdan bağımsız, izleme penceresi içinde)
  const r2 = await withQuery(() => reconcile({ log: () => {} }), async () => ({ ok: true, ref: 'LATE1', status: 'AP' }));
  assert.strictEqual(statusOf(p), STATUS.COLLECTED, 'gecikmiş onay tahsil edilmeli');
  assert.strictEqual(r2.collected, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM account_movements WHERE firm_id=?').get(f).n, 1, 'tek cari hareket (idempotent)');
  // 3) tekrar çalıştırılırsa çift kayıt olmamalı
  const r3 = await withQuery(() => reconcile({ log: () => {} }), async () => ({ ok: true, ref: 'LATE1', status: 'AP' }));
  assert.strictEqual(r3.collected, 0, 'ikinci kez tahsil edilmemeli');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM account_movements WHERE firm_id=?').get(f).n, 1, 'çift cari hareket oluşmamalı');
});

test('mutabakat: izleme penceresinden eski iptal kayıtlar sorgulanmaz', async () => {
  reset();
  const f = firm();
  const old = addPayment(f, 'R-OLD-CANCEL', 20);
  db.prepare("UPDATE payments SET status=? WHERE id=?").run(STATUS.CANCELLED, old);
  const r = await withQuery(() => reconcile({ log: () => {} }), async () => {
    throw new Error('sorgulanmamalı');
  });
  assert.strictEqual(statusOf(old), STATUS.CANCELLED, 'durum değişmemeli');
  assert.strictEqual(r.collected, 0);
});

test('cari: iptal edilen ödeme bakiyeyi etkilemez', () => {
  reset();
  const f = firm();
  db.prepare(
    `INSERT INTO payments(firm_id,kind,amount,currency,amount_tl,status,provider,provider_order,source,created_at)
     VALUES(?,'odeme',50000,'TL',50000,?,'paratika','R-BAL','bayi',datetime('now','-10 minutes'))`
  ).run(f, STATUS.CANCELLED);
  assert.strictEqual(accountSummary(f, 'ana').balance, 0, 'iptal edilen ödeme bakiyeyi değiştirmemeli');
});
