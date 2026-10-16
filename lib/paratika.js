const crypto = require('crypto');

// Paratika Sanal POS (Web POS / barındırılan ödeme sayfası) adaptörü.
//
// Paratika API'si yalnızca POST kabul eder ve kimlik bilgileri HER istekte gövdede gönderilir
// (MERCHANT, MERCHANTUSER, MERCHANTPASSWORD). Gövde form-encoded (application/x-www-form-urlencoded).
//
// Ortam değişkenleri:
//   PARATIKA_MERCHANT (üye işyeri numarası), PARATIKA_MERCHANT_USER (e-posta), PARATIKA_MERCHANT_PASSWORD
//   PARATIKA_ENV ('test' | 'prod'; varsayılan test)
//     test -> https://entegrasyon.paratika.com.tr/paratika/api/v2
//     prod -> https://vpos.paratika.com.tr/paratika/api/v2
//   PARATIKA_API_BASE / PARATIKA_HPP_URL (gerekirse elle)
//   PARATIKA_SIMULATE=1 (ağ isteği yapmadan simülasyon)
//   PARATIKA_TIMEOUT_MS (varsayılan 20000)

function cfg() {
  const prod = process.env.PARATIKA_ENV === 'prod';
  return {
    merchant: process.env.PARATIKA_MERCHANT || '',
    user: process.env.PARATIKA_MERCHANT_USER || '',
    pass: process.env.PARATIKA_MERCHANT_PASSWORD || '',
    apiBase: (
      process.env.PARATIKA_API_BASE ||
      (prod ? 'https://vpos.paratika.com.tr/paratika/api/v2' : 'https://entegrasyon.paratika.com.tr/paratika/api/v2')
    ).replace(/\/+$/, ''),
    hppUrl:
      process.env.PARATIKA_HPP_URL ||
      (prod ? 'https://vpos.paratika.com.tr/paratika/hpp/{token}' : 'https://entegrasyon.paratika.com.tr/paratika/hpp/{token}'),
    // SESSIONTOKEN isteğinin SESSIONTYPE değeri (Paratika'nın geçerli değeri hâlâ doğrulanıyor).
    sessionType: process.env.PARATIKA_SESSION_TYPE || 'PAYMENT',
    simulate: process.env.PARATIKA_SIMULATE === '1',
    timeoutMs: +(process.env.PARATIKA_TIMEOUT_MS || 20000)
  };
}

const isConfigured = () => {
  const c = cfg();
  return !!(c.merchant && c.user && c.pass);
};

// Yanıt anahtarlarını büyük/küçük harf duyarsız bul.
function pick(o, ...keys) {
  const map = {};
  for (const k of Object.keys(o || {})) map[k.toLowerCase()] = o[k];
  for (const k of keys) {
    const v = map[String(k).toLowerCase()];
    if (v != null && v !== '') return v;
  }
  return null;
}

// Paratika ödeme para birimi olarak TL yerine TRY bekler.
function normalizeCurrency(cur) {
  const c = String(cur || 'TL').toUpperCase();
  return c === 'TL' ? 'TRY' : c;
}

const creds = c => ({ MERCHANT: c.merchant, MERCHANTUSER: c.user, MERCHANTPASSWORD: c.pass });

// Paratika API tek uç noktadır: gövdedeki ACTION işlemi belirler. Yanıt JSON'dur.
async function api(c, params) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), c.timeoutMs);
  try {
    const res = await fetch(c.apiBase, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(params),
      signal: ctrl.signal
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* bazı hatalarda form-encoded dönebilir */
    }
    if (!json && text) json = Object.fromEntries(new URLSearchParams(text));
    return json || {};
  } finally {
    clearTimeout(timer);
  }
}

// Paratika hata mesajını okunur hale getirir.
function apiError(json, def) {
  const msg = pick(json, 'errorMsg', 'responseMsg', 'message');
  const v = pick(json, 'violatorParam');
  return (msg || def || 'İşlem başarısız') + (v ? ' (eksik/geçersiz: ' + v + ')' : '');
}

// Paratika'da oturum açar. Başarılıysa { token, redirectUrl }, aksi halde { error } döner.
async function startSession({ orderId, amount, currency = 'TL', installment, description, returnUrl, customer }) {
  const c = cfg();
  if (c.simulate) {
    const token = 'SIM-' + crypto.randomBytes(8).toString('hex');
    const u = new URL(returnUrl, 'http://localhost');
    u.searchParams.set('simulate', '1');
    u.searchParams.set('token', token);
    u.searchParams.set('payment_status', 'success');
    return { token, redirectUrl: u.pathname + u.search };
  }
  if (!isConfigured()) return { error: 'Sanal POS yapılandırılmamış. Lütfen yönetici ile iletişime geçin.' };

  /** @type {Record<string, string>} */
  const params = {
    ...creds(c),
    ACTION: 'SESSIONTOKEN',
    SESSIONTYPE: c.sessionType,
    AMOUNT: Number(amount).toFixed(2),
    CURRENCY: normalizeCurrency(currency),
    ORDERID: orderId,
    RETURNURL: returnUrl
  };
  if (installment) params.INSTALLMENTCOUNT = String(installment);
  if (description) params.DESCRIPTION = String(description).slice(0, 200);
  if (customer) params.CUSTOMER = String(customer).slice(0, 120);

  try {
    const json = await api(c, params);
    const code = String(pick(json, 'responseCode') ?? '');
    const token = pick(json, 'token', 'sessionToken');
    const direct = pick(json, 'sessionUrl', 'sessionURL', 'redirectUrl', 'paymentUrl', 'url');
    if (token && (code === '00' || code === '0' || code === '')) {
      return { token, redirectUrl: direct || c.hppUrl.replace('{token}', encodeURIComponent(token)) };
    }
    if (token && direct) return { token, redirectUrl: direct };
    return { error: 'Sanal POS oturumu açılamadı: ' + apiError(json) };
  } catch (e) {
    return { error: 'Sanal POS bağlantı hatası: ' + e.message };
  }
}

// Ödeme durumunu sunucudan sunucuya doğrular. { ok, ref } ya da { ok:false, error } döner.
// NOT: Paratika'da sorgulama işleminin ACTION değeri 'QUERYTRANSACTION' (canlı testte doğrulandı).
async function query({ orderId }) {
  const c = cfg();
  if (c.simulate) return { ok: true, ref: 'SIMULATED' };
  if (!isConfigured()) return { ok: false, error: 'Sanal POS yapılandırılmamış.' };
  try {
    const json = await api(c, { ...creds(c), ACTION: 'QUERYTRANSACTION', ORDERID: orderId });
    const code = String(pick(json, 'responseCode') ?? '');
    const status = String(pick(json, 'status', 'transactionStatus') ?? '').toLowerCase();
    const ref = pick(json, 'transactionId');
    const approved =
      (code === '00' || code === '0') && (!status || ['paid', 'approved', 'success', 'completed'].includes(status));
    if (approved) return { ok: true, ref };
    return { ok: false, error: apiError(json, 'Ödeme onaylanmadı (kod: ' + code + ')') };
  } catch (e) {
    return { ok: false, error: 'Doğrulama hatası: ' + e.message };
  }
}

module.exports = { cfg, isConfigured, startSession, query, normalizeCurrency };
