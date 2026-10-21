# E-posta Kurulumu (Bionic Motor)

Bu dosya, `bionicmotorsiklet.com` alan adının **posta + DNS** yapısını ve acil durum komutlarını özetler.

## Genel yapı

| Bileşen | Sağlayıcı | Not |
|---|---|---|
| Alan adı kaydı (registrar) | **Metunic** | .com 2027-10-09, .com.tr 2027-10-08 |
| DNS yönetimi | **Metunic** (`ns1/ns2/ns3.metunic.com.tr`) | Tüm kayıtlar Metunic → DNS Kayıtları |
| **Giden posta (uygulama)** | **Oracle Cloud Email Delivery** (Frankfurt) | `smtp.email.eu-frankfurt-1.oci.oraclecloud.com:587` · STARTTLS · TLS 1.2 |
| **Gelen posta** | **ImprovMX** (ücretsiz yönlendirme) | `info@` → `hasan-sancar@hotmail.com` |
| Web sitesi | **Oracle Cloud** (130.61.231.148) | nginx + PM2 (`bionic`, port 3000) |

## Kritik DNS kayıtları (Metunic)

| Tür | Ad | Değer |
|---|---|---|
| A | `@` | `130.61.231.148` |
| A | `mail` | `45.151.248.107` |
| A | `webmail`, `cpanel`, `autodiscover`, `autoconfig` | `45.151.250.117` |
| CNAME | `www` | `bionicmotorsiklet.com` |
| MX | `@` | `10 mx1.improvmx.com` · `20 mx2.improvmx.com` |
| TXT | `@` (SPF) | `v=spf1 include:_spf.protection.veridyen.com include:relay.mailchannels.net include:eu.rp.oracleemaildelivery.com ~all` |
| TXT | `default._domainkey` | Veridyen DKIM (eski kutu) |
| TXT | `bionic2026._domainkey` | Oracle Email Delivery DKIM (public key) |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:info@bionicmotorsiklet.com` |

> ⚠️ Kural: **tek SPF kaydı** olmalı. Yeni bir gönderim servisi eklenirse mevcut kayda `include:` olarak eklenir.

## Uygulama ayarları (.env)

```env
SMTP_HOST=smtp.email.eu-frankfurt-1.oci.oraclecloud.com
SMTP_PORT=587
SMTP_SECURE=0
SMTP_USER=ocid1.user.oc1..xxxx@ocid1.tenancy.oc1..yyyy
SMTP_PASS=********
SMTP_FROM=no-reply@bionicmotorsiklet.com
SMTP_FROM_NAME=Bionic Motor
```

Notlar:
- `.env` izinleri `640`. SMTP parolası yalnızca sunucuda.
- SMTP parolası değişirse: **Identity → Users → SMTP Credentials → Generate** → sonra sunucuda `sudo bash scripts/mail-setup.sh`.
- Oracle limitleri (ücretsiz): **200 mail/gün**, 10 mail/dk, 2 MB.

## Bakım komutları (sunucuda)

```bash
cd /var/www/bionic

# 1) Ayarları denetle (SPF/DKIM/DMARC/MX/SMTP)
npm run mail:check
# DKIM selector'ü elle kontrol etmek için:
node scripts/mail-check.js --dkim=bionic2026

# 2) Bağlantı testi (mail göndermeden)
node --env-file=.env scripts/mail-test.js

# 3) Gerçek test maili
node --env-file=.env scripts/mail-test.js kime@adres.com

# 4) SMTP ayarlarını (şifre değişti vs.) etkileşimli güncelle
sudo bash scripts/mail-setup.sh
```

## Şifre sıfırlama akışı

- Sayfa: `/sifre/unuttum` → e-posta → **kayıtlı + aktif** kullanıcıysa bağlantı maili gider.
- Bağlantı: `/sifre/sifirla/<token>` · **60 dk** geçerli · **tek kullanımlık** · yeni istek eskisini iptal eder.
- Parola: en az **14 karakter** (büyük/küçük harf + rakam + simge), bcrypt ile saklanır, kullanıcının tüm oturumları kapatılır.
- Denetim: `audit_log` tablosunda `password_reset_request` / `password_reset`.

## Sorun giderme

| Belirti | Kontrol |
|---|---|
| Mail spam'e düşüyor | `npm run mail:check` — SPF'de `include:eu.rp.oracleemaildelivery.com` var mı, DKIM TXT yayında mı, DMARC `p=quarantine` uyumlu mu |
| Şifre sıfırlama maili gelmiyor | `node --env-file=.env scripts/mail-test.js <adres>` + `audit_log` (`password_reset_failed` varsa `reason`) |
| `info@`'a gelen mail Hotmail'e düşmüyor | ImprovMX panelinde alias (`info` → Hotmail) aktif mi · MX `mx1/mx2.improvmx.com` mı |
| Site açılmıyor | `pm2 status`, `curl -I https://bionicmotorsiklet.com`, nginx logları |
