# E-posta Kurulumu (Bionic Motor)

Bu dosya `bionicmotorsiklet.com` alan adının **posta + DNS** yapısını ve bakım komutlarını özetler.

## Genel yapı

| Bileşen | Sağlayıcı | Not |
|---|---|---|
| Alan adı (registrar) | **Metunic** | .com 2027-10-09 · .com.tr 2027-10-08 |
| DNS yönetimi | **Metunic** (`ns1/ns2/ns3.metunic.com.tr`) | Tüm kayıtlar: Metunic → DNS Kayıtları |
| **Giden posta (uygulama)** | **Brevo SMTP relay** | `smtp-relay.brevo.com:587` (STARTTLS) · DKIM `d=bionicmotorsiklet.com` ✅ |
| **Gelen posta** | **ImprovMX** (ücretsiz) | `info@` → `hasan-sancar@hotmail.com` |
| Web sitesi | **Oracle Cloud** (130.61.231.148) | nginx + PM2 (`bionic`, port 3000) |

> Eski kurulum (Oracle Email Delivery) artık kullanılmıyor. DKIM'i kendi alan adımıza imzalayamadığı için
> (`d=fra1.rp.oracleemaildelivery.com` → DMARC uyumsuz → spam) **Brevo'ya geçildi**.

## Kritik DNS kayıtları (Metunic)

| Tür | Ad | Değer |
|---|---|---|
| A | `@` | `130.61.231.148` |
| A | `mail` | `45.151.248.107` |
| A | `webmail`, `cpanel`, `autodiscover`, `autoconfig` | `45.151.250.117` |
| CNAME | `www` | `bionicmotorsiklet.com` |
| MX | `@` | `10 mx1.improvmx.com` · `20 mx2.improvmx.com` |
| TXT | `@` (Brevo doğrulama) | `brevo-code:…` |
| TXT | `@` (SPF) | `v=spf1 include:_spf.protection.veridyen.com include:relay.mailchannels.net include:spf.brevo.com ~all` |
| **CNAME** | `brevo1._domainkey` | `b1.bionicmotorsiklet-com.dkim.brevo.com` |
| **CNAME** | `brevo2._domainkey` | `b2.bionicmotorsiklet-com.dkim.brevo.com` |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:info@bionicmotorsiklet.com` |

> Kural: **tek SPF kaydı** olmalı; yeni sağlayıcı eklenirse `include:` olarak eklenir.

## Uygulama ayarları (.env)

```env
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=0
SMTP_USER=<brevo smtp login>      # ör. bf5fff001@smtp-brevo.com
SMTP_PASS=<brevo smtp key>
SMTP_FROM=no-reply@bionicmotorsiklet.com
SMTP_FROM_NAME=Bionic Motor
```

Notlar:
- Brevo'da **Security → Authorized IP addresses** içinde sunucu IP'si (`130.61.231.148`) yetkili olmalı; aksi halde `525 5.7.1 Unauthorized IP address` hatası alınır.
- `no-reply@bionicmotorsiklet.com` Brevo'da **verified sender** olmalı.
- `.env` izinleri `640`; SMTP anahtarı yalnızca sunucuda.

## Bakım komutları (sunucuda)

```bash
cd /var/www/bionic

npm run mail:check                 # SPF / DKIM / DMARC / MX / SMTP denetimi
npm run mail:auth                  # geçici kutuya mail atıp DKIM d= ve DMARC uyumunu doğrular
node --env-file=.env scripts/mail-test.js kime@adres.com   # gerçek gönderim testi
sudo bash scripts/mail-setup.sh    # SMTP ayarlarını etkileşimli güncelle (yedekler)
```

`mail:auth` çıktısında beklenen:
```
DKIM d=        : bionicmotorsiklet.com
DKIM hizalaması: UYUMLU ✅ (DMARC geçer)
```

## Şifre sıfırlama akışı

- `/sifre/unuttum` → kayıtlı + aktif kullanıcıysa e-posta gönderilir
- `/sifre/sifirla/<token>` · **60 dk** · **tek kullanımlık** · yeni istek eskisini iptal eder
- Parola: en az **14 karakter** (büyük/küçük harf + rakam + simge), bcrypt ile saklanır, tüm oturumlar kapatılır
- Denetim: `audit_log` → `password_reset_request` / `password_reset`

## Sorun giderme

| Belirti | Kontrol |
|---|---|
| Mail spam'e düşüyor | `npm run mail:auth` → `d=bionicmotorsiklet.com` mi? SPF/DKIM/DMARC yayında mı? |
| `525 5.7.1 Unauthorized IP` | Brevo → Security → Authorized IP addresses → sunucu IP'sini ekle |
| Gönderen reddediliyor | Brevo → Senders → `no-reply@…` **Verified** mi? |
| `info@`'a gelen Hotmail'e düşmüyor | ImprovMX alias (`info` → Hotmail) aktif mi · MX `mx1/mx2.improvmx.com` mı |
| Site açılmıyor | `pm2 status` · `curl -I https://bionicmotorsiklet.com` · nginx logları |
