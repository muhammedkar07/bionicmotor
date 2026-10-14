'use strict';
// Giriş / yetki testleri. Harici bağımlılık yok: Node yerleşik test runner + fetch.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bionic-auth-'));
process.env.DATA_DIR = TMP;
process.env.UPLOAD_DIR = path.join(TMP, 'uploads');
process.env.ADMIN_PASSWORD = 'TestAdmin1234!xy';
process.env.NODE_ENV = 'test';

const app = require('../server');
let server, base;

test.before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => { server && server.close(); });

const sidOf = res => { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/sid=([^;]+)/); return m ? 'sid=' + m[1] : ''; };
const csrfOf = html => { const m = html.match(/name="_csrf" value="([^"]+)"/); return m ? m[1] : ''; };

async function getPage(url, cookie) {
  const res = await fetch(base + url, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  const html = res.status === 200 ? await res.text() : '';
  return { res, html, cookie: sidOf(res) };
}

test('yetkisiz /admin erişimi giriş sayfasına yönlenir', async () => {
  const res = await fetch(base + '/admin', { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  assert.match(res.headers.get('location') || '', /\/admin\/giris/);
});

test('yanlış parola ile giriş reddedilir', async () => {
  const g = await getPage('/admin/giris');
  assert.strictEqual(g.res.status, 200);
  const body = new URLSearchParams({ username: 'admin', password: 'yanlis-parola', _csrf: csrfOf(g.html) });
  const res = await fetch(base + '/admin/giris', { method: 'POST', redirect: 'manual', headers: { cookie: g.cookie, 'content-type': 'application/x-www-form-urlencoded' }, body });
  assert.strictEqual(res.status, 302);
  assert.match(res.headers.get('location') || '', /\/admin\/giris/);
});

test('CSRF token olmadan giriş reddedilir', async () => {
  const g = await getPage('/admin/giris');
  const body = new URLSearchParams({ username: 'admin', password: 'TestAdmin1234!xy' });
  const res = await fetch(base + '/admin/giris', { method: 'POST', redirect: 'manual', headers: { cookie: g.cookie, 'content-type': 'application/x-www-form-urlencoded' }, body });
  assert.strictEqual(res.status, 403);
});

test('doğru parola ile giriş yapılır ve panele erişilir', async () => {
  const g = await getPage('/admin/giris');
  const body = new URLSearchParams({ username: 'admin', password: 'TestAdmin1234!xy', _csrf: csrfOf(g.html) });
  const res = await fetch(base + '/admin/giris', { method: 'POST', redirect: 'manual', headers: { cookie: g.cookie, 'content-type': 'application/x-www-form-urlencoded' }, body });
  assert.strictEqual(res.status, 302);
  const newCookie = sidOf(res);
  assert.ok(newCookie, 'giriş sonrası yeni oturum çerezi beklenir');
  const panel = await fetch(base + '/admin', { redirect: 'manual', headers: { cookie: newCookie } });
  assert.strictEqual(panel.status, 200);
});
