'use strict';
// Paratika (Web POS) akış testleri. Ağ isteği yok: PARATIKA_SIMULATE=1 ile başarılı ödeme
// simüle edilir; böylece ödeme -> callback -> cari hareketi zinciri baştan sona test edilir.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bionic-pay-'));
process.env.DATA_DIR = TMP;
process.env.UPLOAD_DIR = path.join(TMP, 'uploads');
process.env.ADMIN_PASSWORD = 'TestAdmin1234!xy';
process.env.SEED_DEMO = '1';
process.env.PARATIKA_SIMULATE = '1';
process.env.NODE_ENV = 'test';

const app = require('../server');
const { db, STATUS } = require('../db');
const { accountSummary } = require('../lib/account');

let server, base;
test.before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => {
  server && server.close();
});

const sidOf = res => {
  const m = (res.headers.get('set-cookie') || '').match(/sid=([^;]+)/);
  return m ? 'sid=' + m[1] : '';
};
const csrfOf = html => {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : '';
};

async function get(url, cookie) {
  const res = await fetch(base + url, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  const html = res.status === 200 ? await res.text() : '';
  return { res, html, cookie: sidOf(res) || cookie };
}
async function postForm(url, fields, cookie) {
  const body = new URLSearchParams(fields);
  const res = await fetch(base + url, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  return res;
}
async function loginBayi() {
  const g = await get('/bayi/giris');
  const res = await postForm('/bayi/giris', { code: '25895', password: 'demo1234Ab!', _csrf: csrfOf(g.html) }, g.cookie);
  return sidOf(res);
}
async function loginServis() {
  const p = db.prepare('SELECT id FROM firms LIMIT 1').get().id;
  db.prepare('INSERT INTO dealer_users(code,email,name,password_hash,role) VALUES(?,?,?,?,?)').run(
    '90001',
    'servis@test.local',
    'TEST SERVIS',
    bcrypt.hashSync('ServisPass123!x', 12),
    'servis'
  );
  const uid = db.prepare('SELECT id FROM dealer_users WHERE code=?').get('90001').id;
  db.prepare('INSERT INTO user_firms(user_id,firm_id) VALUES(?,?)').run(uid, p);
  const g = await get('/servis/giris');
  const res = await postForm('/servis/giris', { code: '90001', password: 'ServisPass123!x', _csrf: csrfOf(g.html) }, g.cookie);
  return sidOf(res);
}

const balance = firmId => accountSummary(firmId, 'ana').balance;
const lastPayment = () => db.prepare('SELECT * FROM payments ORDER BY id DESC LIMIT 1').get();

// Kart ödemesi başlatır ve simüle callback'i takip eder. Sonuç: finalize edilmiş ödeme.
async function payByCard(cookie, panel, amount, { currency = 'TL', installment_id = 1 } = {}) {
  const page = await get(panel + '/odeme', cookie);
  const res = await postForm(
    panel + '/odeme/ode',
    {
      method: 'kart',
      amount,
      currency,
      description: 'test',
      installment_id,
      _csrf: csrfOf(page.html)
    },
    cookie
  );
  assert.strictEqual(res.status, 302, 'Paratika yönlendirmesi bekleniyor');
  const loc = res.headers.get('location');
  assert.ok(loc && loc.startsWith('/odeme/paratika/sonuc'), 'callback adresine yönlenmeli: ' + loc);
  const cb = await fetch(base + loc, { redirect: 'manual', headers: { cookie } });
  return { loc, cb };
}

test('bayi kart ödemesi tahsil edilir ve aktif firmanın carisine alacak işlenir', async () => {
  const cookie = await loginBayi();
  const firmId = db.prepare('SELECT id FROM firms LIMIT 1').get().id;
  const before = balance(firmId);

  const { cb } = await payByCard(cookie, '/bayi', '1000.00');
  assert.strictEqual(cb.status, 302);

  const p = lastPayment();
  assert.strictEqual(p.status, STATUS.COLLECTED);
  assert.strictEqual(p.firm_id, firmId);
  assert.strictEqual(p.source, 'bayi');
  assert.strictEqual(p.provider, 'paratika');
  assert.ok(p.provider_order, 'provider_order kaydedilmeli');
  assert.ok(p.movement_id, 'cari hareketi bağlanmalı');

  assert.strictEqual(balance(firmId), before - 100000, 'cari 100000 kuruş (1000 TL) azalmalı');
  const mv = db.prepare('SELECT * FROM account_movements WHERE doc_no=? AND deleted_at IS NULL').get('POS-' + p.id);
  assert.ok(mv, 'POS cari hareketi oluşmalı');
  assert.strictEqual(mv.kind, 'alacak');
  assert.strictEqual(mv.amount, 100000);
  assert.ok(
    db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='payment_collected'").get().n > 0,
    'audit_log payment_collected kaydı olmalı'
  );
});

test('komisyon cariye yazılmaz (alacak = amount, total değil)', async () => {
  const cookie = await loginBayi();
  const firmId = db.prepare('SELECT id FROM firms LIMIT 1').get().id;
  const before = balance(firmId);
  // 3 Taksit komisyonu %3.5 -> total 1035; cari yalnızca 1000 azalmalı.
  const { cb } = await payByCard(cookie, '/bayi', '1000.00', { installment_id: 3 });
  assert.strictEqual(cb.status, 302);
  const p = lastPayment();
  assert.strictEqual(p.amount, 100000);
  assert.strictEqual(p.total, 103500);
  assert.strictEqual(balance(firmId), before - 100000, 'cari yalnızca ödenen borç kadar azalmalı');
});

test('döviz ödemesi kurdan TL’ye çevrilerek işlenir', async () => {
  const cookie = await loginBayi();
  const firmId = db.prepare('SELECT id FROM firms LIMIT 1').get().id;
  const rate = parseFloat(db.prepare("SELECT value FROM settings WHERE key='usd_rate'").get().value);
  const before = balance(firmId);
  const { cb } = await payByCard(cookie, '/bayi', '100.00', { currency: 'USD' });
  assert.strictEqual(cb.status, 302);
  const p = lastPayment();
  assert.strictEqual(p.currency, 'USD');
  const expected = Math.round(10000 * rate);
  assert.strictEqual(balance(firmId), before - expected, 'cari ' + expected + ' kuruş azalmalı');
});

test('aynı callback iki kez gelirse çift kayıt olmaz (idempotent)', async () => {
  const cookie = await loginBayi();
  const firmId = db.prepare('SELECT id FROM firms LIMIT 1').get().id;
  const { loc } = await payByCard(cookie, '/bayi', '500.00');
  const afterFirst = balance(firmId);
  const p = lastPayment();
  const cnt1 = db.prepare('SELECT COUNT(c) c FROM (SELECT 1 c FROM account_movements WHERE doc_no=?)').get('POS-' + p.id).c;
  await fetch(base + loc, { redirect: 'manual', headers: { cookie } });
  assert.strictEqual(balance(firmId), afterFirst, 'ikinci callback bakiyeyi değiştirmemeli');
  const cnt2 = db.prepare('SELECT COUNT(c) c FROM (SELECT 1 c FROM account_movements WHERE doc_no=?)').get('POS-' + p.id).c;
  assert.strictEqual(cnt2, cnt1, 'ek cari hareketi oluşmamalı');
});

test('servis panelinden ödeme servis firmasının carisine işlenir', async () => {
  const cookie = await loginServis();
  const firmId = db.prepare('SELECT id FROM firms LIMIT 1').get().id;
  const before = balance(firmId);
  const { cb } = await payByCard(cookie, '/servis', '250.00');
  assert.strictEqual(cb.status, 302);
  const p = lastPayment();
  assert.strictEqual(p.source, 'servis');
  assert.strictEqual(p.firm_id, firmId);
  assert.strictEqual(balance(firmId), before - 25000);
});

test('Paratika POST callback (CSRF/çerez olmadan) işlenir', async () => {
  const cookie = await loginBayi();
  const firmId = db.prepare('SELECT id FROM firms LIMIT 1').get().id;
  const before = balance(firmId);
  const page = await get('/bayi/odeme', cookie);
  const res = await postForm(
    '/bayi/odeme/ode',
    {
      method: 'kart',
      amount: '150.00',
      currency: 'TL',
      description: 't',
      installment_id: 1,
      _csrf: csrfOf(page.html)
    },
    cookie
  );
  const orderId = new URL(base + res.headers.get('location')).searchParams.get('o');
  // Paratika'nın sunucudan yaptığı POST benzeri: CSRF token ve çerez yok.
  const cb = await fetch(base + '/odeme/paratika/sonuc', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ o: orderId, ORDER_ID: orderId })
  });
  assert.strictEqual(cb.status, 302, 'CSRF nedeniyle 403 olmamalı');
  assert.strictEqual(lastPayment().status, STATUS.COLLECTED);
  assert.strictEqual(balance(firmId), before - 15000);
});

test('odeme panelinden (e-posta girişi) ödeme aktif firmanın carisine işlenir', async () => {
  const g = await get('/odeme');
  const res = await postForm('/odeme/giris', { email: 'demo@bayi.local', password: 'demo1234Ab!', _csrf: csrfOf(g.html) }, g.cookie);
  const cookie = sidOf(res);
  assert.ok(cookie, 'ödeme girişi başarılı olmalı');
  const firmId = db.prepare('SELECT id FROM firms LIMIT 1').get().id;
  const before = balance(firmId);
  const { cb } = await payByCard(cookie, '', '300.00');
  assert.strictEqual(cb.status, 302);
  const p = lastPayment();
  assert.strictEqual(p.source, 'odeme');
  assert.strictEqual(balance(firmId), before - 30000);
});

test('kartla yedek parça siparişi: ödeme sonrası sipariş dönüşür, cari borç+alacak işlenir', async () => {
  const cookie = await loginBayi();
  const firmId = db.prepare('SELECT id FROM firms LIMIT 1').get().id;
  const part = db.prepare("SELECT id, price FROM products WHERE kind='parca' AND active=1 ORDER BY id LIMIT 1").get();
  const before = accountSummary(firmId, 'parca').balance;

  const page = await get('/bayi/yedek-parca/yeni', cookie);
  const res = await postForm(
    '/bayi/yedek-parca/yeni',
    {
      _csrf: csrfOf(page.html),
      part_id: String(part.id),
      qty: '2',
      pay_method: 'kart',
      installment_id: '1',
      note: 'test'
    },
    cookie
  );
  assert.strictEqual(res.status, 302, 'Paratika yönlendirmesi bekleniyor');
  const loc = res.headers.get('location');
  assert.ok(loc.startsWith('/odeme/paratika/sonuc'), 'callback adresine yönlenmeli: ' + loc);

  const cb = await fetch(base + loc, { redirect: 'manual', headers: { cookie } });
  assert.strictEqual(cb.status, 302);

  const order = db.prepare('SELECT * FROM spare_orders ORDER BY id DESC LIMIT 1').get();
  assert.strictEqual(order.status, STATUS.CONVERTED, 'ödeme sonrası siparişe dönüşmeli');
  const pay = db.prepare('SELECT * FROM payments WHERE id=?').get(order.payment_id);
  assert.strictEqual(pay.status, STATUS.COLLECTED);
  assert.strictEqual(pay.source, 'bayi');
  // Borç (sipariş) ve alacak (ödeme) birlikte işlendiği için net bakiye değişmemeli.
  assert.strictEqual(accountSummary(firmId, 'parca').balance, before, 'net bakiye değişmemeli');
  const borc = db
    .prepare(
      "SELECT COALESCE(SUM(amount),0) s FROM account_movements WHERE ledger='parca' AND firm_id=? AND kind='borc' AND deleted_at IS NULL"
    )
    .get(firmId).s;
  assert.ok(borc > 0, 'sipariş borcu işlenmeli');
});
