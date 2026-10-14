# Bionic — Kurumsal Site + Bayi Paneli + Online Ödeme + Yönetim Paneli

Node 24 + Express + EJS + yerleşik SQLite (`node:sqlite`). Harici veritabanı gerekmez.

## Çalıştırma
    npm install
    cp .env.example .env   # (Windows: copy .env.example .env) ve değerleri düzenleyin
    npm start              # http://localhost:3000
    npm test               # yerleşik test runner (harici bağımlılık gerekmez)

İlk açılışta boş veritabanında yönetici hesabı oluşturulur (`data/app.db`).

- **Canlıda (`NODE_ENV=production`)** `ADMIN_PASSWORD` tanımlı değilse uygulama **başlatılmaz**.
  Parola en az 14 karakter, bir büyük/küçük harf, bir rakam ve bir simge içermelidir.
- Geliştirmede `ADMIN_PASSWORD` verilmezse politika uyumlu rastgele bir parola üretilir ve
  konsola yazılır.
- Demo bayi ve örnek finansal veriler yalnızca **`SEED_DEMO=1`** iken oluşturulur.

| Panel | Adres | Giriş |
|---|---|---|
| Site | `/` | – |
| Bayi paneli | `/bayi` | kullanıcı kodu `25895` / `demo1234Ab!` (yalnızca `SEED_DEMO=1`) |
| Online ödeme | `/odeme` | `demo@bayi.local` / `demo1234Ab!` (yalnızca `SEED_DEMO=1`) |
| Yönetim | `/admin` | `admin` / `ADMIN_PASSWORD` |

## Canlıya alma
- Örnek ortam dosyası: `.env.example`. Kullanılan değişkenler: `PORT`, `NODE_ENV`,
  `ADMIN_PASSWORD` (ilk kurulum), `SEED_DEMO`, `COOKIE_SECURE=1` (HTTPS arkasında),
  `TRUST_PROXY=1` (nginx/IIS arkasında), `PUBLIC_URL` (ters proxy dış adres), `DATA_DIR`,
  `UPLOAD_DIR` ve Paratika için `PARATIKA_*` (bkz. aşağıdaki bölüm).
- Kalıcı veri (önemli): Render/Railway gibi platformlarda dosya sistemi her deploy'da sıfırlanır. Kalıcı bir disk (volume) bağlayıp `DATA_DIR` ve `UPLOAD_DIR` değişkenlerini o yola verin (örn. `DATA_DIR=/var/data`, `UPLOAD_DIR=/var/data/uploads`). Aksi halde panelden girilen veriler deploy sonrası kaybolur.
- Yedek: `npm run backup` ile tutarlı bir SQLite kopyası alınır (varsayılan `backups/` klasörü).
  Ayrıca `UPLOAD_DIR` (varsayılan `public/uploads/`) klasörünü de yedekleyin.
- Hatalar `logs/error.log` dosyasına da yazılır.

## Online ödeme (Paratika Web POS)
Kart ödemeleri **barındırılan ödeme sayfası** ile alınır: kart bilgisi sitemize hiç gelmez,
kullanıcı Paratika'nın güvenli sayfasına yönlendirilir (PCI kapsamı küçülür). Ödeme dönüşünde
durum kullanıcıya güvenilmeden **sunucudan sunucuya** doğrulanır ve onaylıysa tutar, ödemeyi
yapan **aktif firmanın** cari hesabına otomatik alacak işlenir (idempotent).

Kurulum:
1. Paratika üye işyeri bilgilerini `.env`'e girin: `PARATIKA_MERCHANT`, `PARATIKA_MERCHANT_USER`,
   `PARATIKA_MERCHANT_PASSWORD`, `PUBLIC_URL` (dönüş adresi için) ve canlıda `PARATIKA_ENV=prod`.
2. Paratika panelinde dönüş (RETURNURL) adresi otomatik gönderilir: `<PUBLIC_URL>/odeme/paratika/sonuc`.
3. Kart bilgisi alınmadığı için CVC/PCI saklama yükümlülüğü yoktur.
4. Test için `PARATIKA_SIMULATE=1` ile ağ isteği yapılmadan başarılı ödeme simüle edilebilir.

Cari kuralı: alacak, ödemenin **kendisi** (`amount`) kadardır; taksit komisyonu cari borcunu
değiştirmediği için alacağa eklenmez. Döviz ödemeler, ödeme anındaki kur ile TL'ye çevrilip işlenir.

Yedek parça siparişinde kart seçilirse: sanal POS tahsilatı yapılmadan sipariş **"Beklemede"**
kalır ve tahsil edilmiş sayılmaz; ödeme onayı/callback'i sonrası cariye işlenir.

## Yayına almadan demo (paylaşılabilir link)
Gerçek sunucu/domain gerekmeden, kendi bilgisayarından müşteriye gösterebileceğin geçici bir
**HTTPS link** üretebilirsin. Demo **ayrı bir veritabanı** (`demo-data/`) ile çalışır; gerçek
verilere dokunmaz ve kart ödemeleri Paratika **simülasyon** modundadır.

1. Bir terminalde demo sunucusunu başlat:
       npm run demo        # http://localhost:3000  (admin / DemoAdmin12345!x)
2. İkinci bir terminalde tüneli aç (Cloudflare; hesap gerekmez):
       npm run tunnel      # https://<rastgele>.trycloudflare.com linkini verir
3. Linki müşteriyle paylaş. Demo bitince iki terminali de kapat (Ctrl+C).

Girişler: Yönetim `admin / DemoAdmin12345!x` · Bayi `kullanıcı kodu 25895 / demo1234Ab!` ·
Online ödeme `demo@bayi.local / demo1234Ab!`.

Notlar:
- Tünel yalnızca iki komut açıkken çalışır ve her açılışta link değişir. Sabit link için
  Cloudflare "named tunnel" + kendi domain'iniz, ya da Render/Railway gibi kalıcı diskli
  barındırma kullanın.
- Linke sahip olan herkes panele erişebilir; hassas veri koymayın, iş bitince tüneli kapatın.
- `cloudflared` kurulu değilse: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
- Alternatif: ngrok (hesap gerekir) veya localtunnel. Kalıcı/uzun süreli demo için kalıcı diskli
  bir barındırma (Render/Railway) daha uygundur; `DATA_DIR` + `UPLOAD_DIR` volume'a verilmelidir.

