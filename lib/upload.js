const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');

// Yüklenen dosyalar UPLOAD_DIR ortam değişkeniyle kalıcı bir diske taşınabilir.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = { '.jpg': 1, '.jpeg': 1, '.png': 1, '.webp': 1, '.gif': 1, '.pdf': 1 };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) =>
    cb(null, !!ALLOWED[path.extname(file.originalname).toLowerCase()] && /^(image\/|application\/pdf)/.test(file.mimetype))
});

// Dosyanın gerçek türü içeriğinden (magic bytes) anlaşılır; yalnızca uzantıya ve
// istemcinin bildirdiği Content-Type'a güvenmek yeterli değildir.
function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === '%PDF') return 'application/pdf';
  return null;
}
const EXT_BY_TYPE = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf']
};

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
    if (type === 'image/png') p = p.png({ compressionLevel: 9, palette: true });
    else if (type === 'image/webp') p = p.webp({ quality: 82 });
    else p = p.jpeg({ quality: 82, mozjpeg: true });
    const buf = await p.toBuffer();
    if (buf && buf.length) fs.writeFileSync(file.path, buf);
  } catch {
    /* optimizasyon başarısız olsa da yükleme sürer */
  }
}

// İçeriği uzantıyla uyuşmayan dosyaları diskten siler ve isteği reddeder; görselleri optimize eder.
async function validateUploads(req, res, next) {
  const files = fileList(req);
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
    const ext = path.extname(f.originalname || f.path).toLowerCase();
    const ok = !!type && (EXT_BY_TYPE[type] || []).includes(ext);
    if (!ok) {
      try {
        fs.unlinkSync(f.path);
      } catch {
        /* yok say */
      }
      return res.status(400).send('Yüklenen dosyanın içeriği geçersiz veya uzantısıyla uyuşmuyor.');
    }
    if (type.startsWith('image/')) await optimizeImage(f, type);
  }
  next();
}

module.exports = {
  upload,
  UPLOAD_DIR,
  validateUploads,
  // Rota bazlı hazır yığınlar: dosyalar ayrıştırılır, içerik doğrulanır; CSRF kontrolü
  // Multer'dan SONRA (gövde hazır olduğunda) eklenir.
  anyFiles: [upload.any(), validateUploads],
  singleImage: [upload.single('image'), validateUploads]
};
