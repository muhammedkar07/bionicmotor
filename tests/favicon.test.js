'use strict';
// Favicon testleri: tarayıcıların istediği /favicon.ico ve ikon dosyaları 404 değil 200 dönmeli.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bionic-favicon-'));
process.env.DATA_DIR = TMP;
process.env.UPLOAD_DIR = path.join(TMP, 'uploads');
process.env.ADMIN_PASSWORD = 'TestAdmin1234!xy';
process.env.SEED_DEMO = '0';
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

test('favicon istekleri 200 doner (404 yok)', async () => {
  for (const u of ['/favicon.ico', '/static/img/favicon-32.png', '/static/img/favicon-16.png', '/static/img/apple-touch-icon.png']) {
    const r = await fetch(base + u, { redirect: 'manual' });
    assert.strictEqual(r.status, 200, u);
    assert.match(r.headers.get('content-type') || '', /image\/png/, u);
  }
});

test('ana sayfa ikon baglantilarini yayinlar', async () => {
  const r = await fetch(base + '/', { redirect: 'manual' });
  const html = await r.text();
  assert.match(html, /rel="icon"[^>]*favicon-32\.png/);
  assert.match(html, /rel="apple-touch-icon"/);
});
