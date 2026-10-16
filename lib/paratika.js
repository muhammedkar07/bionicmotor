const crypto = require('crypto');

// Paratika Sanal POS adaptörü — Ortak Ödeme Sayfası (HPP / Web POS, browser redirect).
//
// Akış (resmi dokümanla doğrulandı — docs/PARATIKA.md):
//   1) SESSIONTOKEN alınır (ACTION=SESSIONTOKEN, SESSIONTYPE=PAYMENTSESSION).
//   2) Kullanıcı https://<host>/payment/<sessionToken> adresine yönlendirilir (kart bilgisi
//      ASLA bizim sunucumuza gelmez; PCI kapsamı küçülür, 3D banka sayfasında yapılır).
//   3) Paratika işlem sonucunu RETURNURL'e POST eder.
//   4) Sonuç kullanıcıya GÜVENİLMEYEREK sunucudan sunucuya QUERYTRANSACTION ile doğrulanır.
//
// Paratika API'si YALNIZCA POST kabul eder, tek uç noktadır (işlemi gövdedeki ACTION belirler),
// gövde form-encoded ve alan adları BÜYÜK harftir; kimlik bilgileri her istekte gövdede gönderilir.
//
// Ortam değişkenleri:
//   PARATIKA_MERCHANT (üye işyeri no), PARATIKA_MERCHANT_USER (e-posta), PARATIKA_MERCHANT_PASSWORD
//   PARATIKA_ENV ('test' | 'prod'; varsayılan test)
//   PARATIKA_API_BASE / PARATIKA_HPP_URL (gerekirse elle; HPP şablonunda {token} yer tutucusu)
//   PARATIKA_SIMULATE=1 (ağ isteği yapmadan simülasyon; yalnızca geliştirme/test)
//   PARATIKA_TIMEOUT_MS (varsayılan 30000)

function cfg() {
  const prod = process.env.PARATIKA_ENV === 'prod';
  const host = prod ? 'https://vpos.paratika.com.tr' : 'https://entegrasyon.paratika.com.tr';
  return {
    merchant: process.env.PARATIKA_MERCHANT || '',
    user: process.env.PARATIKA_MERCHANT_USER || '',
    pass: process.env.PARATIKA_MERCHANT_PASSWORD || '',
    apiBase: (process.env.PARATIKA_API_BASE || host + '/paratika/api/v2').replace(/\/+$/, ''),
    hppUrl: process.env.PARATIKA_HPP_URL || host + '/payment/{token}',
    simulate: process.env.PARATIKA_SIMULATE === '1',
    timeoutMs: +(process.env.PARATIKA_TIMEOUT_MS || 30000)
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
  const c = String(cur || 'TRY').toUpperCase();
  return c === 'TL' ? 'TRY' : c;
}

const creds = c => ({ MERCHANT: c.merchant, MERCHANTUSER: c.user, MERCHANTPASSWORD: c.pass });

// Paratika hata mesajını okunur hale getirir.
function apiError(json, def) {
  const msg = pick(json, 'errorMsg', 'responseMsg', 'pgTranErrorText', 'message');
  const v = pick(json, 'violatorParam');
  return (msg || def || 'İşlem başarısız') + (v ? ' (eksik/geçersiz: ' + v + ')' : '');
}

// API'ye form-encoded POST. Yanıt JSON'dur.
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

// Sepet kalemleri (ORDERITEMS) — Paratika toplamın AMOUNT ile eşleşmesini ister.
function buildOrderItems(orderItems, amount, description) {
  if (orderItems) return typeof orderItems === 'string' ? orderItems : JSON.stringify(orderItems);
  const name = (description || 'Online Ödeme').slice(0, 120).replace(/\s+/g, ' ').trim() || 'Online Ödeme';
  return JSON.stringify([
    { productCode: 'ODEME', name, description: name, quantity: 1, amount: Number(Number(amount).toFixed(2)) }
  ]);
}

// Paratika'da ödeme oturumu açar. Başarılıysa { token, redirectUrl }, aksi halde { error } döner.
async function startSession({ orderId, amount, currency = 'TRY', returnUrl, customer, customerName, customerEmail, customerPhone, customerIp, orderItems, description }) {
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
    SESSIONTYPE: 'PAYMENTSESSION',
    MERCHANTPAYMENTID: String(orderId),
    AMOUNT: Number(amount).toFixed(2),
    CURRENCY: normalizeCurrency(currency),
    ORDERITEMS: buildOrderItems(orderItems, amount, description)
  };
  if (returnUrl) params.RETURNURL = returnUrl;
  if (customer) params.CUSTOMER = String(customer).slice(0, 120);
  if (customerName) params.CUSTOMERNAME = String(customerName).slice(0, 120);
  if (customerEmail) params.CUSTOMEREMAIL = String(customerEmail).slice(0, 160);
  if (customerPhone) params.CUSTOMERPHONE = String(customerPhone).slice(0, 32);
  if (customerIp) params.CUSTOMERIP = String(customerIp).slice(0, 64);

  try {
    const json = await api(c, params);
    const code = String(pick(json, 'responseCode') ?? '');
    const token = pick(json, 'sessionToken', 'token');
    if (token && (code === '00' || code === '0')) {
      return { token, redirectUrl: c.hppUrl.replace('{token}', encodeURIComponent(token)) };
    }
    return { error: 'Sanal POS oturumu açılamadı: ' + apiError(json) };
  } catch (e) {
    return { error: 'Sanal POS bağlantı hatası: ' + e.message };
  }
}

// Paratika işlem durumu kodları.
const STATUS_OK = ['AP', 'SU', 'OK', 'APPROVED'];
const STATUS_PENDING = ['IP', 'PE', 'PENDING'];

// Ödeme durumunu sunucudan sunucuya doğrular.
// Döner: { ok:true, ref, status, raw } | { ok:false, pending:true, error } | { ok:false, error }
async function query({ orderId }) {
  const c = cfg();
  if (c.simulate) return { ok: true, ref: 'SIMULATED', status: 'AP' };
  if (!isConfigured()) return { ok: false, error: 'Sanal POS yapılandırılmamış.' };
  try {
    const json = await api(c, { ...creds(c), ACTION: 'QUERYTRANSACTION', MERCHANTPAYMENTID: String(orderId) });
    const code = String(pick(json, 'responseCode') ?? '');
    if (code !== '00' && code !== '0') return { ok: false, error: apiError(json) };

    const list = Array.isArray(json.transactionList) ? json.transactionList : [];
    const sales = list.filter(t => String(t.transactionType || '').toUpperCase() === 'SALE');

    const approved = sales.find(t => {
      const st = String(t.transactionStatus || '').toUpperCase();
      const rc = String(t.pgTranReturnCode || '');
      return STATUS_OK.includes(st) || rc === '00';
    });
    if (approved) {
      return {
        ok: true,
        ref: pick(approved, 'pgTranId', 'pgTranRefId') || null,
        status: approved.transactionStatus || null,
        raw: summarize(approved)
      };
    }

    const pending = sales.find(t => STATUS_PENDING.includes(String(t.transactionStatus || '').toUpperCase()));
    if (pending || sales.length === 0) {
      return { ok: false, pending: true, error: 'Ödeme sonucu henüz kesinleşmedi, lütfen birkaç saniye sonra tekrar deneyin.' };
    }

    const failed = sales[0];
    return { ok: false, error: (failed && failed.pgTranErrorText) || apiError(json, 'Ödeme onaylanmadı.') };
  } catch (e) {
    return { ok: false, error: 'Doğrulama hatası: ' + e.message };
  }
}

// İşlem kaydından denetime uygun kısa özet çıkar.
function summarize(t) {
  return {
    pgTranId: t.pgTranId || null,
    status: t.transactionStatus || null,
    returnCode: t.pgTranReturnCode || null,
    errorCode: t.pgTranErrorCode || null,
    amount: t.amount,
    currency: t.currency
  };
}

module.exports = { cfg, isConfigured, startSession, query, normalizeCurrency };
