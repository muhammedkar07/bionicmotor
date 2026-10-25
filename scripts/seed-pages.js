'use strict';
// Yer tutucu (kısa) sayfa metinlerini genel-geçer içerikle doldurur.
// Yalnızca gövdesi KISA (yer tutucu) olan sayfaları günceller; elle yazılmış uzun metinleri ezmez.
// Kullanım:  node --env-file=.env scripts/seed-pages.js
const { db } = require('../db');

const COMPANY = 'Sancarlar Motor İthalat İhracat San. ve Tic. Ltd. Şti.';
const TEL = '0544 733 73 73';
const MAIL = 'info@bionicmotorsiklet.com';

const PAGES = {
  'hizmet-sozlesmesi': [
    '<h3>Hizmet Sözleşmesi</h3>',
    '<p>İşbu Hizmet Sözleşmesi, <strong>' +
      COMPANY +
      '</strong> (“Şirket”) ile web sitemiz ve dijital kanallarımız üzerinden hizmet alan kullanıcı (“Kullanıcı”) arasında akdedilmiştir. Siteyi kullanarak ve/veya sipariş oluşturarak işbu sözleşme şartlarını kabul etmiş sayılırsınız.</p>',
    '<h4>1. Konu ve Kapsam</h4><p>Sözleşme; Bionic Motor markalı ürün ve hizmetlere ilişkin bilgilendirme, sipariş, satış ve satış sonrası hizmet süreçlerinin genel çerçevesini belirler.</p>',
    '<h4>2. Tarafların Yükümlülükleri</h4><p>Kullanıcı, verdiği bilgilerin doğru ve güncel olduğunu kabul eder. Şirket, sunulan hizmetlerin mevzuata ve iyi niyet kurallarına uygun ifasını taahhüt eder.</p>',
    '<h4>3. Sipariş ve Fiyatlandırma</h4><p>Ürün fiyatları, kampanya ve stok durumuna göre değişebilir. Sipariş, ödemenin onaylanması ile geçerlilik kazanır.</p>',
    '<h4>4. Teslimat</h4><p>Teslimat süreleri; ürün, bölge ve yetkili satış noktasına göre farklılık gösterebilir. Gecikme hâlinde tarafınıza bilgi verilir.</p>',
    '<h4>5. Cayma Hakkı ve İade</h4><p>Cayma hakkı ve iade süreçleri, “İptal &amp; İade” sayfamızda belirtilen koşullara tabidir.</p>',
    '<h4>6. Sorumluluk</h4><p>Şirket; ürünlerin hatalı/harici müdahale ile kullanılmasından doğan zararlardan sorumlu değildir. Kullanıcı, ürünü kullanım kılavuzuna uygun kullanmayı kabul eder.</p>',
    '<h4>7. Uyuşmazlıkların Çözümü</h4><p>İşbu sözleşmeden doğan uyuşmazlıklarda <strong>Mersin</strong> mahkemeleri ve icra daireleri yetkilidir.</p>',
    '<h4>8. Yürürlük</h4><p>Sözleşme, Kullanıcı’nın siteyi kullanması ile yürürlüğe girer. Şirket, sözleşme şartlarını mevzuata uygun olarak güncelleyebilir.</p>',
    '<p>İletişim: <a href="mailto:' + MAIL + '">' + MAIL + '</a> · ' + TEL + '</p>'
  ].join('\n'),

  'iptal-iade': [
    '<h3>İptal &amp; İade Koşulları</h3>',
    '<p><strong>' +
      COMPANY +
      '</strong> olarak müşteri memnuniyetini önemsiyoruz. Aşağıda iptal ve iade süreçlerine ilişkin genel koşullar yer alır.</p>',
    '<h4>Cayma Hakkı</h4><p>Mesafeli satışlarda, teslim aldığınız ürünü <strong>14 gün</strong> içinde herhangi bir gerekçe göstermeksizin iade edebilirsiniz.</p>',
    '<h4>İade Şartları</h4><ul><li>Ürün, kullanılmamış ve orijinal ambalajında olmalıdır.</li><li>Ürünle birlikte verilen tüm aksesuar ve evraklar eksiksiz gönderilmelidir.</li><li>Ürün faturası/teslim belgesi iadeye eklenmelidir.</li></ul>',
    '<h4>İade Süreci</h4><p>İade talebiniz için ' +
      TEL +
      ' numaralı hattımızdan veya <a href="mailto:' +
      MAIL +
      '">' +
      MAIL +
      '</a> adresinden bizimle iletişime geçmeniz yeterlidir. Onay sonrası ürün, anlaşmalı kargo ile tarafımıza gönderilir.</p>',
    '<h4>Ücret İadesi</h4><p>İade edilen ürünün kontrolü sonrasında, ödeme yönteminize uygun şekilde <strong>14 gün</strong> içinde ücret iadesi yapılır.</p>',
    '<h4>İstisnalar</h4><p>Kullanılmış, hasar görmüş, kişiye özel üretilmiş veya hijyen açısından iadesi uygun olmayan ürünler iade kapsamı dışındadır.</p>',
    '<p>Detaylı bilgi ve başvuru için bize ulaşabilirsiniz: ' + TEL + ' · <a href="mailto:' + MAIL + '">' + MAIL + '</a></p>'
  ].join('\n'),

  'kisisel-bilgi-guvenligi': [
    '<h3>Kişisel Verilerin Korunması (KVKK) Aydınlatma Metni</h3>',
    '<p>Veri Sorumlusu: <strong>' +
      COMPANY +
      '</strong>. 6698 sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) uyarınca kişisel verileriniz aşağıda açıklandığı şekilde işlenmektedir.</p>',
    '<h4>İşlenen Kişisel Veriler</h4><p>Ad-soyad, iletişim bilgileri, adres, e-posta, telefon, sipariş ve ödeme bilgileri gibi hizmet sunumuna ilişkin veriler işlenebilir.</p>',
    '<h4>İşleme Amaçları</h4><ul><li>Sipariş ve talep süreçlerinin yürütülmesi</li><li>Müşteri ilişkileri ve satış sonrası hizmetlerin sağlanması</li><li>Yasal yükümlülüklerin yerine getirilmesi</li><li>Talep ve önerilerin değerlendirilmesi</li></ul>',
    '<h4>Aktarım</h4><p>Kişisel verileriniz; yasal zorunluluklar dâhilinde yetkili kamu kurumları ve hizmet aldığımız iş ortaklarıyla, amaçla sınırlı olarak paylaşılabilir.</p>',
    '<h4>Haklarınız (KVKK md.11)</h4><p>Kişisel verilerinizin işlenip işlenmediğini öğrenme, düzeltilmesini, silinmesini veya anonim hâle getirilmesini talep etme ve mevzuatta belirtilen diğer haklarınız bulunmaktadır.</p>',
    '<h4>Başvuru</h4><p>Taleplerinizi <a href="mailto:' +
      MAIL +
      '">' +
      MAIL +
      '</a> adresine iletebilirsiniz. Ayrıca çerezler ve site kullanımına ilişkin bilgiler için “Çerez Politikası” sayfamızı inceleyebilirsiniz.</p>'
  ].join('\n'),

  garanti: [
    '<h3>Garanti İşlemleri</h3>',
    '<p>Bionic Motor markalı elektrikli ürünlerimiz, <strong>2 yıl</strong> garanti kapsamındadır.</p>',
    '<h4>Garanti Kapsamı</h4><p>Üretim hatalarından kaynaklanan arızalar; yetkili servislerimiz tarafından garanti kapsamında değerlendirilir.</p>',
    '<h4>Kapsam Dışı Durumlar</h4><ul><li>Kullanım kılavuzuna aykırı kullanım</li><li>Yetkili olmayan kişilerce yapılan müdahale/onarım</li><li>Doğal afet, darbe, sıvı teması gibi harici etkenler</li><li>Sarf malzemeleri ve normal aşınan parçalar</li></ul>',
    '<h4>Garanti Şartları</h4><p>Garanti hakkının geçerli olması için ürünün, ürün belgesi/garanti belgesi ile birlikte yetkili servislerimize başvurulması ve periyodik bakımlarının yapılmış olması gerekir.</p>',
    '<h4>Nasıl Başvurulur?</h4><p>Size en yakın yetkili servis için “Satış ve Servis” sayfamızı ziyaret edebilir veya ' +
      TEL +
      ' numaralı hattımızdan bilgi alabilirsiniz.</p>',
    '<p>İletişim: <a href="mailto:' + MAIL + '">' + MAIL + '</a></p>'
  ].join('\n'),

  'bakim-onarim': [
    '<h3>Bakım ve Onarım İşlemleri</h3>',
    '<p>Aracınızın güvenliği ve performansı için bakım işlemlerinin yetkili servislerimiz tarafından yapılmasını öneririz.</p>',
    '<h4>Periyodik Bakım</h4><p>Elektrikli araçlar benzinli modellere göre daha az bakım gerektirir. Yine de fren, lastik, batarya ve elektrik aksam kontrollerinin <strong>6–12 ayda bir</strong> yapılması önerilir.</p>',
    '<h4>Kontrol Edilen Başlıca Noktalar</h4><ul><li>Batarya ve şarj sistemi</li><li>Fren sistemi ve fren hidroliği</li><li>Lastikler ve jantlar</li><li>Elektrik/elektronik aksam ve bağlantılar</li></ul>',
    '<h4>Onarım Süreci</h4><p>Servislerimiz; arıza tespitinin ardından iş emri açarak yapılacak işlemler ve süre hakkında tarafınıza bilgi verir. Onarım, onayınız sonrası gerçekleştirilir.</p>',
    '<h4>Randevu ve İletişim</h4><p>Yetkili servis noktalarımız için “Satış ve Servis” sayfamızı ziyaret edebilir veya ' +
      TEL +
      ' numaralı hattımızdan bilgi alabilirsiniz.</p>'
  ].join('\n'),

  medya: [
    '<h3>Medya</h3>',
    '<p>Bionic Motor hakkında basın ve medya talepleriniz için bizimle iletişime geçebilirsiniz.</p>',
    '<h4>Basın İletişimi</h4><p>Röportaj, tanıtım ve iş birliği talepleriniz için: <a href="mailto:' + MAIL + '">' + MAIL + '</a></p>',
    '<h4>Logolar ve Kurumsal Görseller</h4><p>Marka logomuzu ve kurumsal görsellerimizi yayınlarınızda kullanmak için öncelikle yazılı izin almanız gerekir. Taleplerinizi e-posta ile iletebilirsiniz.</p>',
    '<h4>Dijital Katalog</h4><p>Ürün kataloğumuza “Dijital Katalog” sayfamızdan ulaşabilirsiniz.</p>'
  ].join('\n'),

  'dijital-katalog': [
    '<h3>Dijital Katalog</h3>',
    '<p>Bionic Motor ürün kataloğumuza aşağıdaki kanallardan ulaşabilirsiniz.</p>',
    '<h4>Katalog Talebi</h4><p>Güncel dijital katalog talebinizi <a href="mailto:' +
      MAIL +
      '">' +
      MAIL +
      '</a> adresine iletebilir veya ' +
      TEL +
      ' numaralı hattımızdan bilgi alabilirsiniz.</p>',
    '<h4>Modeller</h4><p>Ürünlerimizin teknik özellikleri için “Modeller” sayfamızı inceleyebilir; satış ve servis noktalarımıza “Satış ve Servis” sayfamızdan ulaşabilirsiniz.</p>'
  ].join('\n')
};

let updated = 0;
for (const [slug, body] of Object.entries(PAGES)) {
  const row = db.prepare('SELECT body FROM pages WHERE slug=?').get(slug);
  const cur = row ? String(row.body || '') : '';
  if (row && cur.length < 200) {
    db.prepare('UPDATE pages SET body=? WHERE slug=?').run(body, slug);
    updated++;
    console.log('güncellendi: ' + slug + ' (' + cur.length + ' → ' + body.length + ' krkt)');
  } else if (!row) {
    db.prepare('INSERT INTO pages(slug,title,body) VALUES(?,?,?)').run(slug, slug, body);
    updated++;
    console.log('eklendi: ' + slug);
  } else {
    console.log('atlandı (zaten dolu): ' + slug);
  }
}
console.log('Sayfa güncellemesi: ' + updated);
db.close();
