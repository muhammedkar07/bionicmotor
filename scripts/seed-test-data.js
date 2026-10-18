'use strict';
// =============================================================================
//  TEST ORTAMI VERİSİ — uçtan uca deneme için gerçekçi veri seti oluşturur.
//
//  ⚠️ YALNIZCA TEST/STAGING ORTAMINDA ÇALIŞTIRIN. Canlı veriye dokunur!
//     DATA_DIR içinde "test" geçmiyorsa onay ister (--evet).
//
//  Kullanım:  node --env-file=.env scripts/seed-test-data.js
//             TEST_DATA_PASSWORD=... ile giriş parolası değiştirilebilir.
//
//  Oluşturduğu hesaplar (parola: TEST_DATA_PASSWORD, varsayılan Test1234Ab!x):
//    Bayi   : kullanıcı kodu 10001
//    Servis : kullanıcı kodu 20001
// =============================================================================
const bcrypt = require('bcryptjs');
const { db, tx } = require('../db');

const DATA_DIR = process.env.DATA_DIR || '';
const TESTLIKE = /test|staging/i.test(DATA_DIR) || /test|staging/i.test(process.env.PM2_APP || '');
if (!TESTLIKE && !process.argv.includes('--evet')) {
  console.error('!! DATA_DIR test ortamina benzemiyor: ' + (DATA_DIR || '(bos)'));
  console.error('   Bu betik TEST ortami icindir. Yine de calistirmak icin: --evet ekleyin.');
  process.exit(1);
}

const PASS = process.env.TEST_DATA_PASSWORD || 'Test1234Ab!x';
const hash = bcrypt.hashSync(PASS, 10);

// --- temizlik (yalnızca bu betiğin oluşturduğu kayıtlar) ---
const TEST_FIRM_CODES = ['120.01.001', '120.02.001'];
const TEST_USER_CODES = ['10001', '20001'];

tx(() => {
  db.prepare(
    `DELETE FROM account_movements WHERE firm_id IN (SELECT id FROM firms WHERE code IN (${TEST_FIRM_CODES.map(() => '?').join(',')}))`
  ).run(...TEST_FIRM_CODES);
  db.prepare('DELETE FROM payments WHERE user_id IN (SELECT id FROM dealer_users WHERE code IN (?,?))').run(...TEST_USER_CODES);
  db.prepare(
    `DELETE FROM user_firms WHERE user_id IN (SELECT id FROM dealer_users WHERE code IN (${TEST_USER_CODES.map(() => '?').join(',')}))`
  ).run(...TEST_USER_CODES);
  db.prepare(`DELETE FROM dealer_users WHERE code IN (${TEST_USER_CODES.map(() => '?').join(',')})`).run(...TEST_USER_CODES);
  db.prepare(`DELETE FROM firms WHERE code IN (${TEST_FIRM_CODES.map(() => '?').join(',')})`).run(...TEST_FIRM_CODES);
  db.prepare("DELETE FROM messages WHERE email LIKE '%@test.local'").run();
  db.prepare("DELETE FROM applications WHERE phone LIKE '0500%'").run();
  db.prepare("DELETE FROM points WHERE name LIKE 'TEST %'").run();
  db.prepare("DELETE FROM announcements WHERE author='TEST'").run();
  db.prepare("DELETE FROM warranty_records WHERE serial_no LIKE 'TEST%'").run();
  db.prepare("DELETE FROM work_orders WHERE serial_no LIKE 'TEST%'").run();
});

const r1 = tx(() => {
  // --- firmalar ---
  const firmBayi = Number(
    db
      .prepare("INSERT INTO firms(code,name,city,phone,email,devir,devir_parca) VALUES(?,?,?,?,?,?,?)")
      .run('120.01.001', 'TEST BAYİ MERSİN', 'Mersin', '0555 111 22 33', 'bayi@test.local', 250000, 40000).lastInsertRowid
  );
  const firmServis = Number(
    db
      .prepare("INSERT INTO firms(code,name,city,phone,email,devir) VALUES(?,?,?,?,?,?)")
      .run('120.02.001', 'TEST SERVİS ADANA', 'Adana', '0555 444 55 66', 'servis@test.local', 0).lastInsertRowid
  );

  // --- kullanıcılar ---
  const uBayi = Number(
    db
      .prepare("INSERT INTO dealer_users(code,email,name,password_hash,role) VALUES(?,?,?,?,'bayi')")
      .run('10001', 'bayi@test.local', 'Test Bayi Kullanıcısı', hash).lastInsertRowid
  );
  const uServis = Number(
    db
      .prepare("INSERT INTO dealer_users(code,email,name,password_hash,role) VALUES(?,?,?,?,'servis')")
      .run('20001', 'servis@test.local', 'Test Servis Kullanıcısı', hash).lastInsertRowid
  );
  db.prepare('INSERT INTO user_firms(user_id,firm_id) VALUES(?,?)').run(uBayi, firmBayi);
  db.prepare('INSERT INTO user_firms(user_id,firm_id) VALUES(?,?)').run(uServis, firmServis);

  // --- ürünler (araç + yedek parça) ---
  const models = db.prepare('SELECT id,name FROM models ORDER BY sort,id LIMIT 6').all();
  const prod = db.prepare(
    'INSERT INTO products(kind,code,name,category,price,active,stock,model_id,max_qty) VALUES(?,?,?,?,?,1,?,?,?)'
  );
  const araclar = [
    ['arac', 'TP-100', 'Test Scooter 125', 'Scooter', 8990000, 12, models[0] ? models[0].id : null, 5],
    ['arac', 'TP-200', 'Test Motosiklet 250', 'Motosiklet', 15490000, 4, models[1] ? models[1].id : null, 3],
    ['arac', 'TP-300', 'Test Scooter 50', 'Scooter', 5490000, 0, models[2] ? models[2].id : null, 0]
  ];
  const parcalar = [
    ['parca', 'YP-T01', 'Test Fren Balatası', 'Fren', 32000, 40, null, 10],
    ['parca', 'YP-T02', 'Test Yağ Filtresi', 'Motor', 9500, 0, null, 0],
    ['parca', 'YP-T03', 'Test Ayna Takımı', 'Gövde', 41000, 15, null, 4]
  ];
  const pids = {};
  for (const a of [...araclar, ...parcalar]) pids[a[1]] = Number(prod.run(...a).lastInsertRowid);

  db.exec(
    "INSERT OR IGNORE INTO categories(name) SELECT DISTINCT TRIM(category) FROM products WHERE category IS NOT NULL AND TRIM(category)<>''"
  );

  // --- bayi stoğu ---
  const fs = db.prepare('INSERT OR REPLACE INTO firm_stock(firm_id,product_id,qty) VALUES(?,?,?)');
  fs.run(firmBayi, pids['TP-100'], 3);
  fs.run(firmBayi, pids['TP-200'], 1);

  // --- siparişler ---
  const ord = db.prepare(
    'INSERT INTO orders(firm_id,request_date,request_no,delivery_type,status,note,movement_id) VALUES(?,?,?,?,?,?,-1)'
  );
  const item = db.prepare('INSERT INTO order_items(order_id,product_name,qty,unit_price,discount_pct) VALUES(?,?,?,?,?)');
  const o1 = Number(ord.run(firmBayi, '2026-09-01', '9001', 'İleri Vadeli Teslim', 'Beklemede', 'Test bekleyen sipariş').lastInsertRowid);
  item.run(o1, 'Test Scooter 125', 2, 8990000, 0);
  const o2 = Number(ord.run(firmBayi, '2026-08-15', '9002', 'Peşin', 'Siparişe Dönüştürüldü', 'Test dönüşen sipariş').lastInsertRowid);
  item.run(o2, 'Test Motosiklet 250', 1, 15490000, 5);
  const o3 = Number(ord.run(firmBayi, '2026-07-20', '9003', 'Peşin', 'İptal', null).lastInsertRowid);
  item.run(o3, 'Test Scooter 50', 1, 5490000, 0);

  // --- cari hareketler (ana + yedek parça) ---
  const mv = db.prepare(
    'INSERT INTO account_movements(firm_id,ledger,date,doc_no,doc_type,kind,amount,has_detail,bank,cheque_no,cheque_due,payer_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  mv.run(firmBayi, 'ana', '2026-08-01', 'TF2026001', 'Toptan Satış Faturası', 'borc', 17081000, 1, null, null, null, null);
  mv.run(firmBayi, 'ana', '2026-08-10', 'C2026001', 'Kredi Kartı Fişi', 'alacak', 5000000, 0, null, null, null, null);
  mv.run(firmBayi, 'ana', '2026-08-20', 'CK-T001', 'Çek Girişi', 'alacak', 8000000, 0, 'Ziraat', '123456', '2026-11-20', null);
  mv.run(firmBayi, 'ana', '2026-09-05', 'BK-T001', 'Vadesi Gelmemiş Çek', 'bilgi', 6000000, 0, null, '654321', '2027-01-15', null);
  mv.run(firmBayi, 'ana', '2026-09-10', 'HV-T001', 'Havale/EFT', 'alacak', 3000000, 0, 'Halkbank', null, null, 'Test Gönderen');
  mv.run(firmBayi, 'parca', '2026-08-05', 'YPF-T001', 'Yedek Parça Faturası', 'borc', 1250000, 1, null, null, null, null);
  mv.run(firmBayi, 'parca', '2026-08-25', 'C2026050', 'Kredi Kartı Fişi', 'alacak', 500000, 0, null, null, null, null);
  mv.run(firmServis, 'ana', '2026-09-01', 'TF2026002', 'Toptan Satış Faturası', 'borc', 8990000, 1, null, null, null, null);
  mv.run(firmServis, 'ana', '2026-09-15', 'C2026060', 'Kredi Kartı Fişi', 'alacak', 4000000, 0, null, null, null, null);

  // --- garanti kayıtları ---
  const wr = db.prepare(
    'INSERT INTO warranty_records(firm_id,serial_no,model,customer,sale_date,warranty_end,status,invoice_no,setup_fee) VALUES(?,?,?,?,?,?,?,?,?)'
  );
  wr.run(firmBayi, 'TEST0001', 'Test Scooter 125', 'Test Müşteri A', '2026-08-20', '2028-08-20', 'Aktif', 'FTR-001', 0);
  wr.run(firmServis, 'TEST0002', 'Test Motosiklet 250', 'Test Müşteri B', '2026-09-01', '2028-09-01', 'Aktif', 'FTR-002', 0);

  // --- iş emirleri ---
  const wo = db.prepare(
    'INSERT INTO work_orders(firm_id,user_id,no,serial_no,model,km,type,description,status) VALUES(?,?,?,?,?,?,?,?,?)'
  );
  wo.run(firmServis, uServis, 'IE2026001', 'TEST0002', 'Test Motosiklet 250', '1250', 'Garanti', 'İlk bakım (test)', 'Beklemede');
  wo.run(firmServis, uServis, 'IE2026002', 'TEST0002', 'Test Motosiklet 250', '3400', 'Ücretli', 'Yağ değişimi (test)', 'Tamamlandı');

  // --- yedek parça siparişleri ---
  const so = db.prepare(
    'INSERT INTO spare_orders(firm_id,user_id,no,status,note,request_date,delivery_method) VALUES(?,?,?,?,?,?,?)'
  );
  const soi = db.prepare('INSERT INTO spare_order_items(order_id,part_code,part_name,qty,unit_price) VALUES(?,?,?,?,?)');
  const s1 = Number(so.run(firmBayi, uBayi, 'YS2026001', 'Beklemede', 'Test bekleyen parça siparişi', '2026-09-05', 'Kargo').lastInsertRowid);
  soi.run(s1, 'YP-T01', 'Test Fren Balatası', 2, 32000);
  const s2 = Number(so.run(firmBayi, uBayi, 'YS2026002', 'Siparişe Dönüştürüldü', null, '2026-08-28', 'Kargo').lastInsertRowid);
  soi.run(s2, 'YP-T03', 'Test Ayna Takımı', 1, 41000);

  // --- online ödemeler ---
  const pay = db.prepare(
    `INSERT INTO payments(user_id,firm_id,kind,amount,currency,amount_tl,description,installment,commission,total,status,provider,provider_ref,provider_order,source,paid_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  pay.run(uBayi, firmBayi, 'havale', 250000, 'TL', 250000, 'Test havale bildirimi', 'Tek Çekim', 0, 250000, 'Talimat Oluşturuldu', null, null, null, 'odeme', null);
  pay.run(uBayi, firmBayi, 'odeme', 100000, 'TL', 100000, 'Test kart ödemesi', 'Tek Çekim', 0, 100000, 'Tahsil Edildi', 'paratika', 'TESTREF1', 'BNTEST0001', 'odeme', '2026-09-12');

  // --- satış/servis noktaları ---
  const pt = db.prepare('INSERT INTO points(name,type,city,address,phone,active) VALUES(?,?,?,?,?,1)');
  pt.run('TEST Bionic Merkez', 'Bayi & Servis', 'Mersin', 'Test Mah. Test Cad. No:1', '0555 000 00 01');
  pt.run('TEST Bionic İstanbul', 'Bayi', 'İstanbul', 'Test Mah. Test Cad. No:2', '0212 000 00 02');
  pt.run('TEST Bionic Servis Adana', 'Servis', 'Adana', 'Test Mah. Test Cad. No:3', '0322 000 00 03');

  // --- mesajlar & başvurular ---
  const msg = db.prepare('INSERT INTO messages(name,email,phone,message,is_read) VALUES(?,?,?,?,?)');
  msg.run('Test Ziyaretçi', 'ziyaci@test.local', '0555 123 45 67', 'Test iletişim mesajı.', 0);
  msg.run('Test Ziyaretçi 2', 'ziyaci2@test.local', '0555 765 43 21', 'İkinci test mesajı.', 1);
  const app = db.prepare('INSERT INTO applications(name,city,district,phone,note,status) VALUES(?,?,?,?,?,?)');
  app.run('Test Başvuru', 'İzmir', 'Bornova', '0500 111 22 33', 'Test bayilik başvurusu.', 'Yeni');
  app.run('Test Başvuru 2', 'Bursa', 'Nilüfer', '0500 444 55 66', 'İkinci test başvurusu.', 'İnceleniyor');

  // --- duyurular ---
  const ann = db.prepare('INSERT INTO announcements(text,author,sort,active) VALUES(?,?,?,1)');
  ann.run('Test duyurusu: bu kayıt test ortamı içindir.', 'TEST', 90);

  // --- stok bildirimi ---
  db.prepare('INSERT OR REPLACE INTO stock_notify(product_id,firm_id,user_id) VALUES(?,?,?)').run(pids['YP-T02'], firmBayi, uBayi);

  return { firmBayi, firmServis, uBayi, uServis };
});

console.log('=== TEST VERISI OLUSTURULDU ===');
console.log('  Bayi firmasi   : id=' + r1.firmBayi + '  (120.01.001)');
console.log('  Servis firmasi : id=' + r1.firmServis + '  (120.02.001)');
console.log('  Bayi girisi    : kod 10001  / ' + PASS);
console.log('  Servis girisi  : kod 20001  / ' + PASS);
console.log('');
console.log('  Özet:');
for (const t of [
  'firms',
  'dealer_users',
  'orders',
  'order_items',
  'account_movements',
  'products',
  'warranty_records',
  'work_orders',
  'spare_orders',
  'spare_order_items',
  'payments',
  'points',
  'messages',
  'applications',
  'announcements'
]) {
  console.log('    ' + t.padEnd(20) + db.prepare('SELECT COUNT(*) n FROM ' + t).get().n);
}
db.close();
