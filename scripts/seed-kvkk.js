'use strict';
// Kişisel Bilgi Güvenliği (KVKK Aydınlatma Metni) sayfasını günceller.
// Kullanım:  node --env-file=.env scripts/seed-kvkk.js
const { db } = require('../db');

const BODY = [
  '<h3>Bionic Motor Kişisel Verilerin İşlenmesine İlişkin Aydınlatma Metni</h3>',
  '<p>6698 sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) uyarınca, <strong>Sancarlar Motor İthalat İhracat San. ve Tic. Ltd. Şti.</strong> (“Bionic Motor” / “Şirket”) olarak, veri sorumlusu sıfatıyla kişisel verilerinizi aşağıda açıklanan amaçlar ve hukuki sebepler çerçevesinde işlemekteyiz.</p>',
  '<h4>1. Veri Sorumlusunun Kimliği</h4>',
  '<p><strong>Veri Sorumlusu:</strong> Sancarlar Motor İthalat İhracat San. ve Tic. Ltd. Şti.<br>',
  '<strong>Adres:</strong> Merkez Mahallesi 52039 Sokak No:17/A, Akdeniz / Mersin<br>',
  '<strong>E-posta:</strong> info@bionicmotorsiklet.com · <strong>Telefon:</strong> 0544 733 73 73</p>',
  '<h4>2. İşlenen Kişisel Verileriniz ve Toplanma Yöntemleri</h4>',
  '<p>Web sitemiz (bionicmotorsiklet.com) üzerinden aşağıdaki kişisel verileriniz; tamamen veya kısmen otomatik olan ya da herhangi bir veri kayıt sisteminin parçası olmak kaydıyla otomatik olmayan yollarla (iletişim formları, bayi başvuru formları, test sürüşü/servis randevu talepleri, çerezler vb.) toplanmaktadır:</p>',
  '<ul>',
  '<li><strong>Kimlik Bilgileri:</strong> Ad, soyad, T.C. kimlik numarası (gerekli hâllerde).</li>',
  '<li><strong>İletişim Bilgileri:</strong> Telefon numarası, e-posta adresi, adres/şehir bilgisi.</li>',
  '<li><strong>Müşteri İşlem ve Talep Bilgileri:</strong> İlgilendiğiniz motosiklet modeli, bayilik talepleri, mesaj içeriğiniz, servis/test sürüşü randevu detayları.</li>',
  '<li><strong>İşlem Güvenliği ve Teknik Veriler:</strong> IP adresi, internet sitesi giriş-çıkış kayıtları, çerez (cookie) verileri, tarayıcı ve cihaz bilgileri.</li>',
  '</ul>',
  '<h4>3. Kişisel Verilerin İşlenme Amaçları</h4>',
  '<ul>',
  '<li>Web sitemiz üzerinden ilettiğiniz soru, talep, öneri ve şikâyetlerin değerlendirilmesi ve yanıtlanması,</li>',
  '<li>Motosiklet satış, teslimat, servis ve garanti süreçlerinin Yetkili Bayilerimiz ve Servislerimiz ağı aracılığıyla yürütülmesi ve koordinasyonu,</li>',
  '<li>Size en yakın bayiye veya ilgilendiğiniz modele yönelik yönlendirmelerin yapılması,</li>',
  '<li>Müşteri memnuniyeti ve destek süreçlerinin yönetilmesi,</li>',
  '<li>Açık rızanızın bulunması hâlinde; kampanya, indirim, yeni model lansmanları ve özel tekliflere ilişkin ticari elektronik ileti (SMS, e-posta vb.) gönderilmesi,</li>',
  '<li>Bilgi güvenliği süreçlerinin yürütülmesi ve web sitesi kullanım analizleri yapılması,</li>',
  '<li>Yasal mevzuattan kaynaklanan bilgi/belge saklama ve yetkili kurumlara bildirim yükümlülüklerinin yerine getirilmesi.</li>',
  '</ul>',
  '<h4>4. İşlenen Kişisel Verilerin Aktarıldığı Taraflar ve Aktarım Amaçları</h4>',
  '<p>Kişisel verileriniz, yukarıda belirtilen amaçların gerçekleştirilmesi doğrultusunda ve KVKK’nın 8. ve 9. maddelerine uygun olarak aşağıdaki üçüncü kişilere aktarılabilecektir:</p>',
  '<ul>',
  '<li><strong>Yetkili Bayiler ve Yetkili Servisler:</strong> Talebinizin (satış, test sürüşü, teknik destek, fiyat teklifi vb.) karşılanması amacıyla ilgili bölgedeki Bionic Motor yetkili bayilerine veya servislerine,</li>',
  '<li><strong>Hizmet Sağlayıcılar:</strong> Web sitesi altyapısı, sunucu/bulut hizmeti, e-posta/SMS gönderim hizmeti ve bilgi teknolojileri desteği alınan tedarikçilere,</li>',
  '<li><strong>Hukuken Yetkili Kurum ve Kuruluşlar:</strong> Yasal yükümlülüklerin yerine getirilmesi amacıyla adli ve idari makamlara, kolluk kuvvetlerine ve ilgili kamu kurumlarına.</li>',
  '</ul>',
  '<h4>5. Kişisel Veri Toplamanın Hukuki Sebepleri</h4>',
  '<p>Kişisel verileriniz, KVKK’nın 5. maddesinde yer alan aşağıdaki hukuki sebeplere dayanarak işlenmektedir:</p>',
  '<ul>',
  '<li>Kanunlarda açıkça öngörülmesi ve veri sorumlusunun hukuki yükümlülüğünü yerine getirebilmesi için zorunlu olması (mevzuattan doğan saklama ve işlem güvenliği yükümlülükleri),</li>',
  '<li>Bir sözleşmenin kurulması veya ifasıyla doğrudan doğruya ilgili olması (talep ettiğiniz hizmet veya ürün yönlendirmesinin yapılması),</li>',
  '<li>İlgili kişinin temel hak ve özgürlüklerine zarar vermemek kaydıyla, veri sorumlusunun meşru menfaatleri için veri işlenmesinin zorunlu olması (site güvenliği, müşteri ilişkileri yönetimi),</li>',
  '<li><strong>Açık Rıza:</strong> Pazarlama, bülten aboneliği ve ticari ileti gönderimi süreçlerinde alınan açık rızanız.</li>',
  '</ul>',
  '<h4>6. Kişisel Veri Sahibinin (İlgili Kişinin) Hakları</h4>',
  '<p>KVKK’nın 11. maddesi uyarınca, veri sahibi olarak Bionic Motor’a başvurarak aşağıdaki haklarınızı kullanabilirsiniz:</p>',
  '<ul>',
  '<li>Kişisel verilerinizin işlenip işlenmediğini öğrenme,</li>',
  '<li>Kişisel verileriniz işlenmişse buna ilişkin bilgi talep etme,</li>',
  '<li>Kişisel verilerin işlenme amacını ve bunların amacına uygun kullanılıp kullanılmadığını öğrenme,</li>',
  '<li>Yurt içinde veya yurt dışında kişisel verilerin aktarıldığı üçüncü kişileri bilme,</li>',
  '<li>Kişisel verilerin eksik veya yanlış işlenmiş olması hâlinde bunların düzeltilmesini isteme,</li>',
  '<li>KVKK’nın 7. maddesinde öngörülen şartlar çerçevesinde kişisel verilerin silinmesini veya yok edilmesini isteme,</li>',
  '<li>Düzeltme, silme ve yok edilme işlemlerinin verilerin aktarıldığı üçüncü kişilere bildirilmesini isteme,</li>',
  '<li>İşlenen verilerin münhasıran otomatik sistemler vasıtasıyla analiz edilmesi suretiyle aleyhinize bir sonucun ortaya çıkmasına itiraz etme,</li>',
  '<li>Kişisel verilerin kanuna aykırı olarak işlenmesi sebebiyle zarara uğramanız hâlinde zararın giderilmesini talep etme.</li>',
  '</ul>',
  '<h4>7. Başvuru Yöntemi</h4>',
  '<p>Yukarıda belirtilen haklarınızı kullanmak için taleplerinizi, “Veri Sorumlusuna Başvuru Usul ve Esasları Hakkında Tebliğ”e uygun olarak;</p>',
  '<ul>',
  '<li><strong>E-posta yoluyla:</strong> info@bionicmotorsiklet.com üzerinden,</li>',
  '<li><strong>Yazılı olarak:</strong> Merkez Mahallesi 52039 Sokak No:17/A, Akdeniz / Mersin adresine ıslak imzalı dilekçe ile</li>',
  '</ul>',
  '<p>iletebilirsiniz. Başvurunuz, talebin niteliğine göre en kısa sürede ve en geç <strong>30 (otuz) gün</strong> içinde ücretsiz olarak sonuçlandırılacaktır.</p>'
].join('\n');

const row = db.prepare('SELECT slug FROM pages WHERE slug=?').get('kisisel-bilgi-guvenligi');
if (row) {
  db.prepare('UPDATE pages SET body=? WHERE slug=?').run(BODY, 'kisisel-bilgi-guvenligi');
  console.log('Kişisel Bilgi Güvenliği sayfası güncellendi (' + BODY.length + ' krkt).');
} else {
  db.prepare('INSERT INTO pages(slug,title,body) VALUES(?,?,?)').run('kisisel-bilgi-guvenligi', 'Kişisel Bilgi Güvenliği', BODY);
  console.log('Kişisel Bilgi Güvenliği sayfası oluşturuldu.');
}
db.close();
