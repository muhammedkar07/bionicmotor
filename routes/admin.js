const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, tx, set, nextNo, nextFirmCode, nextUserCode, syncOrderDebit } = require('../db');
const { flash, throttle, regenerate, fmtDate, fmtDateTime, fmtMoney, addYears } = require('../lib/core');

const DUMMY = bcrypt.hashSync('x', 10);
const T = (name, label, extra = {}) => ({ name, label, type: 'text', ...extra });
const N = (name, label, extra = {}) => ({ name, label, type: 'number', ...extra });
const D = (name, label, extra = {}) => ({ name, label, type: 'date', ...extra });
const A = (name, label, extra = {}) => ({ name, label, type: 'textarea', ...extra });
const C = (name, label = 'Aktif') => ({ name, label, type: 'checkbox', def: 1 });
const R = (name, label, ref, refLabel = 'name', extra = {}) => ({ name, label, type: 'ref', ref, refLabel, ...extra });
const S = (name, label, options, extra = {}) => ({ name, label, type: 'select', options, ...extra });
const I = (name, label) => ({ name, label, type: 'image' });
const RO = (name, label, extra = {}) => ({ name, label, type: 'readonly', ...extra });
const AUTO = (name, label, hint) => ({ name, label, type: 'auto', hint });
const FIRM = R('firm_id', 'Firma', 'firms', 'name', { required: true });
const DELIVERY = ['İleri Vadeli Teslim', 'Peşin Teslim', 'Fabrikadan Teslim', 'Kargo ile Gönderim', 'Nakliye ile Sevk'];
const PRODUCT = (name, label, kind) => ({ name, label, type: 'product', kind });

const RES = {
  firms: { title: 'Firmalar (Bayiler)', table: 'firms', group: 'Bayi Yönetimi', order: 'id DESC',
    list: ['code', 'name', 'city', 'phone', 'active'],
    fields: [AUTO('code', 'Cari Kodu', 'Kaydedildiğinde sistem tarafından otomatik verilir'), T('name', 'Firma Adı', { required: true }), T('city', 'Şehir'), T('phone', 'Telefon'), T('email', 'E-posta'),
      N('devir', 'Önceki Dönemden Devir (₺)'), N('devir_parca', 'Yedek Parça Devir (₺)'), C('active')] },
  users: { title: 'Bayi Kullanıcıları', table: 'dealer_users', group: 'Bayi Yönetimi',
    list: ['code', 'name', 'email', 'role', 'active'],
    fields: [{ name: 'firms', label: 'Erişebildiği Firmalar', type: 'multi' },
      AUTO('code', 'Kullanıcı Kodu', 'Firma seçildiğinde otomatik verilir (firma sırasına göre artar)'), T('name', 'Ad Soyad', { required: true }),
      T('email', 'E-posta (online ödeme girişi)', { nullable: true }),
      S('role', 'Rol', ['bayi', 'servis'], { def: 'bayi' }),
      { name: 'password', label: 'Parola (boş bırakılırsa değişmez)', type: 'password' }, C('active')] },
  orders: { title: 'Sipariş Talepleri', table: 'orders', group: 'Bayi Yönetimi',
    list: ['request_date', 'request_no', 'firm_id', 'delivery_date', 'delivery_type', 'status'], order: 'CAST(request_no AS INTEGER) DESC, rowid DESC',
    fields: [FIRM, D('request_date', 'Talep Tarihi', { today: true }), AUTO('request_no', 'Talep No', 'Otomatik verilir (1\'den başlayarak artar)'),
      D('delivery_date', 'Teslim Tarihi'), S('delivery_type', 'Teslim Şekli', DELIVERY, { def: 'İleri Vadeli Teslim' }),
      S('status', 'Talep Durumu', ['Beklemede', 'Siparişe Dönüştürüldü', 'İptal Edildi'], { def: 'Beklemede',
        help: 'Siparişe dönüştürüldüğünde sipariş tutarı firmanın hesap hareketlerine borç olarak eklenir.' }), A('note', 'Not')],
    debit: { items: 'order_items', ledger: 'ana' },
    children: { table: 'order_items', fk: 'order_id', title: 'Talep İçeriği', kind: 'arac',
      cols: [PRODUCT('product_name', 'Ürün', 'arac'), N('qty', 'Adet', { def: 1 }), N('unit_price', 'Birim Fiyat')] } },
  movements: { title: 'Hesap Hareketleri', table: 'account_movements', group: 'Bayi Yönetimi',
    list: ['date', 'firm_id', 'ledger', 'doc_type', 'cheque_no', 'amount'], order: 'date DESC, rowid DESC',
    fields: [FIRM, S('ledger', 'Hesap', ['ana', 'parca'], { def: 'ana' }), D('date', 'Tarih'),
      S('doc_type', 'Ödeme Türü', ['Nakit', 'Kart', 'Çek/Senet']),
      T('bank', 'Banka', { nullable: true }),
      T('cheque_no', 'Çek/Senet No', { nullable: true }),
      S('cheque_type', 'Çek Türü', ['Senet', 'Çek'], { def: 'Çek' }),
      D('cheque_due', 'Vadesi', { nullable: true }),
      { name: 'receipt', label: 'Dekont (isteğe bağlı)', type: 'file' },
      S('kind', 'Yön', ['borc', 'alacak', 'bilgi'], { help: 'borç: bakiyeyi düşürür · alacak: artırır · bilgi: bakiyeyi etkilemez (vadesi gelmemiş çek)' }),
      T('payer_name', 'Gönderen Adı Soyadı', { nullable: true }),
      T('doc_no', 'Belge No', { nullable: true }),
      N('amount', 'Tutar (₺)', { required: true })] },
  announcements: { title: 'Duyurular', table: 'announcements', group: 'Bayi Yönetimi',
    list: ['created_at', 'text', 'author', 'active'], order: 'created_at DESC, id DESC',
    fields: [A('text', 'Duyuru Metni', { required: true, rows: 8 }), T('author', 'Yayınlayan', { def: 'Satış Sonrası Hizmetler Müdürlüğü' }), C('active')] },
  products: { title: 'Ürünler / Fiyat Listesi', table: 'products', group: 'Bayi Yönetimi',
    list: ['kind', 'code', 'name', 'category', 'price', 'active'], order: 'id DESC',
    fields: [S('kind', 'Tür', ['arac', 'parca'], { def: 'arac', help: 'arac: toptan fiyat listesi · parca: yedek parça sipariş listesi' }),
      T('code', 'Kod'), T('name', 'Ürün Adı', { required: true }), { name: 'category', label: 'Kategori', type: 'category' }, N('price', 'Toptan Fiyat (₺)'), C('active')] },
  warranty: { title: 'Garanti Kayıtları', table: 'warranty_records', group: 'Satış Sonrası',
    list: ['serial_no', 'firm_id', 'model', 'customer', 'invoice_no', 'sale_date', 'warranty_end', 'status'],
    fields: [FIRM, T('serial_no', 'Şase No', { required: true }), T('model', 'Model'), T('customer', 'Müşteri'), T('invoice_no', 'Fatura No', { required: true }),
      D('sale_date', 'Satış Tarihi', { required: true }), RO('warranty_end', 'Garanti Bitiş'), T('status', 'Durum', { def: 'Aktif' })] },
  workorders: { title: 'İş Emirleri', table: 'work_orders', group: 'Satış Sonrası', noCreate: true,
    list: ['created_at', 'no', 'firm_id', 'serial_no', 'type', 'status'],
    fields: [RO('no', 'İş Emri No'), RO('firm_id', 'Firma', { ref: 'firms' }), RO('serial_no', 'Şase No'), RO('model', 'Model'), RO('km', 'Km'),
      S('type', 'Tür (Bayi seçemez, yönetici belirler)', ['', 'Garanti', 'Ücretli', 'Sevkiyat Hasarı'], { def: '' }),
      RO('description', 'Açıklama'), RO('image', 'Görsel', { image: true }),
      S('status', 'Durum', ['Beklemede', 'İnceleniyor', 'Onaylandı', 'Tamamlandı', 'Reddedildi']), A('admin_note', 'Yönetici Notu')] },
  spareorders: { title: 'Yedek Parça Siparişleri', table: 'spare_orders', group: 'Satış Sonrası',
    list: ['request_date', 'no', 'firm_id', 'pay_method', 'delivery_date', 'delivery_method', 'status'], order: 'CAST(no AS INTEGER) DESC, rowid DESC',
    fields: [FIRM, D('request_date', 'Talep Tarihi', { today: true }), AUTO('no', 'Talep No', 'Otomatik verilir (1\'den başlayarak artar)'),
      D('delivery_date', 'Teslim Tarihi'), S('delivery_method', 'Teslim Şekli', DELIVERY, { def: 'İleri Vadeli Teslim' }),
      RO('pay_method', 'Ödeme Yöntemi'),
      S('status', 'Durum', ['Beklemede', 'Siparişe Dönüştürüldü', 'Hazırlanıyor', 'Sevk Edildi', 'Tamamlandı', 'İptal'], { def: 'Beklemede',
        help: 'Beklemede/İptal dışındaki her durumda tutar firmanın Yedek Parça hesabına borç olarak eklenir.' }), A('note', 'Not')],
    debit: { items: 'spare_order_items', ledger: 'parca' },
    children: { table: 'spare_order_items', fk: 'order_id', title: 'Talep İçeriği', kind: 'parca',
      cols: [PRODUCT('part_name', 'Parça', 'parca'), T('part_code', 'Kod'), N('qty', 'Adet', { def: 1 }), N('unit_price', 'Birim Fiyat')] } },
  payments: { title: 'Online Ödemeler', table: 'payments', group: 'Satış Sonrası', noCreate: true,
    list: ['created_at', 'kind', 'firm_id', 'amount', 'currency', 'installment', 'card_last4', 'status'],
    fields: [RO('kind', 'Tür'), RO('firm_id', 'Firma', { ref: 'firms' }), RO('amount', 'Tutar'), RO('currency', 'Para Birimi'), RO('installment', 'Taksit'),
      RO('total', 'Toplam'), RO('card_holder', 'Kart Sahibi'), RO('card_last4', 'Kart Son 4'), RO('description', 'Açıklama'),
      S('status', 'Durum', ['Sanal POS Bekliyor', 'Talimat Oluşturuldu', 'Onaylandı', 'Tahsil Edildi', 'İptal'])] },
  installments: { title: 'Taksit / Komisyon', table: 'installments', group: 'Online Ödeme',
    list: ['label', 'count', 'rate', 'active'], order: 'count',
    fields: [T('label', 'Etiket', { required: true }), N('count', 'Taksit Sayısı', { required: true }), N('rate', 'Komisyon Oranı (%)'), C('active')] },
  slides: { title: 'Ana Sayfa Slider', table: 'slides', group: 'Web Sitesi', list: ['sort', 'title', 'new_price', 'active'], order: 'sort',
    fields: [I('image', 'Görsel (yüklenirse yazılar gösterilmez)'), T('title', 'Başlık'), T('subtitle', 'Alt Yazı'), T('old_price', 'Eski Fiyat'), T('new_price', 'Yeni Fiyat'),
      T('bg', 'Arka Plan Rengi (#hex)', { def: '#111111' }), T('link', 'Bağlantı'), N('sort', 'Sıra', { def: 0 }), C('active')] },
  models: { title: 'Modeller', table: 'models', group: 'Web Sitesi', list: ['sort', 'name', 'category', 'cc', 'price', 'active'], order: 'sort',
    fields: [T('name', 'Model Adı', { required: true }), T('category', 'Kategori'), T('cc', 'Hacim'), T('power', 'Güç'), T('gearbox', 'Şanzıman'),
      A('description', 'Açıklama'), I('image', 'Görsel'), N('price', 'Perakende Fiyat (₺)'), N('sort', 'Sıra', { def: 0 }), C('active')] },
  faqs: { title: 'Sıkça Sorulan Sorular', table: 'faqs', group: 'Web Sitesi', list: ['sort', 'question', 'active'], order: 'sort',
    fields: [T('question', 'Soru', { required: true }), A('answer', 'Cevap'), N('sort', 'Sıra', { def: 0 }), C('active')] },
  points: { title: 'Satış ve Servis Noktaları', table: 'points', group: 'Web Sitesi', list: ['name', 'type', 'city', 'phone', 'active'],
    fields: [T('name', 'Ad', { required: true }), T('type', 'Tür'), T('city', 'İl'), T('address', 'Adres'), T('phone', 'Telefon'), C('active')] },
  pages: { title: 'Sayfalar (HTML)', table: 'pages', group: 'Web Sitesi', list: ['slug', 'title'], noCreate: false,
    fields: [T('slug', 'Adres (slug)', { required: true, slug: true }), T('title', 'Başlık', { required: true }), A('body', 'İçerik (HTML)', { rows: 14 })] },
  messages: { title: 'İletişim Mesajları', table: 'messages', group: 'Gelen Kutusu', noCreate: true,
    list: ['created_at', 'name', 'email', 'phone', 'is_read'],
    fields: [RO('name', 'Ad Soyad'), RO('email', 'E-posta'), RO('phone', 'Telefon'), RO('message', 'Mesaj'), C('is_read', 'Okundu')] },
  applications: { title: 'Bayilik Başvuruları', table: 'applications', group: 'Gelen Kutusu', noCreate: true,
    list: ['created_at', 'name', 'city', 'district', 'phone', 'status'],
    fields: [RO('name', 'Ad Soyad'), RO('city', 'İl'), RO('district', 'İlçe'), RO('phone', 'Telefon'), RO('note', 'Açıklama'),
      S('status', 'Durum', ['Yeni', 'Görüşüldü', 'Olumlu', 'Olumsuz'])] }
};

const SETTINGS = [
  ['Marka', [['brand_1', 'Logo Yazısı - 1. Kısım'], ['brand_2', 'Logo Yazısı - 2. Kısım (kırmızı)'], ['logo_image', 'Logo Görseli', 'image'], ['company', 'Firma Ünvanı']]],
  ['İletişim', [['phone', 'Telefon'], ['email', 'E-posta'], ['branch', 'Şube Adı'], ['address', 'Adres'], ['map_lat', 'Harita Enlem'], ['map_lng', 'Harita Boylam']]],
  ['Sosyal Medya / Bağlantılar', [['facebook', 'Facebook'], ['instagram', 'Instagram'], ['youtube', 'YouTube'], ['eticaret_url', 'E-Ticaret Adresi']]],
  ['Online Ödeme', [['eur_rate', 'EUR Kuru'], ['usd_rate', 'USD Kuru']]],
  ['Diğer', [['footer_note', 'Alt Bilgi Metni']]]
];

router.get('/giris', (req, res) => {
  if (req.session.admin) return res.redirect('/admin');
  res.render('admin/login', { title: 'Yönetici Girişi' });
});
router.post('/giris', (req, res) => {
  const username = String(req.body.username || '').trim().slice(0, 60);
  const t = throttle('admin:' + req.ip + ':' + username, 6);
  if (t.blocked) { flash(req, 'danger', 'Çok fazla hatalı deneme. Daha sonra tekrar deneyin.'); return res.redirect('/admin/giris'); }
  const a = db.prepare('SELECT * FROM admins WHERE username=?').get(username);
  if (!(bcrypt.compareSync(String(req.body.password || '').slice(0, 200), a ? a.password_hash : DUMMY) && a)) {
    t.hit(); flash(req, 'danger', 'Kullanıcı adı veya parola hatalı.'); return res.redirect('/admin/giris');
  }
  t.reset();
  regenerate(req, res, 'admin');
  req.session.admin = { id: a.id };
  req.saveSession();
  res.redirect('/admin');
});

router.use((req, res, next) => {
  const a = req.session.admin && db.prepare('SELECT id,username,name FROM admins WHERE id=?').get(req.session.admin.id);
  if (!a) return res.redirect('/admin/giris');
  res.locals.admin = a;
  res.locals.menu = Object.entries(RES).reduce((m, [k, r]) => ((m[r.group] = m[r.group] || []).push({ key: k, title: r.title }), m), {});
  res.locals.res = null;
  res.locals.path = req.path;
  res.locals.badges = {
    messages: db.prepare('SELECT COUNT(*) c FROM messages WHERE is_read=0').get().c,
    applications: db.prepare("SELECT COUNT(*) c FROM applications WHERE status='Yeni'").get().c,
    workorders: db.prepare("SELECT COUNT(*) c FROM work_orders WHERE status='Beklemede'").get().c,
    spareorders: db.prepare("SELECT COUNT(*) c FROM spare_orders WHERE status='Beklemede'").get().c,
    payments: db.prepare("SELECT COUNT(*) c FROM payments WHERE status IN ('Sanal POS Bekliyor','Talimat Oluşturuldu')").get().c
  };
  next();
});

router.post('/cikis', (req, res) => { regenerate(req, res, 'admin'); res.redirect('/admin/giris'); });

router.get('/', (req, res) => {
  const c = t => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  res.render('admin/dashboard', { title: 'Panel', stats: [
    ['Firmalar', c('firms'), 'firms'], ['Bayi Kullanıcıları', c('dealer_users'), 'users'], ['Sipariş Talepleri', c('orders'), 'orders'],
    ['Okunmamış Mesaj', res.locals.badges.messages, 'messages'], ['Yeni Bayilik Başvurusu', res.locals.badges.applications, 'applications'],
    ['Bekleyen İş Emri', res.locals.badges.workorders, 'workorders'], ['Bekleyen Yedek Parça Siparişi', res.locals.badges.spareorders, 'spareorders'],
    ['Bekleyen Ödeme', res.locals.badges.payments, 'payments']] });
});

// ---- Genel CRUD ----
function refMap(f) {
  const rows = db.prepare(`SELECT rowid AS id, ${f.refLabel || 'name'} AS label FROM ${f.ref} ORDER BY 2`).all();
  return rows;
}

router.param('res', (req, res, next, key) => {
  const r = RES[key];
  if (!r) return res.status(404).send('Bulunamadı');
  res.locals.res = { key, ...r };
  req.r = r;
  next();
});

function cell(f, v, refs) {
  if (v === null || v === undefined) return '';
  if (f.type === 'checkbox') return v ? '✓' : '—';
  if (f.type === 'date') return fmtDate(v);
  if (f.name === 'created_at') return fmtDateTime(v);
  if (f.type === 'ref' || f.ref) { const m = (refs[f.name] || []).find(x => x.id === v); return m ? m.label : v; }
  if (f.type === 'number' || ['amount', 'price'].includes(f.name)) return fmtMoney(v, 0);
  const s = String(v);
  return s.length > 90 ? s.slice(0, 90) + '…' : s;
}

router.get('/r/:res', (req, res) => {
  const r = req.r;
  const all = [...r.fields, { name: 'created_at', label: 'Tarih' }, { name: 'id', label: 'No' }];
  const cols = r.list.map(n => all.find(f => f.name === n) || { name: n, label: n });
  const refs = {};
  r.fields.filter(f => f.ref).forEach(f => { refs[f.name] = refMap(f); });
  const q = String(req.query.q || '').trim();
  const firm = req.query.firm ? +req.query.firm : null;
  const textCols = r.fields.filter(f => ['text', 'textarea', 'readonly'].includes(f.type) && !f.ref).map(f => f.name);
  let where = [];
  if (q && textCols.length) where.push('(' + textCols.map(c => `${c} LIKE @q`).join(' OR ') + ')');
  if (r.table === 'account_movements' && firm) where.push('firm_id=@firm');
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sql = `SELECT rowid AS _id, * FROM ${r.table} ${whereSql} ORDER BY ${r.order || 'rowid DESC'} LIMIT 500`;
  const params = { q: `%${q}%` };
  if (r.table === 'account_movements' && firm) params.firm = firm;
  const rows = db.prepare(sql).all(params);
  const firms = db.prepare('SELECT id,name FROM firms ORDER BY name').all();
  res.render('admin/list', { title: r.title, cols, rows, refs, cell, q, firm: firm || '', firms: firms });
});

function loadForm(req, res, id) {
  const r = req.r;
  const row = id ? db.prepare(`SELECT rowid AS _id, * FROM ${r.table} WHERE rowid=?`).get(id) : null;
  const refs = {};
  r.fields.filter(f => f.type === 'ref' || f.ref).forEach(f => { refs[f.name] = refMap(f); });
  let multi = null;
  if (r.table === 'dealer_users') {
    multi = { all: db.prepare('SELECT id,name FROM firms ORDER BY id DESC').all(),
      sel: id ? db.prepare('SELECT firm_id FROM user_firms WHERE user_id=?').all(id).map(x => x.firm_id) : [] };
  }
  const kids = r.children && id ? db.prepare(`SELECT * FROM ${r.children.table} WHERE ${r.children.fk}=?`).all(id) : [];
  const catalog = r.children && r.children.kind
    ? db.prepare("SELECT code,name,category,price FROM products WHERE kind=? AND active=1 ORDER BY category, name").all(r.children.kind) : [];
  const categories = db.prepare('SELECT name FROM categories ORDER BY name COLLATE NOCASE').all().map(x => x.name);
  return { row, refs, multi, kids, catalog, categories, today: new Date().toISOString().slice(0, 10) };
}

router.get('/r/:res/new', (req, res, next) => {
  if (req.r.noCreate) return next();
  res.render('admin/form', { title: req.r.title + ' - Yeni', ...loadForm(req, res, null) });
});
router.get('/r/:res/:id', (req, res, next) => {
  const id = +req.params.id;
  const f = loadForm(req, res, id);
  if (!f.row) return next();
  if (req.r.table === 'messages') db.prepare('UPDATE messages SET is_read=1 WHERE id=?').run(id);
  res.render('admin/form', { title: req.r.title + ' - Düzenle', ...f });
});

const num = v => { const n = parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
// Giriş "1.250,50" (TR) veya "1250.50" olabilir
const numAny = v => {
  const s = String(v ?? '').trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  return num(s);
};

router.post('/r/:res/save', (req, res) => {
  const r = req.r, b = req.body, id = +b._id || 0;
  if (!id && r.noCreate) return res.status(403).send('Yetkisiz');
  const data = {};
  let debitTotal = 0;
  try {
    const firmIds = [].concat(b.firms || []).map(Number).filter(Boolean);
    if (r.table === 'dealer_users' && !firmIds.length) throw new Error('En az bir firma seçmelisiniz.');
    for (const f of r.fields) {
      if (f.type === 'readonly' || f.type === 'multi') continue;
      if (r.table === 'warranty_records' && f.name === 'warranty_end') continue;
      if (f.type === 'auto') {
        if (!id) data[f.name] = r.table === 'firms' ? nextFirmCode()
          : r.table === 'dealer_users' ? nextUserCode(firmIds[0]) : String(nextNo(r.table, f.name));
        continue;
      }
      let v = b[f.name];
      if (f.type === 'category') {
        v = String(v ?? '').trim();
        if (v) db.prepare('INSERT OR IGNORE INTO categories(name) VALUES(?)').run(v);
      } else if (f.type === 'checkbox') v = v ? 1 : 0;
      else if (f.type === 'number') v = numAny(v);
      else if (f.type === 'ref') v = +v || null;
      else if (f.type === 'password') {
        v = String(v || '');
        if (!v) { if (!id) throw new Error('Parola zorunludur.'); continue; }
        if (v.length < 6) throw new Error('Parola en az 6 karakter olmalıdır.');
        data.password_hash = bcrypt.hashSync(v, 10); continue;
      } else if (f.type === 'image' || f.type === 'file') {
        const up = (req.files || []).find(x => x.fieldname === f.name);
        if (!up) continue;
        v = '/static/uploads/' + up.filename;
      } else if (f.type === 'select') {
        if (f.def && v === undefined) v = f.def;
        if (v !== undefined && !f.options.includes(v)) v = f.def ?? f.options[0];
      }
      else v = String(v ?? '').trim();
      if (f.required && (v === '' || v === null || v === undefined)) throw new Error(`"${f.label}" zorunludur.`);
      if (f.slug && !/^[a-z0-9-]+$/.test(v)) throw new Error('Adres yalnızca küçük harf, rakam ve tire içerebilir.');
      if (f.nullable && v === '') v = null;
      data[f.name] = v;
      }
      if (r.table === 'warranty_records' && data.sale_date) {
        data.warranty_end = addYears(data.sale_date, 2);
      }
      const cols = Object.keys(data);
      tx(() => {
        let rowid = id;
        if (id) {
          if (cols.length) db.prepare(`UPDATE ${r.table} SET ${cols.map(c => c + '=@' + c).join(',')} WHERE rowid=@_id`).run({ ...data, _id: id });
        } else {
          rowid = db.prepare(`INSERT INTO ${r.table}(${cols.join(',')}) VALUES(${cols.map(c => '@' + c).join(',')})`).run(data).lastInsertRowid;
        }
      if (r.table === 'dealer_users') {
        db.prepare('DELETE FROM user_firms WHERE user_id=?').run(rowid);
        const ins = db.prepare('INSERT OR IGNORE INTO user_firms(user_id,firm_id) VALUES(?,?)');
        [].concat(b.firms || []).forEach(fid => { if (+fid) ins.run(rowid, +fid); });
      }
      if (r.children && !r.children.readonly) {
        const ch = r.children;
        db.prepare(`DELETE FROM ${ch.table} WHERE ${ch.fk}=?`).run(rowid);
        const first = [].concat(b['ch_' + ch.cols[0].name] || []);
        const ins = db.prepare(`INSERT INTO ${ch.table}(${ch.fk},${ch.cols.map(c => c.name).join(',')}) VALUES(?,${ch.cols.map(() => '?').join(',')})`);
        first.forEach((_, i) => {
          const vals = ch.cols.map(c => { const v = [].concat(b['ch_' + c.name] || [])[i]; return c.type === 'number' ? numAny(v) : String(v ?? '').trim(); });
          if (vals[0] !== '') ins.run(rowid, ...vals);
        });
      }
      if (r.debit) {
        const t = syncOrderDebit(r.table, r.debit.items, rowid, r.debit.ledger);
        if (t !== null) debitTotal = t;
      }
      if (r.table === 'work_orders' && id) {
        const st = db.prepare('SELECT status FROM work_orders WHERE rowid=?').get(rowid);
        if (rowid && data.status !== undefined) {
          const locked = ['Beklemede', 'İnceleniyor'].includes(data.status) ? 0 : 1;
          db.prepare('UPDATE work_orders SET type_locked=? WHERE rowid=?').run(locked, rowid);
        }
      }
    });
    flash(req, 'success', debitTotal ? `Kaydedildi. ${fmtMoney(debitTotal, 2)} ₺ tutarı firmanın hesap hareketlerine borç olarak yansıtıldı.` : 'Kaydedildi.');
    res.redirect('/admin/r/' + req.params.res);
  } catch (e) {
    const msg = /UNIQUE/.test(e.message) ? 'Bu kayıt zaten mevcut (benzersiz alan çakışması).' : e.message;
    flash(req, 'danger', msg);
    res.redirect(id ? `/admin/r/${req.params.res}/${id}` : `/admin/r/${req.params.res}/new`);
  }
});

router.get('/kullanici-kodu', (req, res) => {
  const id = +req.query.firm;
  res.json({ code: id && db.prepare('SELECT 1 FROM firms WHERE id=?').get(id) ? nextUserCode(id) : '' });
});

router.post('/kategori-ekle', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Kategori adı boş olamaz.' });
  db.prepare('INSERT OR IGNORE INTO categories(name) VALUES(?)').run(name);
  const row = db.prepare('SELECT name FROM categories WHERE name=? COLLATE NOCASE').get(name);
  res.json({ name: row.name });
});

router.post('/r/:res/:id/delete', (req, res) => {
  const id = +req.params.id;
  if (req.r.debit) {
    const o = db.prepare(`SELECT * FROM ${req.r.table} WHERE rowid=?`).get(id);
    for (const m of [o && o.movement_id, o && o.pay_movement_id]) if (m) db.prepare('DELETE FROM account_movements WHERE id=?').run(m);
  }
  db.prepare(`DELETE FROM ${req.r.table} WHERE rowid=?`).run(id);
  flash(req, 'success', 'Silindi.');
  res.redirect('/admin/r/' + req.params.res);
});

// ---- Ayarlar ----
router.get('/ayarlar', (req, res) => res.render('admin/settings', { title: 'Site Ayarları', groups: SETTINGS }));
router.post('/ayarlar', (req, res) => {
  SETTINGS.forEach(([, items]) => items.forEach(([key, , type]) => {
    if (type === 'image') {
      const up = (req.files || []).find(f => f.fieldname === key);
      if (up) set(key, '/static/uploads/' + up.filename);
      else if (req.body['clear_' + key]) set(key, '');
    } else if (key in req.body) set(key, String(req.body[key]).slice(0, 500));
  }));
  flash(req, 'success', 'Ayarlar kaydedildi.');
  res.redirect('/admin/ayarlar');
});

router.get('/sifre', (req, res) => res.render('admin/password', { title: 'Parola Değiştir' }));
router.post('/sifre', (req, res) => {
  const a = db.prepare('SELECT * FROM admins WHERE id=?').get(res.locals.admin.id);
  const { current, next: nw, again } = req.body;
  if (!bcrypt.compareSync(String(current || ''), a.password_hash)) flash(req, 'danger', 'Mevcut parola hatalı.');
  else if (String(nw || '').length < 8) flash(req, 'danger', 'Yeni parola en az 8 karakter olmalıdır.');
  else if (nw !== again) flash(req, 'danger', 'Yeni parolalar eşleşmiyor.');
  else {
    db.prepare('UPDATE admins SET password_hash=? WHERE id=?').run(bcrypt.hashSync(nw, 10), a.id);
    flash(req, 'success', 'Parola güncellendi.');
  }
  res.redirect('/admin/sifre');
});

module.exports = router;
