'use strict';
// Paratika QUERYTRANSACTION yanıtının çözümlenmesi. Ağ isteği YOK: global fetch taklit edilir.
// Canlı yanıtta doğrulanan alan: installmentCount (1 = tek çekim, 6 = 6 taksit).
const test = require('node:test');
const assert = require('node:assert');

process.env.PARATIKA_SIMULATE = '0';
process.env.PARATIKA_ENV = 'test';
process.env.PARATIKA_MERCHANT = '10000000';
process.env.PARATIKA_MERCHANT_USER = 'test@example.com';
process.env.PARATIKA_MERCHANT_PASSWORD = 'x';

const paratika = require('../lib/paratika');

const realFetch = global.fetch;
test.after(() => {
  global.fetch = realFetch;
});

const mockJson = json => {
  global.fetch = async () => ({ text: async () => JSON.stringify(json) });
};

test('onaylı satıştan taksit sayısı ve komisyon oranı okunur', async () => {
  mockJson({
    responseCode: '00',
    responseMsg: 'Approved',
    transactionList: [
      // Önce başarısız deneme (tek çekim), sonra onaylı 6 taksit satışı.
      { transactionType: 'SALE', transactionStatus: 'FA', installmentCount: 1 },
      {
        transactionType: 'SALE',
        transactionStatus: 'AP',
        pgTranId: 'PG-1',
        pgTranReturnCode: '00',
        amount: 67000,
        currency: 'TRY',
        installmentCount: 6,
        merchantCommissionRate: 13.5
      },
      { transactionType: 'QUERYCAMPAIGNONLINE', transactionStatus: 'FA', installmentCount: 6, merchantCommissionRate: 0 }
    ]
  });
  const v = await paratika.query({ orderId: 'BN1' });
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.ref, 'PG-1');
  assert.strictEqual(v.installment, 6);
  assert.strictEqual(v.commissionRate, 13.5);
  assert.strictEqual(v.raw.installmentCount, 6);
});

test('tek çekim onaylı satışta taksit 1 döner', async () => {
  mockJson({
    responseCode: '00',
    transactionList: [{ transactionType: 'SALE', transactionStatus: 'AP', pgTranId: 'PG-2', installmentCount: 1 }]
  });
  const v = await paratika.query({ orderId: 'BN2' });
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.installment, 1);
});

test('taksit alanı yoksa null döner (kayıt bozulmaz)', async () => {
  mockJson({
    responseCode: '00',
    transactionList: [{ transactionType: 'SALE', transactionStatus: 'AP', pgTranId: 'PG-3' }]
  });
  const v = await paratika.query({ orderId: 'BN3' });
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.installment, null);
  assert.strictEqual(v.commissionRate, null);
});

test('taksit sayısı metin olarak gelse de okunur', async () => {
  mockJson({
    responseCode: '00',
    transactionList: [{ transactionType: 'SALE', transactionStatus: 'AP', pgTranId: 'PG-4', installmentCount: '9' }]
  });
  const v = await paratika.query({ orderId: 'BN4' });
  assert.strictEqual(v.installment, 9);
});
