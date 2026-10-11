const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, tx, syncOrderDebit, nextNo } = require('../db');
const { flash, throttle, regenerate, luhn, addYears } = require('../lib/core');

const DUMMY = bcrypt.hashSync('x', 10);
const page = (res, view, title, extra = {}) => res.render('servis/' + view, { title, ...extra });

router.get('/giris', (req, res) => {
  if (req.session.servis) return res.redirect('/servis');
  res.render('servis/login', { title: 'Servis Girişi' });
});

router.post('/giris', (req, res) => {
  const code = String(req.body.code || '').trim().slice(0, 50);
  const pass = String(req.body.password || '').slice(0, 200);
  const t = throttle('servis:' + req.ip + ':' + code);
  if (t.blocked) { flash(req, 'danger', 'Çok fazla hatalı deneme. Lütfen daha sonra tekrar deneyin.'); return res.redirect('/servis/giris'); }
  const u = db.prepare("SELECT * FROM dealer_users WHERE code=? AND active=1 AND (role='servis' OR role IS NULL)").get(code);
  const ok = bcrypt.compareSync(pass, u ? u.password_hash : DUMMY) && u;
  if (!ok) { t.hit(); flash(req, 'danger', 'Kullanıcı kodu veya parola hatalı.'); return res.redirect('/servis/giris'); }
  if (u.role === null || u.role === '') db.prepare("UPDATE dealer_users SET role='servis' WHERE id=?").run(u.id);
  t.reset();
  const firmId = db.prepare('SELECT firm_id FROM user_firms WHERE user_id=? ORDER BY firm_id').get(u.id);
  regenerate(req, res, 'servis');
  req.session.servis = { userId: u.id, firmId: firmId ? firmId.firm_id : null };
  req.saveSession();
  res.redirect('/servis');
});

router.use((req, res, next) => {
  const s = req.session.servis;
  const u = s && db.prepare("SELECT * FROM dealer_users WHERE id=? AND active=1").get(s.userId);
  if (!u) return res.redirect('/servis/giris');
  res.locals.su = u;
  res.locals.sf = null;
  next();
});

router.get('/', (req, res) => page(res, 'home', 'Servis Portalı'));
router.post('/cikis', (req, res) => { regenerate(req, res, 'servis'); res.redirect('/servis/giris'); });

router.get('/garanti', (req, res) => {
  const q = String(req.query.q || '').trim();
  const firm = req.session.servis.firmId;
  const rows = firm ? db.prepare("SELECT * FROM warranty_records WHERE firm_id=? AND (?='' OR serial_no LIKE ? OR customer LIKE ? OR invoice_no LIKE ?) ORDER BY sale_date DESC").all(firm,q,`%${q}%`,`%${q}%`,`%${q}%`) : [];
  page(res, 'warranty', 'Garanti Kayıtları', { rows, q });
});
router.get('/garanti/yeni', (req, res) => page(res, 'warranty_new', 'Yeni Ürün Garanti Kaydı', { today: new Date().toISOString().slice(0,10) }));
router.post('/garanti/yeni', (req, res) => {
  const b=req.body, clip=(v,n)=>String(v||'').trim().slice(0,n), back=m=>{flash(req,'danger',m);return res.redirect('/servis/garanti/yeni');};
  const firm=req.session.servis.firmId; if(!firm) return back('Firma bilgisi bulunamadı.');
  const serial=clip(b.serial_no,40), invoice=clip(b.invoice_no,60), saleDate=clip(b.sale_date,10);
  if(!serial||!saleDate) return back('Şase no ve satış tarihi zorunludur.');
  if(!invoice) return back('Fatura numarası zorunludur.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) return back('Geçerli bir satış tarihi girin.');
  const warrantyEnd=addYears(saleDate,2);
  db.prepare('INSERT INTO warranty_records(firm_id,serial_no,model,customer,sale_date,warranty_end,status,invoice_no) VALUES(?,?,?,?,?,?,?,?)').run(firm,serial,clip(b.model,80),clip(b.customer,120),saleDate,warrantyEnd,'Aktif',invoice);
  flash(req,'success','Ürün garanti kaydı oluşturuldu. Garanti bitiş tarihi satış tarihinden itibaren 2 yıl olarak tanımlandı.');
  res.redirect('/servis/garanti');
});

router.get('/is-emri/yeni', (req,res)=>page(res,'workorder_new','İş Emri Oluştur'));
router.post('/is-emri/yeni', (req,res)=>{
  const b=req.body, clip=(v,n)=>String(v||'').trim().slice(0,n), img=(req.files||[]).find(f=>f.fieldname==='image');
  const firm=req.session.servis.firmId; const uid=req.session.servis.userId;
  if(!clip(b.serial_no,40)||!clip(b.description,3000)){flash(req,'danger','Şase no ve açıklama zorunludur.');return res.redirect('/servis/is-emri/yeni');}
  if(!img){flash(req,'danger','İş emri için görsel eklemek zorunludur (JPG, PNG, WEBP veya PDF).');return res.redirect('/servis/is-emri/yeni');}
  if(!firm){flash(req,'danger','Firma bilgisi bulunamadı.');return res.redirect('/servis/is-emri/yeni');}
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
  page(res,'spare_new','Yedek Parça Sipariş Oluştur',{parts,inst});
});
router.post('/yedek-parca/yeni', (req,res)=>{
  const b=req.body, back=m=>{flash(req,'danger',m);return res.redirect('/servis/yedek-parca/yeni');};
  const firm=req.session.servis.firmId, uid=req.session.servis.userId; if(!firm) return back('Firma bilgisi bulunamadı.');
  const ids=[].concat(b.part_id||[]), qtys=[].concat(b.qty||[]); const lines=[];
  ids.forEach((id,i)=>{const qty=Math.floor(+qtys[i]); const p=id&&db.prepare("SELECT * FROM products WHERE id=? AND kind='parca' AND active=1").get(+id); if(p&&qty>0&&qty<=10000) lines.push({p,qty});});
  if(!lines.length) return back('Sepete en az bir parça ve adet eklemelisiniz.');
  const total=lines.reduce((s,l)=>s+l.qty*l.p.price,0); const method={kart:'Kredi Kartı',nakit:'Nakit',havale:'Havale / EFT'}[b.pay_method];
  if(!method) return back('Ödeme yöntemini seçin.');
  const payer=String(b.payer_name||'').trim().slice(0,120); if(b.pay_method==='havale'&& !payer) return back('Havale / EFT için gönderen hesap ad soyad bilgisini giriniz.');
  let card=null;
  if(b.pay_method==='kart'){
    const inst=db.prepare('SELECT * FROM installments WHERE id=? AND active=1').get(+b.installment_id);
    const holder=String(b.holder||'').trim().slice(0,80), number=String(b.number||'').replace(/\s/g,''), month=+b.month, year=+b.year, cvc=String(b.cvc||'');
    const now=new Date(); if(!inst) return back('Taksit seçeneği seçin.');     if(!holder) return back('Kart bilgileri geçersiz.');
    if(!(month>=1&&month<=12)||year<now.getFullYear()||(year===now.getFullYear()&&month<now.getMonth()+1)) return back('Kartın son kullanma tarihi geçersiz.');
    if(!/^\d{3,4}$/.test(cvc)) return back('CVC geçersiz.'); card={inst,holder,last4:number.slice(-4)};
  }
  let no; tx(()=>{ no=String(nextNo('spare_orders','no')); let payId=null;
    if(card){ const commission=Math.round(total*card.inst.rate)/100;
      payId=db.prepare(`INSERT INTO payments(user_id,firm_id,kind,amount,currency,description,installment,commission,total,card_holder,card_last4,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(uid,firm,'odeme',total,'TL','Yedek Parça Siparişi #'+no,card.inst.label,commission,total+commission,card.holder,card.last4,'Sanal POS Bekliyor').lastInsertRowid;
    }
    const oid=db.prepare("INSERT INTO spare_orders(firm_id,user_id,no,note,request_date,pay_method,payment_id,payer_name) VALUES(?,?,?,?,date('now'),?,?,?)").run(firm,uid,no,String(b.note||'').slice(0,1000),method,payId,payer||null).lastInsertRowid;
    const ins=db.prepare('INSERT INTO spare_order_items(order_id,part_code,part_name,qty,unit_price) VALUES(?,?,?,?,?)'); lines.forEach(l=>ins.run(oid,l.p.code,l.p.name,l.qty,l.p.price));
    syncOrderDebit('spare_orders','spare_order_items',oid,'parca');
  });
  flash(req,'success',card?`Ödemeniz alındı ve ${no} numaralı siparişiniz iletildi. (Sanal POS entegrasyonu henüz aktif değil; tahsilat yapılmamıştır.)`:`${no} numaralı siparişiniz ${method} ödeme yöntemiyle kaydedildi.`);
  res.redirect('/servis/yedek-parca-siparisleri');
});
router.get('/yedek-parca-siparisleri', (req,res)=>{
  const firm=req.session.servis.firmId; const orders=firm?db.prepare('SELECT * FROM spare_orders WHERE firm_id=? ORDER BY id DESC').all(firm):[];
  orders.forEach(o=>{ o.items=db.prepare('SELECT * FROM spare_order_items WHERE order_id=?').all(o.id); o.total=o.items.reduce((s,i)=>s+i.qty*i.unit_price,0); });
  page(res,'spare_orders','Yedek Parça Siparişlerim',{orders});
});

module.exports = router;
