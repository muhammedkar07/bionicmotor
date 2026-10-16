# Paratika Sanal POS — Entegrasyon Notları

Bu dosya, Paratika API'siyle ilgili **test ortamında canlı deneyerek doğruladığımız**
sözleşmeyi kaydeder. Dokümantasyon sitesi otomatik erişime kapalı olduğu için
(`docs.paratika.com.tr` çözümlenmiyor; doküman 403 dönüyor) uç noktalar deneyle çıkarıldı.

## Uç noktalar (yalnızca POST)

| Ortam | Adres |
| --- | --- |
| Test (entegrasyon) | `https://entegrasyon.paratika.com.tr/paratika/api/v2` |
| Canlı (VPOS) | `https://vpos.paratika.com.tr/paratika/api/v2` |

- **Tek uç nokta:** Tüm işlemler bu adrese POST edilir; işlemi gövdedeki `ACTION` alanı belirler.
- `GET` istekleri yalnızca bir HTML bilgi sayfası döner.
- Gövde **form-encoded** (`application/x-www-form-urlencoded`) ve alan adları **BÜYÜK harf**.
- Kimlik bilgileri **her istekte gövdede** gönderilir:
  `MERCHANT` (üye işyeri numarası), `MERCHANTUSER` (API kullanıcı e-postası), `MERCHANTPASSWORD`.

## Yanıt biçimi (JSON)

```json
{
  "responseCode": "99",
  "responseMsg": "Declined",
  "errorCode": "ERR10010",
  "errorMsg": "İstekte zorunlu parametrelerden biri bulunamadı",
  "violatorParam": "MERCHANT"
}
```

- `violatorParam`, eksik/geçersiz alanı söyler — entegrasyon hatalarını ayıklamak için çok kullanışlı.
- Başarı kodu `responseCode = "00"` beklenir (SALE/QUERYTRANSACTION için doğrulanacak).

## Doğrulanan ACTION değerleri

| ACTION | Durum |
| --- | --- |
| `SESSIONTOKEN` | Geçerli (ödeme sayfası oturumu) |
| `QUERYTRANSACTION` | Geçerli (**sorgulama — `QUERY` DEĞİL**) |
| `SALE` | Geçerli |
| `REFUND` | Geçerli |

Geçersiz çıkanlar: `QUERY`, `TRANSACTIONQUERY`, `GETTRANSACTION`, `ORDERQUERY`, `CANCEL`, `LIST`
(`ERR10056 – Geçersiz API isteği belirtilmiş`).

## Doğrulanan zorunlu alanlar

- Tüm istekler: `MERCHANT`, `MERCHANTUSER`, `MERCHANTPASSWORD`.
- `SESSIONTOKEN`: `SESSIONTYPE`, `AMOUNT`, `CURRENCY`, `ORDERID`, `RETURNURL`.
- `SALE`: `MERCHANTPAYMENTID`.
- `REFUND`: `PGTRANID`.

## Hâlâ netleşmesi gerekenler

1. **`MERCHANT` (üye işyeri numarası)** — sayısal; panelden/hoş geldin e-postasından alınmalı.
   Bu alan olmadan gerçek işlem yapılamıyor (`violatorParam: MERCHANT`).
2. **`SESSIONTYPE` geçerli değeri** — `PAYMENT` ve denenen ~60 değer reddedildi
   (`ERR10128 – Geçersiz parametre değeri`). Dokümandaki "Ödeme Sayfası" sayfasından alınmalı.
3. **Ödeme sayfası (HPP) URL'i** — `SESSIONTOKEN` yanıtındaki `token` ile yönlendirilecek adres.
4. **SALE / 3D dönüş alanları ve `HASH` imza doğrulaması** — dokümandan alınacak.
5. Kart verisinin bizden geçip geçmeyeceği (DirectPost) **veya** barındırılan sayfa (HPP) tercihi.

## Notlar

- Kart bilgisi barındırılan ödeme sayfasında kalırsa **PCI kapsamı küçülür**; HPP önerilir.
- `PARATIKA_SIMULATE=1` iken hiçbir ağ isteği yapılmaz (geliştirme/test).
- Adaptör: `lib/paratika.js` — `cfg()`, `isConfigured()`, `startSession()`, `query()`.
