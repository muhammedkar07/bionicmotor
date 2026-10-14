const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, set, tx } = require('../db');
const { passwordError } = require('../lib/core');

// Boş veritabanında ilk yöneticiyi ve (isteğe bağlı) demo verileri oluşturur.
// - Canlıda (NODE_ENV=production) ADMIN_PASSWORD tanımlı değilse uygulama başlatılmaz.
// - Demo bayi ve örnek finansal veriler yalnızca SEED_DEMO=1 iken oluşturulur.
function ensureSeed() {
  if (db.prepare('SELECT COUNT(*) c FROM admins').get().c > 0) return;

  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass && process.env.NODE_ENV === 'production') {
    throw new Error('Canlı ortamda (NODE_ENV=production) ADMIN_PASSWORD ortam değişkeni zorunludur. Uygulama başlatılmadı.');
  }
  const generated = !adminPass;
  const pass = adminPass || crypto.randomBytes(9).toString('base64url') + 'Aa1!';
  const pe = passwordError(pass);
  if (pe) throw new Error('ADMIN_PASSWORD parola politikasına uymuyor: ' + pe);
  const seedDemo = process.env.SEED_DEMO === '1';

  tx(() => {
    db.prepare('INSERT INTO admins(username,name,password_hash,is_super) VALUES(?,?,?,1)')
      .run('admin', 'Yönetici', bcrypt.hashSync(pass, 12));

    const S = {
      brand_1: 'Bionic ', brand_2: 'Motor', logo_image: '/static/img/bionic-logo.png',
      company: 'SANCARLAR MOTOR İTHALAT İHRACAT SAN. VE TİC. LTD. ŞTİ.',
      phone: '0544 733 73 73', email: 'info@bionicmotorsiklet.com',
      branch: 'MERKEZ',
      address: 'Merkez Mahallesi 52039 Sokak No:17/A Akdeniz / MERSİN',
      map_lat: '36.8000', map_lng: '34.6333',
      facebook: '#', instagram: '#', youtube: '#', eticaret_url: '#',
      meta_description: 'Bionic Motor — Mersin merkezli motosiklet ve scooter markası. Güncel modeller, yetkili bayi ve servis noktaları, online ödeme ve kampanyalar.',
      eur_rate: '55.1724', usd_rate: '49.2714',
      footer_note: '© Tüm hakları saklıdır.'
    };
    Object.entries(S).forEach(([k, v]) => set(k, v));

    const slide = db.prepare('INSERT INTO slides(title,subtitle,old_price,new_price,bg,sort) VALUES(?,?,?,?,?,?)');
    slide.run('SST125', 'FIRSATI YAKALA, YOLLARI KAÇIRMA! Şimdi tam sürüş zamanı.', '178.200₺', '111.500 TL', '#1d4e5f', 1);
    slide.run('DEV KAMPANYA', 'Kredi kartına 9-12 taksit fiyatı 138.200 TL. Kampanya stoklarla sınırlıdır.', '220.900₺', '138.200 TL', '#3b0d0d', 2);

    const model = db.prepare('INSERT INTO models(name,category,cc,power,gearbox,description,price,sort) VALUES(?,?,?,?,?,?,?,?)');
    model.run('SST125', 'Scooter', '125 cc', '11,3 HP', 'Otomatik', 'Sıvı soğutmalı, 10,5 L depolu maxi scooter.', 178200, 1);
    model.run('Cruiser 150', 'Motosiklet', '150 cc', '12 HP', 'Manuel', 'Şehir içi ve uzun yol için rahat sürüş.', 129900, 2);
    model.run('Urban 50', 'Scooter', '50 cc', '3,5 HP', 'Otomatik', 'Şehir içi pratik kullanım.', 69900, 3);

    const faq = db.prepare('INSERT INTO faqs(question,answer,sort) VALUES(?,?,?)');
    [
      ['Bionic Motor motosikletlerini nasıl temin edebilirim?', 'Yetkili bayilerimizden temin edebilirsiniz. Size en yakın bayi için Satış ve Servis sayfasını inceleyin.'],
      ['Bionic Motor motosikletlerinin garanti süresi ne kadardır?', 'Garanti koşulları model ve kullanıma göre değişir. Ayrıntılar için yetkili servislerimize başvurun.'],
      ['Yetkili servislere nasıl ulaşabilirim?', 'Satış ve Servis sayfasındaki listeden size en yakın servisi bulabilirsiniz.'],
      ['Fabrikadan yedek parça temin edebilir miyim?', 'Yedek parçalar yetkili servis ve bayiler aracılığıyla temin edilir.'],
      ['Müşteri Hizmetlerine nasıl ulaşabilirim?', 'İletişim sayfamızdaki telefon ve e-posta bilgilerinden bize ulaşabilirsiniz.'],
      ['Motosiklete başlarken mutlaka ders almalı mıyım?', 'Güvenli sürüş için temel sürüş eğitimi alınması önerilir.'],
      ['Hangi motosiklet ile başlamalıyım?', 'Deneyim düzeyinize ve kullanım amacınıza göre bayilerimizden öneri alabilirsiniz.'],
      ['Scooter kullanıyorum Ehliyet Türü gerek var mı?', 'Motor hacmine göre farklı ehliyet sınıfları gereklidir.'],
      ['Araç üzerinde modifikasyon yapılabilir mi?', 'Yasal mevzuata aykırı modifikasyonlar garanti kapsamını etkileyebilir.'],
      ['ECU ve EFI Anlamları nelerdir?', 'ECU motor kontrol ünitesi, EFI elektronik yakıt enjeksiyon sistemidir.'],
      ['ABS ve CBS Anlamları ve Farklılıkları nelerdir? TCS Sistemi nedir?', 'ABS tekerlek kilitlenmesini önler, CBS kombine frenleme sağlar, TCS çekiş kontrolüdür.'],
      ['Motosiklet Kullanımı İçin Hangi Ehliyet Türü Gereklidir?', 'A1, A2 ve A sınıfı ehliyetler motor gücüne göre değişir.']
    ].forEach((r, i) => faq.run(r[0], r[1], i + 1));

    const pt = db.prepare('INSERT INTO points(name,type,city,address,phone) VALUES(?,?,?,?,?)');
    pt.run('Bionic Motor Merkez', 'Bayi & Servis', 'Mersin', 'Merkez Mah. Akdeniz / Mersin', '0544 733 73 73');
    pt.run('Bionic Motor İstanbul', 'Bayi', 'İstanbul', 'Örnek Mah. Örnek Cad. No:1', '0212 000 00 00');

    const page = db.prepare('INSERT INTO pages(slug,title,body) VALUES(?,?,?)');
    page.run('kurumsal', 'Kurumsal', '<p>Şirketimiz hakkında bilgileri yönetim panelinden düzenleyebilirsiniz.</p>');
    page.run('dijital-katalog', 'Dijital Katalog', '<p>Dijital katalog yakında.</p>');
    page.run('medya', 'Medya', '<p>Medya içerikleri yakında.</p>');
    page.run('garanti', 'Garanti İşlemleri', '<p>Garanti işlemleri hakkında bilgi.</p>');
    page.run('bakim-onarim', 'Bakım ve Onarım İşlemleri', '<p>Bakım ve onarım hakkında bilgi.</p>');
    page.run('kisisel-bilgi-guvenligi', 'Kişisel Bilgi Güvenliği', '<p>Kişisel verileriniz yasal mevzuata uygun olarak korunur.</p>');
    page.run('iptal-iade', 'İptal & İade', '<p>İptal ve iade koşulları.</p>');
    page.run('hizmet-sozlesmesi', 'Hizmet Sözleşmesi', '<p>Hizmet sözleşmesi metni.</p>');

    const ins = db.prepare('INSERT INTO installments(label,count,rate) VALUES(?,?,?)');
    ins.run('Tek Çekim', 1, 0); ins.run('2 Taksit', 2, 2.5); ins.run('3 Taksit', 3, 3.5);
    ins.run('6 Taksit', 6, 6); ins.run('9 Taksit', 9, 8.5); ins.run('12 Taksit', 12, 11);

    const ann = db.prepare('INSERT INTO announcements(text,author,sort) VALUES(?,?,?)');
    const au = 'Satış Sonrası Hizmetler Müdürlüğü';
    ann.run('Değerli servis ve bayilerimiz sevkiyatta hasar alan ürünler için 3 iş günü içinde sistem üzerinden iş emri açarak tarafımıza bildirmeniz rica olunur.', au, 1);
    ann.run('Değerli iş ortağımız, garantiden değiştirilmiş ürünler ve ücretli yedek parçadan iade edeceğiniz ürünleri tarafımıza *bilgi vermeden* lütfen kargo ile tarafımıza iade işlemi yapmayınız. İade edeceğiniz ürünler kendi araçlarımızla alınacaktır. Tarafımıza bilgi verilmeden kargo ile yaptığınız gönderilerin ücreti tarafınıza fatura edilecektir.', au, 2);
    ann.run('Değerli Bayi ve Servis Yetkililerimiz,\nİş süreçlerimizin daha sağlıklı ve hızlı ilerleyebilmesi adına, iş emri oluşturulurken iş emriyle ilgili görsel eklenmesi zorunlu hale getirilmiştir.\nOluşturulan iş emirlerinde;\n-Arıza, hasar veya yapılan işlemle ilgili net ve anlaşılır görsellerin eklenmesi,\n-Görsellerin iş emrini açıkça desteklemesi\nönemle rica olunur.\nAlakasız görselle oluşturulan iş emirleri, inceleme sürecini uzatabileceği için onay sürecine alınmayabilir.\nBilgilerinize sunar, iş birliğiniz için teşekkür ederiz.', au, 3);

    // ---- Demo veriler (yalnızca SEED_DEMO=1) ----
    if (!seedDemo) return;

    const firm = db.prepare('INSERT INTO firms(code,name,city,phone,email) VALUES(?,?,?,?,?)')
      .run('120.01.001', 'SİMMOTO', 'Aksaray', '0544 733 73 73', 'bayi@example.com').lastInsertRowid;
    const demoPass = process.env.DEMO_PASSWORD || 'demo1234Ab!';
    const user = db.prepare('INSERT INTO dealer_users(code,email,name,password_hash) VALUES(?,?,?,?)')
      .run('25895', 'demo@bayi.local', 'DEMO BAYİ', bcrypt.hashSync(demoPass, 12)).lastInsertRowid;
    db.prepare('INSERT INTO user_firms(user_id,firm_id) VALUES(?,?)').run(user, firm);

    const ord = db.prepare('INSERT INTO orders(firm_id,request_date,request_no,delivery_type,status,movement_id) VALUES(?,?,?,?,?,-1)');
    const item = db.prepare('INSERT INTO order_items(order_id,product_name,qty,unit_price) VALUES(?,?,?,?)');
    [['2026-03-10', '1'], ['2026-04-20', '2'], ['2026-05-19', '3'],
     ['2026-05-19', '4'], ['2026-05-19', '5'], ['2026-06-23', '6'],
     ['2026-09-09', '7'], ['2026-09-14', '8'], ['2026-09-14', '9']]
      .forEach(([d, n]) => {
        const id = ord.run(firm, d, n, 'İleri Vadeli Teslim', 'Siparişe Dönüştürüldü').lastInsertRowid;
        item.run(id, 'SST125', 4, 111500);
        item.run(id, 'Urban 50', 2, 52000);
      });

    const mv = db.prepare('INSERT INTO account_movements(firm_id,ledger,date,doc_no,doc_type,kind,amount,has_detail) VALUES(?,?,?,?,?,?,?,?)');
    const F = 'Toptan Satış Faturası', K = 'Kredi Kartı Fişi';
    mv.run(firm, 'ana', '2026-03-13', 'SIA2026000000035', F, 'borc', 1253776, 1);
    mv.run(firm, 'ana', '2026-03-23', 'C202603196964SO1', K, 'alacak', 115000, 0);
    mv.run(firm, 'ana', '2026-04-11', '09517', 'Çek Girişi', 'alacak', 1250000, 0);
    mv.run(firm, 'ana', '2026-05-01', 'SIA2026000000059', F, 'borc', 693796, 1);
    mv.run(firm, 'ana', '2026-05-04', 'C202605202237SO1', K, 'alacak', 29500, 0);
    mv.run(firm, 'ana', '2026-05-06', '0000000000021411', K, 'alacak', 30000, 0);
    mv.run(firm, 'ana', '2026-05-08', 'C202605202767SO1', K, 'alacak', 50000, 0);
    mv.run(firm, 'ana', '2026-05-09', 'C202605202851SO1', K, 'alacak', 45000, 0);
    mv.run(firm, 'ana', '2026-06-25', 'SIA2026000000101', F, 'borc', 4164492, 1);
    mv.run(firm, 'ana', '2026-07-02', 'C202607000001SO1', K, 'alacak', 3116000, 0);
    mv.run(firm, 'ana', '2026-07-10', '09600', 'Vadesi Gelmemiş Çek', 'bilgi', 700000, 0);
    mv.run(firm, 'parca', '2026-04-02', 'YP2026000001', 'Yedek Parça Faturası', 'borc', 48500, 1);
    mv.run(firm, 'parca', '2026-04-20', 'C202604200001SO1', K, 'alacak', 20000, 0);

    const pr = db.prepare('INSERT INTO products(kind,code,name,category,price,model_id,stock,max_qty) VALUES(?,?,?,?,?,?,?,?)');
    pr.run('arac', 'SST125', 'SST125', 'Scooter', 111500, 1, 20, 5);
    pr.run('arac', 'CRZ150', 'Cruiser 150', 'Motosiklet', 96000, 2, 10, 3);
    pr.run('arac', 'URB50', 'Urban 50', 'Scooter', 52000, 3, 0, 0);
    pr.run('parca', 'YP-001', 'Ön Fren Balatası', 'Fren', 320, 1, 50, 10);
    pr.run('parca', 'YP-002', 'Yağ Filtresi', 'Motor', 95, 1, 0, 0);
    pr.run('parca', 'YP-003', 'Ayna Takımı', 'Gövde', 410, 2, 15, 4);

    // Ürün kategorilerini categories tablosuna aktar (ürün formundaki kategori listesi buradan beslenir)
    db.exec("INSERT OR IGNORE INTO categories(name) SELECT DISTINCT TRIM(category) FROM products WHERE category IS NOT NULL AND TRIM(category)<>''");

    db.prepare('INSERT INTO warranty_records(firm_id,serial_no,model,customer,sale_date,warranty_end,status) VALUES(?,?,?,?,?,?,?)')
      .run(firm, 'NLCSST125R0001234', 'SST125', 'Örnek Müşteri', '2026-05-20', '2028-05-20', 'Aktif');
    db.prepare('INSERT INTO work_orders(firm_id,no,serial_no,model,km,type,description,status) VALUES(?,?,?,?,?,?,?,?)')
      .run(firm, 'IE2026000001', 'NLCSST125R0001234', 'SST125', '1200', 'Garanti', 'İlk bakım', 'Tamamlandı');
  });

  console.log('Veritabanı oluşturuldu.');
  if (generated) console.log('Yönetici: admin / ' + pass + '  (bu parola rastgele üretildi; hemen değiştirin!)');
  else console.log('Yönetici: admin  (parola ADMIN_PASSWORD ile verildi)');
  if (seedDemo) console.log('Demo bayi: kullanıcı kodu 25895 / ' + (process.env.DEMO_PASSWORD || 'demo1234Ab!') + ' (e-posta: demo@bayi.local)');
  else console.log('Demo veriler oluşturulmadı (istemiyorsanız bu normaldir; SEED_DEMO=1 ile açılabilir).');
}

module.exports = { ensureSeed };
if (require.main === module) ensureSeed();
