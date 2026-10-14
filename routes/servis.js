const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, tx, syncOrderDebit, nextNo, STATUS } = require('../db');
const { flash, throttle, regenerate, addYears, fmtMoney } = require('../lib/core');
const { accountSummary } = require('../lib/account');
const pay = require('../lib/pay');

const DUMMY = bcrypt.hashSync('x', 10);
const page = (res, view, title, extra = {}) => res.render('servis/' + view, { title, ...extra });

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
  if (req.session.servis) return res.redirect('/servis');
  res.render('servis/login', { title: 'Servis Girişi' });
});

router.post('/giris', (req, res) => {
  const code = String(req.body.code || '').trim().slice(0, 50);
  const pass = String(req.body.password || '').slice(0, 200);
  const t = throttle('servis:' + req.ip + ':' + code);
  if (t.blocked) { flash(req, 'danger', 'Çok fazla hatalı deneme. Lütfen daha sonra tekrar deneyin.'); return res.redirect('/servis/giris'); }
  const u = db.prepare('SELECT * FROM dealer_users WHERE code=? AND active=1').get(code);
  const ok = bcrypt.compareSync(pass, u ? u.password_hash : DUMMY) && u;
  if (!ok) { t.hit(); flash(req, 'danger', 'Kullanıcı kodu veya parola hatalı.'); return res.redirect('/servis/giris'); }
  t.reset();
  const firmRow = db.prepare('SELECT firm_id FROM user_firms WHERE user_id=? ORDER BY firm_id').get(u.id);
  if (u.role !== 'servis') {
    if (!firmRow) { flash(req, 'danger', 'Hesabınıza tanımlı aktif firma bulunmuyor.'); return res.redirect('/servis/giris'); }
    if (u.role === null || u.role === '') db.prepare("UPDATE dealer_users SET role='bayi' WHERE id=?").run(u.id);
    regenerate(req, res, 'dealer');
    req.session.dealer = { userId: u.id, firmId: firmRow.firm_id };
    req.saveSession();
    return res.redirect('/bayi');
  }
  regenerate(req, res, 'servis');
  req.session.servis = { userId: u.id, firmId: firmRow ? firmRow.firm_id : null };
  req.saveSession();
  res.redirect('/servis');
});

router.use((req, res, next) => {
  const s = req.session.servis;
  const u = s && db.prepare("SELECT * FROM dealer_users WHERE id=? AND active=1").get(s.userId);
  if (!u) return res.redirect('/servis/giris');
  if (u.role !== 'servis') return res.redirect('/bayi');
  const f = u && s.firmId && db.prepare(
    'SELECT f.* FROM firms f JOIN user_firms uf ON uf.firm_id=f.id WHERE uf.user_id=? AND f.id=? AND f.active=1').get(u.id, s.firmId);
  res.locals.su = u;
  res.locals.sf = f || null;
  next();
});

router.get('/', (req, res) => {
  const u = res.locals.su;
  const unread = u ? db.prepare('SELECT * FROM announcements WHERE active=1 AND (? IS NULL OR created_at > ?) ORDER BY created_at DESC, id DESC')
    .all(u.ann_seen_at, u.ann_seen_at) : [];
  if (u) db.prepare("UPDATE dealer_users SET ann_seen_at=datetime('now') WHERE id=?").run(u.id);
  page(res, 'home', 'Servis Portalı', { unread });
});
router.post('/cikis', (req, res) => { regenerate(req, res, 'servis'); res.redirect('/servis/giris'); });

router.get('/hesap-ozeti', (req, res) => {
  const firm = req.session.servis.firmId;
  if (!firm) return res.redirect('/servis');
  res.render('servis/account', { title: 'Hesap Özeti', heading: 'Hesap Özeti', a: accountSummary(firm, 'ana'), showCards: true });
});
router.get('/yedek-parca-ekstre', (req, res) => {
  const firm = req.session.servis.firmId;
  if (!firm) return res.redirect('/servis');
  res.render('servis/account', { title: 'Yedek Parça Hesap Ekstresi', heading: 'Yedek Parça Hesap Ekstresi', a: accountSummary(firm, 'parca'), showCards: false });
});

router.get('/odeme', (req, res) => {
  if (!req.session.servis.firmId) { flash(req, 'danger', 'Firma bilgisi bulunamadı.'); return res.redirect('/servis'); }
  const inst = db.prepare('SELECT * FROM installments WHERE active=1 ORDER BY count').all();
  page(res, 'odeme', 'Online Ödeme', { inst, base: '/servis/odeme' });
});
router.post('/odeme/ode', (req, res) => {
  if (!req.session.servis.firmId) { flash(req, 'danger', 'Firma bilgisi bulunamadı.'); return res.redirect('/servis'); }
  const b = req.body;
  const ctx = { userId: res.locals.su.id, firmId: req.session.servis.firmId };
  const method = ['kart', 'havale'].includes(b.method) ? b.method : 'kart';
  const r = method === 'havale' ? pay.havale(ctx, b) : pay.card(ctx, b);
  flash(req, r.error ? 'danger' : 'success', r.error || r.msg);
  res.redirect('/servis/odeme');
});
router.post('/odeme/talimat', (req, res) => {
  if (!req.session.servis.firmId) { flash(req, 'danger', 'Firma bilgisi bulunamadı.'); return res.redirect('/servis'); }
  const r = pay.talimat({ userId: res.locals.su.id, firmId: req.session.servis.firmId }, req.body);
  flash(req, r.error ? 'danger' : 'success', r.error || r.msg);
  res.redirect('/servis/odeme');
});

router.get('/garanti', (req, res) => {
  const q = String(req.query.q || '').trim();
  const firm = req.session.servis.firmId;
  const rows = firm ? db.prepare("SELECT * FROM warranty_records WHERE firm_id=? AND (?='' OR serial_no LIKE ? OR customer LIKE ? OR invoice_no LIKE ?) ORDER BY sale_date DESC").all(firm,q,`%${q}%`,`%${q}%`,`%${q}%`) : [];
  page(res, 'warranty', 'Garanti Kayıtları', { rows, q });
});
router.get('/garanti/yeni', (req, res) => {
  const models = db.prepare("SELECT id,name,warranty_setup_fee,warranty_setup_desc FROM models WHERE active=1 ORDER BY name").all();
  page(res, 'warranty_new', 'Yeni Ürün Garanti Kaydı', { today: new Date().toISOString().slice(0,10), old: null, models });
});
router.post('/garanti/yeni', (req, res) => {
  const b=req.body, clip=(v,n)=>String(v||'').trim().slice(0,n);
  const old={ model_id: +b.model_id || '', serial_no: clip(b.serial_no,120), customer: clip(b.customer,120), invoice_no: clip(b.invoice_no,120), sale_date: clip(b.sale_date,120) };
  const back=m=>{
    const models = db.prepare("SELECT id,name,warranty_setup_fee,warranty_setup_desc FROM models WHERE active=1 ORDER BY name").all();
    res.locals.flash={type:'danger',msg:m};
    page(res,'warranty_new','Yeni Ürün Garanti Kaydı',{today:new Date().toISOString().slice(0,10),old,models});
  };
  const firm=req.session.servis.firmId; if(!firm) return back('Firma bilgisi bulunamadı.');
  const serial=clip(b.serial_no,40), invoice=clip(b.invoice_no,60), saleDate=clip(b.sale_date,10);
  const mid = +b.model_id || null;
  if(!mid) return back('Model seçmelisiniz.');
  if(!serial||!saleDate) return back('Şase no ve satış tarihi zorunludur.');
  if(!invoice) return back('Fatura numarası zorunludur.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) return back('Geçerli bir satış tarihi girin.');
  const m = db.prepare('SELECT name,warranty_setup_fee FROM models WHERE id=? AND active=1').get(mid);
  if(!m) return back('Geçersiz model.');
  const warrantyEnd=addYears(saleDate,2);
  const fee = Math.max(0, +m.warranty_setup_fee || 0);
  let wrid;
  tx(()=>{
    wrid = db.prepare('INSERT INTO warranty_records(firm_id,serial_no,model,customer,sale_date,warranty_end,status,invoice_no,setup_fee) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(firm,serial,m.name,clip(b.customer,120),saleDate,warrantyEnd,'Aktif',invoice,fee).lastInsertRowid;
    if(fee>0){
      const md = db.prepare("INSERT INTO account_movements(firm_id,ledger,date,doc_no,doc_type,kind,amount,has_detail) VALUES(?,'parca',date('now'),?,?,?,?,0)")
        .run(firm,'GR-'+wrid,'Garanti Başlangıç Bedeli','alacak',fee).lastInsertRowid;
      db.prepare('UPDATE warranty_records SET setup_movement_id=? WHERE rowid=?').run(md,wrid);
    }
  });
  flash(req,'success','Ürün garanti kaydı oluşturuldu.' + (fee>0 ? ` (Test/devreye alma bedeli ${fmtMoney(fee)} ₺ yedek parça hesabına alacak olarak işlendi)` : ''));
  res.redirect('/servis/garanti');
});

router.get('/is-emri/yeni', (req,res)=>page(res,'workorder_new','İş Emri Oluştur',{old:null}));
router.post('/is-emri/yeni', (req,res)=>{
  const b=req.body, clip=(v,n)=>String(v||'').trim().slice(0,n), img=(req.files||[]).find(f=>f.fieldname==='image');
  const old={}; for(const k of ['serial_no','model','km','description']) old[k]=clip(b[k],3000);
  const back=m=>{res.locals.flash={type:'danger',msg:m};page(res,'workorder_new','İş Emri Oluştur',{old});};
  const firm=req.session.servis.firmId; const uid=req.session.servis.userId;
  if(!clip(b.serial_no,40)||!clip(b.description,3000)) return back('Şase no ve açıklama zorunludur.');
  if(!img) return back('İş emri için görsel eklemek zorunludur (JPG, PNG, WEBP veya PDF).');
  if(!firm) return back('Firma bilgisi bulunamadı.');
  const n=db.prepare('SELECT COUNT(*) c FROM work_orders').get().c+1;
  const no='IE'+new Date().getFullYear()+String(n).padStart(6,'0');
  db.prepare('INSERT INTO work_orders(firm_id,user_id,no,serial_no,model,km,type,description,image) VALUES(?,?,?,?,?,?,?,?,?)').run(firm,uid,no,clip(b.serial_no,40),clip(b.model,80),clip(b.km,20),'',clip(b.description,3000),'/static/uploads/'+img.filename);
  flash(req,'success',`İş emriniz oluşturuldu: ${no}. İş emri türü yönetici tarafından belirlenecektir.`);
  res.redirect('/servis/is-emirlerim');
});
router.get('/is-emirlerim', (req,res)=>{
  const firm=req.session.servis.firmId; const rows=firm?db.prepare('SELECT * FROM work_orders WHERE firm_id=? ORDER BY id DESC').all(firm):[];
  page(res,'workorders','İş Emirlerim',{rows});
});

router.get('/yedek-parca/yeni', (req,res)=>{
  const parts=db.prepare("SELECT * FROM products WHERE kind='parca' AND active=1 ORDER BY category,name").all();
  const inst=db.prepare('SELECT * FROM installments WHERE active=1 ORDER BY count').all();
  const models=db.prepare('SELECT id,name FROM models WHERE active=1 ORDER BY name COLLATE NOCASE').all();
  const firm=req.session.servis.firmId;
  const bal=firm?accountSummary(firm,'parca').balance:0;
  const credit=bal<0?Math.round(-bal*100)/100:0;
  page(res,'spare_new','Yedek Parça Sipariş Oluştur',{parts,inst,models,old:null,credit});
});
router.post('/yedek-parca/yeni', (req,res)=>{
  const b=req.body;
  const ids=[].concat(b.part_id||[]), qtys=[].concat(b.qty||[]);
  const old={lines:ids.map((id,i)=>[+id||'',String(qtys[i]??'').trim()]),note:String(b.note||'').slice(0,1000),pay_method:b.pay_method||'kart',holder:String(b.holder||'').slice(0,80),number:String(b.number||'').trim(),month:b.month||'',year:b.year||'',cvc:String(b.cvc||'').slice(0,4),payer_name:String(b.payer_name||'').slice(0,120),installment_id:b.installment_id||''};
  const renderNew=()=>{const parts=db.prepare("SELECT * FROM products WHERE kind='parca' AND active=1 ORDER BY category,name").all();const inst=db.prepare('SELECT * FROM installments WHERE active=1 ORDER BY count').all();const models=db.prepare('SELECT id,name FROM models WHERE active=1 ORDER BY name COLLATE NOCASE').all();const bal=accountSummary(firm,'parca').balance;const credit=bal<0?Math.round(-bal*100)/100:0;page(res,'spare_new','Yedek Parça Sipariş Oluştur',{parts,inst,models,old,credit});};
  const back=m=>{res.locals.flash={type:'danger',msg:m};renderNew();};
  const firm=req.session.servis.firmId, uid=req.session.servis.userId; if(!firm) return back('Firma bilgisi bulunamadı.');
  const lines=[];
  ids.forEach((id,i)=>{const qty=Math.floor(+qtys[i]); const p=id&&db.prepare("SELECT * FROM products WHERE id=? AND kind='parca' AND active=1").get(+id); if(p&&qty>0&&qty<=10000) lines.push({p,qty});});
  if(!lines.length) return back('Sepete en az bir parça ve adet eklemelisiniz.');
  const overQty=checkMaxQty(lines); if(overQty) return back(overQty);
  const total=lines.reduce((s,l)=>s+l.qty*l.p.price,0);
  const bal=accountSummary(firm,'parca').balance;
  const available=bal<0?Math.round(-bal*100)/100:0;
  const applied=Math.round(Math.min(available,total)*100)/100;
  const payable=Math.round((total-applied)*100)/100;
  const method={kart:'Kredi Kartı',nakit:'Nakit',havale:'Havale / EFT'}[b.pay_method];
  if(!method) return back('Ödeme yöntemini seçin.');
  const payer=String(b.payer_name||'').trim().slice(0,120); if(payable>0 && b.pay_method==='havale' && !payer) return back('Havale / EFT için gönderen hesap ad soyad bilgisini giriniz.');
  let card=null;
  if(payable>0 && b.pay_method==='kart'){
    const inst=db.prepare('SELECT * FROM installments WHERE id=? AND active=1').get(+b.installment_id);
    const holder=String(b.holder||'').trim().slice(0,80), number=String(b.number||'').replace(/\s/g,''), month=+b.month, year=+b.year, cvc=String(b.cvc||'');
    const now=new Date(); if(!inst) return back('Taksit seçeneği seçin.');     if(!holder) return back('Kart bilgileri geçersiz.');
    if(!(month>=1&&month<=12)||year<now.getFullYear()||(year===now.getFullYear()&&month<now.getMonth()+1)) return back('Kartın son kullanma tarihi geçersiz.');
    if(!/^\d{3,4}$/.test(cvc)) return back('CVC geçersiz.'); card={inst,holder,last4:number.slice(-4)};
  }
  const fullyCovered = payable <= 0;
  let no;
  tx(() => {
    no = String(nextNo('spare_orders', 'no'));
    // Yalnızca tamamen bakiyeden (alacaktan) karşılanan sipariş anında onaylanır.
    // Sanal POS entegrasyonu olmadığı için kart ödemesi tahsil edilmiş SAYILMAZ:
    // ödeme "Sanal POS Bekliyor", sipariş "Beklemede" olarak kaydedilir ve yönetici onayı bekler.
    const status = fullyCovered ? STATUS.CONVERTED : STATUS.PENDING;
    let payId = null;
    if (card) {
      const commission = Math.round(payable * card.inst.rate) / 100;
      payId = db.prepare(`INSERT INTO payments(user_id,firm_id,kind,amount,currency,description,installment,commission,total,card_holder,card_last4,status)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(uid, firm, 'odeme', payable, 'TL', 'Yedek Parça Siparişi #' + no,
        card.inst.label, commission, payable + commission, card.holder, card.last4, STATUS.POS_PENDING).lastInsertRowid;
    }
    const oid = db.prepare("INSERT INTO spare_orders(firm_id,user_id,no,status,note,request_date,pay_method,payment_id,payer_name,balance_applied) VALUES(?,?,?,?,?,date('now'),?,?,?,?)")
      .run(firm, uid, no, status, String(b.note || '').slice(0, 1000), fullyCovered ? 'Bakiye (Alacak)' : method, payId, payer || null, applied).lastInsertRowid;
    const ins = db.prepare('INSERT INTO spare_order_items(order_id,part_code,part_name,qty,unit_price) VALUES(?,?,?,?,?)');
    lines.forEach(l => ins.run(oid, l.p.code, l.p.name, l.qty, l.p.price));
    syncOrderDebit('spare_orders', 'spare_order_items', oid, 'parca');
  });
  const creditMsg = applied > 0 ? ` Bakiyenizden ${fmtMoney(applied)} ₺ alacak kullanıldı${payable > 0 ? `, kalan ${fmtMoney(payable)} ₺ ödendi.` : ' olup siparişiniz tamamen bakiyenizden karşılandı.'}` : '';
  const msg = fullyCovered
    ? `${no} numaralı siparişiniz onaylandı.`
    : card
      ? `${no} numaralı siparişiniz kaydedildi. Sanal POS entegrasyonu henüz aktif olmadığından ödeme alınmamıştır; yönetici onayından sonra hesabınıza işlenecektir.`
      : `${no} numaralı siparişiniz ${method} ödeme yöntemiyle kaydedildi. Yönetici onayından sonra hesabınıza işlenecektir.`;
  flash(req, 'success', msg + creditMsg);
  res.redirect('/servis/yedek-parca-siparisleri');
});
router.post('/stok-bildirim',(req,res)=>{
  const pid=+req.body.product_id; const p=pid&&db.prepare("SELECT id FROM products WHERE id=? AND active=1").get(pid);
  const firm=req.session.servis.firmId;
  if(p&&firm) db.prepare('INSERT OR IGNORE INTO stock_notify(product_id,firm_id,user_id) VALUES(?,?,?)').run(pid,firm,req.session.servis.userId);
  res.json({ok:!!(p&&firm)});
});
router.get('/yedek-parca-siparisleri', (req,res)=>{
  const firm=req.session.servis.firmId; const orders=firm?db.prepare('SELECT * FROM spare_orders WHERE firm_id=? ORDER BY id DESC').all(firm):[];
  orders.forEach(o=>{ o.items=db.prepare('SELECT * FROM spare_order_items WHERE order_id=?').all(o.id); o.total=o.items.reduce((s,i)=>s+i.qty*i.unit_price,0); });
  page(res,'spare_orders','Yedek Parça Siparişlerim',{orders});
});

module.exports = router;



