'use strict';
// GÖNDERİM KİMLİK DOĞRULAMA TESTİ (SPF / DKIM / DMARC)
//
// Şifre sıfırlama e-postasının aynısını geçici bir kutuya (mail.tm) gönderir ve
// gelen mailin ham başlıklarını okuyarak DKIM imzasının hangi alan adına ait
// olduğunu (d=...), DMARC uyumunu ve spam riskini raporlar.
//
// Kullanım: node --env-file=.env scripts/mail-auth-test.js
// Not: Dış servis (api.mail.tm) kullanır; internet erişimi gerekir.

const mail = require('../lib/mail');

const API = 'https://api.mail.tm';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (!mail.configured()) {
    console.log('SMTP yapılandırılmamış (SMTP_HOST/SMTP_USER/SMTP_PASS eksik).');
    process.exit(1);
  }

  // 1) Geçici kutu
  const dom = await (await fetch(API + '/domains')).json();
  const domain = dom['hydra:member'][0].domain;
  const address = 'bionic' + Date.now().toString(36) + '@' + domain;
  const password = 'Test!' + Math.random().toString(36).slice(2) + '9x';
  const created = await fetch(API + '/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, password })
  });
  if (created.status >= 400) {
    console.log('Geçici kutu açılamadı:', created.status, await created.text());
    process.exit(2);
  }
  const tok = await (
    await fetch(API + '/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address, password })
    })
  ).json();
  const auth = { authorization: 'Bearer ' + tok.token };
  console.log('alıcı (geçici kutu):', address);

  // 2) Şifre sıfırlama mailinin aynısı
  const content = mail.resetMail({
    name: 'Yetkili Test',
    link: 'https://bionicmotorsiklet.com/sifre/sifirla/' + 'a'.repeat(64) + '?p=bayi',
    minutes: 60,
    panel: 'Bayi Paneli'
  });
  const sent = await mail.send({ to: address, replyTo: 'info@bionicmotorsiklet.com', ...content });
  console.log('gönderim          :', sent.ok ? 'BAŞARILI ✅' : 'HATA ❌ ' + sent.error);
  if (!sent.ok) process.exit(3);

  // 3) Maili bekle
  let msg = null;
  for (let i = 0; i < 12 && !msg; i++) {
    await sleep(5000);
    const list = await (await fetch(API + '/messages', { headers: auth })).json();
    const arr = list['hydra:member'] || [];
    if (arr.length) msg = arr[0];
  }
  if (!msg) {
    console.log('Mail 60 sn içinde ulaşmadı (gecikme olabilir).');
    process.exit(4);
  }

  // 4) Ham başlıklar
  const dl = await fetch(API + '/messages/' + msg.id + '/download', { headers: auth });
  const raw = dl.ok ? await dl.text() : '';
  if (!raw) {
    console.log('Ham kaynak alınamadı.');
    process.exit(5);
  }

  const dkim = (raw.match(/^DKIM-Signature:[\s\S]*?(?=\r?\n[A-Za-z-]+:)/m) || [''])[0];
  const d = (dkim.match(/\bd\s*=\s*([^;\s]+)/i) || [])[1] || '';
  const s = (dkim.match(/\bs\s*=\s*([^;\s]+)/i) || [])[1] || '';
  const fromAddr = (raw.match(/^From:\s*.*?<([^>]+)>/im) || [])[1] || '';
  const returnPath = (raw.match(/^Return-Path:\s*<([^>]+)>/im) || [])[1] || '';

  console.log('\n--- başlık özeti ---');
  console.log('  From          :', fromAddr);
  console.log('  Return-Path   :', returnPath);
  console.log('  DKIM imzası   :', dkim ? 'VAR ✅' : 'YOK ❌');
  console.log('  DKIM d=       :', d || '(yok)');
  console.log('  DKIM selector :', s || '(yok)');

  const fromDomain = (fromAddr.split('@')[1] || '').toLowerCase();
  const aligned = d && fromDomain && (d.toLowerCase() === fromDomain || d.toLowerCase().endsWith('.' + fromDomain));
  console.log('\n--- değerlendirme ---');
  console.log('  DKIM hizalaması:', aligned ? 'UYUMLU ✅ (DMARC geçer)' : 'UYUMSUZ ❌ (DMARC başarısız → spam riski)');
  if (!aligned) {
    console.log('\n  Yapılacak: OCI Email Delivery → Email Domains → domain → DKIM → durum "Active" olmalı.');
    console.log('  CNAME kaydı: <selector>._domainkey.<domain> → <selector>.<domain>.dkim.fra1.oracleemaildelivery.com');
    process.exitCode = 6;
  } else {
    console.log('  Sonuç: kimlik doğrulama tamam ✅');
  }
})();
