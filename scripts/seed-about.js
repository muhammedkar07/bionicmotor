'use strict';
// "Hakkımızda / Kurumsal" sayfasının içeriğini Bionic Motor'a uyarlanmış metinle günceller.
// Kullanım:  node --env-file=.env scripts/seed-about.js
const { db } = require('../db');

const BODY = [
  '<h3>Hakkımızda</h3>',
  '<p>Bionic Motor; E-Bike ve motosiklet üretim ve satışına başlayan, sürdürülebilir büyüme stratejisi kapsamında daha kaliteli, daha ekonomik ve daha kolay hizmet verebilmek için kendisiyle yarışan, çıtasını her zaman yükselterek büyümeyi hedefleyen bir markadır.</p>',
  '<p>Bionic Motor; ürün çeşitliliği, tasarım farklılıkları, kalite anlayışı ve satış sonrası hizmetleri ile sektöre katma değer sağlamaya ve yeni açılımlar yaratmaya devam ediyor. Tüketici odaklı yaklaşımı ile sektörün ihtiyaç ve beklentilerini her noktada ürünlerine ve hizmetlerine en iyi şekilde yansıtan Bionic Motor, yeni eğilim ve trendleri öngörerek tüm üretim ve hizmet süreçlerini sürekli geliştiriyor.</p>',
  '<p>Yenilikçi çizgisi ile modern üretim ve pazarlama anlayışını sektördeki deneyimi ile birleştiren Bionic Motor, aynı zamanda motosiklet sektöründe standartları sürekli yükseltmeyi hedeflemektedir.</p>',
  '<h3>Vizyonumuz</h3>',
  '<p>Bionic Motor olarak; sürdürülebilir ve yenilikçi ulaşım çözümleri sunarak şehir içi ve şehirler arası mobiliteyi daha erişilebilir, çevre dostu ve ekonomik hale getirmek istiyoruz. Amacımız; müşterilerimize en kaliteli ürün ve hizmetleri sunarak motosiklet ve elektrikli araç pazarında öncü bir marka olmaktır.</p>',
  '<h3>Misyonumuz</h3>',
  '<p>Müşteri odaklı bir yaklaşımla; yenilikçi tasarım, yüksek performans ve çevreci teknolojiyi bir araya getirerek herkes için güvenli ve keyifli bir sürüş deneyimi sağlıyoruz. Bionic Motor olarak kullanıcılarımızın ihtiyaçlarını dinliyor, ürün gamımızı sürekli geliştiriyor ve sürdürülebilir bir geleceğe katkıda bulunmak için çalışıyoruz.</p>',
  '<h3>Kalite Politikamız</h3>',
  '<p><strong>Sancarlar Motor İthalat İhracat San. ve Tic. Ltd. Şti.</strong> olarak; 2, 3 ve 4 tekerlekli motosikletler ile elektro-mobil araç üretiminde yenilikçi, çevreci ve müşteri odaklı yaklaşımımızla sektörde öncü olmayı hedefliyoruz. Kalite politikamızın temelini şu ilkeler oluşturur:</p>',
  '<ul>',
  '<li><strong>Sıfır Hata Hedefi:</strong> Tüm dünyada geçerli olan "sıfır hata" hedefi ile üretim ve montaj faaliyetleri yürütmek, süreçlerimizin temel politikası ve hassasiyetidir.</li>',
  '<li><strong>Müşteri Memnuniyeti:</strong> Her çalışanımız, talep edilen ürün ve hizmetlerin kalitesini korumakla sorumlu ve yükümlüdür. Müşterinin talep ettiği ürünü zamanında ve standart kalitede sağlamak temel sorumluluğumuzdur.</li>',
  '<li><strong>Çalışan Memnuniyeti:</strong> Çalışanlarımızın kalite bilincini ve motivasyonunu artırmak işletmemizin önemli bir görevidir. Çalışanlarımız firmamızın en kıymetli temel paydaşlarıdır. Bu kapsamda her çalışanımız politikamızı benimsemeli ve uygulamalıdır.</li>',
  '<li><strong>Doğal Kaynakların Korunması:</strong> Çevreye en az zarar veren yararlı teknolojileri güncel olarak takip ederek doğal kaynaklarımızı korumak ve oluşan atıkların uygun geri kazanım yöntemlerini belirleyerek bertarafına yardımcı olmak temel görev ve sorumluluğumuzdur.</li>',
  '<li><strong>Çevresel ve İSG Yaklaşım Sorumluluğumuz:</strong> Havaya, suya ve toprağa yapacağımız çevresel etkileri önceden tahmin etmek, önlemek, kontrol altında tutmak ve oluşan etkileri azaltmak ya da yok etmek öncelikli görevimizdir. Ayrıca her çalışanımızın güvenliğini sağlamak ve bunu temel bir yaşam felsefesi haline getirmek, onları bu konuda sürekli eğitmek ana sorumluluğumuzdur.</li>',
  '<li><strong>Yasalara ve Yükümlülüklere Uyum:</strong> Ulusal mevzuatlara ve standartlara uymayı taahhüt etmekte ve evrensel geçerliliği olan normları sağlamayı hedeflemekteyiz. Bu amaçla çalışmalarımızı ilgili kurum ve kuruluşlarla iş birliği içerisinde tamamlamaktayız.</li>',
  '<li><strong>Sürekli İyileştirme ve Gelişerek Değişme:</strong> Kalite anlayışımız; tüm süreç ve üretimimizin her aşamasında hata yapmayı ve oluşumunu önlemektir. Çalışanlarımız arasında bilgi alışverişi ve kalite kültürünün devamlılığı, sürekli iyileştirme için temel şartımızdır.</li>',
  '<li><strong>Bilgi Güvenliği:</strong> Firmamız; tüm çalışanlarımız, tedarikçi ve müşterilerimiz gibi paydaşlarımıza ait bilgilerin gizliliğine oldukça önem göstermekte ve bu konuda hassas davranmaktadır. Aynı hassasiyet ve titizliğin paydaşlarımızdan da bize karşı gösterilmesi temel beklentimizdir.</li>',
  '</ul>'
].join('\n');

const body = BODY;
const exists = db.prepare('SELECT slug FROM pages WHERE slug=?').get('kurumsal');
if (exists) {
  db.prepare('UPDATE pages SET body=? WHERE slug=?').run(body, 'kurumsal');
  console.log('Kurumsal sayfası güncellendi.');
} else {
  db.prepare('INSERT INTO pages(slug,title,body) VALUES(?,?,?)').run('kurumsal', 'Kurumsal', body);
  console.log('Kurumsal sayfası oluşturuldu.');
}
console.log('Uzunluk:', body.length, 'karakter');
db.close();
