'use strict';
// E-POSTA TESLİM (SPAM) KONTROLÜ
// SPF / DKIM / DMARC kayıtlarını ve SMTP yapılandırmasını denetler.
//
// Kullanım:
//   node scripts/mail-check.js
//   node scripts/mail-check.js --dkim=oci-abc123     → DKIM selector'ünü de kontrol eder
//   node scripts/mail-check.js --domain=bionicmotorsiklet.com
const dns = require('dns').promises;

// Önbelleksiz ve tutarlı sonuç için genel çözücüler kullanılır.
try {
  require('dns').setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  /* yok say */
}

const args = process.argv.slice(2);
const argOf = name => {
  const hit = args.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.split('=').slice(1).join('=') : null;
};
const DOMAIN = argOf('domain') || String(process.env.MAIL_CHECK_DOMAIN || 'bionicmotorsiklet.com');

let pass = 0;
const fails = [];
let warns = 0;
const ok = (cond, label, detail) => {
  if (cond) {
    pass++;
    console.log('  ✅ ' + label + (detail ? ' — ' + detail : ''));
  } else {
    fails.push(label);
    console.log('  ❌ ' + label + (detail ? ' — ' + detail : ''));
  }
};
const warn = (cond, label, detail) => {
  if (cond) {
    pass++;
    console.log('  ✅ ' + label + (detail ? ' — ' + detail : ''));
  } else {
    warns++;
    console.log('  ⚠️  ' + label + (detail ? ' — ' + detail : ''));
  }
};

const txt = async name => {
  try {
    const r = await dns.resolveTxt(name);
    return r.map(parts => parts.join(''));
  } catch {
    return [];
  }
};

(async () => {
  console.log('E-POSTA TESLİM KONTROLÜ → ' + DOMAIN + '\n');

  // ---- SPF ----
  console.log('SPF (gönderen sunucu yetkisi)');
  const spfAll = (await txt(DOMAIN)).filter(t => /^v=spf1/i.test(t));
  ok(spfAll.length === 1, 'Tek SPF kaydı var', spfAll.length === 1 ? '' : spfAll.length + ' kayıt bulundu (birden fazla SPF hata verir!)');
  const spf = spfAll[0] || '';
  // Sağlayıcıya göre beklenen SPF include'u
  const mailCfg = require('../lib/mail').cfg();
  const PROVIDERS = [
    { re: /oci\.oraclecloud\.com$/i, inc: 'oracleemaildelivery', label: 'Oracle Email Delivery' },
    { re: /brevo\.com$/i, inc: 'spf.brevo.com', label: 'Brevo' },
    { re: /veridyen\.com$/i, inc: '_spf.protection.veridyen.com', label: 'Veridyen' }
  ];
  const provider = PROVIDERS.find(p => p.re.test(mailCfg.host || ''));
  if (spf) {
    ok(spf.includes('include:'), 'SPF include içeriyor');
    if (provider) ok(spf.includes('include:' + provider.inc), provider.label + ' yetkili (include:' + provider.inc + ')');
    console.log('     kayıt: ' + spf);
    const lookups = (spf.match(/include:/g) || []).length + (spf.match(/a[: ]/g) || []).length + (spf.match(/mx/g) || []).length;
    warn(lookups <= 8, 'SPF DNS sorgu sayısı sınırda değil', lookups + ' include/mx');
  }

  // ---- DMARC ----
  console.log('\nDMARC (politika)');
  const dmarc = (await txt('_dmarc.' + DOMAIN))[0] || '';
  ok(!!dmarc, 'DMARC kaydı var', dmarc);
  if (dmarc) warn(/rua=/i.test(dmarc), 'Rapor adresi tanımlı (rua=)', /rua=/i.test(dmarc) ? '' : 'rapor almak için önerilir');

  // ---- DKIM ----
  console.log('\nDKIM (imza)');
  const selectors = [];
  const given = argOf('dkim');
  if (given) selectors.push(given);
  ['default', 'brevo1', 'brevo2', 'mail', 'dkim', 'oci', 'selector1', 'google'].forEach(s => selectors.push(s));
  let dkimFound = null;
  for (const s of [...new Set(selectors)]) {
    const v = (await txt(s + '._domainkey.' + DOMAIN))[0];
    // DKIM TXT'i ya "v=DKIM1;..." ya da doğrudan "k=rsa;p=..." biçiminde olabilir (CNAME zinciri).
    if (v && (/v=DKIM1/i.test(v) || /(^|;)\s*k=rsa/i.test(v))) {
      console.log('  ✅ ' + s + '._domainkey yayında');
      if (!dkimFound) dkimFound = s;
    }
  }
  if (given) {
    ok(!!(await txt(given + '._domainkey.' + DOMAIN))[0], 'Belirtilen DKIM selector yayında', given);
  } else if (!dkimFound) {
    warns++;
    console.log('  ⚠️  Bilinen selector adlarında DKIM bulunamadı (Oracle selector adı farklı olabilir: --dkim=<selector> ile kontrol edin)');
  }

  // ---- MX ----
  console.log('\nGelen posta (MX)');
  const mx = await dns.resolveMx(DOMAIN).catch(() => []);
  ok(mx.length > 0, 'MX kaydı var', mx.map(m => m.exchange).join(', '));

  // ---- SMTP (uygulama ayarı) ----
  console.log('\nSMTP (uygulama)');
  const mail = require('../lib/mail');
  const c = mail.cfg();
  ok(mail.configured(), 'SMTP yapılandırıldı', mail.configured() ? c.host + ':' + c.port : 'eksik');
  warn(/bionicmotorsiklet\.com$/i.test(c.from || ''), 'Gönderen adresi kendi alan adımızda', c.from);

  // ---- Özet ----
  console.log('\n' + '='.repeat(58));
  console.log('SONUÇ: ' + pass + ' geçti · ' + fails.length + ' hata · ' + warns + ' uyarı');
  if (fails.length) {
    console.log('\nEksikler:');
    fails.forEach(f => console.log('  - ' + f));
    process.exitCode = 1;
  } else if (!warns) {
    console.log('Tebliğ altyapısı tamam ✅ (mailler gelen kutusuna düşmeli)');
  }
  console.log('='.repeat(58));
})();
