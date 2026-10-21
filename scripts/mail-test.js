'use strict';
// SMTP AYAR / TEST ARACI
//
// Kullanım (sunucuda, uygulama klasöründe):
//   node --env-file=.env scripts/mail-test.js                 → ayarları ve bağlantıyı kontrol eder
//   node --env-file=.env scripts/mail-test.js kime@firma.com   → test e-postası gönderir
//
// .env'de tanımlanması gerekenler:
//   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_FROM_NAME
const mail = require('../lib/mail');

(async () => {
  const c = mail.cfg();
  console.log('--- SMTP ayarları ---');
  console.log('  sunucu   :', c.host || '(tanımsız)');
  console.log('  port     :', c.port, c.secure ? '(SSL)' : '(STARTTLS)');
  console.log('  kullanıcı:', c.user || '(tanımsız)');
  console.log('  parola   :', c.pass ? 'tanımlı (' + c.pass.length + ' karakter)' : '(tanımsız)');
  console.log('  gönderen :', c.from ? '"' + c.fromName + '" <' + c.from + '>' : '(tanımsız)');
  console.log('  durum    :', mail.configured() ? 'HAZIR ✅' : 'EKSİK ❌');

  if (!mail.configured()) {
    console.log('\nEksik ayarlar için .env dosyasına şunları ekleyin:');
    console.log('  SMTP_HOST=mail.veridyen.com');
    console.log('  SMTP_PORT=465');
    console.log('  SMTP_SECURE=1');
    console.log('  SMTP_USER=info@bionicmotorsiklet.com');
    console.log('  SMTP_PASS=********');
    console.log('  SMTP_FROM=info@bionicmotorsiklet.com');
    console.log('  SMTP_FROM_NAME=Bionic Motor');
    process.exit(1);
  }

  const to = process.argv[2];
  if (!to) {
    console.log('\nBağlantı deneniyor...');
    const t = require('nodemailer').createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      auth: c.user ? { user: c.user, pass: c.pass } : undefined,
      requireTLS: !c.secure,
      tls: { minVersion: 'TLSv1.2' },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000
    });
    try {
      await t.verify();
      console.log('bağlantı : BAŞARILI ✅  (test e-postası için: node --env-file=.env scripts/mail-test.js kime@firma.com)');
    } catch (e) {
      console.log('bağlantı : HATA ❌  ' + (e && e.message ? e.message : e));
      process.exit(1);
    }
    return;
  }

  console.log('\nTest e-postası gönderiliyor →', to);
  const r = await mail.send({
    to,
    subject: 'Bionic Motor · SMTP test',
    text: 'Bu bir test e-postasıdır. SMTP ayarları doğru çalışıyor.',
    html: '<p>Bu bir <b>test</b> e-postasıdır. SMTP ayarları doğru çalışıyor. ✅</p>'
  });
  console.log(r.ok ? 'gönderim : BAŞARILI ✅' : 'gönderim : HATA ❌  ' + r.error);
  process.exit(r.ok ? 0 : 1);
})();
