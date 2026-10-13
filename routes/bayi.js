const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, tx, syncOrderDebit, nextNo } = require('../db');
const { flash, throttle, regenerate, luhn, addYears, fmtMoney } = require('../lib/core');
const { accountSummary } = require('../lib/account');
const pay = require('../lib/pay');

const DUMMY = bcrypt.hashSync('x', 10);

// Admin tarafından belirlenen maksimum alım adedini aşan satır var mı?
function checkMaxQty(lines) {
  const agg = {};
  for (const l of lines) agg[l.p.id] = (agg[l.p.id] || 0) + l.qty;
  for (const l of lines) {
    const max = +l.p.max_qty || 0;
    if (max > 0 && agg[l.p.id] > max) return `"${l.p.name}" için en fazla ${max} adet sipariş verebilirsiniz.`;
  }
  return null;
}

router.get('/giris', (req, res) => {
  if (req.session.dealer) return res.redirect('/bayi');
  res.render('bayi/login', { title: 'Bayi Girişi' });
});

router.post('/giris', (req, res) => {
  const code = String(req.body.code || '').trim().slice(0, 50);
  const pass = String(req.body.password || '').slice(0, 200);
  const t = throttle('bayi:' + req.ip + ':' + code);
  if (t.blocked) {
    flash(req, 'danger', 'Çok fazla hatalı deneme. Lütfen daha sonra tekrar deneyin.');
    return res.redirect('/bayi/giris');
  }
  const u = db.prepare('SELECT * FROM dealer_users WHERE code=? AND active=1').get(code);
  const ok = bcrypt.compareSync(pass, u ? u.password_hash : DUMMY) && u;
  if (!ok) {
    t.hit();
    flash(req, 'danger', 'Kullanıcı kodu veya parola hatalı.');
    return res.redirect('/bayi/giris');
  }
  t.reset();
  const firms = db.prepare('SELECT f.id FROM firms f JOIN user_firms uf ON uf.firm_id=f.id WHERE uf.user_id=? AND f.active=1').all(u.id);
  if (firms.length === 0) {
    flash(req, 'danger', 'Hesabınıza tanımlı aktif firma bulunmuyor.');
    return res.redirect('/bayi/giris');
  }
  if (u.role === 'servis') {
    regenerate(req, res, 'servis');
    req.session.servis = { userId: u.id, firmId: firms[0].id };
    req.saveSession();
    return res.redirect('/servis');
  }
  if (u.role === null || u.role === '') db.prepare("UPDATE dealer_users SET role='bayi' WHERE id=?").run(u.id);
  regenerate(req, res, 'dealer');
  req.session.dealer = { userId: u.id, firmId: firms[0].id };
  req.saveSession();
  res.redirect('/bayi');
});

router.use((req, res, next) => {
  const d = req.session.dealer;
  const u = d && db.prepare('SELECT * FROM dealer_users WHERE id=? AND active=1').get(d.userId);
  if (u && u.role === 'servis') return res.redirect('/servis');
  const f = u && db.prepare(
    'SELECT f.* FROM firms f JOIN user_firms uf ON uf.firm_id=f.id WHERE uf.user_id=? AND f.id=? AND f.active=1').get(u.id, d.firmId);
  if (!f) return res.redirect('/bayi/giris');
  res.locals.bu = u; res.locals.bf = f;
  res.locals.multiFirm = db.prepare('SELECT COUNT(*) c FROM user_firms WHERE user_id=?').get(u.id).c > 1;
  res.locals.bell = db.prepare(
    'SELECT COUNT(*) c FROM announcements WHERE active=1 AND (? IS NULL OR created_at > ?)').get(u.ann_seen_at, u.ann_seen_at).c;
  next();
});

const page = (res, view, title, extra = {}) => res.render('bayi/' + view, { title, ...extra });

router.get('/', (req, res) => {
  const unread = db.prepare('SELECT * FROM announcements WHERE active=1 AND (? IS NULL OR created_at > ?) ORDER BY created_at DESC, id DESC')
    .all(res.locals.bu.ann_seen_at, res.locals.bu.ann_seen_at);
  db.prepare("UPDATE dealer_users SET ann_seen_at=datetime('now') WHERE id=?").run(res.locals.bu.id);
  res.locals.bell = 0;
  page(res, 'home', 'Bayi Portalı', { unread });
});

router.post('/cikis', (req, res) => {
  regenerate(req, res, 'dealer');
  flash(req, 'danger', 'Başarıyla çıkış yaptınız.');
  res.redirect('/bayi/giris');
});

router.get('/firma-degistir', (req, res) => {
  const firms = db.prepare(
    'SELECT f.* FROM firms f JOIN user_firms uf ON uf.firm_id=f.id WHERE uf.user_id=? AND f.active=1 ORDER BY f.name').all(res.locals.bu.id);
  page(res, 'firms', 'Firma Değiştir', { firms });
});
router.post('/firma-degistir', (req, res) => {
  const f = db.prepare(
    'SELECT f.id FROM firms f JOIN user_firms uf ON uf.firm_id=f.id WHERE uf.user_id=? AND f.id=? AND f.active=1')
    .get(res.locals.bu.id, +req.body.firm_id);
  if (f) { req.session.dealer.firmId = f.id; req.saveSession(); }
  res.redirect('/bayi');
});

router.get('/siparisler', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE firm_id=? ORDER BY request_date,id').all(res.locals.bf.id);
  page(res, 'orders', 'Sipariş Taleplerim', { orders });
});
router.get('/siparisler/:id', (req, res, next) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=? AND firm_id=?').get(+req.params.id, res.locals.bf.id);
  if (!order) return next();
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
  page(res, 'order_detail', 'Talep İçeriği', { order, items });
});

router.get('/siparis-olustur', (req, res) => {
  const products = db.prepare("SELECT * FROM products WHERE kind='arac' AND active=1 ORDER BY category,name").all();
  page(res, 'order_new', 'Yeni Sipariş Talebi', { products, old: null });
});
router.post('/siparis-olustur', (req, res) => {
  const b = req.body;
  const ids = [].concat(b.product_id || []), qtys = [].concat(b.qty || []);
  const old = {
    lines: ids.map((id, i) => [+id || '', String(qtys[i] ?? '').trim()]),
    note: String(b.note || '').slice(0, 1000),
  };
  const back = m => {
    res.locals.flash = { type: 'danger', msg: m };
    const products = db.prepare("SELECT * FROM products WHERE kind='arac' AND active=1 ORDER BY category,name").all();
    page(res, 'order_new', 'Yeni Sipariş Talebi', { products, old });
  };
  const lines = [];
  ids.forEach((id, i) => {
    const qty = Math.floor(+qtys[i]);
    const p = id && db.prepare("SELECT * FROM products WHERE id=? AND kind='arac' AND active=1").get(+id);
    if (p && qty > 0 && qty <= 10000) lines.push({ p, qty });
  });
  if (!lines.length) return back('Sepete en az bir ürün ve adet eklemelisiniz.');
  const overQty = checkMaxQty(lines);
  if (overQty) return back(overQty);
  const no = String(nextNo('orders', 'request_no'));
  tx(() => {
    // Talep oluşturmak tutarı etkilemez; "Siparişe Dönüştürüldü" olunca borca işlenir ve stok düşer.
    const oid = db.prepare(`INSERT INTO orders(firm_id,request_date,request_no,delivery_date,delivery_type,status,note) VALUES(?,date('now'),?,NULL,'İleri Vadeli Teslim','Beklemede',?)`)
      .run(res.locals.bf.id, no, old.note || null).lastInsertRowid;
    const ins = db.prepare('INSERT INTO order_items(order_id,product_name,qty,unit_price) VALUES(?,?,?,?)');
    lines.forEach(l => ins.run(oid, l.p.name, l.qty, l.p.price));
  });
  flash(req, 'success', `${no} numaralı sipariş talebiniz oluşturuldu. Oluşturma sırasında tutar ve stok etkilenmez; talebinizin "Siparişe Dönüştürüldü" durumuna geçirilmesi beklenir.`);
  res.redirect('/bayi/siparisler');
});

router.get('/stoklar', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.code, p.category, p.price, COALESCE(fs.qty,0) AS qty
    FROM products p
    LEFT JOIN firm_stock fs ON fs.product_id=p.id AND fs.firm_id=?
    WHERE p.kind='arac' AND p.active=1 AND COALESCE(fs.qty,0) > 0
    ORDER BY p.category, p.name`).all(res.locals.bf.id);
  page(res, 'stoklar', 'Stoklarım', { rows });
});

router.get('/hesap-ozeti', (req, res) => {
  page(res, 'account', 'Hesap Özeti', { a: accountSummary(res.locals.bf.id, 'ana'), heading: 'Hesap Özeti', showCards: true });
});
router.get('/yedek-parca-ekstre', (req, res) => {
  page(res, 'account', 'Yedek Parça Hesap Ekstresi',
    { a: accountSummary(res.locals.bf.id, 'parca'), heading: 'Yedek Parça Hesap Ekstresi', showCards: false });
});

router.get('/odeme', (req, res) => {
  const inst = db.prepare('SELECT * FROM installments WHERE active=1 ORDER BY count').all();
  page(res, 'odeme', 'Online Ödeme', { inst, base: '/bayi/odeme' });
});
router.post('/odeme/ode', (req, res) => {
  const b = req.body;
  const ctx = { userId: res.locals.bu.id, firmId: res.locals.bf.id };
  const method = ['kart', 'havale'].includes(b.method) ? b.method : 'kart';
  const r = method === 'havale' ? pay.havale(ctx, b) : pay.card(ctx, b);
  flash(req, r.error ? 'danger' : 'success', r.error || r.msg);
  res.redirect('/bayi/odeme');
});
router.post('/odeme/talimat', (req, res) => {
  const r = pay.talimat({ userId: res.locals.bu.id, firmId: res.locals.bf.id }, req.body);
  flash(req, r.error ? 'danger' : 'success', r.error || r.msg);
  res.redirect('/bayi/odeme');
});

router.get('/duyurular', (req, res) => {
  const list = db.prepare('SELECT * FROM announcements WHERE active=1 ORDER BY created_at DESC, id DESC').all();
  const seen = res.locals.bu.ann_seen_at;
  list.forEach(a => { a.isNew = !seen || a.created_at > seen; });
  db.prepare("UPDATE dealer_users SET ann_seen_at=datetime('now') WHERE id=?").run(res.locals.bu.id);
  res.locals.bell = 0;
  page(res, 'announcements', 'Duyurular', { list });
});

router.get('/fiyat-listesi', (req, res) => {
  const list = db.prepare("SELECT * FROM products WHERE kind='arac' AND active=1 ORDER BY category,name").all();
  page(res, 'prices', 'Toptan Fiyat Listesi', { list });
});

router.get('/garanti', (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = q ? db.prepare("SELECT * FROM warranty_records WHERE firm_id=? AND serial_no LIKE ? ORDER BY sale_date DESC")
    .all(res.locals.bf.id, `%${q}%`) : [];
  page(res, 'warranty', 'Garanti Kayıtları', { rows, q });
});

router.get('/yedek-parca/yeni', (req, res) => {
  const parts = db.prepare("SELECT * FROM products WHERE kind='parca' AND active=1 ORDER BY category,name").all();
  const inst = db.prepare('SELECT * FROM installments WHERE active=1 ORDER BY count').all();
  const models = db.prepare('SELECT id,name FROM models WHERE active=1 ORDER BY name COLLATE NOCASE').all();
  const bal = accountSummary(res.locals.bf.id, 'parca').balance;
  const credit = bal < 0 ? Math.round(-bal * 100) / 100 : 0;
  page(res, 'spare_new', 'Yedek Parça Sipariş Oluştur', { parts, inst, models, old: null, credit });
});
router.post('/yedek-parca/yeni', (req, res) => {
  const b = req.body;
  const ids = [].concat(b.part_id || []), qtys = [].concat(b.qty || []);
  const old = {
    lines: ids.map((id, i) => [+id || '', String(qtys[i] ?? '').trim()]),
    note: String(b.note || '').slice(0, 1000),
    pay_method: b.pay_method || 'kart',
    holder: String(b.holder || '').slice(0, 80),
    number: String(b.number || '').trim(),
    month: b.month || '', year: b.year || '', cvc: String(b.cvc || '').slice(0, 4),
    payer_name: String(b.payer_name || '').slice(0, 120),
    installment_id: b.installment_id || '',
  };
  const renderNew = () => {
    const parts = db.prepare("SELECT * FROM products WHERE kind='parca' AND active=1 ORDER BY category,name").all();
    const inst = db.prepare('SELECT * FROM installments WHERE active=1 ORDER BY count').all();
    const models = db.prepare('SELECT id,name FROM models WHERE active=1 ORDER BY name COLLATE NOCASE').all();
    const bal = accountSummary(res.locals.bf.id, 'parca').balance;
    const credit = bal < 0 ? Math.round(-bal * 100) / 100 : 0;
    page(res, 'spare_new', 'Yedek Parça Sipariş Oluştur', { parts, inst, models, old, credit });
  };
  const back = m => { res.locals.flash = { type: 'danger', msg: m }; renderNew(); };
  const lines = [];
  ids.forEach((id, i) => {
    const qty = Math.floor(+qtys[i]);
    const p = id && db.prepare("SELECT * FROM products WHERE id=? AND kind='parca' AND active=1").get(+id);
    if (p && qty > 0 && qty <= 10000) lines.push({ p, qty });
  });
  if (!lines.length) return back('Sepete en az bir parça ve adet eklemelisiniz.');
  const overQty = checkMaxQty(lines);
  if (overQty) return back(overQty);
  const total = lines.reduce((s, l) => s + l.qty * l.p.price, 0);
  const bal = accountSummary(res.locals.bf.id, 'parca').balance;
  const available = bal < 0 ? Math.round(-bal * 100) / 100 : 0;
  const applied = Math.round(Math.min(available, total) * 100) / 100;
  const payable = Math.round((total - applied) * 100) / 100;
  const method = { kart: 'Kredi Kartı', nakit: 'Nakit', havale: 'Havale / EFT' }[b.pay_method];
  if (!method) return back('Ödeme yöntemini seçin.');
  const payer = String(b.payer_name || '').trim().slice(0, 120);
  if (payable > 0 && b.pay_method === 'havale' && !payer) return back('Havale / EFT için gönderen hesap ad soyad bilgisini giriniz.');

  let card = null;
  if (payable > 0 && b.pay_method === 'kart') {
    const inst = db.prepare('SELECT * FROM installments WHERE id=? AND active=1').get(+b.installment_id);
    const holder = String(b.holder || '').trim().slice(0, 80);
    const number = String(b.number || '').replace(/\s/g, '');
    const month = +b.month, year = +b.year, cvc = String(b.cvc || '');
    const now = new Date();
    if (!inst) return back('Taksit seçeneği seçin.');
    if (!holder) return back('Kart bilgileri geçersiz.');
    if (!(month >= 1 && month <= 12) || year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1))
      return back('Kartın son kullanma tarihi geçersiz.');
    if (!/^\d{3,4}$/.test(cvc)) return back('CVC geçersiz.');
    card = { inst, holder, last4: number.slice(-4) };
  }

  const fullyCovered = payable <= 0;
  let no;
  tx(() => {
    no = String(nextNo('spare_orders', 'no'));
    // Kredi kartı ödemesi başarıyla tamamlanmış sayılır ve sipariş anında onaylanır;
    // nakit/havale siparişler yönetici onayı bekler.
    const status = (card || fullyCovered) ? 'Siparişe Dönüştürüldü' : 'Beklemede';
    let payId = null;
    if (card) {
      const commission = Math.round(payable * card.inst.rate) / 100;
      payId = db.prepare(`INSERT INTO payments(user_id,firm_id,kind,amount,currency,description,installment,commission,total,card_holder,card_last4,status)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(res.locals.bu.id, res.locals.bf.id, 'odeme', payable, 'TL', 'Yedek Parça Siparişi #' + no,
        card.inst.label, commission, payable + commission, card.holder, card.last4, 'Tahsil Edildi').lastInsertRowid;
    }
    const oid = db.prepare("INSERT INTO spare_orders(firm_id,user_id,no,status,note,request_date,pay_method,payment_id,payer_name,balance_applied) VALUES(?,?,?,?,?,date('now'),?,?,?,?)")
      .run(res.locals.bf.id, res.locals.bu.id, no, status, String(b.note || '').slice(0, 1000), fullyCovered ? 'Bakiye (Alacak)' : method, payId, payer || null, applied).lastInsertRowid;
    const ins = db.prepare('INSERT INTO spare_order_items(order_id,part_code,part_name,qty,unit_price) VALUES(?,?,?,?,?)');
    lines.forEach(l => ins.run(oid, l.p.code, l.p.name, l.qty, l.p.price));
    // Sipariş ve (varsa) ödeme yedek parça cari hesabına işlenir
    syncOrderDebit('spare_orders', 'spare_order_items', oid, 'parca');
  });
  const creditMsg = applied > 0 ? ` Bakiyenizden ${fmtMoney(applied)} ₺ alacak kullanıldı${payable > 0 ? `, kalan ${fmtMoney(payable)} ₺ ödendi.` : ' olup siparişiniz tamamen bakiyenizden karşılandı.'}` : '';
  flash(req, 'success', ((card || fullyCovered) ? `${no} numaralı siparişiniz onaylandı.` : `${no} numaralı siparişiniz ${method} ödeme yöntemiyle kaydedildi. Yönetici onayından sonra hesabınıza işlenecektir.`) + creditMsg);
  res.redirect('/bayi/yedek-parca-siparisleri');
});

router.post('/stok-bildirim', (req, res) => {
  const pid = +req.body.product_id;
  const p = pid && db.prepare("SELECT id FROM products WHERE id=? AND active=1").get(pid);
  if (p) db.prepare('INSERT OR IGNORE INTO stock_notify(product_id,firm_id,user_id) VALUES(?,?,?)')
    .run(pid, res.locals.bf.id, res.locals.bu.id);
  res.json({ ok: !!p });
});

router.get('/yedek-parca-siparisleri', (req, res) => {
  const orders = db.prepare('SELECT * FROM spare_orders WHERE firm_id=? ORDER BY id DESC').all(res.locals.bf.id);
  orders.forEach(o => {
    o.items = db.prepare('SELECT * FROM spare_order_items WHERE order_id=?').all(o.id);
    o.total = o.items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  });
  page(res, 'spare_orders', 'Yedek Parça Siparişlerim', { orders });
});

module.exports = router;
