'use strict';
// Sıkça Sorulan Sorular (Bionic'e uyarlanmış). Idempotent: aynı soru varsa atlar.
// Kullanım:  node --env-file=.env scripts/seed-faqs.js
const { db } = require('../db');

const FAQS = [
  [
    'Bionic Motor ürünlerini nasıl temin edebilirim?',
    'Ürünlerimizi yalnızca yetkili satış noktalarımız (bayilerimiz) aracılığıyla temin edebilirsiniz. Fabrikadan doğrudan satışımız bulunmamaktadır. Size en yakın satış noktasına "Satış ve Servis" sayfamızdan ulaşabilirsiniz.'
  ],
  [
    'Ürünlerin garanti süresi ne kadardır?',
    'Tüm elektrikli modellerimizin garanti süresi 2 yıldır. Garanti koşulları ve kapsamı hakkında detaylı bilgi için yetkili servislerimizle iletişime geçebilirsiniz.'
  ],
  [
    'Yetkili servislere nasıl ulaşabilirim?',
    'bionicmotorsiklet.com adresindeki "Satış ve Servis" bölümünden, bulunduğunuz bölgedeki yetkili servislere harita üzerinden kolayca ulaşabilirsiniz.'
  ],
  [
    'Fabrikadan yedek parça temin edebilir miyim?',
    'Fabrikadan doğrudan yedek parça satışımız bulunmamaktadır. Yedek parça taleplerinizi yetkili servislerimiz aracılığıyla iletebilirsiniz.'
  ],
  [
    'Müşteri Hizmetleri\'ne nasıl ulaşabilirim?',
    '0544 733 73 73 numaralı hattımızdan veya info@bionicmotorsiklet.com e-posta adresimizden bize ulaşabilirsiniz. Ayrıca sosyal medya kanallarımızdan (Instagram, Facebook) öneri ve taleplerinizi iletebilirsiniz.'
  ],
  [
    'Elektrikli araç kullanmaya başlarken sürüş eğitimi almalı mıyım?',
    'Evet. Sürüş eğitimi almak, özellikle büyükşehirlerde trafikteki tehlike ve hatalara karşı doğru davranışı öğrenmek açısından hayat kurtarır. Güvenliğiniz için eğitim almanızı öneririz.'
  ],
  [
    'Hangi model ile başlamalıyım?',
    'İlk kez elektrikli bir araç kullanacaksanız, düşük güçlü E-Scoter modellerimizle başlamanızı öneririz. İhtiyaç ve kullanım amacınıza göre yetkili satış noktalarımız size en uygun modeli önerecektir.'
  ],
  [
    'Ekipman kullanmam gerekir mi?',
    'Küçükten büyüğe tüm modellerde mutlaka kask ve uygun koruyucu ekipman kullanmalısınız. Unutmayın; kask ve doğru ekipman hayat kurtarır.'
  ],
  [
    'Araç üzerinde modifikasyon yapılabilir mi?',
    'Araç üzerinde (motor gücü artırma veya orijinal parçaların değiştirilmesi gibi) modifikasyon yapılması güvenliği ve yasal düzenlemeleri ihlal edebilir. Yasalara uygun olmayan hiçbir değişiklik yapılmamalıdır.'
  ],
  [
    'ABS, CBS ve TCS nedir?',
    'ABS (Anti-Lock Braking System), ani frenlemede tekerleğin kilitlenmesini önleyerek sürücünün kontrolünü korur. CBS (Combined Braking System), tek fren uygulandığında fren basıncını ön ve arka arasında dengeli biçimde dağıtır. TCS (Traction Control System) ise çekiş kaybını ve patinajı önlemeye yardımcı olur; ABS ile birlikte çalışır.'
  ],
  [
    'Elektrikli araçlarda bakım gerekir mi?',
    'Elektrikli araçlar benzinli modellere göre çok daha az bakım gerektirir; motor yağı, yağ filtresi ve egzoz gibi bakım kalemleri yoktur. Yine de batarya, fren ve lastik kontrolleri için yetkili servislerimizde periyodik kontrol yaptırmanızı öneririz.'
  ],
  [
    'Elektrikli araç kullanmak için hangi ehliyet gerekir?',
    'İki, üç ve dört tekerlekli motorlu bisikletler (moped) için M sınıfı; belirli güç sınırlarını aşmayan iki ve üç tekerlekli motosikletler için A1 ve A2; daha yüksek güçlü motosikletler için A sınıfı ehliyet gerekmektedir. Aracınızın teknik özelliklerine göre hangi sınıfın gerektiğini yetkili satış noktalarımızdan öğrenebilirsiniz.'
  ]
];

const exists = db.prepare('SELECT 1 FROM faqs WHERE question=?');
const ins = db.prepare('INSERT INTO faqs(question,answer,sort,active) VALUES(?,?,?,1)');
let added = 0;
let skipped = 0;
FAQS.forEach(([q, a], i) => {
  if (exists.get(q)) {
    skipped++;
    return;
  }
  ins.run(q, a, i + 1);
  added++;
});
console.log(`SSS yüklendi: eklenen=${added} atlanan=${skipped} (toplam ${FAQS.length}) — tabloda ${db.prepare('SELECT COUNT(*) n FROM faqs').get().n}`);
db.close();
