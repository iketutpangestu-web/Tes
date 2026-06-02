// Render template .docx dengan placeholder mustache ({{nama}}) lalu convert ke PDF
// via LibreOffice (soffice CLI). Dipakai oleh fitur "Ajukan Dokumen".
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const crypto = require('crypto');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
let ImageModule = null;
try { ImageModule = require('docxtemplater-image-module-free'); } catch { /* optional */ }

/**
 * Parser literal: treat tag name as-is (no angular expression eval), so
 * placeholders like {{Cr-Cs}} look up the literal key "Cr-Cs" in data
 * instead of being parsed as the expression `Cr - Cs` (subtraction).
 * Without this, hyphenated placeholders break the render and may produce
 * a corrupt .docx that Word refuses to open.
 */
function literalTagParser(tag) {
  return {
    get(scope) {
      if (scope == null) return '';
      if (tag === '.') return scope;
      const v = scope[tag];
      return v == null ? '' : v;
    },
  };
}

/** Ekstrak daftar placeholder unik dari .docx, dipisah text vs image. */
function extractPlaceholdersTyped(docxPath) {
  const content = fs.readFileSync(docxPath);
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
    parser: literalTagParser,
  });
  const text = doc.getFullText();
  const textSet = new Set();
  const imageSet = new Set();
  let m;
  const re1 = /\{\{\s*([a-zA-Z0-9_\-]+)\s*\}\}/g;
  while ((m = re1.exec(text)) !== null) textSet.add(m[1]);
  const re2 = /\{%\s*([a-zA-Z0-9_\-]+)\s*\}/g;
  while ((m = re2.exec(text)) !== null) imageSet.add(m[1]);
  return { text: Array.from(textSet), image: Array.from(imageSet) };
}

/** Ekstrak daftar placeholder unik {{xxx}} + {%xxx} dari .docx (gabungan). */
function extractPlaceholders(docxPath) {
  const { text, image } = extractPlaceholdersTyped(docxPath);
  return Array.from(new Set([...text, ...image]));
}

/**
 * Render template .docx dengan data, tulis ke outDocxPath.
 *
 * Opsi `images`: map placeholder → { buffer, width, height } untuk
 * menyisipkan gambar (mis. TTD PNG) menggantikan placeholder. Memerlukan
 * `docxtemplater-image-module-free` (lihat server/package.json).
 */
function renderDocx(templatePath, data, outDocxPath, opts = {}) {
  const content = fs.readFileSync(templatePath);
  const zip = new PizZip(content);
  const modules = [];
  const images = opts.images || {};
  if (ImageModule && Object.keys(images).length > 0) {
    modules.push(new ImageModule({
      centered: false,
      getImage: (tagValue) => {
        // tagValue diisi via data sebagai key ke `images`
        const img = images[tagValue];
        return img ? img.buffer : Buffer.alloc(0);
      },
      getSize: (_img, tagValue) => {
        const img = images[tagValue];
        return img ? [img.width || 150, img.height || 75] : [1, 1];
      },
    }));
  }
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
    nullGetter: () => '',
    parser: literalTagParser,
    modules,
  });
  // Untuk placeholder image, value-nya harus berupa key di map images.
  const renderData = { ...(data || {}) };
  for (const key of Object.keys(images)) {
    // Jika user mengirim data[key] = "<key>", biarkan; jika belum, isi default.
    if (renderData[key] == null || renderData[key] === '') renderData[key] = key;
  }
  doc.render(renderData);
  const buf = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  // Opsi: paksa seluruh font di document.xml jadi Calibri agar hasil
  // placeholder (dan body) konsisten. Default ON untuk fitur SKC.
  const forceFont = opts.forceFont || null;
  let outBuf = buf;
  if (forceFont) {
    try {
      outBuf = applyForceFont(buf, forceFont);
    } catch (e) {
      // Fallback: tetap pakai buffer asli.
      console.warn('[docxRender] forceFont gagal, fallback ke original:', e.message);
    }
  }
  fs.writeFileSync(outDocxPath, outBuf);
  return outDocxPath;
}

/**
 * Timpa seluruh atribut font di word/document.xml dengan nama font tertentu.
 * Juga sisipkan rFonts default pada styles.xml supaya teks tanpa rPr ikut
 * font baru. Aman bila file styles.xml tidak ada (skip).
 */
function applyForceFont(docxBuffer, fontName) {
  const zip = new PizZip(docxBuffer);
  const escapedFont = String(fontName).replace(/[&<>"]/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  }[ch]));
  const fontAttrs = `w:ascii="${escapedFont}" w:hAnsi="${escapedFont}" w:eastAsia="${escapedFont}" w:cs="${escapedFont}"`;
  const rewriteFonts = (xml) => xml
    // Pertahankan bentuk tag: self-closing tetap self-closing, opening tag tetap opening.
    // Jangan jalankan regex opening ke tag self-closing karena itu membuat XML korup.
    .replace(/<w:rFonts\b[^>]*\/>/g, `<w:rFonts ${fontAttrs}/>`)
    .replace(/<w:rFonts\b(?![^>]*\/>)[^>]*>/g, `<w:rFonts ${fontAttrs}>`);

  for (const name of ['word/document.xml', 'word/styles.xml', 'word/header1.xml', 'word/header2.xml', 'word/header3.xml', 'word/footer1.xml', 'word/footer2.xml', 'word/footer3.xml']) {
    const f = zip.file(name);
    if (!f) continue;
    const xml = f.asText();
    zip.file(name, rewriteFonts(xml));
  }
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Cari soffice executable. Bisa dioverride via env SOFFICE_PATH. */
function findSoffice() {
  if (process.env.SOFFICE_PATH && fs.existsSync(process.env.SOFFICE_PATH)) {
    return process.env.SOFFICE_PATH;
  }
  const candidates = [
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    '/usr/bin/soffice',
    '/usr/local/bin/soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return 'soffice'; // fallback ke PATH
}

/**
 * Convert .docx → .pdf pakai LibreOffice headless.
 * Return path PDF hasil konversi (di folder output yang sama).
 */
function convertDocxToPdf(docxPath, outDir) {
  return new Promise((resolve, reject) => {
    const soffice = findSoffice();
    // Gunakan profile dir unik agar bisa concurrent.
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soffice-profile-'));
    const args = [
      '--headless',
      '--norestore',
      '--nolockcheck',
      '--nologo',
      '--nodefault',
      `-env:UserInstallation=file://${profileDir.replace(/\\/g, '/')}`,
      '--convert-to', 'pdf',
      '--outdir', outDir,
      docxPath,
    ];
    const proc = spawn(soffice, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += String(d); });
    proc.on('error', (err) => {
      try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
      reject(new Error('soffice_not_found: ' + err.message));
    });
    proc.on('exit', (code) => {
      try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
      if (code !== 0) {
        return reject(new Error('soffice_failed (code ' + code + '): ' + stderr.slice(0, 500)));
      }
      const base = path.basename(docxPath, path.extname(docxPath));
      const pdfPath = path.join(outDir, base + '.pdf');
      if (!fs.existsSync(pdfPath)) {
        return reject(new Error('soffice_no_output_pdf'));
      }
      resolve(pdfPath);
    });
  });
}

/** Validasi nama placeholder: alphanumeric + underscore/hyphen, untuk keamanan. */
function safeFieldName(name) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(String(name || ''));
}

function randomId(prefix = '') {
  return prefix + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
}

module.exports = {
  extractPlaceholders,
  extractPlaceholdersTyped,
  renderDocx,
  convertDocxToPdf,
  safeFieldName,
  randomId,
  findSoffice,
};