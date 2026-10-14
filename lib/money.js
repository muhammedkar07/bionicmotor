// Para birimi yardımcıları. Tutarlar uygulama içinde kuruş (tam sayı) olarak temsil edilir.
// Girişte katı doğrulama yapılır: aynı anda binlik ayracı "." ve ondalık ayracı "," olan
// TR biçimi (1.250,50) ya da düz ondalık "." biçimi (1250.50) kabul edilir; "1,250.50"
// gibi karışık/belirsiz biçimler reddedilir. "12.50" artık 1250 değil, 12,50 olarak okunur.
const MAX_AMOUNT_KURUS = 10000000 * 100;

function decToKurus(dec) {
  return Number(((dec || '') + '00').slice(0, 2));
}

// Geçerli tutarı kuruş (tam sayı) olarak döndürür; geçersizse null.
function parseAmount(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim().replace(/\s/g, '').replace(/₺/g, '').replace(/(?:TL|TRY)/gi, '');
  if (s === '') return null;
  let neg = false;
  if (s[0] === '-') { neg = true; s = s.slice(1); }
  let kurus = null;
  // TR binlik + ondalık: 1.234.567,89 veya 1.250,50
  let m = s.match(/^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/);
  if (m) kurus = Number(m[1].replace(/\./g, '')) * 100 + decToKurus(m[2]);
  // TR ondalık (binlik ayraçsız): 1234,5
  if (kurus === null) {
    m = s.match(/^(\d+)(?:,(\d{1,2}))?$/);
    if (m) kurus = Number(m[1]) * 100 + decToKurus(m[2]);
  }
  // Düz ondalık: 1250.50 / 12.5 / 1250
  if (kurus === null) {
    m = s.match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (m) kurus = Number(m[1]) * 100 + decToKurus(m[2]);
  }
  if (kurus === null || !Number.isFinite(kurus) || kurus > MAX_AMOUNT_KURUS) return null;
  return neg ? -kurus : kurus;
}

const kurusToTL = k => Math.round(+k || 0) / 100;
const tlToKurus = tl => Math.round((+tl || 0) * 100);
const fmtKurus = (k, d = 2) =>
  (Math.round(+k || 0) / 100).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });

// Yönerge metni (form yardımı / hata mesajı) için ortak ifade.
const AMOUNT_HINT = 'Örnek: 1.250,50 veya 1250.50';

module.exports = { parseAmount, kurusToTL, tlToKurus, fmtKurus, AMOUNT_HINT, MAX_AMOUNT_KURUS };
