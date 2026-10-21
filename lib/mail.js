'use strict';
// E-posta gönderimi (SMTP / nodemailer).
//
// Sağlayıcı bilgileri .env'den okunur:
//   SMTP_HOST       ör. mail.veridyen.com
//   SMTP_PORT       465 (SSL) veya 587 (STARTTLS). Boşsa: 465
//   SMTP_SECURE     1 = SSL (465) · 0 = STARTTLS (587). Boşsa porta göre belirlenir
//   SMTP_USER       tam e-posta adresi (ör. info@bionicmotorsiklet.com)
//   SMTP_PASS       posta kutusu parolası
//   SMTP_FROM       gönderen adres (boşsa SMTP_USER)
//   SMTP_FROM_NAME  gönderen adı (boşsa "Bionic Motor")
//   MAIL_CAPTURE_FILE  (yalnızca test) e-posta GÖNDERİLMEZ, bu dosyaya JSON olarak yazılır.
//
// SMTP tanımlı değilse send() { ok:false, error:'not-configured' } döner; çağıran taraf
// kullanıcıya anlaşılır bir mesaj gösterir.
const fs = require('fs');
const nodemailer = require('nodemailer');

function cfg() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '');
  const portRaw = String(process.env.SMTP_PORT || '').trim();
  const secureRaw = String(process.env.SMTP_SECURE || '').trim();
  const port = Number(portRaw) || (secureRaw === '0' ? 587 : 465);
  const secure = secureRaw === '' ? port === 465 : secureRaw === '1';
  const from = String(process.env.SMTP_FROM || user || '').trim();
  const fromName = String(process.env.SMTP_FROM_NAME || '').trim() || 'Bionic Motor';
  return { host, port, secure, user, pass, from, fromName };
}

function configured() {
  const c = cfg();
  if (!c.host || !c.from) return false;
  if (c.user && !c.pass) return false;
  return true;
}

let transporter = null;
let transporterKey = '';
function getTransport(c) {
  const key = [c.host, c.port, c.secure, c.user, c.pass].join('|');
  if (transporter && key === transporterKey) return transporter;
  transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
    // Oracle Email Delivery TLS 1.2+ ister; 587'de STARTTLS otomatik yükseltilir.
    requireTLS: !c.secure,
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 25000
  });
  transporterKey = key;
  return transporter;
}

function capturePath() {
  return String(process.env.MAIL_CAPTURE_FILE || '').trim();
}

// Gönderim yapılabilir mi? (test için dosyaya yakalama da "etkin" sayılır)
function enabled() {
  return !!capturePath() || configured();
}

// { to, subject, text, html, replyTo } → { ok, error? }
/**
 * @param {{ to: string, subject: string, text: string, html?: string, replyTo?: string }} msg
 */
async function send(msg) {
  const { to, subject, text, html, replyTo } = msg || {};
  const c = cfg();
  const message = {
    from: '"' + c.fromName + '" <' + c.from + '>',
    to,
    subject,
    text,
    html: html || undefined
  };
  if (replyTo) message.replyTo = replyTo;

  if (capturePath()) {
    try {
      const tmp = capturePath();
      let list = [];
      if (fs.existsSync(tmp)) {
        try {
          list = JSON.parse(fs.readFileSync(tmp, 'utf8')) || [];
        } catch {
          list = [];
        }
      }
      list.push({ at: new Date().toISOString(), ...message });
      fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
      return { ok: true, captured: true };
    } catch (e) {
      return { ok: false, error: 'capture: ' + e.message };
    }
  }

  if (!configured()) return { ok: false, error: 'not-configured' };
  try {
    const info = await getTransport(c).sendMail(message);
    return { ok: true, info };
  } catch (e) {
    // Tanı için sunucu günlüğüne yaz (parola asla yazılmaz)
    console.error('[mail] gönderilemedi:', e && e.message ? e.message : e);
    return { ok: false, error: e && e.message ? e.message : 'gönderim hatası' };
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// Şifre sıfırlama e-postası içeriği
/**
 * @param {object} opts
 * @param {string} [opts.name]
 * @param {string} opts.link
 * @param {number} [opts.minutes]
 * @param {string} [opts.panel]
 * @param {{ company?: string, address?: string, phone?: string, email?: string }} [opts.site]
 */
function resetMail(opts) {
  const { name, link, minutes = 60, panel = 'Portal', site = {} } = opts || {};
  const brand = 'Bionic Motor';
  const footer = [site.company, site.address, site.phone ? 'Tel: ' + site.phone : null, site.email]
    .filter(Boolean)
    .join(' · ');
  const subject = brand + ' · Şifre sıfırlama bağlantısı';
  const text =
    (name ? 'Sayın ' + name + ',\n\n' : 'Merhaba,\n\n') +
    brand + ' ' + panel + ' hesabınız için şifre sıfırlama talebi alındı.\n' +
    'Yeni şifrenizi belirlemek için aşağıdaki bağlantıyı açın:\n\n' +
    link +
    '\n\nBağlantı ' + minutes + ' dakika geçerlidir ve yalnızca bir kez kullanılabilir.\n' +
    'Şifrenizi siz istemediyseniz bu e-postayı dikkate almayın; şifreniz değişmez.\n\n' +
    brand +
    (footer ? '\n' + footer : '');
  const html = `<!doctype html><html lang="tr"><body style="margin:0;padding:0;background:#f2f4f7;font-family:Arial,Helvetica,sans-serif;color:#1f2430">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f7;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3e7ee">
        <tr><td style="background:#111418;padding:18px 26px;color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:.5px">
          ${brand}
        </td></tr>
        <tr><td style="padding:26px">
          <h1 style="margin:0 0 12px;font-size:19px;color:#111418">Şifre sıfırlama</h1>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3d4654">
            ${name ? 'Sayın ' + esc(name) + ',' : 'Merhaba,'}<br>
            <b>${esc(panel)}</b> hesabınız için şifre sıfırlama talebi alındı. Aşağıdaki düğmeye tıklayarak yeni şifrenizi belirleyebilirsiniz.
          </p>
          <p style="text-align:center;margin:26px 0">
            <a href="${esc(link)}" style="display:inline-block;background:#c8102e;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:13px 26px;border-radius:8px">Yeni şifre belirle</a>
          </p>
          <p style="margin:0 0 6px;font-size:12px;color:#6b7482">Düğme çalışmazsa bu bağlantıyı tarayıcınıza kopyalayın:</p>
          <p style="margin:0 0 18px;font-size:12px;word-break:break-all"><a href="${esc(link)}" style="color:#0b63ce">${esc(link)}</a></p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7482">
            Bağlantı <b>${minutes} dakika</b> geçerlidir ve <b>yalnızca bir kez</b> kullanılabilir.<br>
            Şifrenizi siz istemediyseniz bu e-postayı dikkate almayın; şifreniz değişmez.
          </p>
        </td></tr>
        <tr><td style="background:#f7f8fa;padding:14px 26px;font-size:11px;color:#8a929f">
          Bu e-posta ${brand} portalı tarafından otomatik gönderilmiştir. Yanıtlamayın.${footer ? '<br>' + esc(footer) : ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return { subject, text, html };
}

module.exports = { cfg, configured, enabled, send, resetMail };
