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
  `TRUST_PROXY=1` (nginx/IIS arkasında), `DATA_DIR`, `UPLOAD_DIR`.
- Kalıcı veri (önemli): Render/Railway gibi platformlarda dosya sistemi her deploy'da sıfırlanır. Kalıcı bir disk (volume) bağlayıp `DATA_DIR` ve `UPLOAD_DIR` değişkenlerini o yola verin (örn. `DATA_DIR=/var/data`, `UPLOAD_DIR=/var/data/uploads`). Aksi halde panelden girilen veriler deploy sonrası kaybolur.
- Yedek: `npm run backup` ile tutarlı bir SQLite kopyası alınır (varsayılan `backups/` klasörü).
  Ayrıca `UPLOAD_DIR` (varsayılan `public/uploads/`) klasörünü de yedekleyin.
- Hatalar `logs/error.log` dosyasına da yazılır.
- Online ödeme: kart bilgileri saklanmaz; gerçek sanal POS entegrasyonu henüz yapılmadı
  (durum "Sanal POS Bekliyor"). Kart seçilen yedek parça siparişi tahsil edilmiş sayılmaz;
  sipariş "Beklemede" olarak kaydedilir ve yönetici onayı bekler.
