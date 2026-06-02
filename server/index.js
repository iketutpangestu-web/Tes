// FlukSite Pro - Express server (LAN/offline mode).
// Serve REST API di /api/* dan static frontend dari ../dist
const path = require('path');
const { pathToFileURL } = require('url');
const { Readable } = require('stream');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
require('dotenv').config();

const { pool } = require('./db');
const docxRender = require('./lib/docxRender');

const PORT = Number(process.env.PORT || 8080);
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 16) {
  console.error('[server] SESSION_SECRET di server/.env terlalu pendek atau belum diset.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);

// CORS: izinkan akses dari LAN kantor (mis. http://192.168.x.x:8080).
// Kita pakai same-origin saat browser membuka via server ini, jadi cors longgar aman untuk LAN.
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({ limit: '20mb' })); // limit besar karena foto base64 dari signup
app.use((err, req, res, next) => {
  if (err?.type === 'request.aborted' || err?.code === 'ECONNABORTED') {
    console.warn('[server] Request dibatalkan client:', req.method, req.originalUrl, `${err.received || 0}/${err.expected || err.length || '?'} bytes`);
    return res.status(499).json({ error: 'request_aborted' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload_terlalu_besar' });
  }
  next(err);
});

// Session HARUS didaftarkan sebelum route apa pun supaya req.session
// tersedia di semua handler (termasuk upload template).
app.use(session({
  store: new PgSession({ pool, tableName: 'user_sessions' }),
  name: 'fluksite.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false, // LAN HTTP - kalau pakai HTTPS, set true
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 hari
  },
}));

// ---- Helpers (dipakai oleh route di bawah) ----
function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// ============================================================
// UPLOADS (file fisik di folder server/uploads/)
// Disimpan per-tahun/bulan supaya tidak menumpuk di satu folder.
// JSON aplikasi cuma menyimpan path relatif seperti '/uploads/2026/05/abc.pdf'.
// ============================================================
const uploadsDir = path.join(__dirname, 'uploads');
try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch { /* ignore */ }

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
  'application/pdf',
]);

function safeExt(originalName, mime) {
  const ext = (path.extname(originalName || '') || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
  if (ext && ext.length <= 6) return ext;
  if (mime === 'application/pdf') return '.pdf';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '.jpg';
}

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const d = new Date();
    const sub = path.join(uploadsDir, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'));
    fs.mkdir(sub, { recursive: true }, (err) => cb(err, sub));
  },
  filename: (_req, file, cb) => {
    const rand = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}-${rand}${safeExt(file.originalname, file.mimetype)}`);
  },
});

const uploader = multer({
  storage: uploadStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error('format_tidak_didukung'));
  },
});

const publicUploader = multer({
  storage: uploadStorage,
  limits: { fileSize: 4 * 1024 * 1024 }, // 4 MB untuk foto signup
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('hanya_gambar'));
  },
});

function fileToPublicUrl(file) {
  if (!file) return null;
  const rel = path.relative(uploadsDir, file.path).split(path.sep).join('/');
  return `/uploads/${rel}`;
}

// Serve file fisik. Cache 30 hari di browser karena nama file unik.
app.use('/uploads', express.static(uploadsDir, {
  maxAge: '30d',
  fallthrough: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'private, max-age=2592000');
  },
}));

// Upload untuk user yang sudah login (lampiran cuti/sakit, dll).
app.post('/api/uploads', requireAuth, (req, res) => {
  uploader.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'upload_gagal' });
    if (!req.file) return res.status(400).json({ error: 'file_kosong' });
    res.json({ url: fileToPublicUrl(req.file), size: req.file.size, mime: req.file.mimetype });
  });
});

// Upload publik (foto signup) — hanya gambar, limit lebih kecil.
app.post('/api/uploads/public', (req, res) => {
  publicUploader.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'upload_gagal' });
    if (!req.file) return res.status(400).json({ error: 'file_kosong' });
    res.json({ url: fileToPublicUrl(req.file), size: req.file.size, mime: req.file.mimetype });
  });
});

// ============================================================
// DOCUMENT TEMPLATES & DOCUMENT REQUESTS
// (Fitur "Ajukan Dokumen": admin upload .docx template, karyawan
//  isi form → server render + convert ke PDF via LibreOffice.)
// ============================================================
const DOCX_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream', // beberapa browser kirim ini untuk .docx
]);

const templatesDir = path.join(uploadsDir, 'templates');
const documentsRootDir = path.join(uploadsDir, 'documents');
try { fs.mkdirSync(templatesDir, { recursive: true }); } catch { /* ignore */ }
try { fs.mkdirSync(documentsRootDir, { recursive: true }); } catch { /* ignore */ }

// ---------------- Cleanup SKC generated files ----------------
// File hasil render SKC (docx/pdf) hanya sementara — di-fetch ulang oleh
// client lalu dibungkus ZIP di sisi browser. Setelah beberapa menit, file
// sudah tidak diperlukan dan hanya menumpuk sebagai cache.
const skcRootDir = path.join(documentsRootDir, 'skc');
const SKC_FILE_TTL_MS = 15 * 60 * 1000; // 15 menit setelah render → delete
const SKC_SWEEP_INTERVAL_MS = 30 * 60 * 1000; // sapu menyeluruh tiap 30 menit

function scheduleSkcDelete(filePath) {
  setTimeout(() => {
    fs.promises.unlink(filePath).catch(() => { /* sudah hilang, ok */ });
  }, SKC_FILE_TTL_MS).unref?.();
}

function sweepSkcOldFiles() {
  const cutoff = Date.now() - SKC_FILE_TTL_MS;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        try {
          const left = fs.readdirSync(p);
          if (left.length === 0) fs.rmdirSync(p);
        } catch { /* ignore */ }
      } else if (e.isFile()) {
        try {
          const st = fs.statSync(p);
          if (st.mtimeMs < cutoff) fs.unlinkSync(p);
        } catch { /* ignore */ }
      }
    }
  };
  walk(skcRootDir);
}

// Sapu sekali saat startup + jadwalkan periodik.
try { sweepSkcOldFiles(); } catch { /* ignore */ }
setInterval(() => { try { sweepSkcOldFiles(); } catch { /* ignore */ } }, SKC_SWEEP_INTERVAL_MS).unref?.();

const templateUploader = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, templatesDir),
    filename: (_req, file, cb) => {
      const rand = crypto.randomBytes(6).toString('hex');
      cb(null, `tpl-${Date.now()}-${rand}.docx`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const okExt = /\.docx$/i.test(file.originalname || '');
    const okMime = DOCX_MIME.has(file.mimetype) || okExt;
    if (okExt && okMime) return cb(null, true);
    cb(new Error('hanya_docx'));
  },
});

async function getRoleOfSession(req) {
  if (!req.session?.userId) return null;
  const u = await getUserById(req.session.userId);
  return u?.role || null;
}

function canManageTemplates(role) {
  return role === 'ADMIN' || role === 'APPROVAL_HR' || role === 'SUPERUSER';
}

/** Upload template .docx. Hanya ADMIN/APPROVAL_HR/SUPERUSER. */
app.post('/api/document-templates/upload', requireAuth, async (req, res) => {
  const role = await getRoleOfSession(req);
  if (!canManageTemplates(role)) return res.status(403).json({ error: 'forbidden' });
  templateUploader.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'upload_gagal' });
    if (!req.file) return res.status(400).json({ error: 'file_kosong' });
    try {
      const typed = docxRender.extractPlaceholdersTyped(req.file.path);
      res.json({
        url: fileToPublicUrl(req.file),
        fileName: req.file.originalname,
        size: req.file.size,
        placeholders: Array.from(new Set([...typed.text, ...typed.image])),
        textPlaceholders: typed.text,
        imagePlaceholders: typed.image,
      });
    } catch (e) {
      // Template korup / placeholder tidak balance
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      res.status(400).json({ error: 'template_invalid: ' + (e.message || String(e)).slice(0, 200) });
    }
  });
});

/**
 * Render template + (opsional) convert ke PDF.
 * Body: {
 *   templateUrl: '/uploads/templates/xxx.docx',
 *   values: {...},
 *   images?: { placeholder: '/uploads/signatures/xxx.png' },
 *   format?: 'docx' | 'pdf'  // default 'docx' (cepat, tanpa LibreOffice)
 * }
 * Return: { docxUrl, pdfUrl? }
 */
app.post('/api/document-templates/render', requireAuth, async (req, res) => {
  const T0 = Date.now();
  const t = (label) => console.log(`[doc-render] ${label}: +${Date.now() - T0}ms`);
  try {
    const { templateUrl, values, images, format } = req.body || {};
    const outFormat = format === 'pdf' ? 'pdf' : 'docx';
    if (!templateUrl || typeof templateUrl !== 'string') {
      return res.status(400).json({ error: 'templateUrl_wajib' });
    }
    const rel = templateUrl.replace(/^\/uploads\//, '');
    const absTemplate = path.normalize(path.join(uploadsDir, rel));
    if (!absTemplate.startsWith(uploadsDir) || !fs.existsSync(absTemplate)) {
      return res.status(404).json({ error: 'template_tidak_ditemukan' });
    }
    const data = {};
    if (values && typeof values === 'object') {
      for (const [k, v] of Object.entries(values)) {
        if (!docxRender.safeFieldName(k)) continue;
        data[k] = v == null ? '' : String(v);
      }
    }
    t('parsed-input');

    // Image map: hanya muat PNG bila template benar-benar punya placeholder {%nama}.
    // Menghindari overhead image-module bila tidak diperlukan.
    const imagesMap = {};
    if (images && typeof images === 'object' && Object.keys(images).length > 0) {
      let phs = [];
      try { phs = docxRender.extractPlaceholders(absTemplate); } catch { /* ignore */ }
      const phSet = new Set(phs);
      for (const [k, urlStr] of Object.entries(images)) {
        if (!docxRender.safeFieldName(k)) continue;
        if (phs.length > 0 && !phSet.has(k)) continue;
        if (typeof urlStr !== 'string' || !urlStr.startsWith('/uploads/')) continue;
        const relImg = urlStr.replace(/^\/uploads\//, '');
        const absImg = path.normalize(path.join(uploadsDir, relImg));
        if (!absImg.startsWith(uploadsDir) || !fs.existsSync(absImg)) continue;
        try { imagesMap[k] = { buffer: fs.readFileSync(absImg), width: 150, height: 75 }; } catch { /* skip */ }
      }
    }
    t(`images-loaded (${Object.keys(imagesMap).length})`);

    const d = new Date();
    const outDir = path.join(documentsRootDir, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'));
    fs.mkdirSync(outDir, { recursive: true });
    const baseId = docxRender.randomId('doc-');
    const outDocx = path.join(outDir, baseId + '.docx');
    docxRender.renderDocx(absTemplate, data, outDocx, { images: imagesMap });
    t('docx-written');
    const docxUrlRel = '/uploads/' + path.relative(uploadsDir, outDocx).split(path.sep).join('/');
    if (outFormat === 'docx') {
      console.log(`[doc-render] DONE total=${Date.now() - T0}ms file=${path.basename(outDocx)}`);
      return res.json({ docxUrl: docxUrlRel });
    }
    let outPdf;
    try {
      outPdf = await docxRender.convertDocxToPdf(outDocx, outDir);
    } catch (e) {
      console.error('[doc-render] gagal konversi PDF:', e.message);
      return res.status(500).json({
        error: 'pdf_convert_gagal',
        message: e.message,
        hint: 'Pastikan LibreOffice terinstall di PC server dan soffice ada di PATH atau set SOFFICE_PATH di server/.env.',
        docxUrl: docxUrlRel,
      });
    }
    console.log(`[doc-render] DONE+pdf total=${Date.now() - T0}ms`);
    res.json({
      pdfUrl: '/uploads/' + path.relative(uploadsDir, outPdf).split(path.sep).join('/'),
      docxUrl: docxUrlRel,
    });
  } catch (e) {
    console.error('[doc-render] error:', e);
    res.status(400).json({ error: 'render_gagal', message: e.message });
  }
});

/** Cek apakah soffice terdeteksi (dipakai UI buat warning). */
app.get('/api/document-templates/soffice-check', requireAuth, (_req, res) => {
  const sp = docxRender.findSoffice();
  res.json({ path: sp, exists: fs.existsSync(sp) });
});

// ============================================================
// SIGNATURES (PNG TTD untuk template SKC)
// File fisik: server/uploads/signatures/<file>.png
// Metadata disimpan di app_data['fluksite_signatures'].
// ============================================================
const signaturesDir = path.join(uploadsDir, 'signatures');
try { fs.mkdirSync(signaturesDir, { recursive: true }); } catch { /* ignore */ }

const signatureUploader = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, signaturesDir),
    filename: (_req, file, cb) => {
      const rand = crypto.randomBytes(6).toString('hex');
      cb(null, `sig-${Date.now()}-${rand}.png`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'image/png') return cb(null, true);
    cb(new Error('hanya_png'));
  },
});

/**
 * Upload TTD PNG. Semua role yang sudah login boleh upload — metadata
 * (ownerId, scope per role) dikelola di sisi client/AppContext.
 */
app.post('/api/signatures', requireAuth, (req, res) => {
  signatureUploader.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'upload_gagal' });
    if (!req.file) return res.status(400).json({ error: 'file_kosong' });
    res.json({ url: fileToPublicUrl(req.file), size: req.file.size });
  });
});

/**
 * SKC render: render template .docx dengan data DAN sisipkan PNG TTD pada
 * placeholder image (key di body.images = nama placeholder, value = URL relatif
 * PNG di /uploads/signatures/...).
 *
 * Body: { templateUrl, values, images: { tanda_tangan: '/uploads/signatures/xxx.png' } }
 * Hanya SUPERUSER/APPROVAL_HR.
 */
app.post('/api/document-templates/render-skc', requireAuth, async (req, res) => {
  const role = await getRoleOfSession(req);
  if (role !== 'SUPERUSER' && role !== 'APPROVAL_HR') {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const { templateUrl, values, images, format } = req.body || {};
    const outFormat = format === 'docx' ? 'docx' : 'pdf';
    if (!templateUrl || typeof templateUrl !== 'string') {
      return res.status(400).json({ error: 'templateUrl_wajib' });
    }
    const rel = templateUrl.replace(/^\/uploads\//, '');
    const absTemplate = path.normalize(path.join(uploadsDir, rel));
    if (!absTemplate.startsWith(uploadsDir) || !fs.existsSync(absTemplate)) {
      return res.status(404).json({ error: 'template_tidak_ditemukan' });
    }
    const data = {};
    if (values && typeof values === 'object') {
      for (const [k, v] of Object.entries(values)) {
        if (!docxRender.safeFieldName(k)) continue;
        data[k] = v == null ? '' : String(v);
      }
    }
    // Build images map (load PNG buffers)
    const imagesMap = {};
    if (images && typeof images === 'object') {
      for (const [k, urlStr] of Object.entries(images)) {
        if (!docxRender.safeFieldName(k)) continue;
        if (typeof urlStr !== 'string' || !urlStr.startsWith('/uploads/')) continue;
        const relImg = urlStr.replace(/^\/uploads\//, '');
        const absImg = path.normalize(path.join(uploadsDir, relImg));
        if (!absImg.startsWith(uploadsDir) || !fs.existsSync(absImg)) continue;
        try {
          imagesMap[k] = { buffer: fs.readFileSync(absImg), width: 150, height: 75 };
        } catch { /* skip */ }
      }
    }
    const d = new Date();
    const outDir = path.join(documentsRootDir, 'skc', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'));
    fs.mkdirSync(outDir, { recursive: true });
    const baseId = docxRender.randomId('skc-');
    const outDocx = path.join(outDir, baseId + '.docx');
    try {
      docxRender.renderDocx(absTemplate, data, outDocx, { images: imagesMap, forceFont: 'Calibri' });
    } catch (e) {
      return res.status(400).json({ error: 'render_gagal', message: e.message });
    }
    const docxUrlRel = '/uploads/' + path.relative(uploadsDir, outDocx).split(path.sep).join('/');
    if (outFormat === 'docx') {
      scheduleSkcDelete(outDocx);
      return res.json({ docxUrl: docxUrlRel });
    }
    let outPdf;
    try {
      outPdf = await docxRender.convertDocxToPdf(outDocx, outDir);
    } catch (e) {
      return res.status(500).json({
        error: 'pdf_convert_gagal',
        message: e.message,
        docxUrl: docxUrlRel,
      });
    }
    scheduleSkcDelete(outDocx);
    scheduleSkcDelete(outPdf);
    res.json({
      pdfUrl: '/uploads/' + path.relative(uploadsDir, outPdf).split(path.sep).join('/'),
      docxUrl: docxUrlRel,
    });
  } catch (e) {
    console.error('[skc-render] error:', e);
    res.status(400).json({ error: 'render_gagal', message: e.message });
  }
});

async function getUserById(id) {
  const { rows } = await pool.query(
    'SELECT id, email, name, nik, role, profile FROM users WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

function userToEmployee(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name, nik: u.nik || '-', role: u.role,
    ...u.profile,
  };
}

function normalizeNik(value) {
  return String(value || '').trim().toLowerCase();
}

function toSignupEmployee(e) {
  const nik = String(e?.nik || '').trim();
  const name = String(e?.name || '').trim();
  if (!nik || !name) return null;
  return {
    id: String(e?.id || nik),
    nik,
    name,
  };
}

async function getSignupEmployees() {
  const { rows } = await pool.query(
    `SELECT value FROM app_data WHERE key = 'mineroster_employees'`
  );
  const list = Array.isArray(rows[0]?.value) ? rows[0].value : [];
  return list.map(toSignupEmployee).filter(Boolean);
}

// ============================================================
// AUTH
// ============================================================
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email & password wajib diisi' });

  const { rows } = await pool.query(
    'SELECT id, email, name, nik, role, profile, password FROM users WHERE lower(email) = lower($1)',
    [email]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'email_atau_password_salah' });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'email_atau_password_salah' });

  req.session.userId = user.id;
  delete user.password;
  res.json({ user: userToEmployee(user) });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Verifikasi password Superuser (tanpa mengubah sesi login saat ini).
app.post('/api/auth/verify-superuser', async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.json({ ok: false });
  const { rows } = await pool.query(
    "SELECT password FROM users WHERE role = 'SUPERUSER'"
  );
  for (const r of rows) {
    if (r.password && await bcrypt.compare(password, r.password)) {
      return res.json({ ok: true });
    }
  }
  res.json({ ok: false });
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.session?.userId) return res.json({ user: null });
  const u = await getUserById(req.session.userId);
  res.json({ user: userToEmployee(u) });
});

// Ganti password user sendiri atau (jika SUPERUSER) user lain.
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { userId, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'password_minimal_4_karakter' });
  }
  const me = await getUserById(req.session.userId);
  const targetId = userId || me.id;
  if (targetId !== me.id && me.role !== 'SUPERUSER') {
    return res.status(403).json({ error: 'forbidden' });
  }
  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hash, targetId]);
  res.json({ ok: true });
});

// ============================================================
// USERS (akun login) — manage oleh SUPERUSER
// ============================================================
app.get('/api/users', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, email, name, nik, role, profile FROM users ORDER BY name'
  );
  res.json({ users: rows.map(userToEmployee) });
});

// Upsert user (tambah/update). Dipakai admin saat approve signup atau ubah role.
app.post('/api/users', requireAuth, async (req, res) => {
  const me = await getUserById(req.session.userId);
  if (me.role !== 'SUPERUSER' && me.role !== 'ADMIN') {
    return res.status(403).json({ error: 'forbidden' });
  }
  const { id, email, name, nik, role, password, profile } = req.body || {};
  if (!id || !email || !name) return res.status(400).json({ error: 'id, email, name wajib' });

  const profileJson = profile || {};
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO users (id, email, name, nik, role, password, profile)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email, name = EXCLUDED.name, nik = EXCLUDED.nik,
             role = EXCLUDED.role, password = EXCLUDED.password,
             profile = COALESCE(users.profile, '{}'::jsonb) || COALESCE(EXCLUDED.profile, '{}'::jsonb)`,
      [id, email, name, nik || '-', role || 'REGULAR', hash, profileJson]
    );
  } else {
    await pool.query(
      `INSERT INTO users (id, email, name, nik, role, password, profile)
       VALUES ($1, $2, $3, $4, $5, '', $6)
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email, name = EXCLUDED.name, nik = EXCLUDED.nik,
             role = EXCLUDED.role,
             profile = COALESCE(users.profile, '{}'::jsonb) || COALESCE(EXCLUDED.profile, '{}'::jsonb)`,
      [id, email, name, nik || '-', role || 'REGULAR', profileJson]
    );
  }
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAuth, async (req, res) => {
  const me = await getUserById(req.session.userId);
  if (me.role !== 'SUPERUSER') return res.status(403).json({ error: 'forbidden' });
  await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============================================================
// APP DATA (key-value JSONB)
// Semua state aplikasi (employees, leaves, symbols, dll) disimpan
// sebagai JSONB. Frontend memanggil /api/data?keys=a,b,c saat boot
// dan PUT /api/data/:key setiap kali state berubah.
// ============================================================
app.get('/api/data', requireAuth, async (req, res) => {
  const keys = String(req.query.keys || '').split(',').map(k => k.trim()).filter(Boolean);
  if (!keys.length) {
    const { rows } = await pool.query('SELECT key, value FROM app_data');
    const out = {};
    for (const r of rows) out[r.key] = r.value;
    return res.json({ data: out });
  }
  const { rows } = await pool.query('SELECT key, value FROM app_data WHERE key = ANY($1)', [keys]);
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  res.json({ data: out });
});

app.put('/api/data/:key', requireAuth, async (req, res) => {
  const key = req.params.key;
  const value = req.body?.value;
  if (value === undefined) return res.status(400).json({ error: 'value wajib' });
  try {
    await pool.query(
      `INSERT INTO app_data (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/data] PUT', key, 'gagal:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Public read khusus untuk halaman daftar: hanya kirim NIK + nama karyawan.
// Ini memungkinkan device baru memuat database NIK sebelum user login,
// tanpa membuka data karyawan lengkap.
app.get('/api/signup/employees', async (_req, res) => {
  try {
    const employees = await getSignupEmployees();
    res.json({ employees });
  } catch (err) {
    console.error('[api/signup/employees] gagal:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Public endpoint: pengguna baru kirim signup request tanpa harus login.
// Append-only ke app_data['mineroster_signups'] supaya tidak menimpa data lain.
app.post('/api/signups', async (req, res) => {
  const { name, nik, password, photo } = req.body || {};
  if (!name || !nik || !password) {
    return res.status(400).json({ error: 'name, nik, password wajib' });
  }
  try {
    const nikNorm = String(nik).trim();
    const employees = await getSignupEmployees();
    const matchedEmployee = employees.find((e) => normalizeNik(e.nik) === normalizeNik(nikNorm));
    if (!matchedEmployee) {
      return res.status(404).json({ error: 'nik_tidak_ditemukan' });
    }

    const { rows } = await pool.query(
      `SELECT value FROM app_data WHERE key = 'mineroster_signups'`
    );
    const list = Array.isArray(rows[0]?.value) ? rows[0].value : [];
    if (list.some((r) => r.status === 'PENDING' && normalizeNik(r.nik) === normalizeNik(nikNorm))) {
      return res.status(409).json({ error: 'permintaan_sudah_ada' });
    }
    const entry = {
      id: `signup-${Date.now()}`,
      name: matchedEmployee.name,
      nik: matchedEmployee.nik,
      password: String(password),
      photo: photo || '',
      submittedAt: new Date().toISOString(),
      status: 'PENDING',
    };
    const next = [...list, entry];
    await pool.query(
      `INSERT INTO app_data (key, value) VALUES ('mineroster_signups', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(next)]
    );
    res.json({ ok: true, signup: entry });
  } catch (err) {
    console.error('[api/signups] gagal:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/data/:key', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM app_data WHERE key = $1', [req.params.key]);
  res.json({ ok: true });
});

// Health check (boleh tanpa auth) untuk cek server hidup.
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up' });
  } catch (err) {
    res.status(503).json({ ok: false, db: 'down', error: err.message });
  }
});

// ============================================================
// Static frontend (hasil `npm run build`).
// TanStack Start = SSR. Static asset di dist/client/, HTML dirender on-the-fly oleh worker dist/server/index.js.
// ============================================================
const distClientDir = path.join(__dirname, '..', 'dist', 'client');
const distServerEntry = path.join(__dirname, '..', 'dist', 'server', 'index.js');

if (fs.existsSync(distClientDir)) {
  // Static asset (JS/CSS/images) - tanpa fallback HTML.
  app.use(express.static(distClientDir, { index: false }));
} else {
  console.warn('[server] Folder dist/client belum ada. Jalankan `npm run build` di root dulu.');
}

let ssrHandlerPromise = null;
async function getSsrHandler() {
  if (ssrHandlerPromise) return ssrHandlerPromise;
  if (!fs.existsSync(distServerEntry)) return null;
  ssrHandlerPromise = import(pathToFileURL(distServerEntry).href)
    .then((m) => m.default || m)
    .catch((err) => {
      console.error('[ssr] Gagal load handler:', err);
      ssrHandlerPromise = null;
      return null;
    });
  return ssrHandlerPromise;
}

// SSR fallback: render HTML via worker untuk semua non-/api request.
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  try {
    const handler = await getSsrHandler();
    if (!handler || typeof handler.fetch !== 'function') {
      return res.status(500).type('text/plain').send(
        'SSR handler tidak tersedia. Pastikan `npm run build` sukses dan dist/server/index.js ada.'
      );
    }
    const protocol = req.protocol || 'http';
    const host = req.headers.host || `localhost:${PORT}`;
    const url = `${protocol}://${host}${req.originalUrl}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v == null) continue;
      if (Array.isArray(v)) v.forEach((vv) => headers.append(k, String(vv)));
      else headers.set(k, String(v));
    }
    const webReq = new Request(url, { method: req.method, headers });
    const webRes = await handler.fetch(webReq, {}, { waitUntil: () => {}, passThroughOnException: () => {} });
    res.status(webRes.status);
    webRes.headers.forEach((v, k) => {
      if (k.toLowerCase() === 'content-encoding') return; // biarkan Node yang handle
      res.setHeader(k, v);
    });
    if (webRes.body) {
      Readable.fromWeb(webRes.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    console.error('[ssr] Render error:', err);
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error('[server] Error:', err);
  res.status(500).json({ error: err.message || 'internal_error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  FlukSite Pro server\n  Local : http://localhost:${PORT}`);
  console.log(`  LAN   : http://<IP-PC-INI>:${PORT}  (cek IP via 'ipconfig')\n`);
});
