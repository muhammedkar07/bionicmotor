# Paratika Sanal POS — Entegrasyon Notları

Bu dosya, Paratika'nın resmi entegrasyon dokümanından ve **entegrasyon (test) ortamında yapılan
canlı denemelerle** doğrulanan sözleşmeyi kaydeder. Doküman sitesi (`test.paratika.com.tr/docs` →
`/paratika/api/v2/integration`) yalnızca tarayıcı User-Agent ile açılabiliyor.

Üye işyeri (test): **10006273** — API kullanıcısı: `muhammedkar97@gmail.com`

## Uç noktalar (yalnızca POST)

| Amaç | Test (entegrasyon) | Canlı (VPOS) |
| --- | --- | --- |
| API | `https://entegrasyon.paratika.com.tr/paratika/api/v2` | `https://vpos.paratika.com.tr/paratika/api/v2` |
| HPP ödeme sayfası | `https://entegrasyon.paratika.com.tr/payment/{SESSIONTOKEN}` | `https://vpos.paratika.com.tr/payment/{SESSIONTOKEN}` |
| Direct POST 2D (MOTO) | `https://entegrasyon.paratika.com.tr/merchant/post/sale/{SESSIONTOKEN}` | `https://vpos.paratika.com.tr/merchant/post/sale/{SESSIONTOKEN}` |
| Direct POST 3D | `https://entegrasyon.paratika.com.tr/paratika/api/v2/post/sale3d/{SESSIONTOKEN}` | `https://vpos.paratika.com.tr/paratika/api/v2/post/sale3d/{SESSIONTOKEN}` |
| Canlı panel | `https://entegrasyon.paratika.com.tr/paratika/admin/login` | `https://vpos.paratika.com.tr/paratika/admin/login` |

- **Tek API uç noktası:** işlemi gövdedeki `ACTION` belirler.
- Gövde **form-encoded**, alan adları **BÜYÜK harf**, kimlik bilgileri **her istekte gövdede**:
  `MERCHANT`, `MERCHANTUSER`, `MERCHANTPASSWORD`.
- `GET` istekleri yalnızca bir bilgi HTML'i döner.

## Yanıt biçimi (JSON)

```json
{ "responseCode": "99", "responseMsg": "Declined", "errorCode": "ERR10010",
  "errorMsg": "İstekte zorunlu parametrelerden biri bulunamadı", "violatorParam": "MERCHANT" }
```

Başarı: `responseCode = "00"`. `violatorParam`, eksik/geçersiz alanı söyler.

## Seçilen akış: Ortak Ödeme Sayfası (HPP / Web POS)

1. **SESSIONTOKEN** alınır (sunucudan sunucuya).
2. Kullanıcı `https://<host>/payment/<sessionToken>` adresine yönlendirilir (**GET** yeterli;
   sayfa banka 3D adımını da yönetir). Kart bilgisi **bize hiç gelmez** → PCI kapsamı küçülür.
3. Paratika sonucu **RETURNURL**'e POST eder.
4. Sonuç, kullanıcıya güvenilmeden **QUERYTRANSACTION** ile sunucu tarafında doğrulanır.

> ⚠️ Bu üye işyeri **3D Secure zorunlu**: sunucudan sunucuya `SALE` çağrısı
> `ERR10154 "İşlem 3D kısıtlamasıyla başarısız olmuştur."` ile reddediliyor. Bu yüzden HPP kullanılır.

### SESSIONTOKEN isteği (doğrulandı)

```
ACTION=SESSIONTOKEN
SESSIONTYPE=PAYMENTSESSION        <-- geçerli değer (PAYMENT DEĞİL)
MERCHANT / MERCHANTUSER / MERCHANTPASSWORD
RETURNURL
MERCHANTPAYMENTID                 <-- benzersiz sipariş no
AMOUNT                            <-- "1.00"
CURRENCY                          <-- TRY (TL değil)
CUSTOMER                          <-- benzersiz müşteri no
CUSTOMERNAME / CUSTOMEREMAIL / CUSTOMERPHONE / CUSTOMERIP
ORDERITEMS                        <-- JSON, encode edilir; kalem toplamı AMOUNT ile eşleşmeli
```

- `ORDERITEMS` kalemleri: `productCode`, `name`, **`description` (zorunlu)**, `quantity`, `amount`.
  `description` eksikse: `ERR10128 ... violatorParam: ORDERITEMS:description`.

Başarılı yanıt: `{ "sessionToken": "...", "responseCode": "00", "responseMsg": "Approved" }`

### QUERYTRANSACTION (durum doğrulama)

```
ACTION=QUERYTRANSACTION
MERCHANTPAYMENTID                 (veya PGTranID; tarih aralığı için STARTDATE/ENDDATE "dd-MM-yyyy HH:mm")
```

Yanıt `transactionList[]` döner. `transactionType = "SALE"` kaleminin
`transactionStatus` değeri:

| Kod | Anlam |
| --- | --- |
| `AP` | Onaylandı (Approved) |
| `FA` | Başarısız (Failed) |
| `IP` | İşlemde (In Progress) |

Ek alanlar: `pgTranId`, `pgTranReturnCode`, `pgTranErrorCode`, `pgTranErrorText`, `pgApprCode`,
`amount`, `panLast4`, `bin`, `merchantCommissionRate`.

## Diğer doğrulanan ACTION'lar

| ACTION | Amaç | Zorunlu alanlar |
| --- | --- | --- |
| `SALE` | Sunucudan satış (3D zorunlu ise engellenir) | SESSIONTOKEN, CARDPAN, CARDEXPIRY, CARDCVV, NAMEONCARD; INSTALLMENTS |
| `PREAUTH` | Ön otorizasyon | aynı SALE alanları |
| `POSTAUTH` | Son otorizasyon | PGTRANID |
| `VOID` | İptal | MERCHANTPAYMENTID |
| `REFUND` | İade | MERCHANTPAYMENTID |
| `QUERYINSTALLMENT` | Taksit listesi | — |
| `QUERYCARD` | Kayıtlı kart sorgu | CUSTOMER veya CARDTOKEN |
| `QUERYBIN` | BIN sorgu | BIN veya CARDTOKEN |
| `QUERYMERCHANTCOMMISSION` | Üye işyeri komisyonları | — |
| `QUERYCUSTOMERCOMMISSION` | Müşteriye yansıtılan komisyon | — |

Kart alanları: `CARDPAN`, `CARDEXPIRY` (**mm.yy**, örn. `12.30`), `CARDCVV`, `NAMEONCARD`.

## Test kartları (dokümandan)

| Banka | Kart No | SKT | CVV |
| --- | --- | --- | --- |
| Ziraat-VISA | 4546711234567894 | 12/2026 | 000 |
| Ziraat-MASTER | 5401341234567891 | 12/2026 | 000 |
| AKBANK-VISA | 4355084355084358 | 12/2030 | 000 |
| TEB-VISA | 4402934402934406 | 12/2030 | 000 |
| HALKBANK-VISA | 4920244920244921 | 12/2030 | 001 |
| ISBANK-VISA | 4508034508034509 | 12/2030 | 000 |
| FINANSBANK-VISA | 4022774022774026 | 12/2030 | 000 |

Test ortamında bu üye işyerine tanımlı sanal POS'lar: **Halkbank** ve **İşbank** (test).

## Kod eşlemesi

- `lib/paratika.js` — `cfg()`, `isConfigured()`, `startSession()` (HPP), `query()` (QUERYTRANSACTION).
- `lib/pay.js` — `beginCard()`: SESSIONTOKEN + `payments` kaydı → HPP'ye yönlendirme.
- `routes/odeme.js` — `/odeme/paratika/sonuc` callback: QUERYTRANSACTION ile doğrulama ve
  **aktif firmanın** carisine idempotent alacak.

## Ortam değişkenleri

```
PARATIKA_MERCHANT=10006273
PARATIKA_MERCHANT_USER=muhammedkar97@gmail.com
PARATIKA_MERCHANT_PASSWORD=...
PARATIKA_ENV=test            # canlı için prod
PARATIKA_SIMULATE=0          # 1 = ağsız simülasyon (yalnızca geliştirme)
```

## Tam API v2 dokümanı (kritik)

Paratika'nın **asıl/tam** API dokümanı: `https://entegrasyon.paratika.com.tr/paratika/api/v2/doc`
(entegrasyon rehberinden çok daha detaylı: Direct POST 2D/3D, 3D Kimlik Doğrulama, OTP, hata kodları, test kartları.)

### İki AYRI ortam (ve ayrı API kullanıcıları)

| Ortam | API adresi |
| --- | --- |
| **Test Ortamı** | `https://test.paratika.com.tr/paratika/api/v2` |
| **Entegrasyon Ortamı** | `https://entegrasyon.paratika.com.tr/paratika/api/v2` |

`10006273` numaralı işyerinin API kullanıcısı **yalnızca Entegrasyon ortamında** geçerli.
Test ortamında aynı bilgiler `ERR10020 – Geçersiz kullanıcı bilgileri` döndürüyor →
dokümanın da dediği gibi **"Canlı ve Entegrasyon ortamları için ayrı API kullanıcısı"** gerekir.

### 3D adımı = Modirum ACS SİMÜLATÖRÜ → "Yes"e bas!

Entegrasyon/test ortamında 3D, **Modirum test ACS simülatörüne** gider
(`https://3ds-acs.test.modirum.com/...`). Sayfa aynen şunu der:

> "This screen allows you to simulate the different responses ACS can give to an
> authentication request. Please choose a response from the options below."

Butonlar: **`Yes`** (doğrulandı), `Attempt`, `No`, `Rejected`, `Unavailable`.

**Çözüm: 3D ekranında `Yes` butonuna bas.** Bundan sonra satış **AP (Onaylandı)** döner:
`responseCode=00`, `pgTranReturnCode=00`, `pgTranApprCode=<onay kodu>`.
(Bu adım atlanırsa işlem `IP`=işlemde takılı kalır veya `ERR10154`/`FA` olur.)

- Dokümandaki **"3D Güvenli Şifre = `123456`"** başka senaryolar için; bu simülatörde
  kullanıcı doğrudan "Yes"e basar.
- Canlı ortamda bu ekran yerine **banka ACS'si + gerçek SMS OTP** gelir.

### Doğrulanan hata/response kodları

| Kod | Anlam |
| --- | --- |
| `00` | Onaylı |
| `98` | Genel Hata |
| `99` | Reddedildi (banka/vPOS kaynaklı) |
| `ERR10020` | Geçersiz kullanıcı bilgileri |
| `ERR10046` | Kart geçerlilik tarihi geçersiz |
| `ERR10154` | İşlem 3D kısıtlamasıyla başarısız |
| `ERR10207` | OTP kodu bulunamadı |

3D kimlik doğrulama örnek cevabı: `{ sessionToken, auth3DToken, responseCode: "00", mdStatus: 1, mdErrorMsg: "Authenticated" }`.

### Notlar
- Test ortamında "yabancı banka kartı" hatası: işyerinin vPOS havuzunda o BIN yok demektir.
- İşyerindeki test vPOS'lar: Halkbank, İşbank, TEB, Akbank, Denizbank, Finansbank, Vakıfbank, Ziraat (+Maximobil).
  (Garanti YOK — Garanti test kartları bu işyerinde çalışmaz.)

