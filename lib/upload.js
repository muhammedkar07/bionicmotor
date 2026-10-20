const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');

// Yüklenen dosyalar UPLOAD_DIR ortam değişkeniyle kalıcı bir diske taşınabilir.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = { '.jpg': 1, '.jpeg': 1, '.png': 1, '.webp': 1, '.gif': 1, '.avif': 1, '.heic': 1, '.heif': 1, '.pdf': 1 };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + path.extname(file.originalname).toLowerCase())
  }),
  // NOT: Tür kararı BURADA verilmez. Tarayıcının bildirdiği uzantı/MIME güvenilmez
  // (telefon fotoğrafları .heic gelir, bazı tarayıcılar image/* yerine
  // application/octet-stream gönderir) ve multer reddettiğinde dosya SESSİZCE düşer.
  // Bu yüzden dosya kabul edilir, gerçek tür validateUploads içinde İÇERİKTEN anlaşılır.
  limits: { fileSize: 12 * 1024 * 1024, files: 5 }
});

// Dosyanın gerçek türü içeriğinden (magic bytes) anlaşılır; yalnızca uzantıya ve
// istemcinin bildirdiği Content-Type'a güvenmek yeterli değildir.
function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === '%PDF') return 'application/pdf';
  // ISO-BMFF (AVIF / HEIC-HEIF): "ftyp" kutusu ve marka adı
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'mif1', 'msf1'].includes(brand)) return 'image/heif';
  }
  return null;
}
const EXT_BY_TYPE = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'image/avif': ['.avif'],
  'image/heif': ['.heic', '.heif'],
  'application/pdf': ['.pdf']
};

// Tarayıcılar HEIC/HEIF'i gösteremez → JPEG'e çevrilir (AVIF desteklenir ama tek biçime
// indirmek deposu ve görüntülemeyi basitleştirir). Başarısızsa dosya reddedilir.
async function convertToJpeg(file) {
  const target = path.join(UPLOAD_DIR, path.basename(file.filename, path.extname(file.filename)) + '.jpg');
  try {
    await sharp(file.path, { failOn: 'none' }).rotate().jpeg({ quality: 85, mozjpeg: true }).toFile(target);
    try {
      fs.unlinkSync(file.path);
    } catch {
      /* yok say */
    }
    file.path = target;
    file.filename = path.basename(target);
    file.mimetype = 'image/jpeg';
    return true;
  } catch {
    return false;
  }
}

function fileList(req) {
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === 'object') return Object.values(req.files).flat();
  return req.file ? [req.file] : [];
}

// Görseli en-boy koruyarak küçültür ve sıkıştırır (depolama + hız). GIF animasyonu korunur.
async function optimizeImage(file, type) {
  try {
    if (type === 'image/gif') return;
    const meta = await sharp(file.path, { failOn: 'none' }).metadata();
    let p = sharp(file.path, { failOn: 'none' }).rotate();
    if (meta.width && meta.width > 1600) p = p.resize({ width: 1600, withoutEnlargement: true });
    // Şeffaflık (alfa) varsa PALET KULLANILMAZ: 256 renge indirmek kenarları/gradyanları bozar.
    if (type === 'image/png') p = p.png(meta.hasAlpha ? { compressionLevel: 9 } : { compressionLevel: 9, palette: true });
    else if (type === 'image/webp') p = p.webp({ quality: 82 });
    else p = p.jpeg({ quality: 82, mozjpeg: true });
    const buf = await p.toBuffer();
    if (buf && buf.length) fs.writeFileSync(file.path, buf);
  } catch {
    /* optimizasyon başarısız olsa da yükleme sürer */
  }
}

// Tek renkli (ör. beyaz) arka planı ŞEFFAFA çevirir. Yalnızca görselin KENARLARINDAN bağlantılı
// pikseller temizlendiği için nesnenin içindeki beyaz alanlar korunur. Arka plan tek renk
// değilse (fotoğraf/kompozisyon) dosyaya DOKUNULMAZ. Şeffaflık gerektiği için PNG olarak yazılır.
const REMOVE_BG = process.env.UPLOAD_REMOVE_BG !== '0';

async function removeBackground(file) {
  let out = null;
  try {
    const { data, info } = await sharp(file.path, { failOn: 'none' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width,
      h = info.height,
      ch = info.channels;
    if (ch !== 4 || w < 32 || h < 32) return false;

    const at = (x, y) => (y * w + x) * ch;
    const border = [];
    for (let x = 0; x < w; x++) border.push(at(x, 0), at(x, h - 1));
    for (let y = 0; y < h; y++) border.push(at(0, y), at(w - 1, y));

    // Kenar piksellerinin ortancası = tahmini arka plan rengi
    const med = c => {
      const a = border.map(i => data[i + c]).sort((p, q) => p - q);
      return a[a.length >> 1];
    };
    const bg = [med(0), med(1), med(2)];
    const TOL = 22;
    const near = i =>
      data[i + 3] > 10 &&
      Math.abs(data[i] - bg[0]) <= TOL &&
      Math.abs(data[i + 1] - bg[1]) <= TOL &&
      Math.abs(data[i + 2] - bg[2]) <= TOL;

    // Arka plan gerçekten tek renk mi? (RGB karşılaştırılır; ŞEFFAF kenarlar da geçerlidir —
    // daha önce şeffafa çevrilmiş görsellerde bu piksellerin RGB'si hâlâ arka plan rengidir.)
    const nearRgb = i =>
      Math.abs(data[i] - bg[0]) <= TOL && Math.abs(data[i + 1] - bg[1]) <= TOL && Math.abs(data[i + 2] - bg[2]) <= TOL;
    let nearCount = 0;
    for (const i of border) if (nearRgb(i)) nearCount++;
    if (nearCount / border.length < 0.92) return false;

    // Kenarlardan taşma (flood fill): yalnızca dış arka plan temizlenir
    const seen = new Uint8Array(w * h);
    const stack = [];
    for (const i of border) {
      const p = i / ch;
      if (!seen[p] && near(i)) {
        seen[p] = 1;
        stack.push(p);
      }
    }
    let cleared = 0;
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      const y = (p - x) / w;
      data[p * ch + 3] = 0;
      cleared++;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const np = ny * w + nx;
        if (seen[np] || !near(np * ch)) continue;
        seen[np] = 1;
        stack.push(np);
      }
    }
    // 3) KAPALI (enclosed) arka plan adaları: dışarıya bağlı olmayan, arka plan rengine ÇOK
    // yakın ve yeterince büyük alanlar → tekerlek telleri arası, gövde boşlukları, cam araları.
    // (Dış zemin zaten şeffafsa bile bunlar kalıyordu; asıl "beyazlık" bunlardı.)
    const TOL2 = 10;
    const MIN_AREA = 40;
    const visited = new Uint8Array(w * h);
    let holeArea = 0;
    for (let y0 = 0; y0 < h; y0++) {
      for (let x0 = 0; x0 < w; x0++) {
        const p0 = y0 * w + x0;
        if (visited[p0] || data[p0 * ch + 3] === 0 || !near(p0 * ch)) continue;
        // bileşen topla (sıkı tolerans)
        const strict = i =>
          data[i + 3] > 10 &&
          Math.abs(data[i] - bg[0]) <= TOL2 &&
          Math.abs(data[i + 1] - bg[1]) <= TOL2 &&
          Math.abs(data[i + 2] - bg[2]) <= TOL2;
        if (!strict(p0 * ch)) continue;
        const comp = [];
        const st2 = [p0];
        visited[p0] = 1;
        let touchesEdge = false;
        while (st2.length) {
          const p = st2.pop();
          comp.push(p);
          const x = p % w;
          const y = (p - x) / w;
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1]
          ]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const np = ny * w + nx;
            if (visited[np] || data[np * ch + 3] === 0 || !strict(np * ch)) continue;
            visited[np] = 1;
            st2.push(np);
          }
        }
        if (touchesEdge) continue; // dışarıya bağlı → dış taşma zaten halletti
        if (comp.length >= MIN_AREA) {
          for (const p of comp) data[p * ch + 3] = 0;
          holeArea += comp.length;
        }
      }
    }

    // Hiçbir şey değişmediyse dosyaya dokunma (gereksiz PNG dönüşümü olmasın)
    if (cleared + holeArea === 0) return false;

    // KENAR YUMUŞATMA: temizlenen alana komşu opak piksellerin alfası, arka plan rengine
    // yakınlığına göre kademelendirilir → testere dişi/halo görünümü azalır.
    const soft = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (data[p * ch + 3] === 0) continue;
        const nb = [];
        if (x > 0) nb.push(p - 1);
        if (x < w - 1) nb.push(p + 1);
        if (y > 0) nb.push(p - w);
        if (y < h - 1) nb.push(p + w);
        if (!nb.some(q => data[q * ch + 3] === 0)) continue;
        const d = Math.max(
          Math.abs(data[p * ch] - bg[0]),
          Math.abs(data[p * ch + 1] - bg[1]),
          Math.abs(data[p * ch + 2] - bg[2])
        );
        const a = Math.min(1, d / (TOL * 1.8));
        if (a < 1) soft.push([p, Math.max(0, Math.round(a * 255))]);
      }
    }
    for (const [p, a] of soft) data[p * ch + 3] = a;

    out = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  } catch {
    return false;
  }
  if (!out) return false;
  const target = path.join(UPLOAD_DIR, path.basename(file.filename, path.extname(file.filename)) + '.png');
  try {
    fs.writeFileSync(target, out);
    if (target !== file.path) fs.unlinkSync(file.path);
  } catch {
    return false;
  }
  file.path = target;
  file.filename = path.basename(target);
  file.mimetype = 'image/png';
  return true;
}

// İçeriği uzantıyla uyuşmayan dosyaları diskten siler ve isteği reddeder; görselleri optimize eder.
async function validateUploads(req, res, next) {
  const files = fileList(req);
  const formats = Object.keys(ALLOWED).map(e => e.slice(1).toUpperCase()).join(', ');
  for (const f of files) {
    let type = null;
    try {
      const fd = fs.openSync(f.path, 'r');
      const buf = Buffer.alloc(12);
      const n = fs.readSync(fd, buf, 0, 12, 0);
      fs.closeSync(fd);
      type = sniff(buf.subarray(0, n));
    } catch {
      type = null;
    }
    if (!type) {
      try {
        fs.unlinkSync(f.path);
      } catch {
        /* yok say */
      }
      return res.status(400).send('Yüklenen dosya desteklenmiyor. İzin verilen biçimler: ' + formats + '.');
    }
    // Uzantı içerikle uyuşmuyorsa içeriğe göre düzeltilir (ör. .jfif → .jpg).
    const ext = path.extname(f.originalname || f.path).toLowerCase();
    if (!(EXT_BY_TYPE[type] || []).includes(ext)) {
      const target = path.join(UPLOAD_DIR, path.basename(f.filename, path.extname(f.filename)) + EXT_BY_TYPE[type][0]);
      try {
        fs.renameSync(f.path, target);
        f.path = target;
        f.filename = path.basename(target);
      } catch {
        /* yok say */
      }
    }
    if (type === 'image/heif' || type === 'image/avif') {
      // Tarayıcılar HEIC/HEIF gösteremez → JPEG'e çevir
      if (!(await convertToJpeg(f))) {
        try {
          fs.unlinkSync(f.path);
        } catch {
          /* yok say */
        }
        return res.status(400).send('Görsel dönüştürülemedi (' + type + '). Lütfen JPG veya PNG yükleyin.');
      }
      // NOT: arka plan temizliği OPTİMİZASYONDAN ÖNCE yapılır (yeniden kodlama şeffaf
      // piksellerin RGB'sini sıfırlar; arka plan rengi tespiti orijinalde doğru çalışır).
      if (REMOVE_BG && (await removeBackground(f))) type = 'image/png';
      await optimizeImage(f, type);
    } else if (type.startsWith('image/')) {
      // Önce arka planı temizle (orijinal RGB korunur), sonra boyutlandır/sıkıştır
      if (REMOVE_BG && (await removeBackground(f))) type = 'image/png';
      await optimizeImage(f, type);
    }
  }
  next();
}

module.exports = {
  upload,
  UPLOAD_DIR,
  validateUploads,
  removeBackground,
  // Rota bazlı hazır yığınlar: dosyalar ayrıştırılır, içerik doğrulanır; CSRF kontrolü
  // Multer'dan SONRA (gövde hazır olduğunda) eklenir.
  anyFiles: [upload.any(), validateUploads],
  singleImage: [upload.single('image'), validateUploads]
};
