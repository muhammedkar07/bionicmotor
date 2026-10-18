# BIONIC MOTOR — Dijital Bayi, Servis ve Satış Platformu

> **Tek cümlede:** Bionic Motor'un kurumsal web sitesini, bayi ve servis ağını, cari/muhasebe
> takibini ve online tahsilatını **tek bir sistemde** birleştiren, tarayıcıdan çalışan bulut
> platformu.

**Adres:** https://bionicmotorsiklet.com · **Erişim:** her yerden, kurulum gerektirmez (web tabanlı)

---

## 1. Bu sistem ne işe yarar?

Bugün bir motosiklet markasının günlük işleyişi genelde dağınık araçlarla yürür: telefonla
sipariş, WhatsApp'tan yedek parça talebi, Excel'de cari takibi, elden ödeme, kargo takibi…
Bu platform bunların tamamını **tek çatı altında** toplar:

| Sorun | Platformun çözümü |
| --- | --- |
| Bayi siparişi telefonda/WhatsApp'ta kalıyor | Bayi kendi panelinden **talebi sisteme giriyor**, durumunu takip ediyor |
| Cari bakiye Excel'de, kimin ne borcu var belirsiz | **Otomatik cari hesap**: sipariş dönüşünce borç, ödeme gelince alacak — bakiye anlık |
| Ödemeler elden/EFT, takibi zor | **Online kredi kartı tahsilatı** (3D Secure) + otomatik cariye işleme |
| Servis kayıtları kağıtta | Servis kendi panelinden **iş emri** ve **garanti kaydı** açıyor |
| Web sitesi ayrı, iş süreçleri ayrı | Site + bayi/servis panelleri + yönetim **aynı sistem** |
| "Kim ne zaman ne yaptı?" belirsiz | **Denetim kaydı**: tüm kritik işlemler kayıtlı |

---

## 2. Kimler, hangi ekranı kullanır?

Beş ayrı arayüz, tek sistem:

1. **Ziyaretçi sitesi** (bionicmotorsiklet.com) — müşteriler
2. **Bayi portalı** (`/bayi`) — yetkili satıcılar
3. **Servis portalı** (`/servis`) — yetkili servisler
4. **Online ödeme sayfası** (`/odeme`) — bayi/servis ve ziyaretçi
5. **Yönetim paneli** (`/admin`) — siz ve ekibiniz

---

## 3. Kurumsal web sitesi (ziyaretçi tarafı)

- **Ana sayfa:** dönen **slider** (kendi görsellerinizi yüklersiniz), kampanya kartları, öne çıkan modeller
- **Modeller:** model listesi + her modelin **detay sayfası** (teknik özellikler, fiyat, görsel)
- **Satış ve Servis noktaları:** il ve tür (Bayi / Servis) filtreli arama
- **Destek (SSS):** sıkça sorulan sorular, açılır-kapanır
- **Medya:** görsel galerisi, tıklayınca büyüyen görünüm (Esc / dışına tıkla ile kapanır)
- **Dijital katalog:** yüklediğiniz PDF'i ziyaretçi **doğrudan indirir**
- **Kurumsal / Hakkımızda, KVKK Aydınlatma Metni** ve diğer içerik sayfaları (panelden HTML olarak düzenlenir)
- **İletişim formu** ve **Bayilik başvuru formu** — KVKK onayı zorunlu, pazarlama izni opsiyonel
- **Online ödeme** bağlantısı (üye girişi ile)
- **Aydınlık / karanlık tema** (kullanıcı seçimi hatırlanır), tam **mobil uyumlu**
- **SEO hazır:** sitemap.xml, robots.txt, meta etiketler, Open Graph, yapısal veri (JSON-LD), özel 404 sayfası

---

## 4. Bayi portalı (B2B)

Bayi kendi kullanıcı kodu ve şifresiyle girer; **yalnızca kendi firmasının** verisini görür.

- **Sipariş talebi oluştur** — araç listesinden sepet yapar, tür/iade bilgisi ekler
- **Sipariş taleplerim** — durum takibi (Beklemede → Siparişe Dönüştürüldü → İptal)
- **Stoklarım** — kendisine teslim edilmiş araçların listesi
- **Hesap özeti (cari)** — devir, dönem içi hareketler, bakiye; **tarih aralığı filtresi**
- **Yedek parça siparişi** — ürün görselli katalog, sepet, **kredi kartı / havale / nakit**,
  **cari alacağın (bakiyenin) sipariş bedelinden otomatik düşülmesi**
- **Yedek parça hesap ekstresi** — ayrı cari takibi
- **Garanti kayıtları** — şase numarasıyla sorgu
- **Toptan fiyat listesi** — ürün görselli
- **Duyurular** — okunmamış bildirim göstergesi
- **Online ödeme** — kart ile borç ödeme
- **Firma değiştir** — birden çok firması olan kullanıcılar için

---

## 5. Servis portalı

- **İş emri oluştur** — şase, km, arıza/işlem açıklaması ve **fotoğraflı** kayıt
- **İş emirlerim** — durum takibi (Beklemede / Tamamlandı), yönetici notu
- **Garanti kaydı oluştur** ve **garanti kayıtları** sorgulama
- **Yedek parça siparişi** + **yedek parça ekstresi**
- **Hesap özeti** — cari takibi
- **Online ödeme**

---

## 6. Online ödeme (kredi kartı / havale / EFT)

- **Her şey TL ve tek çekim**; taksit seçimi bankanın Paratika sayfasında yapılır
- **3D Secure** ile kart tahsilatı — **kart bilgisi sistemimize hiç girmez** (PCI yükü yok)
- Ödeme **bayi panelinden**, **servis panelinden** veya **sitedeki ödeme sayfasından** yapılabilir
- Tahsilat **sunucudan sunucuya doğrulanır** (kullanıcının "ödedim" demesine güvenilmez)
- Onaylanan ödeme **aktif firmanın carisine otomatik alacak** işlenir (mükerrer kayıt olmaz)
- **Ödeme sonrası yönlendirme:** panelden yapıldıysa **hesap hareketlerine**, siteden yapıldıysa **ana sayfaya** — kullanıcı **tekrar giriş yapmak zorunda kalmaz**
- **Havale/EFT bildirimi** — gönderen adı ve açıklama ile kayıt
- **Otomatik mutabakat:** dönüş (callback) kaybolsa bile onaylı ödemeler **dakikalar içinde** yakalanıp cariye işlenir — **tahsilat kaybolmaz**
- **Yarım kalan işlemler:** ödeme sayfasını terk edip tamamlamayan kullanıcının kaydı **3 dakika sonra otomatik "İptal"** edilir; **ona bağlı yedek parça siparişi de** düşer (listede yarım iş birikmez)

---

## 7. Yönetim paneli (18 modül)

Tek panelden tüm işletme yönetilir:

**Bayi yönetimi:** Firmalar · Bayi kullanıcıları · Sipariş talepleri · **Hesap hareketleri** · Duyurular
**Satış sonrası:** Ürünler/Fiyat listesi (görselli) · Garanti kayıtları · İş emirleri · Yedek parça siparişleri · Online ödemeler
**Web sitesi:** Ana sayfa slider · Kampanyalar · Modeller · SSS · Satış/Servis noktaları · Sayfalar (HTML) · Dijital katalog
**Gelen kutusu:** İletişim mesajları · Bayilik başvuruları
**Sistem:** Site ayarları · Araç & yedek parça stokları · **Denetim kaydı** · Yönetici kullanıcıları + yetkilendirme · **Sistem testi**

Panel yetenekleri:
- **Arama, tarih aralığı filtresi ve bayi filtresi** tüm listelerde; **özet kartlar** seçilen döneme göre hesaplanır
- **Menüyü sürükle-bırak** ile sıralama, sayfa bazlı izinler (süper yönetici / sınırlı yönetici)
- **Stok yönetimi:** merkez stok + bayi bazlı stok, sipariş dönüşünce **stok otomatik düşer**
- **Hesap hareketleri:** borç / alacak / çek-senet (vadeli takip), **storno** (kayıt silinmez, iz kalır)
- **Sistem testi:** tek tuşla tüm kritik bileşenleri (veritabanı, ödeme, yedekleme, sayfalar, güvenlik) denetler

---

## 8. Cari / muhasebe motoru

- Firma bazlı **iki ayrı cari**: normal hesap (**ana**) ve **yedek parça (parça)**
- **Devir bakiyesi** ile başlar; bakiye = devir + borçlar − alacaklar
- **Otomatik kayıt:** sipariş "Siparişe Dönüştürüldü" olunca **borç**, ödeme tahsil edilince **alacak**
- **Çek / senet** takibi: vade tarihi, banka, çek no; vadesi gelmemiş çek **"bilgi"** kaydıdır ve **bakiyeyi etkilemez** (karşılıksız çek riskine karşı)
- **Ekstre:** tarih aralığı seçilir; dönem başı bakiye, dönem içi satış/kart/çek toplamları ve dönem sonu bakiye anında hesaplanır
- **Finansal kayıtlar fiziksel olarak silinmez** ("storno" ile iptal edilir) — denetim izi korunur
- Tüm hesaplamalar **mükerrer kayıt üretmeyecek** şekilde (idempotent) çalışır

---

## 9. Güvenlik

- **HTTPS / SSL** (Let's Encrypt, otomatik yenileme) + HSTS
- **Giriş denemesi sınırlama** (kaba kuvvet saldırısına karşı)
- **CSRF koruması** tüm formlarda, **CSP (nonce'lu)** ile içerik güvenliği, XSS temizleme
- **Yetki matrisi:** her yönetici yalnızca izinli sayfalara erişir
- **Dosya yükleme doğrulaması:** dosya türü **içeriğinden** anlaşılır (uzantıya güvenilmez)
- **Denetim kaydı:** girişler, kayıt değişiklikleri, ödeme işlemleri, stornolar kim-ne-zaman bilgisiyle saklanır
- **Oturum güvenliği:** güvenli çerezler, oturum yenileme, süre aşımı

---

## 10. Yedekleme ve iş sürekliliği

- **Saatlik otomatik yedek** — veritabanı **+ yüklenen görseller**
- **Şifreli** (AES-256-GCM) — yedek dosyaları açılsa bile okunamaz
- **Sunucu dışına otomatik yükleme** (Cloudflare R2) — sunucu tamamen kaybedilse bile veri durur
- **Rotasyon:** 24 saatlik + 30 günlük + 12 aylık yedek saklanır
- **Bütünlük doğrulaması:** her yedek açılıp tablo sayısı doğrulanır
- **Tam taşıma paketi:** tek komutla "kod + veri + ayarlar" paketi alınır, **başka sunucuya taşınabilir** (sunucuya bağımlılık yok)
- Yeniden başlatma/açılışta servisler **otomatik** ayağa kalkar

---

## 11. Teknik altyapı

| | |
| --- | --- |
| **Çalışma biçimi** | Web tabanlı (tarayıcı), kurulum gerektirmez |
| **Sunucu** | Oracle Cloud (Ubuntu) — istenen herhangi bir sunucuya taşınabilir |
| **Teknoloji** | Node.js + SQLite · nginx · PM2 · Let's Encrypt |
| **Veri tabanı** | 30 tablo, ilişkisel yapı |
| **Ölçek** | Bu işletme ölçeği için tek sunucu yeterli; yedekleriyle taşınabilir |
| **Görsel işleme** | Otomatik boyutlandırma/sıkıştırma, telefon fotoğrafı (HEIC) dönüşümü, **tek renkli arka planı şeffafa çevirme** |

---

## 12. Kalite ve bakım altyapısı

- **Test ortamı (staging):** canlıdan tamamen ayrı bir kopya üzerinde denenir, **canlı asla riske atılmaz**
- **Tek komutla yayına alma:** yeni sürüm önce test ortamında doğrulanır, sonra canlıya alınır — **canlı kodun otomatik yedeği alınır**, sorun çıkarsa **otomatik geri dönülür**
- **34 otomatik birim testi** + **~50 maddelik duman testi** (tüm sayfalar, formlar, yetki kontrolleri, paneller)
- **Canlıda silme koruması:** veri silme/geri yükleme betikleri canlıda **kilitli** — kazara veri kaybı imkânsız
- Kod sürüm takibi (git) ile her değişiklik kayıt altında

---

## Rakamlarla proje

| | |
| --- | --- |
| Özel yazılmış kod | **~10.000 satır** |
| Ekran şablonu | 63 |
| Veritabanı tablosu | 30 |
| Yönetim modülü | 18 |
| Sayfa/endpoint | 96 rota |
| Otomatik test | 34 birim + ~50 duman kontrolü |
| Arayüz | 5 (site, bayi, servis, ödeme, yönetim) |

---

## İşletmeye sağladığı faydalar

1. **Zaman tasarrufu:** sipariş, stok, cari ve tahsilat tek yerden — telefon/Excel trafiği biter
2. **Tahsilat hızı:** bayiler borcunu **7/24 online kartla** ödeyebilir; ödeme anında cariye işlenir
3. **Şeffaflık:** her bayi kendi bakiyesini, siparişini ve ekstresini kendisi görür → "benim borcum ne?" telefonları azalır
4. **Hata azalması:** cari kayıtları elle tutulmaz, otomatik oluşur; mükerrer kayıt olmaz
5. **Marka güveni:** profesyonel kurumsal site + karanlık/aydınlık tema + mobil uyumlu yapı
6. **Süreklilik:** saatlik şifreli + sunucu dışı yedek ve test ortamı sayesinde kesinti/veri kaybı riski minimum
7. **Büyüyebilirlik:** yeni bayi, servis, model, sayfa, kampanya **panelden** eklenir — yazılımcıya ihtiyaç yok

---

## Kapsam dışı (şu an dâhil değil)

Dürüst olmak adına, mevcut sürümde **olmayan** ve ayrıca istenirse eklenebilecek konular:

- **e-Fatura / e-Arşiv** entegrasyonu ve muhasebe programı (Logo, Mikro vb.) bağlantısı
- **Kargo / lojistik** entegrasyonu ve kargo takibi
- **SMS / e-posta** otomatik bildirimleri
- **Taksit / komisyon** yönetimi (taksit seçimi Paratika'nın ödeme sayfasında yapılıyor)
- **İngilizce / çoklu dil**
- **Mobil uygulama** (site mobil uyumludur, uygulama yoktur)
- Çok depolu/çok lokasyonlu gelişmiş **ambar yönetimi**

> Bu başlıklar ayrı birer geliştirme kalemidir; sistem bunlara açık bir mimariyle kurulmuştur.

---

*Bu doküman Bionic Motor dijital platformunun tanıtım özetidir. Teknik ayrıntılar, kurulum ve
işletim bilgileri için `DEPLOY.md`, `docs/STAGING.md` ve `docs/PARATIKA.md` dosyalarına bakılabilir.*
