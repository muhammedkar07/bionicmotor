const router = require('express').Router();
const bcrypt = require('bcryptjs');
const {
  db,
  tx,
  get,
  set,
  nextNo,
  nextFirmCode,
  nextUserCode,
  syncOrderDebit,
  syncOrderStock,
  revertOrderStock,
  syncPaymentCredit,
  revertPaymentCredit,
  logAudit
} = require('../db');
const { flash, throttle, regenerate, fmtDate, fmtDateTime, fmtMoney, addYears, passwordError, csrfCheck } = require('../lib/core');
const { parseAmount, AMOUNT_HINT } = require('../lib/money');
const { anyFiles } = require('../lib/upload');

// Fiziksel silinmeyip "storno" (deleted_at) uygulanan finansal tablolar.
const SOFT_DELETE = new Set(['orders', 'spare_orders', 'payments', 'account_movements']);

// Para birimi tutan alanlar (kuruş çevrimi ve katı doğrulama uygulanır).
const MONEY_FIELDS = new Set([
  'amount',
  'price',
  'devir',
  'devir_parca',
  'unit_price',
  'commission',
  'total',
  'warranty_setup_fee',
  'setup_fee',
  'balance_applied',
  'balance_used'
]);
function moneyVal(v, label) {
  const k = parseAmount(v);
  if (k === null) throw new Error(`"${label || 'Tutar'}" geçerli bir tutar olmalıdır. ${AMOUNT_HINT}`);
  return k; // kuruş (tam sayı)
}
const { overallSummary } = require('../lib/account');

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
const PAYMETHOD = ['Kredi Kartı', 'Nakit', 'Havale / EFT'];
const PRODUCT = (name, label, kind) => ({ name, label, type: 'product', kind });
const MDL = (name, label, extra = {}) => ({ name, label, type: 'model', ...extra });

const RES = {
  firms: {
    title: 'Firmalar (Bayiler)',
    table: 'firms',
    group: 'Bayi Yönetimi',
    order: 'id DESC',
    list: ['code', 'name', 'city', 'phone', 'active'],
    fields: [
      AUTO('code', 'Cari Kodu', 'Kaydedildiğinde sistem tarafından otomatik verilir'),
      T('name', 'Firma Adı', { required: true }),
      T('city', 'Şehir'),
      T('phone', 'Telefon'),
      T('email', 'E-posta'),
      N('devir', 'Önceki Dönemden Devir (₺)'),
      N('devir_parca', 'Yedek Parça Devir (₺)'),
      C('active')
    ]
  },
  users: {
    title: 'Bayi Kullanıcıları',
    table: 'dealer_users',
    group: 'Bayi Yönetimi',
    list: ['code', 'name', 'email', 'role', 'active'],
    fields: [
      { name: 'firms', label: 'Erişebildiği Firmalar', type: 'multi' },
      AUTO('code', 'Kullanıcı Kodu', 'Firma seçildiğinde otomatik verilir (firma sırasına göre artar)'),
      T('name', 'Ad Soyad', { required: true }),
      T('email', 'E-posta (online ödeme girişi)', { nullable: true }),
      S('role', 'Rol', ['bayi', 'servis'], { def: 'bayi' }),
      {
        name: 'password',
        label: 'Parola (boş bırakılırsa değişmez)',
        type: 'password',
        help: 'En az 14 karakter, büyük/küçük harf, rakam ve simge içermelidir.'
      },
      C('active')
    ]
  },
  orders: {
    title: 'Sipariş Talepleri',
    table: 'orders',
    group: 'Bayi Yönetimi',
    list: ['request_date', 'request_no', 'firm_id', 'delivery_date', 'delivery_type', 'status'],
    order: 'CAST(request_no AS INTEGER) DESC, rowid DESC',
    fields: [
      FIRM,
      D('request_date', 'Talep Tarihi', { today: true }),
      AUTO('request_no', 'Talep No', "Otomatik verilir (1'den başlayarak artar)"),
      D('delivery_date', 'Teslim Tarihi'),
      S('delivery_type', 'Teslim Şekli', DELIVERY, { def: 'İleri Vadeli Teslim' }),
      S('status', 'Talep Durumu', ['Beklemede', 'Siparişe Dönüştürüldü', 'İptal Edildi'], {
        def: 'Beklemede',
        help: 'Siparişe dönüştürüldüğünde sipariş tutarı firmanın hesap hareketlerine borç olarak eklenir.'
      }),
      A('note', 'Not')
    ],
    debit: { items: 'order_items', ledger: 'ana' },
    children: {
      table: 'order_items',
      fk: 'order_id',
      title: 'Talep İçeriği',
      kind: 'arac',
      cols: [
        PRODUCT('product_name', 'Ürün', 'arac'),
        N('qty', 'Adet', { def: 1 }),
        N('unit_price', 'Birim Fiyat'),
        N('discount_pct', 'İndirim (%)')
      ]
    }
  },
  movements: {
    title: 'Hesap Hareketleri',
    table: 'account_movements',
    group: 'Bayi Yönetimi',
    list: ['date', 'firm_id', 'ledger', 'doc_type', 'cheque_no', 'amount'],
    order: 'date DESC, rowid DESC',
    fields: [
      FIRM,
      S('ledger', 'Hesap', ['ana', 'parca'], { def: 'ana' }),
      D('date', 'Tarih'),
      S('doc_type', 'Ödeme Türü', ['Nakit', 'Havale / EFT', 'Kart', 'Çek/Senet']),
      T('bank', 'Banka', { nullable: true }),
      T('cheque_no', 'Çek/Senet No', { nullable: true }),
      S('cheque_type', 'Çek Türü', ['Senet', 'Çek'], { def: 'Çek' }),
      D('cheque_due', 'Vadesi', { nullable: true }),
      { name: 'receipt', label: 'Dekont (isteğe bağlı)', type: 'file' },
      S('kind', 'Yön', ['borc', 'alacak', 'bilgi'], {
        def: 'alacak',
        help: 'alacak: ödeme/tahsilat (bakiyeyi düşürür) · borç: satış/borçlandırma (bakiyeyi artırır) · bilgi: bakiyeyi etkilemez. Vadesi gelen çek/senet otomatik tahsil sayılmaz; tahsil edildiğinde "alacak" yapın.'
      }),
      T('payer_name', 'Gönderen Adı Soyadı', { nullable: true }),
      T('doc_no', 'Belge No', { nullable: true }),
      N('amount', 'Tutar (₺)', { required: true })
    ]
  },
  announcements: {
    title: 'Duyurular',
    table: 'announcements',
    group: 'Bayi Yönetimi',
    list: ['created_at', 'text', 'author', 'active'],
    order: 'created_at DESC, id DESC',
    fields: [
      A('text', 'Duyuru Metni', { required: true, rows: 8 }),
      T('author', 'Yayınlayan', { def: 'Satış Sonrası Hizmetler Müdürlüğü' }),
      C('active')
    ]
  },
  products: {
    title: 'Ürünler / Fiyat Listesi',
    table: 'products',
    group: 'Bayi Yönetimi',
    list: ['image', 'kind', 'name', 'category', 'model_id', 'price', 'stock', 'max_qty', 'active'],
    order: 'id DESC',
    fields: [
      S('kind', 'Tür', ['arac', 'parca'], { def: 'arac', help: 'arac: toptan fiyat listesi · parca: yedek parça sipariş listesi' }),
      T('name', 'Ürün Adı', { required: true }),
      I('image', 'Ürün Görseli (JPG, PNG, WEBP, HEIC)'),
      { name: 'category', label: 'Kategori', type: 'category', required: true },
      R('model_id', 'Ait Olduğu Araç Modeli', 'models', 'name', { help: 'Tür "yedek parça" ise zorunludur.' }),
      N('price', 'Toptan Fiyat (₺)'),
      N('stock', 'Genel Merkez Stok Adedi', { help: 'Siparişe dönüştürüldükçe otomatik azalır.' }),
      N('max_qty', 'Maksimum Alım Adedi', { help: 'Bayiler bu adedin üzerinde sipariş veremez. Boş/0 bırakılırsa sınırsız.' }),
      C('active')
    ]
  },
  warranty: {
    title: 'Garanti Kayıtları',
    table: 'warranty_records',
    group: 'Satış Sonrası',
    list: ['serial_no', 'firm_id', 'model', 'customer', 'invoice_no', 'sale_date', 'warranty_end', 'status'],
    fields: [
      FIRM,
      T('serial_no', 'Şase No', { required: true }),
      MDL('model', 'Model', { required: true }),
      T('customer', 'Müşteri'),
      T('invoice_no', 'Fatura No', { required: true }),
      D('sale_date', 'Satış Tarihi', { required: true, today: true }),
      RO('warranty_end', 'Garanti Bitiş'),
      T('status', 'Durum', { def: 'Aktif' })
    ]
  },
  workorders: {
    title: 'İş Emirleri',
    table: 'work_orders',
    group: 'Satış Sonrası',
    list: ['created_at', 'no', 'firm_id', 'serial_no', 'type', 'status'],
    fields: [
      AUTO('no', 'İş Emri No', 'Otomatik verilir'),
      R('firm_id', 'Firma', 'firms', 'name', { required: true }),
      T('serial_no', 'Şase No', { required: true }),
      T('model', 'Model'),
      T('km', 'Km'),
      S('type', 'Tür', ['', 'Garanti', 'Ücretli', 'Sevkiyat Hasarı'], { def: '' }),
      A('description', 'Açıklama', { required: true }),
      I('image', 'Görsel (JPG/PNG/WEBP/PDF)'),
      S('status', 'Durum', ['Beklemede', 'İnceleniyor', 'Onaylandı', 'Tamamlandı', 'Reddedildi'], { def: 'Beklemede' }),
      A('admin_note', 'Yönetici Notu')
    ]
  },
  spareorders: {
    title: 'Yedek Parça Siparişleri',
    table: 'spare_orders',
    group: 'Satış Sonrası',
    list: ['request_date', 'no', 'firm_id', 'pay_method', 'delivery_date', 'delivery_method', 'status'],
    order: 'CAST(no AS INTEGER) DESC, rowid DESC',
    fields: [
      FIRM,
      D('request_date', 'Talep Tarihi', { today: true }),
      AUTO('no', 'Talep No', "Otomatik verilir (1'den başlayarak artar)"),
      D('delivery_date', 'Teslim Tarihi'),
      S('delivery_method', 'Teslim Şekli', DELIVERY, { def: 'İleri Vadeli Teslim' }),
      S('pay_method', 'Ödeme Yöntemi', PAYMETHOD, { nullable: true }),
      S('status', 'Durum', ['Beklemede', 'Siparişe Dönüştürüldü', 'Hazırlanıyor', 'Sevk Edildi', 'Tamamlandı', 'İptal'], {
        def: 'Beklemede',
        help: 'Beklemede/İptal dışındaki her durumda tutar firmanın Yedek Parça hesabına borç olarak eklenir.'
      }),
      A('note', 'Not')
    ],
    debit: { items: 'spare_order_items', ledger: 'parca' },
    children: {
      table: 'spare_order_items',
      fk: 'order_id',
      title: 'Talep İçeriği',
      kind: 'parca',
      cols: [
        PRODUCT('part_name', 'Parça', 'parca'),
        T('part_code', 'Kod'),
        N('qty', 'Adet', { def: 1 }),
        N('unit_price', 'Birim Fiyat'),
        N('discount_pct', 'İndirim (%)')
      ]
    }
  },
  payments: {
    title: 'Online Ödemeler',
    table: 'payments',
    group: 'Satış Sonrası',
    noCreate: true,
    list: ['created_at', 'provider', 'kind', 'firm_id', 'amount', 'currency', 'installment', 'provider_ref', 'status'],
    fields: [
      RO('provider', 'Sağlayıcı'),
      RO('provider_ref', 'İşlem No'),
      RO('kind', 'Tür'),
      RO('firm_id', 'Firma', { ref: 'firms' }),
      RO('amount', 'Tutar'),
      RO('currency', 'Para Birimi'),
      RO('installment', 'Taksit'),
      RO('total', 'Toplam'),
      RO('card_holder', 'Kart Sahibi'),
      RO('card_last4', 'Kart Son 4'),
      RO('paid_at', 'Ödeme Tarihi'),
      RO('description', 'Açıklama'),
      S('status', 'Durum', ['Sanal POS Bekliyor', 'Talimat Oluşturuldu', 'Onaylandı', 'Tahsil Edildi', 'İptal'], {
        help: 'Nakit / Havale-EFT bildirimlerini onaylamak için "Tahsil Edildi" (veya "Onaylandı") seçip kaydedin → tutar cari hesaba otomatik alacak işlenir. "İptal" seçilirse hesaba işlenmez.'
      })
    ]
  },
  slides: {
    title: 'Ana Sayfa Slider',
    table: 'slides',
    group: 'Web Sitesi',
    list: ['sort', 'title', 'new_price', 'active'],
    order: 'sort',
    fields: [
      I('image', 'Görsel (JPG, PNG, WEBP, HEIC — iPhone fotoğrafı yüklenebilir)'),
      T('title', 'Başlık'),
      T('subtitle', 'Alt Yazı'),
      T('old_price', 'Eski Fiyat'),
      T('new_price', 'Yeni Fiyat'),
      T('link', 'Bağlantı'),
      N('sort', 'Sıra', { def: 0 }),
      C('active')
    ]
  },
  campaigns: {
    title: 'Kampanyalar',
    table: 'campaigns',
    group: 'Web Sitesi',
    list: ['sort', 'title', 'old_price', 'new_price', 'start_date', 'end_date', 'active'],
    order: 'sort, id',
    fields: [
      { name: 'model_id', label: 'Modelden Doldur (isteğe bağlı)', type: 'campaignModel' },
      I('image', 'Görsel (model seçince otomatik gelir; JPG, PNG, WEBP, HEIC)'),
      { name: 'image_path', label: '', type: 'hidden' },
      T('title', 'Başlık', { required: true }),
      T('subtitle', 'Alt Yazı'),
      T('old_price', 'Eski Fiyat (ör. 178.200₺)'),
      T('new_price', 'Yeni Fiyat (ör. 111.500 TL)'),
      T('link', 'Bağlantı (ör. /modeller)'),
      D('start_date', 'Başlangıç Tarihi', { nullable: true }),
      D('end_date', 'Bitiş Tarihi (geçerlilik sonu)', {
        nullable: true,
        help: 'Bu tarih geçince kampanya anasayfadan otomatik kalkar ve kaydı silinir.'
      }),
      N('sort', 'Sıra', { def: 0 }),
      C('active')
    ]
  },
  models: {
    title: 'Modeller',
    table: 'models',
    group: 'Web Sitesi',
    list: ['sort', 'name', 'category', 'cc', 'price', 'warranty_setup_fee', 'active'],
    order: 'sort',
    fields: [
      T('name', 'Model Adı', { required: true }),
      T('category', 'Kategori'),
      T('cc', 'Hız'),
      T('power', 'Güç'),
      T('gearbox', 'Şanzıman'),
      A('description', 'Açıklama'),
      T('warranty_setup_desc', 'Garanti Başlatma Açıklaması'),
      N('warranty_setup_fee', 'Test/Devreye Alma Bedeli (₺)'),
      I('image', 'Görsel (JPG, PNG, WEBP, HEIC)'),
      N('price', 'Perakende Fiyat (₺)'),
      N('sort', 'Sıra', { def: 0 }),
      C('active')
    ]
  },
  faqs: {
    title: 'Sıkça Sorulan Sorular',
    table: 'faqs',
    group: 'Web Sitesi',
    list: ['sort', 'question', 'active'],
    order: 'sort',
    fields: [T('question', 'Soru', { required: true }), A('answer', 'Cevap'), N('sort', 'Sıra', { def: 0 }), C('active')]
  },
  points: {
    title: 'Satış ve Servis Noktaları',
    table: 'points',
    group: 'Web Sitesi',
    list: ['name', 'type', 'city', 'phone', 'active'],
    fields: [
      T('name', 'Ad', { required: true }),
      T('type', 'Tür'),
      T('city', 'İl'),
      T('address', 'Adres'),
      T('phone', 'Telefon'),
      C('active')
    ]
  },
  pages: {
    title: 'Sayfalar (HTML)',
    table: 'pages',
    group: 'Web Sitesi',
    list: ['slug', 'title'],
    noCreate: false,
    fields: [
      T('slug', 'Adres (slug)', { required: true, slug: true }),
      T('title', 'Başlık', { required: true }),
      A('body', 'İçerik (HTML)', { rows: 14 }),
      { name: 'catalog_pdf', label: 'Katalog Belgesi (PDF)', type: 'file', help: 'Yalnızca "dijital-katalog" sayfasında görünür. Yüklenen PDF, katalog bağlantısına tıklanınca otomatik indirilir.' }
    ]
  },
  messages: {
    title: 'İletişim Mesajları',
    table: 'messages',
    group: 'Gelen Kutusu',
    noCreate: true,
    list: ['created_at', 'name', 'email', 'phone', 'is_read'],
    fields: [RO('name', 'Ad Soyad'), RO('email', 'E-posta'), RO('phone', 'Telefon'), RO('message', 'Mesaj'), C('is_read', 'Okundu')]
  },
  applications: {
    title: 'Bayilik Başvuruları',
    table: 'applications',
    group: 'Gelen Kutusu',
    noCreate: true,
    list: ['created_at', 'name', 'city', 'district', 'phone', 'status'],
    fields: [
      RO('name', 'Ad Soyad'),
      RO('city', 'İl'),
      RO('district', 'İlçe'),
      RO('phone', 'Telefon'),
      RO('note', 'Açıklama'),
      S('status', 'Durum', ['Yeni', 'Görüşüldü', 'Olumlu', 'Olumsuz'])
    ]
  }
};

/** @type {Array<[string, Array<[string, string, (string|undefined)?]>]>} */
const SETTINGS = [
  [
    'Marka',
    [
      ['brand_1', 'Logo Yazısı - 1. Kısım'],
      ['brand_2', 'Logo Yazısı - 2. Kısım (kırmızı)'],
      ['logo_image', 'Logo Görseli', 'image'],
      ['company', 'Firma Ünvanı']
    ]
  ],
  [
    'İletişim',
    [
      ['phone', 'Telefon'],
      ['email', 'E-posta'],
      ['branch', 'Şube Adı'],
      ['address', 'Adres'],
      ['map_lat', 'Harita Enlem'],
      ['map_lng', 'Harita Boylam']
    ]
  ],
  [
    'Sosyal Medya / Bağlantılar',
    [
      ['facebook', 'Facebook'],
      ['instagram', 'Instagram'],
      ['youtube', 'YouTube']
    ]
  ],
  ['Vergi Oranı (sipariş formunda gösterilir)', [['kdv_rate', 'KDV (%)']]],
  ['Diğer', [['footer_note', 'Alt Bilgi Metni']]],
  ['SEO', [['meta_description', 'Site Açıklaması (meta description, ~150 karakter)']]],
  ['Banka Bilgileri', [['bank_info_image', 'Banka Hesap Bilgileri Görseli', 'image']]]
];

router.get('/giris', (req, res) => {
  if (req.session.admin) return res.redirect('/admin');
  res.render('admin/login', { title: 'Yönetici Girişi' });
});
router.post('/giris', (req, res) => {
  const username = String(req.body.username || '')
    .trim()
    .slice(0, 60);
  const t = throttle('admin:' + req.ip + ':' + username, 6);
  if (t.blocked) {
    flash(req, 'danger', 'Çok fazla hatalı deneme. Daha sonra tekrar deneyin.');
    return res.redirect('/admin/giris');
  }
  const a = db.prepare('SELECT * FROM admins WHERE username=?').get(username);
  if (!(bcrypt.compareSync(String(req.body.password || '').slice(0, 200), a ? a.password_hash : DUMMY) && a)) {
    t.hit();
    logAudit({ type: 'admin', name: username }, 'login_failed', 'admin', null, null, req.ip);
    flash(req, 'danger', 'Kullanıcı adı veya parola hatalı.');
    return res.redirect('/admin/giris');
  }
  t.reset();
  regenerate(req, res, 'admin');
  req.session.admin = { id: a.id };
  req.saveSession();
  logAudit({ type: 'admin', id: a.id, name: a.name || a.username }, 'login', 'admin', a.id, null, req.ip);
  res.redirect('/admin');
});

function parsePerms(p) {
  if (!p) return { res: [], sys: [] };
  try {
    const o = JSON.parse(p);
    const res = Array.isArray(o.res) ? o.res : [];
    const sys = Array.isArray(o.sys) ? o.sys : [];
    return { res, sys };
  } catch (e) {
    return { res: [], sys: [] };
  }
}

// Kayıtlı menü sırası (settings: admin_menu_order) -> düz id listesi.
// Eski "groups" biçimi de desteklenir (kaynak anahtarlarına dönüştürülür).
function savedMenuOrder() {
  try {
    const o = JSON.parse(get('admin_menu_order') || '{}');
    if (Array.isArray(o.order)) return o.order;
    if (Array.isArray(o.groups)) {
      const out = [];
      for (const g of o.groups) for (const k of g.keys || []) out.push('r:' + k);
      return out;
    }
    return [];
  } catch {
    return [];
  }
}
// Menü: kategori yok, tüm öğeler tek düz liste ve her biri sürüklenebilir.
// Kayıtlı sıraya göre dizilir; yeni eklenenler varsayılan sıranın sonuna eklenir.
function buildMenu(a, req) {
  const p = (req && req.path) || '';
  const can = k => a.is_super || ((a.perms && a.perms.sys) || []).includes(k);
  const entries = [{ id: '/admin', label: '▣ Panel', href: '/admin', active: p === '/' }];
  for (const [k, r] of Object.entries(RES)) {
    if (!(a.is_super || a.perms.res.includes(k))) continue;
    entries.push({ id: 'r:' + k, label: r.title, href: '/admin/r/' + k, active: p === '/r/' + k, badge: k });
  }
  if (can('stok')) entries.push({ id: 'sys:stok', label: 'Araç Stok Takibi', href: '/admin/stok', active: p === '/stok' });
  if (can('stok-parca'))
    entries.push({ id: 'sys:stok-parca', label: 'Yedek Parça Stok Takibi', href: '/admin/stok-parca', active: p === '/stok-parca' });
  if (can('ayarlar')) entries.push({ id: 'sys:ayarlar', label: 'Site Ayarları', href: '/admin/ayarlar', active: p === '/ayarlar' });
  if (can('test')) entries.push({ id: 'sys:test', label: 'Sistem Testi', href: '/admin/test', active: p === '/test' });
  if (can('audit')) entries.push({ id: 'sys:audit', label: 'Denetim İzleri', href: '/admin/audit', active: p === '/audit' });
  if (a.is_super)
    entries.push({ id: 'sys:admin-users', label: 'Admin Kullanıcıları', href: '/admin/admin-users', active: p === '/admin-users' });
  entries.push({ id: 'sys:sifre', label: 'Parola Değiştir', href: '/admin/sifre', active: p === '/sifre' });
  entries.push({ id: 'ext:site', label: 'Siteyi Görüntüle ↗', href: '/', external: true, active: false });
  entries.push({ id: 'ext:bayi', label: 'Bayi Paneli ↗', href: '/bayi', external: true, active: false });

  const byId = new Map(entries.map(e => [e.id, e]));
  const used = new Set();
  const ordered = [];
  for (const id of savedMenuOrder()) {
    const e = byId.get(id);
    if (e && !used.has(id)) {
      used.add(id);
      ordered.push(e);
    }
  }
  for (const e of entries) if (!used.has(e.id)) ordered.push(e);
  return ordered;
}
const FIXED_MENU_IDS = new Set([
  '/admin',
  'sys:stok',
  'sys:stok-parca',
  'sys:ayarlar',
  'sys:test',
  'sys:audit',
  'sys:admin-users',
  'sys:sifre',
  'ext:site',
  'ext:bayi'
]);
const validMenuId = id => typeof id === 'string' && (FIXED_MENU_IDS.has(id) || (id.startsWith('r:') && !!RES[id.slice(2)]));

router.use((req, res, next) => {
  const a =
    req.session.admin && db.prepare('SELECT id,username,name,is_super,permissions FROM admins WHERE id=?').get(req.session.admin.id);
  if (!a) return res.redirect('/admin/giris');
  a.perms = parsePerms(a.permissions);
  res.locals.admin = a;
  res.locals.menu = buildMenu(a, req);
  res.locals.moneyFields = Array.from(MONEY_FIELDS);
  res.locals.res = null;
  res.locals.path = req.path;
  res.locals.badges = {
    orders: db.prepare("SELECT COUNT(*) c FROM orders WHERE status='Beklemede' AND deleted_at IS NULL").get().c,
    messages: db.prepare('SELECT COUNT(*) c FROM messages WHERE is_read=0').get().c,
    applications: db.prepare("SELECT COUNT(*) c FROM applications WHERE status='Yeni'").get().c,
    workorders: db.prepare("SELECT COUNT(*) c FROM work_orders WHERE status='Beklemede'").get().c,
    spareorders: db.prepare("SELECT COUNT(*) c FROM spare_orders WHERE status='Beklemede' AND deleted_at IS NULL").get().c,
    payments: db
      .prepare("SELECT COUNT(*) c FROM payments WHERE deleted_at IS NULL AND status IN ('Sanal POS Bekliyor','Talimat Oluşturuldu')")
      .get().c
  };
  next();
});

// Yetki denetimi: süper yönetici tüm sayfalara erişir; diğerleri yalnızca izinli sayfalara.
// Parola değiştirme sayfası herkese açıktır.
function sysKey(p) {
  if (p === '/stok') return 'stok';
  if (p === '/stok-parca') return 'stok-parca';
  if (p === '/ayarlar') return 'ayarlar';
  if (p === '/test' || p.startsWith('/test/')) return 'test';
  if (p === '/audit') return 'audit';
  return null;
}
router.use((req, res, next) => {
  const a = res.locals.admin;
  if (a.is_super) return next();
  const p = req.path;
  let denied = false;
  if (p.startsWith('/r/')) {
    const key = p.split('/')[2];
    denied = !a.perms.res.includes(key);
  } else if (p === '/kullanici-kodu') {
    // Kullanıcı formu yardımcı ucu: bayi kullanıcıları yetkisi gerekir.
    denied = !a.perms.res.includes('users');
  } else if (p === '/kategori-ekle') {
    // Ürün formu yardımcı ucu: ürünler yetkisi gerekir.
    denied = !a.perms.res.includes('products');
  } else {
    const key = sysKey(p);
    denied = key ? !a.perms.sys.includes(key) : false;
  }
  if (denied) return res.status(403).send('Bu sayfaya erişim yetkiniz yok.');
  next();
});

router.post('/cikis', (req, res) => {
  logAudit(res.locals.admin, 'logout', 'admin', res.locals.admin.id, null, req.ip);
  regenerate(req, res, 'admin');
  res.redirect('/admin/giris');
});

router.get('/', (req, res) => {
  const c = t => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  res.render('admin/dashboard', {
    title: 'Panel',
    stats: [
      ['Firmalar', c('firms'), 'firms'],
      ['Bayi Kullanıcıları', c('dealer_users'), 'users'],
      ['Sipariş Talepleri', c('orders'), 'orders'],
      ['Okunmamış Mesaj', res.locals.badges.messages, 'messages'],
      ['Yeni Bayilik Başvurusu', res.locals.badges.applications, 'applications'],
      ['Bekleyen İş Emri', res.locals.badges.workorders, 'workorders'],
      ['Bekleyen Yedek Parça Siparişi', res.locals.badges.spareorders, 'spareorders'],
      ['Bekleyen Ödeme', res.locals.badges.payments, 'payments']
    ]
  });
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return fmtDate(v);
  if (f.name === 'created_at') return fmtDateTime(v);
  if (f.type === 'ref' || f.ref) {
    const m = (refs[f.name] || []).find(x => x.id === v);
    return m ? m.label : v;
  }
  if (MONEY_FIELDS.has(f.name)) return fmtMoney(v, 0);
  if (f.type === 'number') return String(v);
  const s = String(v);
  return s.length > 90 ? s.slice(0, 90) + '…' : s;
}

router.get('/r/:res', (req, res) => {
  const r = req.r;
  const all = [...r.fields, { name: 'created_at', label: 'Tarih' }, { name: 'id', label: 'No' }];
  const cols = r.list.map(n => all.find(f => f.name === n) || { name: n, label: n });
  const refs = {};
  r.fields
    .filter(f => f.ref)
    .forEach(f => {
      refs[f.name] = refMap(f);
    });
  const q = String(req.query.q || '').trim();
  const firm = req.query.firm ? +req.query.firm : null;
  // Tarih aralığı filtresi (yalnızca tarih alanı olan listelerde).
  // Ticari tarih alanları öncelikli; zaman damgasıyla tutulan kayıtlarda created_at kullanılır.
  const DATE_FIELDS = ['date', 'sale_date', 'request_date', 'due_date'];
  const dateCol =
    DATE_FIELDS.find(n => r.fields.some(f => f.name === n)) ||
    (['payments', 'messages', 'applications', 'orders', 'spareorders'].includes(r.table) ? 'created_at' : null);
  const from = String(req.query.from || '').slice(0, 10);
  const to = String(req.query.to || '').slice(0, 10);
  const textCols = r.fields.filter(f => ['text', 'textarea', 'readonly', 'auto'].includes(f.type) && !f.ref).map(f => f.name);
  // Bayi (firma) filtresi: firma ile ilişkisi olan tüm listelerde çalışır
  const firmField = r.fields.find(f => f.ref === 'firms');
  const firmWhere = firmField
    ? `${firmField.name}=@firm`
    : r.table === 'firms'
      ? 'id=@firm'
      : r.table === 'dealer_users'
        ? 'id IN (SELECT user_id FROM user_firms WHERE firm_id=@firm)'
        : null;
  let where = [];
  if (q && textCols.length) {
    const parts = textCols.map(c => `${c} LIKE @q`);
    // Arama metni bayi adında da aranır
    if (firmField) parts.push(`${firmField.name} IN (SELECT id FROM firms WHERE name LIKE @q)`);
    else if (r.table === 'dealer_users')
      parts.push('id IN (SELECT user_id FROM user_firms WHERE firm_id IN (SELECT id FROM firms WHERE name LIKE @q))');
    where.push('(' + parts.join(' OR ') + ')');
  }
  if (firmWhere && firm) where.push(firmWhere);
  if (dateCol && from) where.push(`date(${dateCol}) >= @from`);
  if (dateCol && to) where.push(`date(${dateCol}) <= @to`);
  if (SOFT_DELETE.has(r.table)) where.push('deleted_at IS NULL');
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  // Parametreler yalnızca SQL içinde kullanıldıklarında eklenir (kullanılmayan named parametre hata verir)
  const params = {};
  if (q && textCols.length) params.q = `%${q}%`;
  if (firmWhere && firm) params.firm = firm;
  if (dateCol && from) params.from = from;
  if (dateCol && to) params.to = to;
  const total = db.prepare(`SELECT COUNT(*) n FROM ${r.table} ${whereSql}`).get(params).n;
  const PAGE = 100;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const page = Math.min(pages, Math.max(1, parseInt(req.query.page, 10) || 1));
  const sql = `SELECT rowid AS _id, * FROM ${r.table} ${whereSql} ORDER BY ${r.order || 'rowid DESC'} LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`;
  const rows = db.prepare(sql).all(params);
  // Hesap Hareketleri listesinde: harekete bağlı ödeme varsa "Dekont" bağlantısı gösterilir.
  let receipts = null;
  if (r.table === 'account_movements' && rows.length) {
    const ids = rows.map(x => x._id);
    receipts = {};
    db.prepare(
      `SELECT id, movement_id FROM payments WHERE movement_id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL`
    )
      .all(...ids)
      .forEach(p => {
        receipts[p.movement_id] = p.id;
      });
  }
  const firmFilter = !!firmWhere;
  const firms = firmFilter ? db.prepare('SELECT id,name FROM firms ORDER BY name').all() : [];
  let acct, acctLabel;
  if (r.table === 'account_movements') {
    acct = overallSummary(firm || null, { from, to });
    acctLabel = firm
      ? 'Seçili bayi: ' + (db.prepare('SELECT name FROM firms WHERE id=?').get(firm) || {}).name
      : 'Tüm bayiler (' + acct.firms + ')';
    if (from || to) acctLabel += ' · ' + (from || 'başlangıç') + ' – ' + (to || 'bugün') + ' aralığı';
  }
  res.render('admin/list', {
    title: r.title,
    cols,
    rows,
    refs,
    cell,
    q,
    firm: firm || '',
    firms,
    firmFilter,
    dateFilter: !!dateCol,
    from,
    to,
    acct,
    acctLabel,
    receipts,
    page,
    pages,
    total
  });
});

function loadForm(req, res, id) {
  const r = req.r;
  const row = id ? db.prepare(`SELECT rowid AS _id, * FROM ${r.table} WHERE rowid=?`).get(id) : null;
  const refs = {};
  r.fields
    .filter(f => f.type === 'ref' || f.ref)
    .forEach(f => {
      refs[f.name] = refMap(f);
    });
  let multi = null;
  if (r.table === 'dealer_users') {
    multi = {
      all: db.prepare('SELECT id,name FROM firms ORDER BY id DESC').all(),
      sel: id
        ? db
            .prepare('SELECT firm_id FROM user_firms WHERE user_id=?')
            .all(id)
            .map(x => x.firm_id)
        : []
    };
  }
  const kids = r.children && id ? db.prepare(`SELECT * FROM ${r.children.table} WHERE ${r.children.fk}=?`).all(id) : [];
  const catalog =
    r.children && r.children.kind
      ? db.prepare('SELECT code,name,category,price FROM products WHERE kind=? AND active=1 ORDER BY category, name').all(r.children.kind)
      : [];
  const categories = db
    .prepare('SELECT name FROM categories ORDER BY name COLLATE NOCASE')
    .all()
    .map(x => x.name);
  const models = db
    .prepare('SELECT name FROM models WHERE active=1 ORDER BY name COLLATE NOCASE')
    .all()
    .map(x => x.name);
  const tax = { kdv: numAny(get('kdv_rate')) || 20 };
  const campaignModels =
    r.table === 'campaigns'
      ? db
          .prepare(
            'SELECT id,name,category,cc,power,gearbox,description,image,price FROM models WHERE active=1 ORDER BY name COLLATE NOCASE'
          )
          .all()
      : [];
  return { row, refs, multi, kids, catalog, categories, models, campaignModels, tax, today: new Date().toISOString().slice(0, 10) };
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

const num = v => {
  const n = parseFloat(
    String(v ?? '')
      .replace(/\./g, '')
      .replace(',', '.')
  );
  return Number.isFinite(n) ? n : 0;
};
// Giriş "1.250,50" (TR) veya "1250.50" olabilir
const numAny = v => {
  const s = String(v ?? '').trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  return num(s);
};

router.post('/r/:res/save', anyFiles, csrfCheck, (req, res) => {
  const r = req.r,
    b = req.body,
    id = +b._id || 0;
  if (!id && r.noCreate) return res.status(403).send('Yetkisiz');
  const data = {};
  let debitTotal = 0;
  const before = id ? db.prepare(`SELECT * FROM ${r.table} WHERE rowid=?`).get(id) : null;
  let savedId = id;
  try {
    const firmIds = []
      .concat(b.firms || [])
      .map(Number)
      .filter(Boolean);
    if (r.table === 'dealer_users' && !firmIds.length) throw new Error('En az bir firma seçmelisiniz.');
    for (const f of r.fields) {
      if (f.type === 'readonly' || f.type === 'multi' || f.type === 'campaignModel' || f.type === 'hidden') continue;
      if (r.table === 'warranty_records' && f.name === 'warranty_end') continue;
      if (f.type === 'auto') {
        if (!id)
          data[f.name] =
            r.table === 'firms' ? nextFirmCode() : r.table === 'dealer_users' ? nextUserCode(firmIds[0]) : String(nextNo(r.table, f.name));
        continue;
      }
      let v = b[f.name];
      if (f.type === 'category') {
        v = String(v ?? '').trim();
        if (v) db.prepare('INSERT OR IGNORE INTO categories(name) VALUES(?)').run(v);
      } else if (f.type === 'checkbox') v = v ? 1 : 0;
      else if (f.type === 'number') {
        const raw = String(v ?? '').trim();
        v = MONEY_FIELDS.has(f.name) ? (raw === '' ? 0 : moneyVal(raw, f.label)) : numAny(v);
      } else if (f.type === 'ref') v = +v || null;
      else if (f.type === 'password') {
        v = String(v || '');
        if (!v) {
          if (!id) throw new Error('Parola zorunludur.');
          continue;
        }
        const pe = passwordError(v);
        if (pe) throw new Error(pe);
        data.password_hash = bcrypt.hashSync(v, 12);
        continue;
      } else if (f.type === 'image' || f.type === 'file') {
        const up = (req.files || []).find(x => x.fieldname === f.name);
        if (!up) continue;
        v = '/static/uploads/' + up.filename;
      } else if (f.type === 'select') {
        // Boş bırakılırsa varsayılan/seçenek gelir; listede olmayan mevcut değerler (eski kayıtlar)
        // form tarafından seçenek olarak sunulduğu için korunur.
        if (v === undefined || v === '') v = f.def ?? f.options[0] ?? '';
      } else v = String(v ?? '').trim();
      if (f.required && (v === '' || v === null || v === undefined)) throw new Error(`"${f.label}" zorunludur.`);
      if (f.slug && !/^[a-z0-9-]+$/.test(v)) throw new Error('Adres yalnızca küçük harf, rakam ve tire içerebilir.');
      if (f.nullable && v === '') v = null;
      data[f.name] = v;
    }
    if (r.table === 'warranty_records' && data.sale_date) {
      data.warranty_end = addYears(data.sale_date, 2);
    }
    if (r.table === 'products' && data.kind === 'parca' && !data.model_id)
      throw new Error('Yedek parçanın ait olduğu araç modelini seçmelisiniz.');
    // Çek/Senet için varsayılan yön "bilgi"dir (bakiyeyi etkilemez). Karşılıksız çek
    // riskine karşı vadesi gelen çek otomatik tahsil sayılmaz; tahsil edildiğinde yön
    // yönetici tarafından "alacak" olarak değiştirilir.
    if (r.table === 'account_movements' && data.doc_type === 'Çek/Senet' && !data.kind) data.kind = 'bilgi';
    // Kampanya: model seçildiyse ve yeni dosya yüklenmediyse modelin görselini kullan.
    if (r.table === 'campaigns' && !data.image && b.image_path) data.image = String(b.image_path).slice(0, 300);
    const cols = Object.keys(data);
    tx(() => {
      let rowid = id;
      if (id) {
        if (cols.length)
          db.prepare(`UPDATE ${r.table} SET ${cols.map(c => c + '=@' + c).join(',')} WHERE rowid=@_id`).run({ ...data, _id: id });
      } else {
        rowid = db
          .prepare(`INSERT INTO ${r.table}(${cols.join(',')}) VALUES(${cols.map(c => '@' + c).join(',')})`)
          .run(data).lastInsertRowid;
      }
      savedId = rowid;
      if (r.table === 'dealer_users') {
        db.prepare('DELETE FROM user_firms WHERE user_id=?').run(rowid);
        const ins = db.prepare('INSERT OR IGNORE INTO user_firms(user_id,firm_id) VALUES(?,?)');
        [].concat(b.firms || []).forEach(fid => {
          if (+fid) ins.run(rowid, +fid);
        });
      }
      if (r.children && !r.children.readonly) {
        const ch = r.children;
        db.prepare(`DELETE FROM ${ch.table} WHERE ${ch.fk}=?`).run(rowid);
        const first = [].concat(b['ch_' + ch.cols[0].name] || []);
        const ins = db.prepare(
          `INSERT INTO ${ch.table}(${ch.fk},${ch.cols.map(c => c.name).join(',')}) VALUES(?,${ch.cols.map(() => '?').join(',')})`
        );
        first.forEach((_, i) => {
          const vals = ch.cols.map(c => {
            const raw = [].concat(b['ch_' + c.name] || [])[i];
            if (MONEY_FIELDS.has(c.name)) {
              const s = String(raw ?? '').trim();
              return s === '' ? 0 : moneyVal(s, c.label);
            }
            return c.type === 'number' ? numAny(raw) : String(raw ?? '').trim();
          });
          if (vals[0] !== '') ins.run(rowid, ...vals);
        });
      }
      if (r.debit) {
        const t = syncOrderDebit(r.table, r.debit.items, rowid, r.debit.ledger);
        if (t !== null) debitTotal = t;
      }
      if (r.table === 'orders') syncOrderStock(rowid);
      if (r.table === 'payments') syncPaymentCredit(rowid);
      if (r.table === 'work_orders' && id) {
        if (rowid && data.status !== undefined) {
          const locked = ['Beklemede', 'İnceleniyor'].includes(data.status) ? 0 : 1;
          db.prepare('UPDATE work_orders SET type_locked=? WHERE rowid=?').run(locked, rowid);
        }
      }
    });
    // Denetim izi: kim, neyi, ne zaman değiştirdi (parola hash'i gizlenir).
    const scrub = o => {
      const x = { ...o };
      if ('password_hash' in x) x.password_hash = '***';
      return x;
    };
    if (id && before) {
      const changed = {};
      for (const k of Object.keys(data)) if (String(before[k]) !== String(data[k])) changed[k] = data[k];
      logAudit(res.locals.admin, 'update', r.table, id, { changed: scrub(changed) }, req.ip);
    } else {
      logAudit(res.locals.admin, 'create', r.table, savedId, { created: scrub(data) }, req.ip);
    }
    flash(
      req,
      'success',
      debitTotal ? `Kaydedildi. ${fmtMoney(debitTotal, 2)} ₺ tutarı firmanın hesap hareketlerine borç olarak yansıtıldı.` : 'Kaydedildi.'
    );
    res.redirect('/admin/r/' + req.params.res);
  } catch (e) {
    const msg = /UNIQUE/.test(e.message) ? 'Bu kayıt zaten mevcut (benzersiz alan çakışması).' : e.message;
    // Girilen veriler kaybolmasın: hata mesajıyla formu yeniden göster
    try {
      const f = loadForm(req, res, id || null);
      const posted = { ...(f.row || {}) };
      for (const fld of r.fields) {
        if (['readonly', 'auto', 'multi'].includes(fld.type)) continue;
        if (b[fld.name] !== undefined) {
          if (fld.type === 'password') posted[fld.name] = '';
          else if (fld.type === 'checkbox') posted[fld.name] = b[fld.name] ? 1 : 0;
          else posted[fld.name] = String(b[fld.name] ?? '').trim();
        }
      }
      posted._id = id || 0;
      f.row = posted;
      if (r.table === 'dealer_users' && f.multi)
        f.multi.sel = []
          .concat(b.firms || [])
          .map(Number)
          .filter(Boolean);
      if (r.children) {
        const names = r.children.cols.map(c => c.name);
        f.kids = []
          .concat(b['ch_' + names[0]] || [])
          .map((_, i) => {
            const k = {};
            r.children.cols.forEach(c => {
              k[c.name] = String([].concat(b['ch_' + c.name] || [])[i] ?? '').trim();
            });
            return k;
          })
          .filter(k => k[names[0]] !== '');
      }
      res.locals.flash = { type: 'danger', msg };
      res.render('admin/form', { title: r.title + (id ? ' - Düzenle' : ' - Yeni'), ...f });
    } catch (e2) {
      flash(req, 'danger', msg);
      res.redirect(id ? `/admin/r/${req.params.res}/${id}` : `/admin/r/${req.params.res}/new`);
    }
  }
});

router.get('/kullanici-kodu', (req, res) => {
  const id = +req.query.firm;
  res.json({ code: id && db.prepare('SELECT 1 FROM firms WHERE id=?').get(id) ? nextUserCode(id) : '' });
});

// Menü sırasını kaydeder (yalnızca süper yönetici). Sürükle-bırak istemci tarafından gönderilir.
router.post('/menu-sirala', (req, res) => {
  if (!res.locals.admin.is_super) return res.status(403).json({ error: 'Yetkisiz' });
  let data = {};
  try {
    data = JSON.parse(req.body.data || '{}');
  } catch {
    return res.status(400).json({ error: 'Geçersiz veri' });
  }
  const order = (Array.isArray(data.order) ? data.order : []).filter(validMenuId);
  set('admin_menu_order', JSON.stringify({ order }));
  logAudit(res.locals.admin, 'update', 'admin_menu_order', null, { adet: order.length }, req.ip);
  res.json({ ok: true });
});

router.post('/kategori-ekle', (req, res) => {
  const name = String(req.body.name || '')
    .trim()
    .slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Kategori adı boş olamaz.' });
  db.prepare('INSERT OR IGNORE INTO categories(name) VALUES(?)').run(name);
  const row = db.prepare('SELECT name FROM categories WHERE name=? COLLATE NOCASE').get(name);
  logAudit(res.locals.admin, 'create', 'category', null, { name }, req.ip);
  res.json({ name: row.name });
});

// ---- Stok Takibi ----
router.get('/stok', (req, res) => {
  const products = db
    .prepare("SELECT id,code,name,category,price,stock FROM products WHERE kind='arac' AND active=1 ORDER BY category,name")
    .all();
  const firms = db.prepare('SELECT id,code,name FROM firms WHERE active=1 ORDER BY code,name').all();
  const stock = {};
  db.prepare('SELECT firm_id,product_id,qty FROM firm_stock')
    .all()
    .forEach(r => {
      stock[r.firm_id + ':' + r.product_id] = r.qty;
    });
  res.render('admin/stok', { title: 'Araç Stok Takibi', products, firms, stock });
});
router.post('/stok', (req, res) => {
  const products = db
    .prepare("SELECT id FROM products WHERE kind='arac' AND active=1")
    .all()
    .map(p => p.id);
  const firms = db
    .prepare('SELECT id FROM firms WHERE active=1')
    .all()
    .map(f => f.id);
  const b = req.body;
  tx(() => {
    const upd = db.prepare('UPDATE products SET stock=? WHERE id=?');
    for (const pid of products) upd.run(Math.max(0, numAny(b['g_' + pid])), pid);
    const ups = db.prepare(
      'INSERT INTO firm_stock(firm_id,product_id,qty) VALUES(?,?,?) ON CONFLICT(firm_id,product_id) DO UPDATE SET qty=excluded.qty'
    );
    const del = db.prepare('DELETE FROM firm_stock WHERE firm_id=? AND product_id=?');
    for (const fid of firms)
      for (const pid of products) {
        const v = numAny(b['f_' + fid + '_' + pid]);
        if (v > 0) ups.run(fid, pid, v);
        else del.run(fid, pid);
      }
  });
  flash(req, 'success', 'Araç stokları güncellendi.');
  res.redirect('/admin/stok');
});
router.get('/stok-parca', (req, res) => {
  const products = db
    .prepare("SELECT id,code,name,category,model_id,price,stock FROM products WHERE kind='parca' AND active=1 ORDER BY category,name")
    .all();
  const firms = db.prepare('SELECT id,code,name FROM firms WHERE active=1 ORDER BY code,name').all();
  const stock = {};
  db.prepare('SELECT firm_id,product_id,qty FROM firm_stock')
    .all()
    .forEach(r => {
      stock[r.firm_id + ':' + r.product_id] = r.qty;
    });
  res.render('admin/stok_parca', { title: 'Yedek Parça Stok Takibi', products, firms, stock });
});
router.post('/stok-parca', (req, res) => {
  const products = db
    .prepare("SELECT id FROM products WHERE kind='parca' AND active=1")
    .all()
    .map(p => p.id);
  const firms = db
    .prepare('SELECT id FROM firms WHERE active=1')
    .all()
    .map(f => f.id);
  const b = req.body;
  tx(() => {
    const upd = db.prepare('UPDATE products SET stock=? WHERE id=?');
    for (const pid of products) upd.run(Math.max(0, numAny(b['g_' + pid])), pid);
    const ups = db.prepare(
      'INSERT INTO firm_stock(firm_id,product_id,qty) VALUES(?,?,?) ON CONFLICT(firm_id,product_id) DO UPDATE SET qty=excluded.qty'
    );
    const del = db.prepare('DELETE FROM firm_stock WHERE firm_id=? AND product_id=?');
    for (const fid of firms)
      for (const pid of products) {
        const v = numAny(b['f_' + fid + '_' + pid]);
        if (v > 0) ups.run(fid, pid, v);
        else del.run(fid, pid);
      }
  });
  flash(req, 'success', 'Yedek parça stokları güncellendi.');
  res.redirect('/admin/stok-parca');
});

// Nakit / Havale-EFT bildirimini tek tıkla onayla: kayıt "Tahsil Edildi" olur ve tutar
// cari hesaba alacak işlenir. Kart (Sanal POS) ödemeleri buradan onaylanmaz; onlar
// Paratika'dan sunucu tarafı doğrulanarak (mutabakat) işlenir.
router.post('/r/payments/:id/onayla', (req, res) => {
  const id = +req.params.id;
  const back = '/admin/r/payments';
  const p = db.prepare('SELECT * FROM payments WHERE id=? AND deleted_at IS NULL').get(id);
  if (!p) {
    flash(req, 'danger', 'Ödeme bulunamadı.');
    return res.redirect(back);
  }
  if (!['nakit', 'havale'].includes(p.kind)) {
    flash(req, 'danger', 'Yalnızca nakit / havale-EFT bildirimleri elle onaylanabilir (kart ödemeleri otomatik doğrulanır).');
    return res.redirect(back);
  }
  if (p.status === 'Tahsil Edildi') {
    flash(req, 'info', 'Bu ödeme zaten tahsil edilmiş.');
    return res.redirect(back);
  }
  if (p.status === 'İptal') {
    flash(req, 'danger', 'İptal edilmiş bir bildirim onaylanamaz.');
    return res.redirect(back);
  }
  tx(() => {
    db.prepare("UPDATE payments SET status='Tahsil Edildi', paid_at=COALESCE(paid_at,datetime('now')) WHERE id=?").run(id);
    syncPaymentCredit(id);
    logAudit(res.locals.admin, 'payment_approved', 'payments', id, { kind: p.kind, amount: p.amount }, req.ip);
  });
  flash(req, 'success', 'Ödeme onaylandı; tutar cari hesaba alacak işlendi.');
  res.redirect(back);
});

router.post('/r/:res/:id/delete', (req, res) => {
  const id = +req.params.id;
  const before = db.prepare(`SELECT * FROM ${req.r.table} WHERE rowid=?`).get(id);
  if (!before) {
    flash(req, 'danger', 'Kayıt bulunamadı.');
    return res.redirect('/admin/r/' + req.params.res);
  }
  const soft = SOFT_DELETE.has(req.r.table);
  const scrub = o => {
    const x = { ...o };
    if ('password_hash' in x) x.password_hash = '***';
    return x;
  };
  tx(() => {
    if (req.r.debit) {
      for (const m of [before.movement_id, before.pay_movement_id]) {
        if (m) db.prepare("UPDATE account_movements SET deleted_at=datetime('now') WHERE id=? AND deleted_at IS NULL").run(m);
      }
    }
    if (req.r.table === 'orders') revertOrderStock(id);
    if (req.r.table === 'payments') revertPaymentCredit(id);
    if (soft) db.prepare(`UPDATE ${req.r.table} SET deleted_at=datetime('now') WHERE rowid=?`).run(id);
    else db.prepare(`DELETE FROM ${req.r.table} WHERE rowid=?`).run(id);
    logAudit(res.locals.admin, soft ? 'storno' : 'delete', req.r.table, id, { before: scrub(before) }, req.ip);
  });
  flash(req, 'success', soft ? 'Kayıt iptal edildi (storno); etkileri geri alındı ve denetim kaydı korundu.' : 'Silindi.');
  res.redirect('/admin/r/' + req.params.res);
});

// ---- Ayarlar ----
router.get('/ayarlar', (req, res) => res.render('admin/settings', { title: 'Site Ayarları', groups: SETTINGS }));
router.post('/ayarlar', anyFiles, csrfCheck, (req, res) => {
  const changed = [];
  SETTINGS.forEach(([, items]) =>
    items.forEach(([key, , type]) => {
      if (type === 'image') {
        const up = (req.files || []).find(f => f.fieldname === key);
        if (up) {
          set(key, '/static/uploads/' + up.filename);
          changed.push(key);
        } else if (req.body['clear_' + key]) {
          set(key, '');
          changed.push(key);
        }
      } else if (key in req.body) {
        set(key, String(req.body[key]).slice(0, 500));
        changed.push(key);
      }
    })
  );
  logAudit(res.locals.admin, 'update', 'settings', null, { keys: changed }, req.ip);
  flash(req, 'success', 'Ayarlar kaydedildi.');
  res.redirect('/admin/ayarlar');
});

router.get('/sifre', (req, res) => res.render('admin/password', { title: 'Parola Değiştir' }));
router.post('/sifre', (req, res) => {
  const a = db.prepare('SELECT * FROM admins WHERE id=?').get(res.locals.admin.id);
  const { current, next: nw, again } = req.body;
  if (!bcrypt.compareSync(String(current || ''), a.password_hash)) {
    logAudit(res.locals.admin, 'password_change_failed', 'admin', a.id, null, req.ip);
    flash(req, 'danger', 'Mevcut parola hatalı.');
  } else {
    const pe = passwordError(nw);
    if (pe) flash(req, 'danger', pe);
    else if (nw !== again) flash(req, 'danger', 'Yeni parolalar eşleşmiyor.');
    else {
      db.prepare('UPDATE admins SET password_hash=? WHERE id=?').run(bcrypt.hashSync(nw, 12), a.id);
      logAudit(res.locals.admin, 'password_change', 'admin', a.id, null, req.ip);
      flash(req, 'success', 'Parola güncellendi.');
    }
  }
  res.redirect('/admin/sifre');
});

// ---- Admin Kullanıcıları ----
// Parola değiştirme herkese açık olduğu için yetkilendirme listesine dahil edilmez.
const SYSTEM_PAGES = [
  { key: 'stok', label: 'Araç Stok Takibi' },
  { key: 'stok-parca', label: 'Yedek Parça Stok Takibi' },
  { key: 'ayarlar', label: 'Site Ayarları' },
  { key: 'audit', label: 'Denetim İzleri' },
  { key: 'test', label: 'Sistem Testi' }
];

// Kaynakları grup başlıklarına göre düzenler (yetkilendirme formunda kullanılır).
const resGroups = () =>
  Object.entries(RES).reduce((m, [k, r]) => ((m[r.group] = m[r.group] || []).push({ key: k, title: r.title }), m), {});

router.use('/admin-users', (req, res, next) => {
  if (!res.locals.admin.is_super) return res.status(403).send('Yetkiniz yok.');
  next();
});

router.get('/admin-users', (req, res) => {
  const rows = db
    .prepare('SELECT id,username,name,is_super,permissions FROM admins ORDER BY id DESC')
    .all()
    .map(a => ({ ...a, perms: parsePerms(a.permissions) }));
  res.render('admin/admin_users', { title: 'Admin Kullanıcıları', rows });
});

router.get('/admin-users/new', (req, res) => {
  res.render('admin/admin_user_form', {
    title: 'Admin Kullanıcıları - Yeni',
    row: null,
    groups: resGroups(),
    SYSTEM_PAGES,
    sel: { res: [], sys: [] }
  });
});

router.get('/admin-users/:id', (req, res) => {
  const a = db.prepare('SELECT id,username,name,is_super,permissions FROM admins WHERE id=?').get(+req.params.id);
  if (!a) return res.redirect('/admin/admin-users');
  res.render('admin/admin_user_form', {
    title: 'Admin Kullanıcıları - Düzenle',
    row: a,
    groups: resGroups(),
    SYSTEM_PAGES,
    sel: parsePerms(a.permissions)
  });
});

router.post('/admin-users', (req, res) => {
  const { username, name, password, is_super: iss } = req.body;
  if (!username || !password) {
    flash(req, 'danger', 'Kullanıcı adı ve parola zorunludur.');
    return res.redirect('/admin/admin-users');
  }
  const isSuper = iss ? 1 : 0;
  const perms = { res: [], sys: [] };
  if (!isSuper) {
    const resSel = Array.isArray(req.body.res_perms) ? req.body.res_perms : req.body.res_perms ? [req.body.res_perms] : [];
    const sysSel = Array.isArray(req.body.sys_perms) ? req.body.sys_perms : req.body.sys_perms ? [req.body.sys_perms] : [];
    perms.res = resSel.filter(k => RES[k]);
    perms.sys = sysSel.filter(k => SYSTEM_PAGES.find(p => p.key === k));
  }
  const pe = passwordError(password);
  if (pe) {
    flash(req, 'danger', pe);
    return res.redirect('/admin/admin-users/new');
  }
  const hash = bcrypt.hashSync(String(password), 12);
  try {
    db.prepare('INSERT INTO admins (username,name,password_hash,is_super,permissions) VALUES (?,?,?,?,?)').run(
      String(username).trim(),
      String(name || '').trim() || null,
      hash,
      isSuper,
      JSON.stringify(perms)
    );
    logAudit(res.locals.admin, 'create', 'admin_user', null, { username: String(username).trim(), is_super: isSuper }, req.ip);
    flash(req, 'success', 'Admin kullanıcısı eklendi.');
  } catch (e) {
    flash(req, 'danger', 'Kullanıcı adı zaten kullanılıyor olabilir.');
  }
  res.redirect('/admin/admin-users');
});

router.post('/admin-users/:id/update', (req, res) => {
  if (!res.locals.admin.is_super) return res.status(403).send('Yetkiniz yok.');
  const id = parseInt(req.params.id);
  const a = db.prepare('SELECT * FROM admins WHERE id=?').get(id);
  if (!a) return res.redirect('/admin/admin-users');
  const { username, name, password, is_super: iss } = req.body;
  const isSuper = iss ? 1 : 0;
  const perms = { res: [], sys: [] };
  if (!isSuper) {
    const resSel = Array.isArray(req.body.res_perms) ? req.body.res_perms : req.body.res_perms ? [req.body.res_perms] : [];
    const sysSel = Array.isArray(req.body.sys_perms) ? req.body.sys_perms : req.body.sys_perms ? [req.body.sys_perms] : [];
    perms.res = resSel.filter(k => RES[k]);
    perms.sys = sysSel.filter(k => SYSTEM_PAGES.find(p => p.key === k));
  }
  let hash = a.password_hash;
  if (password) {
    const pe = passwordError(password);
    if (pe) {
      flash(req, 'danger', pe);
      return res.redirect('/admin/admin-users/' + id);
    }
    hash = bcrypt.hashSync(String(password), 12);
  }
  db.prepare('UPDATE admins SET username=?,name=?,password_hash=?,is_super=?,permissions=? WHERE id=?').run(
    String(username || a.username).trim(),
    String(name || '').trim() || null,
    hash,
    isSuper,
    JSON.stringify(perms),
    id
  );
  logAudit(res.locals.admin, 'update', 'admin_user', id, { username: String(username || a.username).trim(), is_super: isSuper }, req.ip);
  flash(req, 'success', 'Güncellendi.');
  res.redirect('/admin/admin-users');
});

router.post('/admin-users/:id/delete', (req, res) => {
  if (!res.locals.admin.is_super) return res.status(403).send('Yetkiniz yok.');
  const id = parseInt(req.params.id);
  if (id === res.locals.admin.id) {
    flash(req, 'danger', 'Kendi hesabınızı silemezsiniz.');
    return res.redirect('/admin/admin-users');
  }
  db.prepare('DELETE FROM admins WHERE id=?').run(id);
  logAudit(res.locals.admin, 'delete', 'admin_user', id, null, req.ip);
  flash(req, 'success', 'Silindi.');
  res.redirect('/admin/admin-users');
});

// ===================== DENETİM İZLERİ (AUDIT LOG) =====================
router.get('/audit', (req, res) => {
  const q = String(req.query.q || '').trim();
  const actor = String(req.query.actor || '').trim();
  const entity = String(req.query.entity || '').trim();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const PAGE = 100;
  const where = [];
  const params = {};
  if (q) {
    where.push('(action LIKE @q OR entity LIKE @q OR actor_name LIKE @q OR detail LIKE @q OR ip LIKE @q)');
    params.q = '%' + q + '%';
  }
  if (actor) {
    where.push('actor=@actor');
    params.actor = actor;
  }
  if (entity) {
    where.push('entity=@entity');
    params.entity = entity;
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM audit_log ${whereSql}`).get(params).n;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const p = Math.min(pages, page);
  const rows = db.prepare(`SELECT * FROM audit_log ${whereSql} ORDER BY id DESC LIMIT ${PAGE} OFFSET ${(p - 1) * PAGE}`).all(params);
  const actors = db
    .prepare('SELECT DISTINCT actor FROM audit_log WHERE actor IS NOT NULL ORDER BY actor')
    .all()
    .map(r => r.actor);
  const entities = db
    .prepare('SELECT DISTINCT entity FROM audit_log ORDER BY entity')
    .all()
    .map(r => r.entity);
  res.render('admin/audit', { title: 'Denetim İzleri', rows, q, actor, entity, actors, entities, page: p, pages, total });
});

// ===================== SİSTEM TESTİ =====================
const { runSystemTests, autoRepair } = require('../lib/diagnostics');

router.get('/test', (req, res) => res.render('admin/test', { title: 'Sistem Testi' }));
router.get('/test/api', async (req, res) => {
  try {
    res.json(await runSystemTests(req));
  } catch (e) {
    res.status(500).json({ ok: false, groups: [], error: e.message });
  }
});
router.post('/test/onar', (req, res) => {
  try {
    res.json(autoRepair());
  } catch (e) {
    res.status(500).json({ error: e.message, repairs: [] });
  }
});

module.exports = router;
