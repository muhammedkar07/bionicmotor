const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, tx, syncOrderDebit, nextNo, STATUS, logAudit } = require('../db');
const { flash, throttle, regenerate, fmtMoney, publicOrigin } = require('../lib/core');
const { checkMaxQty, createSpareCardOrder } = require('../lib/spareOrder');
const { accountSummary } = require('../lib/account');
const pay = require('../lib/pay');

const DUMMY = bcrypt.hashSync('x', 10);

router.get('/giris', (req, res) => {
  if (req.session.dealer) return res.redirect('/bayi');
  res.render('bayi/login', { title: 'Bayi Girişi' });
});

router.post('/giris', (req, res) => {
  const code = String(req.body.code || '')
    .trim()
    .slice(0, 50);
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
    logAudit({ type: 'bayi', name: code }, 'login_failed', 'dealer_user', null, null, req.ip);
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
    logAudit({ type: 'servis', id: u.id, name: u.code }, 'login', 'dealer_user', u.id, null, req.ip);
    return res.redirect('/servis');
  }
  if (u.role === null || u.role === '') db.prepare("UPDATE dealer_users SET role='bayi' WHERE id=?").run(u.id);
  regenerate(req, res, 'dealer');
  req.session.dealer = { userId: u.id, firmId: firms[0].id };
  req.saveSession();
  logAudit({ type: 'bayi', id: u.id, name: u.code }, 'login', 'dealer_user', u.id, { firm: firms[0].id }, req.ip);
  res.redirect('/bayi');
});

router.use((req, res, next) => {
  const d = req.session.dealer;
  const u = d && db.prepare('SELECT * FROM dealer_users WHERE id=? AND active=1').get(d.userId);
  if (u && u.role === 'servis') return res.redirect('/servis');
  const f =
    u &&
    db
      .prepare('SELECT f.* FROM firms f JOIN user_firms uf ON uf.firm_id=f.id WHERE uf.user_id=? AND f.id=? AND f.active=1')
      .get(u.id, d.firmId);
  if (!f) return res.redirect('/bayi/giris');
  res.locals.bu = u;
  res.locals.bf = f;
  res.locals.multiFirm = db.prepare('SELECT COUNT(*) c FROM user_firms WHERE user_id=?').get(u.id).c > 1;
  res.locals.bell = db
    .prepare('SELECT COUNT(*) c FROM announcements WHERE active=1 AND (? IS NULL OR created_at > ?)')
    .get(u.ann_seen_at, u.ann_seen_at).c;
  next();
});

const page = (res, view, title, extra = {}) => res.render('bayi/' + view, { title, ...extra });

router.get('/', (req, res) => {
  const unread = db
    .prepare('SELECT * FROM announcements WHERE active=1 AND (? IS NULL OR created_at > ?) ORDER BY created_at DESC, id DESC')
    .all(res.locals.bu.ann_seen_at, res.locals.bu.ann_seen_at);
  db.prepare("UPDATE dealer_users SET ann_seen_at=datetime('now') WHERE id=?").run(res.locals.bu.id);
  res.locals.bell = 0;
  page(res, 'home', 'Bayi Portalı', { unread });
});

router.post('/cikis', (req, res) => {
  if (res.locals.bu)
    logAudit({ type: 'bayi', id: res.locals.bu.id, name: res.locals.bu.code }, 'logout', 'dealer_user', res.locals.bu.id, null, req.ip);
  regenerate(req, res, 'dealer');
  flash(req, 'danger', 'Başarıyla çıkış yaptınız.');
  res.redirect('/bayi/giris');
});

router.get('/firma-degistir', (req, res) => {
  const firms = db
    .prepare('SELECT f.* FROM firms f JOIN user_firms uf ON uf.firm_id=f.id WHERE uf.user_id=? AND f.active=1 ORDER BY f.name')
    .all(res.locals.bu.id);
  page(res, 'firms', 'Firma Değiştir', { firms });
});
router.post('/firma-degistir', (req, res) => {
  const f = db
    .prepare('SELECT f.id FROM firms f JOIN user_firms uf ON uf.firm_id=f.id WHERE uf.user_id=? AND f.id=? AND f.active=1')
    .get(res.locals.bu.id, +req.body.firm_id);
  if (f) {
    req.session.dealer.firmId = f.id;
    req.saveSession();
  }
  res.redirect('/bayi');
});

router.get('/siparisler', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE firm_id=? AND deleted_at IS NULL ORDER BY request_date,id').all(res.locals.bf.id);
  page(res, 'orders', 'Sipariş Taleplerim', { orders });
});
router.get('/siparisler/:id', (req, res, next) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=? AND firm_id=? AND deleted_at IS NULL').get(+req.params.id, res.locals.bf.id);
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
  const ids = [].concat(b.product_id || []),
    qtys = [].concat(b.qty || []);
  const old = {
    lines: ids.map((id, i) => [+id || '', String(qtys[i] ?? '').trim()]),
    note: String(b.note || '').slice(0, 1000)
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
  let newOid;
  tx(() => {
    // Talep oluşturmak tutarı etkilemez; "Siparişe Dönüştürüldü" olunca borca işlenir ve stok düşer.
    const oid = db
      .prepare(
        `INSERT INTO orders(firm_id,request_date,request_no,delivery_date,delivery_type,status,note) VALUES(?,date('now'),?,NULL,'İleri Vadeli Teslim','Beklemede',?)`
      )
      .run(res.locals.bf.id, no, old.note || null).lastInsertRowid;
    newOid = oid;
    const ins = db.prepare('INSERT INTO order_items(order_id,product_name,qty,unit_price) VALUES(?,?,?,?)');
    lines.forEach(l => ins.run(oid, l.p.name, l.qty, l.p.price));
  });
  logAudit(
    { type: 'bayi', id: res.locals.bu.id, name: res.locals.bu.code },
    'create',
    'orders',
    newOid,
    { no, lines: lines.map(l => ({ name: l.p.name, qty: l.qty, unit_price: l.p.price })) },
    req.ip
  );
  flash(
    req,
    'success',
    `${no} numaralı sipariş talebiniz oluşturuldu. Oluşturma sırasında tutar ve stok etkilenmez; talebinizin "Siparişe Dönüştürüldü" durumuna geçirilmesi beklenir.`
  );
  res.redirect('/bayi/siparisler');
});

router.get('/stoklar', (req, res) => {
  const rows = db
    .prepare(
      `
    SELECT p.id, p.name, p.code, p.category, p.price, COALESCE(fs.qty,0) AS qty
    FROM products p
    LEFT JOIN firm_stock fs ON fs.product_id=p.id AND fs.firm_id=?
    WHERE p.kind='arac' AND p.active=1 AND COALESCE(fs.qty,0) > 0
    ORDER BY p.category, p.name`
    )
    .all(res.locals.bf.id);
  page(res, 'stoklar', 'Stoklarım', { rows });
});

router.get('/hesap-ozeti', (req, res) => {
  page(res, 'account', 'Hesap Özeti', { a: accountSummary(res.locals.bf.id, 'ana'), heading: 'Hesap Özeti', showCards: true });
});
router.get('/yedek-parca-ekstre', (req, res) => {
  page(res, 'account', 'Yedek Parça Hesap Ekstresi', {
    a: accountSummary(res.locals.bf.id, 'parca'),
    heading: 'Yedek Parça Hesap Ekstresi',
    showCards: false
  });
});

router.get('/odeme', (req, res) => {
  const inst = db.prepare('SELECT * FROM installments WHERE active=1 ORDER BY count').all();
  page(res, 'odeme', 'Online Ödeme', { inst, base: '/bayi/odeme' });
});
router.post('/odeme/ode', async (req, res) => {
  const b = req.body;
  const ctx = { userId: res.locals.bu.id, firmId: res.locals.bf.id, source: 'bayi', origin: publicOrigin(req) };
  const method = ['kart', 'havale'].includes(b.method) ? b.method : 'kart';
  if (method === 'havale') {
    const r = pay.havale(ctx, b);
    flash(req, r.error ? 'danger' : 'success', r.error || r.msg);
    return res.redirect('/bayi/odeme');
  }
  try {
    const r = await pay.beginCard(ctx, b);
    if (r.error) {
      flash(req, 'danger', r.error);
      return res.redirect('/bayi/odeme');
    }
    res.redirect(r.redirect);
  } catch (e) {
    flash(req, 'danger', 'Ödeme başlatılamadı: ' + e.message);
    res.redirect('/bayi/odeme');
  }
});
router.post('/odeme/talimat', (req, res) => {
  const r = pay.talimat({ userId: res.locals.bu.id, firmId: res.locals.bf.id }, req.body);
  flash(req, r.error ? 'danger' : 'success', r.error || r.msg);
  res.redirect('/bayi/odeme');
});

router.get('/duyurular', (req, res) => {
  const list = db.prepare('SELECT * FROM announcements WHERE active=1 ORDER BY created_at DESC, id DESC').all();
  const seen = res.locals.bu.ann_seen_at;
  list.forEach(a => {
    a.isNew = !seen || a.created_at > seen;
  });
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
  const rows = q
    ? db
        .prepare('SELECT * FROM warranty_records WHERE firm_id=? AND serial_no LIKE ? ORDER BY sale_date DESC')
        .all(res.locals.bf.id, `%${q}%`)
    : [];
  page(res, 'warranty', 'Garanti Kayıtları', { rows, q });
});

router.get('/yedek-parca/yeni', (req, res) => {
  const parts = db.prepare("SELECT * FROM products WHERE kind='parca' AND active=1 ORDER BY category,name").all();
  const inst = db.prepare('SELECT * FROM installments WHERE active=1 ORDER BY count').all();
  const models = db.prepare('SELECT id,name FROM models WHERE active=1 ORDER BY name COLLATE NOCASE').all();
  const bal = accountSummary(res.locals.bf.id, 'parca').balance;
  const credit = bal < 0 ? -bal : 0;
  page(res, 'spare_new', 'Yedek Parça Sipariş Oluştur', { parts, inst, models, old: null, credit });
});
router.post('/yedek-parca/yeni', async (req, res) => {
  const b = req.body;
  const ids = [].concat(b.part_id || []),
    qtys = [].concat(b.qty || []);
  const old = {
    lines: ids.map((id, i) => [+id || '', String(qtys[i] ?? '').trim()]),
    note: String(b.note || '').slice(0, 1000),
    pay_method: b.pay_method || 'kart',
    payer_name: String(b.payer_name || '').slice(0, 120),
    installment_id: b.installment_id || ''
  };
  const renderNew = () => {
    const parts = db.prepare("SELECT * FROM products WHERE kind='parca' AND active=1 ORDER BY category,name").all();
    const inst = db.prepare('SELECT * FROM installments WHERE active=1 ORDER BY count').all();
    const models = db.prepare('SELECT id,name FROM models WHERE active=1 ORDER BY name COLLATE NOCASE').all();
    const bal = accountSummary(res.locals.bf.id, 'parca').balance;
    const credit = bal < 0 ? -bal : 0;
    page(res, 'spare_new', 'Yedek Parça Sipariş Oluştur', { parts, inst, models, old, credit });
  };
  const back = m => {
    res.locals.flash = { type: 'danger', msg: m };
    renderNew();
  };
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
  const available = bal < 0 ? -bal : 0;
  const applied = Math.min(available, total);
  const payable = total - applied;
  const method = { kart: 'Kredi Kartı', nakit: 'Nakit', havale: 'Havale / EFT' }[b.pay_method];
  if (!method) return back('Ödeme yöntemini seçin.');
  const payer = String(b.payer_name || '')
    .trim()
    .slice(0, 120);
  if (payable > 0 && b.pay_method === 'havale' && !payer) return back('Havale / EFT için gönderen hesap ad soyad bilgisini giriniz.');
  const fullyCovered = payable <= 0;

  // Kredi kartı: kart bilgisi alınmaz; sipariş "Beklemede" kaydedilir ve Paratika ödeme
  // sayfasına yönlendirilir. Ödeme doğrulanınca siparişe dönüştürülüp cariye işlenir.
  if (payable > 0 && b.pay_method === 'kart') {
    const no = String(nextNo('spare_orders', 'no'));
    let r;
    try {
      r = await createSpareCardOrder({
        userId: res.locals.bu.id,
        firmId: res.locals.bf.id,
        source: 'bayi',
        origin: publicOrigin(req),
        no,
        note: String(b.note || '').slice(0, 1000),
        payer,
        applied,
        method,
        lines,
        payable,
        installmentId: b.installment_id
      });
    } catch (e) {
      return back('Ödeme başlatılamadı: ' + e.message);
    }
    if (r.error) return back(r.error);
    logAudit(
      { type: 'bayi', id: res.locals.bu.id, name: res.locals.bu.code },
      'create',
      'spare_orders',
      r.orderId,
      { no, method: 'Kredi Kartı', payable, payment_id: r.paymentId },
      req.ip
    );
    const creditMsg = applied > 0 ? ` Bakiyenizden ${fmtMoney(applied)} ₺ alacak kullanıldı.` : '';
    flash(req, 'success', `${no} numaralı siparişiniz kaydedildi. Ödeme için güvenli ödeme sayfasına yönlendiriliyorsunuz.` + creditMsg);
    return res.redirect(r.redirect);
  }

  let no;
  let newOid;
  tx(() => {
    no = String(nextNo('spare_orders', 'no'));
    // Tamamen bakiyeden karşılanan sipariş anında onaylanır; nakit/havale yönetici onayı bekler.
    const status = fullyCovered ? STATUS.CONVERTED : STATUS.PENDING;
    const oid = db
      .prepare(
        "INSERT INTO spare_orders(firm_id,user_id,no,status,note,request_date,pay_method,payer_name,balance_applied) VALUES(?,?,?,?,?,date('now'),?,?,?)"
      )
      .run(
        res.locals.bf.id,
        res.locals.bu.id,
        no,
        status,
        String(b.note || '').slice(0, 1000),
        fullyCovered ? 'Bakiye (Alacak)' : method,
        payer || null,
        applied
      ).lastInsertRowid;
    newOid = oid;
    const ins = db.prepare('INSERT INTO spare_order_items(order_id,part_code,part_name,qty,unit_price) VALUES(?,?,?,?,?)');
    lines.forEach(l => ins.run(oid, l.p.code, l.p.name, l.qty, l.p.price));
    syncOrderDebit('spare_orders', 'spare_order_items', oid, 'parca');
  });
  logAudit(
    { type: 'bayi', id: res.locals.bu.id, name: res.locals.bu.code },
    'create',
    'spare_orders',
    newOid,
    { no, method: fullyCovered ? 'Bakiye (Alacak)' : method, payable, applied },
    req.ip
  );
  const creditMsg =
    applied > 0
      ? ` Bakiyenizden ${fmtMoney(applied)} ₺ alacak kullanıldı${payable > 0 ? `, kalan ${fmtMoney(payable)} ₺ ödendi.` : ' olup siparişiniz tamamen bakiyenizden karşılandı.'}`
      : '';
  const msg = fullyCovered
    ? `${no} numaralı siparişiniz onaylandı.`
    : `${no} numaralı siparişiniz ${method} ödeme yöntemiyle kaydedildi. Yönetici onayından sonra hesabınıza işlenecektir.`;
  flash(req, 'success', msg + creditMsg);
  res.redirect('/bayi/yedek-parca-siparisleri');
});

router.post('/stok-bildirim', (req, res) => {
  const pid = +req.body.product_id;
  const p = pid && db.prepare('SELECT id FROM products WHERE id=? AND active=1').get(pid);
  if (p)
    db.prepare('INSERT OR IGNORE INTO stock_notify(product_id,firm_id,user_id) VALUES(?,?,?)').run(pid, res.locals.bf.id, res.locals.bu.id);
  res.json({ ok: !!p });
});

router.get('/yedek-parca-siparisleri', (req, res) => {
  const orders = db.prepare('SELECT * FROM spare_orders WHERE firm_id=? AND deleted_at IS NULL ORDER BY id DESC').all(res.locals.bf.id);
  const ids = orders.map(o => o.id);
  const items = ids.length
    ? db.prepare(`SELECT * FROM spare_order_items WHERE order_id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : [];
  const byOrder = {};
  for (const it of items) (byOrder[it.order_id] = byOrder[it.order_id] || []).push(it);
  orders.forEach(o => {
    o.items = byOrder[o.id] || [];
    o.total = o.items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  });
  page(res, 'spare_orders', 'Yedek Parça Siparişlerim', { orders });
});

module.exports = router;
