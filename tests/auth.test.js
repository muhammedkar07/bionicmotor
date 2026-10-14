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
process.env.SEED_DEMO = '1';
process.env.PARATIKA_SIMULATE = '1';
process.env.NODE_ENV = 'test';

const app = require('../server');
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
  const sc = res.headers.get('set-cookie') || '';
  const m = sc.match(/sid=([^;]+)/);
  return m ? 'sid=' + m[1] : '';
};
const csrfOf = html => {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : '';
};

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
  const res = await fetch(base + '/admin/giris', {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: g.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  assert.strictEqual(res.status, 302);
  assert.match(res.headers.get('location') || '', /\/admin\/giris/);
});

test('CSRF token olmadan giriş reddedilir', async () => {
  const g = await getPage('/admin/giris');
  const body = new URLSearchParams({ username: 'admin', password: 'TestAdmin1234!xy' });
  const res = await fetch(base + '/admin/giris', {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: g.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  assert.strictEqual(res.status, 403);
});

test('doğru parola ile giriş yapılır ve panele erişilir', async () => {
  const g = await getPage('/admin/giris');
  const body = new URLSearchParams({ username: 'admin', password: 'TestAdmin1234!xy', _csrf: csrfOf(g.html) });
  const res = await fetch(base + '/admin/giris', {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: g.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  assert.strictEqual(res.status, 302);
  const newCookie = sidOf(res);
  assert.ok(newCookie, 'giriş sonrası yeni oturum çerezi beklenir');
  const panel = await fetch(base + '/admin', { redirect: 'manual', headers: { cookie: newCookie } });
  assert.strictEqual(panel.status, 200);
});

test('menü sırası kaydedilir ve panelde uygulanır', async () => {
  const g = await getPage('/admin/giris');
  const login = await fetch(base + '/admin/giris', {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: g.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'admin', password: 'TestAdmin1234!xy', _csrf: csrfOf(g.html) })
  });
  const cookie = sidOf(login);
  const panel = await getPage('/admin', cookie);
  const iFirms0 = panel.html.indexOf('data-menu-id="r:firms"');
  const iSlides0 = panel.html.indexOf('data-menu-id="r:slides"');
  assert.ok(iFirms0 > -1 && iSlides0 > -1 && iFirms0 < iSlides0, 'başlangıçta r:firms önce gelmeli');

  const order = ['/admin', 'r:slides', 'r:models', 'sys:sifre', 'r:firms', 'r:users'];
  const save = await fetch(base + '/admin/menu-sirala', {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrfOf(panel.html), data: JSON.stringify({ order }) })
  });
  assert.strictEqual(save.status, 200);
  assert.deepStrictEqual(await save.json(), { ok: true });

  const after = await getPage('/admin', cookie);
  const iSlides = after.html.indexOf('data-menu-id="r:slides"');
  const iFirms = after.html.indexOf('data-menu-id="r:firms"');
  assert.ok(iSlides > -1 && iFirms > -1 && iSlides < iFirms, 'kaydedilen sıraya göre r:slides önce gelmeli');
  assert.ok(after.html.indexOf('data-menu-id="/admin"') < iSlides, 'Panel ilk sırada kalmalı');
});

test('sistem testi tüm kontrolleri geçer', async () => {
  const g = await getPage('/admin/giris');
  const login = await fetch(base + '/admin/giris', {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: g.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'admin', password: 'TestAdmin1234!xy', _csrf: csrfOf(g.html) })
  });
  const cookie = sidOf(login);
  const res = await fetch(base + '/admin/test/api', { headers: { cookie } });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  const failed = [];
  for (const grp of data.groups) for (const r of grp.results) if (!r.ok) failed.push(`[${grp.name}] ${r.name} => ${r.detail}`);
  assert.deepStrictEqual(failed, [], 'başarısız testler: ' + failed.join(' | '));
  assert.strictEqual(data.ok, true);
  assert.ok(data.groups.length >= 5, 'birden çok test grubu beklenir');
});
