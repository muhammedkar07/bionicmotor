const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

// Yüklenen dosyalar UPLOAD_DIR ortam değişkeniyle kalıcı bir diske taşınabilir.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = { '.jpg': 1, '.jpeg': 1, '.png': 1, '.webp': 1, '.gif': 1, '.pdf': 1 };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) =>
      cb(null, crypto.randomBytes(12).toString('hex') + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) =>
    cb(null, !!ALLOWED[path.extname(file.originalname).toLowerCase()] && /^(image\/|application\/pdf)/.test(file.mimetype))
});

// Dosyanın gerçek türü içeriğinden (magic bytes) anlaşılır; yalnızca uzantıya ve
// istemcinin bildirdiği Content-Type'a güvenmek yeterli değildir.
function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === '%PDF') return 'application/pdf';
  return null;
}
const EXT_BY_TYPE = {
  'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/gif': ['.gif'],
  'image/webp': ['.webp'], 'application/pdf': ['.pdf']
};

function fileList(req) {
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === 'object') return Object.values(req.files).flat();
  return req.file ? [req.file] : [];
}

// İçeriği uzantıyla uyuşmayan dosyaları diskten siler ve isteği reddeder.
function validateUploads(req, res, next) {
  const files = fileList(req);
  for (const f of files) {
    let ok = false;
    try {
      const fd = fs.openSync(f.path, 'r');
      const buf = Buffer.alloc(12);
      const n = fs.readSync(fd, buf, 0, 12, 0);
      fs.closeSync(fd);
      const type = sniff(buf.subarray(0, n));
      const ext = path.extname(f.originalname || f.path).toLowerCase();
      ok = !!type && (EXT_BY_TYPE[type] || []).includes(ext);
    } catch { ok = false; }
    if (!ok) {
      try { fs.unlinkSync(f.path); } catch {}
      return res.status(400).send('Yüklenen dosyanın içeriği geçersiz veya uzantısıyla uyuşmuyor.');
    }
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
