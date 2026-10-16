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
| `BASE_PATH` | `/bionic` |
| `PUBLIC_URL` | `https://bionicmotorsiklet.com/bionic` |
| `TRUST_PROXY` | `1` |
| `COOKIE_SECURE` | `1` |
| `DATA_DIR` | `/var/lib/bionic/data` |
| `BACKUP_ENCRYPT_KEY` | güçlü, gizli (kaybetmeyin!) |
| `PARATIKA_ENV` | `prod` (canlı) |

## 4) PM2 ile başlat

```bash
cd /var/www/bionic
pm2 start ecosystem.config.js
pm2 save
pm2 startup           # çıkan komutu çalıştırın (açılışta otomatik başlasın)

# Doğrulama:
curl -I http://127.0.0.1:3000/bionic/
```

## 5) nginx

```bash
sudo cp deploy/nginx-bionic.conf /etc/nginx/sites-available/bionic
sudo ln -s /etc/nginx/sites-available/bionic /etc/nginx/sites-enabled/bionic
sudo nginx -t && sudo systemctl reload nginx
```

> **Önemli:** `proxy_pass http://bionic_app;` satırında **sonunda `/` OLMAMALI**.
> Böylece `/bionic/` öneki korunur ve uygulama `BASE_PATH=/bionic` ile eşleşir.

## 6) HTTPS (Let's Encrypt)

```bash
sudo certbot --nginx -d bionicmotorsiklet.com -d www.bionicmotorsiklet.com
```

Certbot 443 bloğunu oluşturur; `location /bionic/ { proxy_pass ... }` bloklarını aynı bırakın.
Sonra `.env` içinde `COOKIE_SECURE=1` olduğundan emin olun ve `pm2 restart bionic`.

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
pm2 restart bionic
```

## 9) Yedekleme
- Uygulama **saatlik** otomatik yedek alır (`BACKUP_DIR`), şifreler ve (ayarlıysa) off-site yükler.
- Elle: `npm run backup` · Doğrula: `npm run backup:verify` · Geri yükle: `npm run restore`
- Yedeklenmesi gereken tek klasör: **`DATA_DIR`** (`/var/lib/bionic/data`).

## 10) Canlıya geçiş kontrol listesi
- [ ] `PARATIKA_ENV=prod` ve **canlı (VPOS) API kullanıcısı** girildi (entegrasyon kullanıcısı canlıda geçmez).
- [ ] `PUBLIC_URL` tam adres (`/bionic` dahil) ve `BASE_PATH=/bionic`.
- [ ] `ADMIN_PASSWORD` güçlü, `SEED_DEMO=0`.
- [ ] `BACKUP_ENCRYPT_KEY` ayarlandı ve güvenli bir yerde saklandı.
- [ ] `https://bionicmotorsiklet.com/bionic/` açılıyor; `/` → `/bionic/` yönleniyor.
- [ ] Ödeme: kart → 3D → dönüşte **cariye alacak** işleniyor (gerçek kart veya canlı test).
- [ ] `logs/error.log` boş; `pm2 logs bionic` temiz.

## Notlar
- **SQLite** kullanıldığı için tek Node örneği (`instances: 1`) çalıştırın (dosya kilidi).
- `/bionic/` öneki `BASE_PATH` ile yönetilir; kökte çalıştırmak istersen `BASE_PATH` boş bırakılır (o zaman tüm bağlantılar köke göre üretilir).
