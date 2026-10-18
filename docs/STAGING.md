# TEST (STAGING) ORTAMI — çalışma akışı

Canlı müşteri kullanımına açıldığı için **hiçbir değişiklik doğrudan canlıda denenmez.**
Sıra her zaman şudur:

```
yerel değişiklik  →  TEST (test.bionicmotorsiklet.com)  →  doğrula  →  CANLI (bionicmotorsiklet.com)
```

## Ortamlar

| | CANLI | TEST (staging) |
| --- | --- | --- |
| Adres | `https://bionicmotorsiklet.com` | `https://test.bionicmotorsiklet.com` |
| Sunucu dizini | `/var/www/bionic` | `/var/www/bionic-test` |
| PM2 süreci | `bionic` | `bionic-test` |
| Port | `3000` | `3100` |
| Veritabanı | `/var/lib/bionic/data/app.db` | `/var/lib/bionic-test/data/app.db` |
| Yedekler | `/var/backups/bionic` | `/var/backups/bionic-test` |
| `.env` | canlı değerler | **ayrı** (canlı bilgi YOK) |
| Paratika | `PROD` (gerçek tahsilat) | `SIMULATE=1` (**gerçek tahsilat imkânsız**) |
| Off-site yedek (R2) | açık | kapalı |

İki ortam **tek sunucuda** ama tamamen ayrıdır: ayrı dizin, ayrı port, ayrı veritabanı, ayrı PM2
süreci, ayrı nginx vhost. Test ortamı çökse/bozulsa bile canlı etkilenmez.

## Günlük akış

### 1) Değişikliği test ortamına gönder
```bash
npm run push:test
```
Yaptığı: yerel kodu paketler (`node_modules` gönderilmez — `sharp` yerel/native modüldür),
sunucuya yükler, `/var/www/bionic-test` içine açar (`.env` korunur), `bionic-test`'i yeniden başlatır.

### 2) Test et
`https://test.bionicmotorsiklet.com` — canlı veriye dokunmaz, gerçek ödeme almaz.

### 3) Doğruysa canlıya al
```bash
npm run promote        # onay ister; ya da: npm run promote -- -Yes
```
Yaptığı:
1. Canlı kodun tam yedeğini alır → `/var/backups/bionic/code-<tarih>.tar.gz`
2. Kodu test ortamından canlıya kopyalar (`.env` ve **veri asla kopyalanmaz**)
3. Canlıyı yeniden başlatır (~5 sn kesinti)
4. Sağlık kontrolü yapar; **başarısızsa otomatik geri alır**

### 4) Sorun çıkarsa geri dön
```bash
ssh -i ~/.ssh/bionic_oracle ubuntu@130.61.231.148 \
  "tar -xzf /var/backups/bionic/code-<tarih>.tar.gz -C /var/www/bionic && pm2 restart bionic"
```

## Yardımcı komutlar (sunucuda, `/var/www/bionic-test`)

| Komut | Ne yapar |
| --- | --- |
| `npm run push:test` (yerelde) | Yerel kodu test ortamına yükler |
| `npm run promote` (yerelde) | Test edilen kodu canlıya uygular (yedek + geri alma) |
| `bash deploy/reset-test.sh --evet` | Test veritabanını **temiz baseline**'a döndürür |
| `bash deploy/snapshot-prod-db.sh --evet` | **Canlı verinin kopyasını** test ortamına alır (gerçekçi test) |
| `pm2 restart bionic-test` | Test uygulamasını yeniden başlatır |
| `pm2 logs bionic-test` | Test uygulaması logları |

## Kurallar (önemli)

1. **Canlıda deneme yapılmaz.** “Küçük bir değişiklik” bile önce test ortamına gider.
2. **Test ortamına canlı Paratika bilgisi yazılmaz.** `PARATIKA_SIMULATE=1` kalır; asla canlı
   üye işyeri (`10013443`) bilgisi girilmez. Test için entegrasyon (test) üye işyeri kullanılır.
3. **Canlı `.env` kopyalanmaz.** Test `.env` dosyası ayrıdır ve `DATA_DIR=/var/lib/bionic-test/data`
   gösterir.
4. **`reset`/`backup` betikleri** test ortamında `PM2_APP=bionic-test` okur → yanlışlıkla canlıyı
   durduramaz.
5. **Test ortamında gerçek veri** varsa (snapshot alındıysa) KVKK gereği iş bitince
   `deploy/reset-test.sh` ile temizlenir.
6. Test alt alanı `noindex, nofollow` ile arama motorlarına kapalıdır ve `X-Env-Test: yes`
   başlığı döner (hangi ortamda olduğunuzu karıştırmayın).

## Kurulum kaydı (18.10.2026)

- `/var/www/bionic-test`: canlı kodun kopyası (`.env` hariç), `node_modules` dahil.
- Veritabanı: canlı baseline'dan oluşturuldu (temiz başlangıç) + canlı görseller kopyalandı.
- PM2: `bionic-test` (port 3100), `pm2 save` yapıldı (sunucu açılışında otomatik başlar).
- nginx: `/etc/nginx/sites-available/bionic-test` → `test.bionicmotorsiklet.com` → `127.0.0.1:3100`.
- Test vhost dosyası **`sed` ile düzenlenmemelidir** (tırnak/encoding bozar); scp ile aktarılır.

### Kalan adım: test alt alanı için DNS + SSL

HSTS (`includeSubDomains`) açık olduğu için test alt alanının da **geçerli sertifikası** olmalı:

1. DNS: `test.bionicmotorsiklet.com` → `130.61.231.148` (A kaydı)
2. ```
   sudo certbot --nginx -d test.bionicmotorsiklet.com --redirect
   ```
3. Doğrulama: `curl -sSI https://test.bionicmotorsiklet.com/ | head -1` → `200`

DNS eklenene kadar test ortamına `http://127.0.0.1:3100` (sunucu içinden) veya
`-H "Host: test.bionicmotorsiklet.com"` ile erişilebilir.
