# Bakım ve Güncelleme Politikası

Bu dosya, `bionicmotorsiklet.com` sunucusunun güncel ve güvenli tutulması için kurulan
otomatik mekanizmaları ve periyodik bakım adımlarını özetler.

## Otomatik olanlar (kurulu)

| İş | Sıklık | Nerede | Not |
|---|---|---|---|
| **İşletim sistemi güvenlik yamaları** | otomatik (günlük) | `unattended-upgrades` | Yalnızca `-security` kaynakları; otomatik reboot **kapalı** |
| **TLS sertifikası yenileme** | günde 2 kez kontrol | `certbot.timer` | Sertifika: 16.01.2027'ye kadar geçerli |
| **npm güvenlik taraması** | Pazartesi 04:00 | `/etc/cron.d/bionic-npm-audit` | Log: `/var/log/bionic/npm-audit.log` |
| **Veritabanı yedeği (şifreli + off-site)** | saatlik | `lib/diagnostics.js` (uygulama içi) | Rotasyon: 24 saatlik + 30 günlük + 12 aylık |
| **Yedek bütünlük doğrulaması** | günlük | `lib/diagnostics.js` | `npm run backup:verify` ile elle de çalıştırılabilir |
| **Ödeme mutabakatı (Paratika)** | dakikada 1 | `lib/diagnostics.js` | Kaçan callback'leri yakalar |
| **Otomatik onarım / sistem testi** | 30 dk / 6 saat | `lib/diagnostics.js` | Admin → Sistem Testi |
| **Oturum + giriş denemesi temizliği** | saatlik | `lib/core.js` | `purgeOld()` |
| **PM2 boot kaydı** | açılışta | `pm2-ubuntu.service` | `pm2 save` ile süreç listesi kalıcı |

## Aylık rutin (5 dakika)

```bash
ssh -i C:\Users\muham\.ssh\bionic_oracle ubuntu@130.61.231.148

# 1) İşletim sistemi
sudo apt update && apt list --upgradable        # bekleyen paketler
sudo apt upgrade -y                             # kurulum (gerekirse reboot)
[ -f /var/run/reboot-required ] && sudo reboot

# 2) Uygulama bağımlılıkları
cd /var/www/bionic
npm audit --omit=dev                            # zafiyet var mı
npm outdated                                    # eskiyen paketler (minor/major)
tail -n 40 /var/log/bionic/npm-audit.log        # haftalık otomatik tarama geçmişi

# 3) Sağlık kontrolü
npm run mail:check
npm run seo:audit -- https://bionicmotorsiklet.com
node --env-file=.env scripts/backup.js           # elle yedek (istenirse)
```

## Güncelleme kuralları

1. **Önce test ortamı, sonra canlı** — `npm run push:test` → doğrula → `npm run promote`.
2. **Küçük sürüm (patch/minor)** güncellemeleri: testler geçiyorsa doğrudan uygulanabilir.
3. **Major sürüm** yükseltmeleri ayrı bir geçiş işi olarak yapılır (aşağıdaki liste).
4. Her `promote` öncesi kod yedeği alınır; sorun olursa otomatik geri dönüş komutu çıktıda yazar.
5. **Canlı veri silinmez**; reset/clean betikleri `ALLOW_PROD_RESET=1` olmadan çalışmaz.

## Bekleyen major sürümler (planlı geçiş)

| Paket | Kurulu | Son | Not |
|---|---|---|---|
| express | 4.x | 5.x | Router/path sözdizimi değişiklikleri; ayrı test turu gerekir |
| ejs | 3.x | 7.x | Şablon motoru major atlama |
| multer | 1.x | 2.x | Dosya yükleme API'si |
| bcryptjs | 2.x | 3.x | Parola hash uyumluluğu test edilmeli |
| eslint | 9.x | 10.x | Yalnızca geliştirme bağımlılığı |

> Major geçişler **staging'de** denenir, testler + elle doğrulama sonrası canlıya alınır.

## İzleme

- **Admin → Sistem Testi**: şablonlar, veritabanı, ayarlar, Paratika, e-posta (SMTP), SEO, yedekler
- **PM2 logları**: `pm2 logs bionic --lines 100`
- **Uygulama hata günlüğü**: `/var/www/bionic/logs/error.log`
- **Disk**: `df -h /` (uyarı eşiği %80)
