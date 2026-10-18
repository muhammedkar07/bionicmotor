# Sunucu Kurulumu — bionicmotorsiklet.com/bionic

Uygulama **Node.js + SQLite** çalıştırır ve ters proxy (nginx) arkasında **`/bionic/` alt yolunda** yayınlanır.

## 1) Sunucu hazırlığı (Ubuntu 24.04)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx git curl

# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

sudo npm i -g pm2
```

## 2) Dosyaları yerleştir

```bash
sudo mkdir -p /var/www/bionic /var/lib/bionic/data /var/backups/bionic /var/log/bionic
sudo chown -R $USER:$USER /var/www/bionic /var/lib/bionic /var/backups/bionic /var/log/bionic

# Projeyi kopyala (git ile veya scp/rsync). Örn:
cd /var/www/bionic
git clone <repo-url> .
# ya da: rsync -av ./ kullanici@sunucu:/var/www/bionic/

npm ci --omit=dev
```

## 3) Ortam dosyası (.env)

```bash
cp deploy/.env.production.example /var/www/bionic/.env
nano /var/www/bionic/.env      # ADMIN_PASSWORD, PARATIKA_* ve BACKUP_ENCRYPT_KEY doldurun
```

Kritik değerler:

| Değişken | Değer |
| --- | --- |
| `BASE_PATH` | *(boş — uygulama kökte çalışır)* |
| `PUBLIC_URL` | `https://bionicmotorsiklet.com` |
| `TRUST_PROXY` | `1` |
| `COOKIE_SECURE` | `1` |
| `DATA_DIR` | `/var/lib/bionic/data` |
| `BACKUP_ENCRYPT_KEY` | güçlü, gizli (kaybetmeyin!) |
| `PARATIKA_ENV` | `prod` (canlı) |

> Alt yolda çalıştırmak isterseniz: `BASE_PATH=/bionic` + `PUBLIC_URL=https://site/bionic` ve
> nginx'te `location /bionic/ { proxy_pass http://bionic_app; }` (önek korunur).

## 4) PM2 ile başlat

```bash
cd /var/www/bionic
pm2 start ecosystem.config.js
pm2 save
pm2 startup           # çıkan komutu çalıştırın (açılışta otomatik başlasın)

# Doğrulama:
curl -I http://127.0.0.1:3000/
```

## 5) nginx

```bash
sudo cp deploy/nginx-bionic.conf /etc/nginx/sites-available/bionic
sudo ln -s /etc/nginx/sites-available/bionic /etc/nginx/sites-enabled/bionic
sudo nginx -t && sudo systemctl reload nginx
```

> **Önemli:** `proxy_pass http://bionic_app;` satırında **sonunda `/` OLMAMALI**.
> Böylece kökte `/` öneki korunur ve uygulama `BASE_PATH` boş iken eşleşir.

## 6) HTTPS (Let's Encrypt) — ✅ KURULDU

DNS (`bionicmotorsiklet.com` + `www` → sunucu IP'si) hazır olduktan sonra bir kez çalıştırılır:

```bash
sudo certbot --nginx -d bionicmotorsiklet.com -d www.bionicmotorsiklet.com \
  --redirect --agree-tos --non-interactive -m <yetkili-eposta> --no-eff-email
```

**Mevcut durum (18.10.2026):**
- Sertifika: `/etc/letsencrypt/live/bionicmotorsiklet.com/` — geçerlilik **16.01.2027**
- Otomatik yenileme: `systemd` timer (`certbot renew`, günde 2 kez) — ek işlem gerekmez
- HTTP → HTTPS yönlendirmesi açık (`--redirect`)
- `https://bionicmotorsiklet.com/bionic/` → **200**, `https://bionicmotorsiklet.com/` → `/bionic/`
- `.env`: `PUBLIC_URL=https://bionicmotorsiklet.com/bionic`, `COOKIE_SECURE=1` → `pm2 restart bionic`

Doğrulama:

```bash
curl -sSI https://bionicmotorsiklet.com/bionic/ | head -1          # 200
curl -sSI http://bionicmotorsiklet.com/bionic/ | grep -i location  # https'e 301
sudo certbot certificates                                          # geçerlilik tarihi
```

> **Neden `PUBLIC_URL` kritik:** Paratika `RETURNURL`'ü bu değerden üretilir →
> `https://bionicmotorsiklet.com/bionic/odeme/paratika/sonuc`. Bankanın 3D adımı bu adrese
> dönebilmesi için alan adı + geçerli HTTPS zorunludur.

## 7) Güvenlik duvarı

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## 8) Güncelleme (yeni sürüm)

```bash
cd /var/www/bionic
git pull
npm ci --omit=dev
npm run seed:models     # modelleri yükler (idempotent; varsa atlar)
pm2 restart bionic
```

## 9) Yedekleme
- Uygulama **saatlik** otomatik yedek alır (`BACKUP_DIR`): **veritabanı + yüklenen görseller**, AES‑256‑GCM ile **şifreli**, rotasyonlu.
- Elle: `npm run backup` · Doğrula: `npm run backup:verify` · Geri yükle: `npm run restore`
- **Tam taşıma paketi** (kod + veri + .env): `node --env-file=.env scripts/pack.js`

### Off-site (Cloudflare R2) kurulumu
```bash
# 1) rclone (en güncel sürüm — eski apt sürümü R2 ile sorun çıkarır)
curl -fsSL https://rclone.org/install.sh | sudo bash

# 2) R2 remote (Cloudflare R2 → API Token: Access Key + Secret)
rclone config create r2 s3 provider Cloudflare \
  access_key_id  <ACCESS_KEY_ID> \
  secret_access_key <SECRET_ACCESS_KEY> \
  endpoint https://<ACCOUNT_ID>.r2.cloudflarestorage.com

# 3) .env içine ekle (--s3-no-check-bucket ŞART; aksi halde rclone bucket'ı oluşturmaya çalışıp 403 alır)
# BACKUP_UPLOAD_CMD=rclone copy "{file}" r2:bionic-backups/ --s3-no-check-bucket

pm2 restart bionic
```
Doğrulama: `node --env-file=.env scripts/backup.js` sonrası `rclone ls r2:bionic-backups --s3-no-check-bucket`.

Yedeklenmesi gereken tek klasör: **`DATA_DIR`** (`/var/lib/bionic/data`).

## 10) Canlıya geçiş kontrol listesi
- [x] `PARATIKA_ENV=prod` ve **canlı (VPOS) API kullanıcısı** girildi — ✅ 18.10.2026 (üye işyeri 10013443; QUERYINSTALLMENT/SESSIONTOKEN onaylı)
- [x] `PUBLIC_URL` tam adres (`/bionic` dahil) ve `BASE_PATH=/bionic` — ✅ `https://bionicmotorsiklet.com/bionic`
- [x] `COOKIE_SECURE=1` (HTTPS) — ✅ çerezler `Secure; HttpOnly; SameSite=Lax`
- [x] `ADMIN_PASSWORD` güçlü, `SEED_DEMO=0`.
- [x] `BACKUP_ENCRYPT_KEY` ayarlandı ve güvenli bir yerde saklandı; off-site (R2) yükleme çalışıyor.
- [x] `https://bionicmotorsiklet.com/` → **200** (kök dizin); eski `/bionic/...` adresleri önek korunarak köke 301'lenir. **HTTP → HTTPS** yönleniyor.
- [x] SSL (Let's Encrypt) kurulu, otomatik yenileme açık — geçerlilik **16.01.2027**.
- [x] Ödeme sonrası yönlendirme: **bayi → `/bayi/hesap-ozeti`**, **servis → `/servis/hesap-ozeti`**, **sitedeki online ödeme → `/`** (ana sayfa) — doğrulandı.
- [x] Çerez + oturum: `Secure; HttpOnly; SameSite=Lax`; panel girişleri HTTPS'te çalışıyor.
- [ ] Ödeme: kart → 3D → dönüşte **cariye alacak** işleniyor — ⛔ **Paratika canlı API kullanıcısına `API_QUERYTRANSACTION` yetkisi verilmeli** (aşağıya bakın)
- [ ] `logs/error.log` boş; `pm2 logs bionic` temiz.

> ### ⛔ Canlı ödeme öncesi zorunlu: `API_QUERYTRANSACTION` yetkisi
> Canlı API kullanıcısı (`h.sancar288@gmail.com` / üye işyeri **10013443**) için `QUERYTRANSACTION`
> çağrısı şu hatayı veriyor:
> ```
> responseCode=99 | errorCode=ERR10082
> "Kullanıcının bu işlem için yetkisi yoktur."
> violatorParam=User does not have API_QUERYTRANSACTION permission to perform this action
> ```
> Ödeme durumu **sunucudan sunucuya** bu çağrıyla doğrulanır (kullanıcıya güvenilmez). Yetki
> verilmezse: para çekilir ama **cariye alacak işlenmez**, mutabakat da çalışamaz.
>
> **Çözüm:** Paratika paneli → **Ayarlar / API Kullanıcıları** → kullanıcının yetkilerinde
> **İşlem Sorgulama (QUERYTRANSACTION)** iznini açın (veya tüm API yetkileri olan yeni bir API
> kullanıcısı oluşturun). Ardından doğrulama:
> ```bash
> curl -s -X POST https://vpos.paratika.com.tr/paratika/api/v2 \
>   -d MERCHANT=10013443 -d MERCHANTUSER=... -d MERCHANTPASSWORD=... \
>   -d ACTION=QUERYTRANSACTION -d MERCHANTPAYMENTID=TEST | head -c 300
> ```
> `responseCode=00` görmelisiniz (işlem bulunamasa bile yetki hatası vermemeli).
>
> Dönüş adresi: `https://bionicmotorsiklet.com/odeme/paratika/sonuc`

## Notlar
- **SQLite** kullanıldığı için tek Node örneği (`instances: 1`) çalıştırın (dosya kilidi).
- Uygulama **kök dizinde** çalışır (`BASE_PATH` boş). Eski `/bionic/...` adresleri nginx'te önek korunarak köke 301'lenir.
- Alt yolda (`/bionic`) çalıştırmak istersen `BASE_PATH=/bionic` yeterlidir; bağlantılar ve ödeme dönüş adresi otomatik uyum sağlar.
