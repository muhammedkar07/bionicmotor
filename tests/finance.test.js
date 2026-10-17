'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bionic-fin-'));
const { db, syncOrderDebit, syncOrderStock, STATUS } = require('../db');
const { accountSummary } = require('../lib/account');

test('sipariş dönüşünce stok düşer, cariye borç yazılır', () => {
  const name = 'AracA' + Date.now();
  const firm = db.prepare('INSERT INTO firms(code,name) VALUES(?,?)').run('901.01.001', 'F1').lastInsertRowid;
  const pid = db
    .prepare("INSERT INTO products(kind,code,name,category,price,stock) VALUES('arac','C1',?,'K',1000,5)")
    .run(name).lastInsertRowid;
  const oid = db.prepare('INSERT INTO orders(firm_id,request_no,status) VALUES(?,?,?)').run(firm, '1001', STATUS.CONVERTED).lastInsertRowid;
  db.prepare('INSERT INTO order_items(order_id,product_name,qty,unit_price) VALUES(?,?,?,?)').run(oid, name, 2, 100000);

  syncOrderDebit('orders', 'order_items', oid, 'ana');
  syncOrderStock(oid);

  assert.strictEqual(accountSummary(firm, 'ana').balance, 200000, 'cariye 200000 kuruş (2000 TL) borç yazılmalı');
  assert.strictEqual(db.prepare('SELECT stock FROM products WHERE id=?').get(pid).stock, 3, 'stok 5-2=3 olmalı');
  assert.strictEqual(
    db.prepare('SELECT qty FROM firm_stock WHERE firm_id=? AND product_id=?').get(firm, pid).qty,
    2,
    'bayi stoğu 2 olmalı'
  );
});

test('stok yetersizse dönüştürme reddedilir ve stok değişmez', () => {
  const name = 'AracB' + Date.now();
  const firm = db.prepare('INSERT INTO firms(code,name) VALUES(?,?)').run('901.01.002', 'F2').lastInsertRowid;
  const pid = db
    .prepare("INSERT INTO products(kind,code,name,category,price,stock) VALUES('arac','C2',?,'K',1000,1)")
    .run(name).lastInsertRowid;
  const oid = db.prepare('INSERT INTO orders(firm_id,request_no,status) VALUES(?,?,?)').run(firm, '1002', STATUS.CONVERTED).lastInsertRowid;
  db.prepare('INSERT INTO order_items(order_id,product_name,qty,unit_price) VALUES(?,?,?,?)').run(oid, name, 5, 100000);

  assert.throws(() => syncOrderStock(oid), /Stok yetersiz/);
  assert.strictEqual(db.prepare('SELECT stock FROM products WHERE id=?').get(pid).stock, 1, 'red sonrası stok değişmemeli');
});

test('tarih filtresi: seçilen aralıktaki hareketler + dönem başı bakiye', () => {
  const firm = db.prepare('INSERT INTO firms(code,name,devir) VALUES(?,?,?)').run('901.01.004', 'F4', 100000).lastInsertRowid;
  const ins = db.prepare(
    "INSERT INTO account_movements(firm_id,ledger,date,doc_no,doc_type,kind,amount) VALUES(?,'ana',?,?,?,?,?)"
  );
  ins.run(firm, '2025-01-10', 'A', 'Sipariş', 'borc', 50000); // aralık öncesi
  ins.run(firm, '2025-03-05', 'B', 'Sipariş', 'borc', 30000); // aralık içi
  ins.run(firm, '2025-03-20', 'C', 'Kredi Kartı Fişi', 'alacak', 20000); // aralık içi
  ins.run(firm, '2025-04-01', 'D', 'Sipariş', 'borc', 10000); // aralık sonrası

  assert.strictEqual(accountSummary(firm, 'ana').balance, 100000 + 50000 + 30000 - 20000 + 10000, 'filtresiz tüm bakiye');

  const f = accountSummary(firm, 'ana', { from: '2025-03-01', to: '2025-03-31' });
  assert.strictEqual(f.rows.length, 2, 'yalnızca mart hareketleri listelenmeli');
  assert.strictEqual(f.opening, 150000, 'dönem başı = devir + aralık öncesi');
  assert.strictEqual(f.sales, 30000, 'aralık içi satışlar');
  assert.strictEqual(f.card, 20000, 'aralık içi kart ödemeleri');
  assert.strictEqual(f.balance, 150000 + 30000 - 20000, 'aralık sonu bakiye');
});

test('storno: cari hareket fiziksel silinmez, bakiye dışına çıkar', () => {
  const firm = db.prepare('INSERT INTO firms(code,name,devir) VALUES(?,?,?)').run('901.01.003', 'F3', 100000).lastInsertRowid;
  const mid = db
    .prepare(
      "INSERT INTO account_movements(firm_id,ledger,date,doc_no,doc_type,kind,amount) VALUES(?,'ana',date('now'),'X','Sipariş','borc',50000)"
    )
    .run(firm).lastInsertRowid;
  assert.strictEqual(accountSummary(firm, 'ana').balance, 150000);
  db.prepare("UPDATE account_movements SET deleted_at=datetime('now') WHERE id=?").run(mid);
  assert.strictEqual(accountSummary(firm, 'ana').balance, 100000, 'storno edilen hareket bakiyeyi etkilememeli');
  assert.strictEqual(
    db.prepare('SELECT COUNT(c) c FROM (SELECT 1 c FROM account_movements WHERE id=?)').get(mid).c,
    1,
    'kayıt fiziksel olarak durmalı'
  );
});
