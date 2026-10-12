# Bionic — Kurumsal Site + Bayi Paneli + Online Ödeme + Yönetim Paneli

Node 24 + Express + EJS + yerleşik SQLite (`node:sqlite`). Harici veritabanı gerekmez.

## Çalıştırma
    npm install
    npm start        # http://localhost:3000

İlk açılışta örnek veri oluşturulur (`data/app.db`).

| Panel | Adres | Giriş |
|---|---|---|
| Site | `/` | – |
| Bayi paneli | `/bayi` | kullanıcı kodu `25895` / `demo1234` |
| Online ödeme | `/odeme` | `demo@bayi.local` / `demo1234` |
| Yönetim | `/admin` | `admin` / `admin123` |

**Canlıya almadan önce** admin parolasını değiştirin (Admin → Parola Değiştir) ve demo bayi kullanıcısını silin/güncelleyin.

## Canlıya alma
- Ortam değişkenleri: `PORT`, `ADMIN_PASSWORD` (ilk kurulum), `COOKIE_SECURE=1` (HTTPS arkasında), `TRUST_PROXY=1` (nginx/IIS arkasında).
- Kalıcı veri (önemli): Render/Railway gibi platformlarda dosya sistemi her deploy'da sıfırlanır. Kalıcı bir disk (volume) bağlayıp `DATA_DIR` ve `UPLOAD_DIR` değişkenlerini o yola verin (örn. `DATA_DIR=/var/data`, `UPLOAD_DIR=/var/data/uploads`). Aksi halde panelden girilen veriler deploy sonrası kaybolur.
- Yedek: `DATA_DIR/app.db` (varsayılan `data/app.db`) ve `UPLOAD_DIR` (varsayılan `public/uploads/`) klasörleri.
- Online ödeme: kart bilgileri saklanmaz; gerçek sanal POS entegrasyonu henüz yapılmadı (durum "Sanal POS Bekliyor").
