const crypto = require('crypto');

// Paratika Sanal POS (Web POS / barındırılan ödeme sayfası) adaptörü.
//
// Akış: Sunucumuz Paratika'da bir oturum (token) açar ve kullanıcıyı Paratika'nın
// barındırılan ödeme sayfasına yönlendirir. Kart bilgisi ASLA bizim sunucumuza gelmez
// (PCI kapsamı küçülür). Ödeme sonrası Paratika bizi RETURNURL'e geri gönderir; ödeme
// durumu kullanıcıya GÜVENİLMEYEREK sunucudan sunucuya `query` ile doğrulanır.
//
// Ortam değişkenleri:
//   PARATIKA_MERCHANT, PARATIKA_MERCHANT_USER, PARATIKA_MERCHANT_PASSWORD
//   PARATIKA_ENV         ('test' | 'prod'; varsayılan test)
//   PARATIKA_API_BASE    (varsayılan: teste https://test.paratika.com.tr/paratika/api/v2)
//   PARATIKA_HPP_URL     ({token} yer tutuculu ödeme sayfası adresi)
//   PARATIKA_SIMULATE=1  (ağ isteği yapmadan başarılı ödeme simüle eder; test/geliştirme)
//   PARATIKA_TIMEOUT_MS  (varsayılan 20000)

function cfg() {
  const prod = process.env.PARATIKA_ENV === 'prod';
  return {
    merchant: process.env.PARATIKA_MERCHANT || '',
    user: process.env.PARATIKA_MERCHANT_USER || '',
    pass: process.env.PARATIKA_MERCHANT_PASSWORD || '',
    apiBase: (process.env.PARATIKA_API_BASE
      || (prod ? 'https://entegrasyon.paratika.com.tr/paratika/api/v2' : 'https://test.paratika.com.tr/paratika/api/v2')).replace(/\/+$/, ''),
    hppUrl: process.env.PARATIKA_HPP_URL
      || (prod ? 'https://entegrasyon.paratika.com.tr/paratika/hpp/{token}' : 'https://test.paratika.com.tr/paratika/hpp/{token}'),
    simulate: process.env.PARATIKA_SIMULATE === '1',
    timeoutMs: +(process.env.PARATIKA_TIMEOUT_MS || 20000)
  };
}

const isConfigured = () => { const c = cfg(); return !!(c.merchant && c.user && c.pass); };
const authHeader = c => 'Basic ' + Buffer.from(c.user + ':' + c.pass).toString('base64');

const pick = (o, ...keys) => { for (const k of keys) if (o[k] != null && o[k] !== '') return o[k]; return null; };

// Paratika ödeme para birimi olarak TL yerine TRY bekler.
function normalizeCurrency(cur) {
  const c = String(cur || 'TL').toUpperCase();
  return c === 'TL' ? 'TRY' : c;
}

async function post(c, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), c.timeoutMs);
  try {
    const res = await fetch(c.apiBase + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: authHeader(c) },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* form-encoded yanıt olabilir */ }
    if (!json && text) json = Object.fromEntries(new URLSearchParams(text));
    return { httpStatus: res.status, json: json || {} };
  } finally { clearTimeout(timer); }
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

  const body = {
    merchant: c.merchant, merchantUser: c.user, merchantPassword: c.pass,
    action: 'SESSIONTOKEN', sessionType: 'PAYMENT',
    amount: Number(amount).toFixed(2), currency: normalizeCurrency(currency),
    orderId, returnUrl
  };
  if (installment) body.installmentCount = String(installment);
  if (description) body.description = String(description).slice(0, 200);
  if (customer) body.customer = String(customer).slice(0, 120);

  try {
    const { json } = await post(c, '/session', body);
    const token = pick(json, 'token', 'TOKEN', 'Token');
    if (token) return { token, redirectUrl: c.hppUrl.replace('{token}', encodeURIComponent(token)) };
    const msg = pick(json, 'errorMsg', 'responseMsg', 'message', 'errorCode');
    return { error: 'Sanal POS oturumu açılamadı' + (msg ? ': ' + msg : '.') };
  } catch (e) {
    return { error: 'Sanal POS bağlantı hatası: ' + e.message };
  }
}

// Ödeme durumunu sunucudan sunucuya doğrular. { ok, ref } ya da { ok:false, error } döner.
async function query({ orderId }) {
  const c = cfg();
  if (c.simulate) return { ok: true, ref: 'SIMULATED' };
  if (!isConfigured()) return { ok: false, error: 'Sanal POS yapılandırılmamış.' };
  try {
    const { json } = await post(c, '/query', {
      merchant: c.merchant, merchantUser: c.user, merchantPassword: c.pass,
      action: 'QUERY', orderId
    });
    const code = String(pick(json, 'responseCode', 'RESPONSECODE', 'errorCode') ?? '');
    const status = String(pick(json, 'status', 'transactionStatus') ?? '').toLowerCase();
    const ref = pick(json, 'transactionId', 'TRANSACTIONID', 'transaction_id');
    const approved = (code === '00' || code === '0' || code === '')
      && (!status || ['paid', 'approved', 'success', 'completed'].includes(status));
    if (approved) return { ok: true, ref };
    return { ok: false, error: pick(json, 'errorMsg', 'responseMsg', 'message') || ('Ödeme onaylanmadı (kod: ' + code + ')') };
  } catch (e) {
    return { ok: false, error: 'Doğrulama hatası: ' + e.message };
  }
}

module.exports = { cfg, isConfigured, startSession, query, normalizeCurrency };
