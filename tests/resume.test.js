'use strict';
// REGRESYON TESTİ: Ödeme sonrası oturum kaybı.
//
// Sorun: Paratika dönüşü tarayıcıya ÇAPRAZ-SİTE POST olarak gelir; `SameSite=Lax` çerezi
// bu istekte GÖNDERİLMEZ. Bu yüzden ödeme tamamlandıktan sonra panel oturumu "kaybolur" ve
// kullanıcı hesap hareketleri yerine giriş ekranına düşerdi.
//
// Çözüm: ödeme başlatılırken dönüş adresine tek kullanımlık oturum anahtarı (`s`) eklenir;
// dönüşte bu anahtarla, YALNIZCA ödemenin sahibi kullanıcı için oturum geri yüklenir.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bionic-resume-'));
process.env.DATA_DIR = TMP;
process.env.UPLOAD_DIR = path.join(TMP, 'uploads');
process.env.ADMIN_PASSWORD = 'TestAdmin1234!xy';
process.env.SEED_DEMO = '1';
process.env.PARATIKA_SIMULATE = '1';
process.env.NODE_ENV = 'test';

const app = require('../server');
const { db } = require('../db');

let server, base;
test.before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => server && server.close());

const sidOf = res => {
  const m = (res.headers.get('set-cookie') || '').match(/sid=([^;]+)/);
  return m ? 'sid=' + m[1] : '';
};
const csrfOf = html => {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : '';
};
async function get(url, cookie) {
  const r = await fetch(base + url, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  return { res: r, html: r.status === 200 ? await r.text() : '', cookie: sidOf(r) || cookie };
}
async function postForm(url, fields, cookie) {
  return fetch(base + url, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields)
  });
}
async function loginBayi() {
  const g = await get('/bayi/giris');
  const res = await postForm('/bayi/giris', { code: '25895', password: 'demo1234Ab!', _csrf: csrfOf(g.html) }, g.cookie);
  return sidOf(res);
}
async function loginServis() {
  const firmId = db.prepare('SELECT id FROM firms LIMIT 1').get().id;
  db.prepare("DELETE FROM dealer_users WHERE code='90001'").run();
  const uid = Number(
    db
      .prepare("INSERT INTO dealer_users(code,email,name,password_hash,role) VALUES('90001','s@test.local','T SERVIS',?,'servis')")
      .run(bcrypt.hashSync('ServisPass123!x', 12)).lastInsertRowid
  );
  db.prepare('INSERT INTO user_firms(user_id,firm_id) VALUES(?,?)').run(uid, firmId);
  const g = await get('/servis/giris');
  const res = await postForm('/servis/giris', { code: '90001', password: 'ServisPass123!x', _csrf: csrfOf(g.html) }, g.cookie);
  return sidOf(res);
}
// Bayi panelinden kart ödemesi başlatır; dönüş adresini (o + s) döndürür.
async function startBayiPayment(cookie) {
  const page = await get('/bayi/odeme', cookie);
  const res = await postForm(
    '/bayi/odeme/ode',
    { method: 'kart', amount: '1,00', description: 'oturum testi', _csrf: csrfOf(page.html) },
    cookie
  );
  assert.strictEqual(res.status, 302, 'Paratika yönlendirmesi bekleniyor');
  return res.headers.get('location');
}

test('ödeme dönüşünde oturum geri yüklenir (çerez gönderilmese bile)', async () => {
  const cookie = await loginBayi();
  const loc = await startBayiPayment(cookie);
  assert.match(loc, /[?&]s=/, 'dönüş adresinde oturum anahtarı olmalı');

  // Bankadan dönen tarayıcı gibi: ÇEREZSİZ istek (çapraz-site POST)
  const cb = await fetch(base + loc, { redirect: 'manual' });
  assert.strictEqual(cb.status, 302);
  assert.strictEqual(cb.headers.get('location'), '/bayi/hesap-ozeti', 'hesap hareketlerine yönlenmeli');

  const newCookie = sidOf(cb);
  assert.ok(newCookie, 'geri yüklenen oturum için yeni çerez verilmeli');
  assert.notStrictEqual(newCookie, cookie, 'oturum kimliği yenilenmeli (anahtar tek kullanımlık)');

  const acc = await get('/bayi/hesap-ozeti', newCookie);
  assert.strictEqual(acc.res.status, 200, 'hesap hareketleri açılmalı (giriş ekranına düşmemeli)');
  assert.ok(/Hesap Özeti|Hesap Hareketleri/.test(acc.html), 'sayfa içeriği hesap özeti olmalı');
});

test('ödeme dönüşünde anahtar YOKSA oturum açılmaz', async () => {
  const cookie = await loginBayi();
  const loc = await startBayiPayment(cookie);
  const locNoKey = loc.replace(/&s=[^&]*/, '');
  const cb = await fetch(base + locNoKey, { redirect: 'manual' });
  assert.strictEqual(cb.status, 302);
  assert.strictEqual(cb.headers.get('location'), '/bayi/hesap-ozeti');
  const acc = await get('/bayi/hesap-ozeti', sidOf(cb));
  assert.strictEqual(acc.res.status, 302, 'çerez olmadığı için giriş ekranına yönlenmeli');
});

test('başka kullanıcının anahtarıyla oturum açılmaz', async () => {
  const bayi = await loginBayi();
  const servis = await loginServis(); // farklı kullanıcı
  const loc = await startBayiPayment(bayi);
  const foreign = loc.replace(/&s=[^&]*/, '&s=' + encodeURIComponent(servis.split('=')[1]));
  const cb = await fetch(base + foreign, { redirect: 'manual' });
  assert.strictEqual(cb.status, 302);
  assert.strictEqual(cb.headers.get('location'), '/bayi/hesap-ozeti');
  // Yabancı anahtar kabul edilmemeli → oturum açılmamış olmalı (giriş ekranına düşer)
  const acc = await get('/bayi/hesap-ozeti', sidOf(cb));
  assert.strictEqual(acc.res.status, 302, 'başka kullanıcının anahtarı kabul edilmemeli');
  // Diğer kullanıcının kendi oturumu da etkilenmemeli
  const own = await get('/servis', servis);
  assert.strictEqual(own.res.status, 200, 'diğer kullanıcının oturumu etkilenmemeli');
});

test('rastgele anahtarla oturum açılmaz', async () => {
  const bayi = await loginBayi();
  const loc = await startBayiPayment(bayi);
  const bogus = loc.replace(/&s=[^&]*/, '&s=' + 'a'.repeat(64));
  const cb = await fetch(base + bogus, { redirect: 'manual' });
  assert.strictEqual(cb.status, 302);
  const acc = await get('/bayi/hesap-ozeti', sidOf(cb));
  assert.strictEqual(acc.res.status, 302, 'geçersiz anahtar kabul edilmemeli');
});
