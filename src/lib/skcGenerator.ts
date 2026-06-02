/**
 * SKC Bulk Generator
 * ------------------
 * Untuk tiap karyawan yang jatuh Cr (Cuti Roster) dalam rentang [from, to],
 * hitung field-field SKC dari timesheet (cycle dimulai dari "Tanggal
 * Meninggalkan Site") dan render template .docx → PDF via server endpoint
 * /api/document-templates/render-skc. Hasil dipaket ZIP berisi 2 folder:
 *
 *   SKC_<from>_<to>.zip
 *   ├── Halaman_Depan/    (PDF SKC per karyawan)
 *   └── Halaman_Belakang/ (PDF timesheet per karyawan, sama dgn Bulk Timesheet)
 */
import type JSZipType from 'jszip';
import { addDays, format, parseISO } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import type { PDFDocument as PDFDocumentType } from 'pdf-lib';

let JSZipCtor: typeof JSZipType | undefined;
let PDFDocumentRef: typeof PDFDocumentType | undefined;
async function loadJsZip() {
  if (!JSZipCtor) {
    const m: any = await import('jszip');
    JSZipCtor = m.default ?? m;
  }
  return JSZipCtor!;
}
async function loadPdfLib() {
  if (!PDFDocumentRef) {
    const m: any = await import('pdf-lib');
    PDFDocumentRef = m.PDFDocument;
  }
  return PDFDocumentRef!;
}
import type {
  Employee, LeaveRequest, CustomSymbol, ManualOverride,
  DocumentTemplate, DocumentTemplateField, Signature,
  DocumentAutoSource,
} from '../types';
import { calculateTimesheet } from './roster';
import { renderSkcDocxTemplate } from './serverStore';

// ---------- helpers ----------

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** Format dd-MMM-yyyy, bulan singkat ID (Jan/Feb/.../Mei/.../Des). */
export function fmtSkcDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = typeof d === 'string' ? parseISO(d) : d;
  if (!dt || isNaN(dt.getTime())) return '';
  return format(dt, 'dd-MMM-yyyy', { locale: idLocale });
}

function isCr(symbol: string): boolean {
  return /^Cr\d*$/i.test(symbol || '');
}
function isX(symbol: string): boolean {
  return /^X\d*$/i.test(symbol || '');
}
function isCt(symbol: string): boolean {
  return /^Ct\d*$/i.test(symbol || '');
}
function isCe(symbol: string): boolean {
  return /^Ce\d*$/i.test(symbol || '');
}
function isXp(symbol: string): boolean {
  return /^XP\d*$/i.test(symbol || '');
}
function isCi(symbol: string): boolean {
  return /^CI\d*$/i.test(symbol || '');
}
function isCs(symbol: string): boolean {
  return /^Cs\d*$/i.test(symbol || '');
}
function isTvOut(symbol: string, color?: string): boolean {
  // TV Out = warna merah (#dc2626 / #ef4444); TV In = biru tua.
  if (String(symbol || '').toUpperCase() !== 'TV') return false;
  const c = String(color || '').toLowerCase();
  if (!c) return true; // default TV = Out
  return c !== '#1e3a8a' && c !== '#1d4ed8';
}

/**
 * Hitung jumlah XP pada cycle TEPAT 1 periode sebelum cycle yang dimulai
 * pada index `startIdx`. Cycle sebelumnya = rentang dari X1 sebelum-sebelumnya
 * (eksklusif) sampai startIdx (eksklusif). Bila tidak ditemukan X1 sebelumnya
 * yang cukup, hitung XP di rentang yang ada dari awal data.
 */
function countPrevCycleXp(
  data: { date: string; symbol: string; color?: string }[],
  startIdx: number,
): number {
  // X1 terdekat sebelum startIdx → batas akhir cycle sebelumnya (eksklusif).
  let prevX1End = -1;
  for (let i = startIdx - 1; i >= 0; i--) {
    if (/^X1$/i.test(data[i].symbol) || isX(data[i].symbol)) { prevX1End = i; break; }
  }
  if (prevX1End < 0) return 0;
  // X1 sebelumnya lagi → awal cycle sebelumnya (eksklusif). Bila tidak ada,
  // mulai dari awal data.
  let prevPrevX1 = -1;
  for (let i = prevX1End - 1; i >= 0; i--) {
    if (/^X1$/i.test(data[i].symbol) || isX(data[i].symbol)) { prevPrevX1 = i; break; }
  }
  const from = prevPrevX1 + 1;
  const to = prevX1End; // eksklusif terhadap X1 batas akhir
  let xp = 0;
  for (let i = from; i < to; i++) if (isXp(data[i].symbol)) xp++;
  return xp;
}

/**
 * Jumlah pada tabel Cuti Site = sisa Cr setelah dikurangi Cs.
 * Cr dasar 14 hari, berkurang oleh XP pada cycle cuti tepat sebelumnya.
 */
export function computeCrMinusCs(cycle: SkcCycleInfo): number {
  const baseCr = Math.max(0, 14 - (cycle.prevXpDays || 0));
  return Math.max(0, baseCr - (cycle.csDays || 0));
}

export interface SkcCycleInfo {
  /** Tanggal meninggalkan Site (yyyy-MM-dd) */
  leaveSiteDate: string;
  /** Tanggal X1 berikutnya (yyyy-MM-dd) */
  x1Date: string;
  /** Jumlah Ct dalam cycle ini (sebelum X1) */
  ctDays: number;
  /** Jumlah Ce dalam cycle ini (sebelum X1) */
  ceDays: number;
  /** Jumlah XP (Potong Penyesuaian) dalam cycle ini (sebelum X1) */
  xpDays: number;
  /** Jumlah CI (Cuti Istimewa) dalam cycle ini (sebelum X1) */
  ciDays: number;
  /** Jumlah Cs (Cuti Site) dalam cycle ini (sebelum X1) */
  csDays: number;
  /** Tanggal Cs pertama (Cs1) dalam cycle ini. '' jika tidak ada. */
  csFirstDate: string;
  /** Tanggal X1 setelah blok Cs (untuk SKC Site). Sama dgn x1Date by default. */
  csX1Date: string;
  /** Jumlah XP pada cycle TEPAT 1 periode sebelum cycle ini. Default 0. */
  prevXpDays: number;
}

/**
 * Cari informasi cycle SKC pertama yang mengandung Cr di [from, to] untuk
 * karyawan emp. Cycle dimulai pada "tanggal meninggalkan site":
 *   - POH Fluk     → tanggal Cr1 pertama dalam rentang
 *   - POH lain     → tanggal TV Out pertama dalam rentang
 * Cycle berakhir sebelum X1 berikutnya.
 * Return null jika tidak ada cycle Cr di rentang.
 */
export function detectSkcCycle(
  emp: Employee,
  fromDate: string,
  toDate: string,
  leaveRequests: LeaveRequest[],
  customSymbols: CustomSymbol[],
  overrides: ManualOverride[],
): SkcCycleInfo | null {
  // Perluas window ke depan 90 hari supaya bisa menemukan X1 setelah cycle.
  const extEnd = format(addDays(parseISO(toDate), 120), 'yyyy-MM-dd');
  const extStartBack = format(addDays(parseISO(fromDate), -120), 'yyyy-MM-dd');
  const data = calculateTimesheet(emp, extStartBack, extEnd, leaveRequests, customSymbols, overrides);

  // Cari Cr pertama di [fromDate, toDate]
  const inWindow = data.filter(d => d.date >= fromDate && d.date <= toDate);
  const firstCr = inWindow.find(d => isCr(d.symbol));
  if (!firstCr) return null;

  const poh = (emp.poh || '').toUpperCase();
  let leaveSiteDate: string;
  if (poh === 'FLUK') {
    // Cr1 pertama (atau Cr saja) di cycle ini
    // Cari Cr1 paling dekat sebelum/sama dengan firstCr
    // Telusuri mundur sampai bukan Cr.
    let idx = data.findIndex(d => d.date === firstCr.date);
    while (idx > 0 && isCr(data[idx - 1].symbol)) idx--;
    leaveSiteDate = data[idx].date;
  } else {
    // TV Out pertama sebelum/pada firstCr (dalam window data)
    const idxCr = data.findIndex(d => d.date === firstCr.date);
    let tvIdx = -1;
    for (let i = idxCr; i >= 0; i--) {
      if (isTvOut(data[i].symbol, data[i].color)) { tvIdx = i; break; }
      // Stop kalau ketemu X (cycle sebelumnya)
      if (isX(data[i].symbol)) break;
    }
    leaveSiteDate = tvIdx >= 0 ? data[tvIdx].date : firstCr.date;
  }

  // X1 berikutnya setelah leaveSiteDate
  const startIdx = data.findIndex(d => d.date === leaveSiteDate);
  let x1Date = '';
  for (let i = startIdx + 1; i < data.length; i++) {
    if (/^X1$/i.test(data[i].symbol)) { x1Date = data[i].date; break; }
  }
  // Fallback: kalau cycle pakai "X" tanpa angka, ambil X pertama
  if (!x1Date) {
    for (let i = startIdx + 1; i < data.length; i++) {
      if (isX(data[i].symbol)) { x1Date = data[i].date; break; }
    }
  }

  // Hitung Ct & Ce dalam cycle [leaveSiteDate, x1Date)
  let ctDays = 0, ceDays = 0;
  const cycleEndIdx = x1Date ? data.findIndex(d => d.date === x1Date) : data.length;
  for (let i = startIdx; i < cycleEndIdx; i++) {
    if (isCt(data[i].symbol)) ctDays++;
    if (isCe(data[i].symbol)) ceDays++;
  }

  let xpDays = 0, ciDays = 0;
  for (let i = startIdx; i < cycleEndIdx; i++) {
    if (isXp(data[i].symbol)) xpDays++;
    if (isCi(data[i].symbol)) ciDays++;
  }
  let csDays = 0;
  for (let i = startIdx; i < cycleEndIdx; i++) {
    if (isCs(data[i].symbol)) csDays++;
  }
  let csFirstDate = '';
  for (let i = startIdx; i < cycleEndIdx; i++) {
    if (isCs(data[i].symbol)) { csFirstDate = data[i].date; break; }
  }
  const prevXpDays = countPrevCycleXp(data, startIdx);
  return { leaveSiteDate, x1Date, ctDays, ceDays, xpDays, ciDays, csDays, csFirstDate, csX1Date: x1Date, prevXpDays };
}

/**
 * Filter ketat: hanya ambil cycle bila "Tanggal Meninggalkan Site"
 * (Cr1 untuk POH Fluk, atau TV Out untuk POH lain) jatuh di [fromDate, toDate].
 * Dipakai oleh Bulk SKC supaya tidak ikut karyawan yang hanya Cr2/Cr3-nya
 * kebetulan jatuh di rentang.
 */
export function detectSkcCycleByLeaveDate(
  emp: Employee,
  fromDate: string,
  toDate: string,
  leaveRequests: LeaveRequest[],
  customSymbols: CustomSymbol[],
  overrides: ManualOverride[],
  kind: 'roster' | 'site' = 'roster',
): SkcCycleInfo | null {
  const extEnd = format(addDays(parseISO(toDate), 120), 'yyyy-MM-dd');
  // Mundur cukup jauh supaya bisa menghitung XP cycle sebelumnya juga.
  const extStart = format(addDays(parseISO(fromDate), -120), 'yyyy-MM-dd');
  const data = calculateTimesheet(emp, extStart, extEnd, leaveRequests, customSymbols, overrides);
  const poh = (emp.poh || '').toUpperCase();

  // Cari leaveSiteDate pertama yang jatuh di [fromDate, toDate]
  let leaveIdx = -1;
  if (kind === 'site') {
    // SKC Site: cycle dimulai pada Cs1 (Cs pertama dalam blok Cs).
    for (let i = 0; i < data.length; i++) {
      if (!isCs(data[i].symbol)) continue;
      if (i > 0 && isCs(data[i - 1].symbol)) continue; // bukan Cs1
      if (data[i].date >= fromDate && data[i].date <= toDate) { leaveIdx = i; break; }
    }
  } else if (poh === 'FLUK') {
    // Cr1: Cr yang sebelumnya bukan Cr (awal blok Cr)
    for (let i = 0; i < data.length; i++) {
      if (!isCr(data[i].symbol)) continue;
      if (i > 0 && isCr(data[i - 1].symbol)) continue; // bukan Cr1
      if (data[i].date >= fromDate && data[i].date <= toDate) { leaveIdx = i; break; }
    }
  } else {
    for (let i = 0; i < data.length; i++) {
      if (!isTvOut(data[i].symbol, data[i].color)) continue;
      if (data[i].date >= fromDate && data[i].date <= toDate) { leaveIdx = i; break; }
    }
  }
  if (leaveIdx < 0) return null;

  const leaveSiteDate = data[leaveIdx].date;

  // X1 berikutnya
  let x1Date = '';
  for (let i = leaveIdx + 1; i < data.length; i++) {
    if (/^X1$/i.test(data[i].symbol)) { x1Date = data[i].date; break; }
  }
  if (!x1Date) {
    for (let i = leaveIdx + 1; i < data.length; i++) {
      if (isX(data[i].symbol)) { x1Date = data[i].date; break; }
    }
  }

  let ctDays = 0, ceDays = 0;
  const cycleEndIdx = x1Date ? data.findIndex(d => d.date === x1Date) : data.length;
  for (let i = leaveIdx; i < cycleEndIdx; i++) {
    if (isCt(data[i].symbol)) ctDays++;
    if (isCe(data[i].symbol)) ceDays++;
  }
  let xpDays = 0, ciDays = 0;
  for (let i = leaveIdx; i < cycleEndIdx; i++) {
    if (isXp(data[i].symbol)) xpDays++;
    if (isCi(data[i].symbol)) ciDays++;
  }
  let csDays = 0;
  for (let i = leaveIdx; i < cycleEndIdx; i++) {
    if (isCs(data[i].symbol)) csDays++;
  }
  let csFirstDate = '';
  for (let i = leaveIdx; i < cycleEndIdx; i++) {
    if (isCs(data[i].symbol)) { csFirstDate = data[i].date; break; }
  }
  const prevXpDays = countPrevCycleXp(data, leaveIdx);
  return { leaveSiteDate, x1Date, ctDays, ceDays, xpDays, ciDays, csDays, csFirstDate, csX1Date: x1Date, prevXpDays };
}

export interface SkcRenderOptions {
  /** "Tanggal Berangkat dari Ternate": kosong vs isi (H-2 dari X1). */
  berangkatTernateMode: 'kosong' | 'isi';
  /** TTD: signature.url, signature.name */
  signature: Signature | null;
  /** Index dokumen di batch (0-based). Dipakai untuk field tipe 'start_number'. */
  docIndex?: number;
  /** Nilai awal per field 'start_number' (key = template field key). */
  startNumberBase?: Record<string, number>;
  /** Anchor tanggal payroll untuk karyawan Lokal (1-31). */
  payrollAnchorLokal?: number;
  /** Anchor tanggal payroll untuk karyawan Non Lokal (1-31). */
  payrollAnchorNonLokal?: number;
}

/** Resolve nilai field auto SKC dari cycle info + opsi. */
export function resolveSkcAuto(
  source: DocumentAutoSource,
  emp: Employee,
  cycle: SkcCycleInfo,
  opts: SkcRenderOptions,
): string {
  switch (source) {
    case 'skc_tanggal_meninggalkan_site':
      return fmtSkcDate(cycle.leaveSiteDate);
    case 'skc_tanggal_berangkat_ternate':
      if (opts.berangkatTernateMode === 'kosong') return '';
      if (!cycle.x1Date) return '';
      return fmtSkcDate(addDays(parseISO(cycle.x1Date), -2));
    case 'skc_tanggal_onsite':
      if (!cycle.x1Date) return '';
      return fmtSkcDate(addDays(parseISO(cycle.x1Date), -1));
    case 'skc_tanggal_x1':
      return fmtSkcDate(cycle.x1Date);
    case 'skc_bulan_romawi': {
      if (!cycle.leaveSiteDate) return '';
      const m = parseISO(cycle.leaveSiteDate).getMonth() + 1;
      return ROMAN[m] || '';
    }
    case 'skc_tahun': {
      if (!cycle.leaveSiteDate) return '';
      return String(parseISO(cycle.leaveSiteDate).getFullYear());
    }
    case 'skc_cuti_tahunan':
      return cycle.ctDays > 0 ? `Tambah Tahunan ${cycle.ctDays} Hari` : '';
    case 'skc_cuti_extra':
      return cycle.ceDays > 0 ? `Tambah Extra ${cycle.ceDays} Hari` : '';
    case 'skc_cuti_summary':
      return buildCutiSummary(cycle);
    case 'skc_jumlah_cuti_site':
      return cycle.csDays > 0 ? `${cycle.csDays} Hari` : '';
    case 'skc_x1_cuti_site':
      return fmtSkcDate(cycle.csX1Date || cycle.x1Date);
    case 'skc_cr_minus_cs':
      return String(computeCrMinusCs(cycle));
    case 'skc_tanggal_cuti_site':
      return fmtSkcDate(cycle.csFirstDate || cycle.leaveSiteDate);
    case 'skc_tanda_tangan':
      // Kosongkan placeholder teks supaya server-side image module fallback ke
      // key dan menyisipkan PNG TTD (lihat docxRender.renderDocx). Nama TTD
      // tetap bisa ditulis manual di template di bawah gambar bila perlu.
      return '';
    default:
      return '';
  }
}

/**
 * Gabungkan 4 jenis cuti/penyesuaian dalam cycle ini menjadi satu string,
 * dipisah " & ". Urutan: Tahunan → Extra → Istimewa → Potong Penyesuaian.
 * Jika hanya satu yang ada, format penuh dipakai apa adanya.
 */
export function buildCutiSummary(cycle: SkcCycleInfo): string {
  const parts: string[] = [];
  if (cycle.ctDays > 0) parts.push(`Tambah Tahunan ${cycle.ctDays} Hari`);
  if (cycle.ceDays > 0) {
    parts.push(parts.length === 0 ? `Tambah Extra ${cycle.ceDays} Hari` : `Extra ${cycle.ceDays} Hari`);
  }
  if (cycle.ciDays > 0) {
    parts.push(parts.length === 0 ? `Tambah Istimewa ${cycle.ciDays} Hari` : `Istimewa ${cycle.ciDays} Hari`);
  }
  // Potong Penyesuaian membaca XP pada cycle TEPAT 1 periode sebelum cycle ini
  // (bukan XP di cycle berjalan), sesuai aturan penyesuaian roster.
  if (cycle.prevXpDays > 0) {
    parts.push(parts.length === 0
      ? `Potong Penyesuaian ${cycle.prevXpDays} Hari`
      : `Potong Penyesuaian ${cycle.prevXpDays} Hari`);
  }
  return parts.join(' & ');
}

/** Bangun values map dari template SKC + cycle + opsi. */
export function buildSkcValues(
  tpl: DocumentTemplate,
  emp: Employee,
  cycle: SkcCycleInfo,
  opts: SkcRenderOptions,
): { values: Record<string, string>; signatureFields: string[] } {
  const values: Record<string, string> = {};
  const signatureFields: string[] = [];
  for (const f of tpl.fields) {
    if (f.type === 'auto' && f.autoSource) {
      if (f.autoSource === 'skc_tanda_tangan') signatureFields.push(f.key);
      // employee_* fallback masih bekerja
      if (f.autoSource.startsWith('skc_')) {
        values[f.key] = resolveSkcAuto(f.autoSource, emp, cycle, opts);
      } else {
        values[f.key] = resolveBasicAuto(f.autoSource, emp);
      }
    } else if (f.type === 'start_number') {
      const base = Number(
        opts.startNumberBase?.[f.key] ??
          (f.defaultValue ? parseInt(f.defaultValue, 10) : NaN),
      );
      const idx = opts.docIndex ?? 0;
      values[f.key] = Number.isFinite(base) ? String(base + idx) : '';
    } else if (f.defaultValue) {
      values[f.key] = f.defaultValue;
    } else {
      values[f.key] = '';
    }
  }
  // Alias eksplisit untuk template lama/field ber-hyphen: {{Cr-Cs}} harus
  // selalu berarti sisa Cr setelah dikurangi XP periode sebelumnya dan Cs.
  const crMinusCs = String(computeCrMinusCs(cycle));
  values['Cr-Cs'] = values['Cr-Cs'] || crMinusCs;
  values['Cr_Cs'] = values['Cr_Cs'] || crMinusCs;
  // Alias placeholder umum untuk template SKC Site.
  // ATURAN: Jumlah = Cr-Cs. Dibayarkan = Jumlah (selalu mengikuti Jumlah,
  // bukan sebaliknya). Jumlah_Cs/Cs tetap menunjuk ke jumlah Cs asli.
  const csDays = String(cycle.csDays || 0);
  const csDateStr = fmtSkcDate(cycle.csFirstDate || cycle.leaveSiteDate);
  if (!values['Jumlah']) values['Jumlah'] = crMinusCs;
  if (!values['jumlah']) values['jumlah'] = values['Jumlah'];
  if (!values['Jumlah_Cs']) values['Jumlah_Cs'] = csDays;
  if (!values['Jumlah_Cuti_Site']) values['Jumlah_Cuti_Site'] = csDays;
  if (!values['Cs']) values['Cs'] = csDays;
  // Dibayarkan selalu = Jumlah (apapun nilainya, termasuk defaultValue template)
  values['Dibayarkan'] = values['Jumlah'];
  values['dibayarkan'] = values['Jumlah'];
  if (!values['Tanggal_Cuti_Site']) values['Tanggal_Cuti_Site'] = csDateStr;
  if (!values['tanggal_cuti_site']) values['tanggal_cuti_site'] = csDateStr;
  if (!values['Tgl_Cuti_Site']) values['Tgl_Cuti_Site'] = csDateStr;
  // anchor_bln: bulan acuan payroll berdasar Lokasi Penggajian + anchor day.
  // Jika tanggal leaveSiteDate > anchor → bulan berikutnya, selain itu bulan ini.
  try {
    if (cycle.leaveSiteDate) {
      const isLokal = String(emp.payrollLocation || '').toLowerCase().includes('lokal') &&
        !String(emp.payrollLocation || '').toLowerCase().includes('non');
      const anchor = (isLokal ? opts.payrollAnchorLokal : opts.payrollAnchorNonLokal) ?? 15;
      const d = parseISO(cycle.leaveSiteDate);
      const dayOfMonth = d.getDate();
      const base = dayOfMonth > anchor ? addDays(new Date(d.getFullYear(), d.getMonth() + 1, 1), 0) : d;
      values['anchor_bln'] = format(base, 'MMMM', { locale: idLocale });
    } else {
      values['anchor_bln'] = values['anchor_bln'] || '';
    }
  } catch { /* ignore */ }
  return { values, signatureFields };
}

function resolveBasicAuto(src: DocumentAutoSource, emp: Employee): string {
  switch (src) {
    case 'employee_name': return emp.name || '';
    case 'employee_nik': return emp.nik || '';
    case 'employee_department': return emp.department || '';
    case 'employee_position': return emp.position || '';
    case 'employee_grade': return emp.grade || '';
    case 'employee_poh': return emp.poh || '';
    case 'employee_email': return emp.email || '';
    case 'employee_phone': return emp.phone || '';
    case 'today_date': return format(new Date(), 'yyyy-MM-dd');
    case 'today_long': return format(new Date(), 'dd MMMM yyyy', { locale: idLocale });
    default: return '';
  }
}

/** Sanitasi nama file. */
function sanitizeFilename(s: string): string {
  return (s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

async function fetchArrayBufferWithTimeout(url: string, timeoutMs = 120_000, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    return await fetch(url, { credentials: 'include', signal: controller.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      if (!timedOut) throw new Error('Proses dihentikan oleh pengguna.');
      throw new Error(`Download PDF terlalu lama (> ${Math.round(timeoutMs / 1000)} detik).`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export interface SkcBulkInput {
  /** 'both' = SKC + Timesheet, 'skc' = SKC saja, 'timesheet' = Timesheet saja. */
  mode: 'both' | 'skc' | 'timesheet';
  template: DocumentTemplate | null;
  signature: Signature | null;
  berangkatTernateMode: 'kosong' | 'isi';
  /** Nilai awal per field 'start_number' (key = template field key). */
  startNumberBase?: Record<string, number>;
  fromDate: string; // yyyy-MM-dd
  toDate: string;
  employees: Employee[];          // sudah difilter (yang jatuh Cr di range)
  leaveRequests: LeaveRequest[];
  customSymbols: CustomSymbol[];
  overrides: ManualOverride[];
  /** Abort in-flight request (render/download) saat tombol hentikan ditekan. */
  abortSignal?: AbortSignal;
  /** Polling cancel: jika true → loop berhenti, hasil parsial dikembalikan. */
  shouldCancel?: () => boolean;
  /** Format halaman depan: 'pdf' (default, butuh LibreOffice) atau 'docx' (cepat). */
  outputFormat?: 'pdf' | 'docx';
  /** Konkurensi worker (default 4, 1–6). */
  concurrency?: number;
  /** Gabungkan hasil jadi satu file per kategori (default 'gabung'). */
  mergeMode?: 'gabung' | 'pisah';
  /** Anchor tanggal payroll (1-31), dipakai untuk {{anchor_bln}} di SKC Site. */
  payrollAnchorLokal?: number;
  payrollAnchorNonLokal?: number;
  /** Jenis SKC: 'roster' (default, cycle Cr) atau 'site' (cycle Cs). */
  skcKind?: 'roster' | 'site';
}

export interface SkcBulkResult {
  zipBlob: Blob;
  filename: string;
  successCount: number;
  failed: Array<{ employee: Employee; error: string }>;
}

/**
 * Generate ZIP SKC. `backPagePdf` callback adalah generator PDF timesheet
 * (Halaman Belakang) — disuntik dari caller agar tidak ada circular import
 * dengan timesheetExport. Signature: (emp) → Promise<ArrayBuffer>.
 */
export async function generateSkcZip(
  input: SkcBulkInput,
  backPagePdf: (emp: Employee) => Promise<ArrayBuffer>,
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<SkcBulkResult> {
  const {
    mode, template, signature, berangkatTernateMode, startNumberBase, fromDate, toDate,
    employees, leaveRequests, customSymbols, overrides, abortSignal, shouldCancel,
    outputFormat = 'docx', concurrency = 4, mergeMode = 'gabung',
    payrollAnchorLokal, payrollAnchorNonLokal,
    skcKind = 'roster',
  } = input;

  const JSZipM = await loadJsZip();
  const zip = new JSZipM();
  const needFront = mode !== 'timesheet';
  const needBack = mode !== 'skc';
  const effectiveMergeMode = mergeMode;
  // Khusus SKC Site + DOCX: paksa file SKC tetap dipisah per karyawan
  // (mekanisme merge DOCX kurang stabil untuk template SKC Site dengan
  // gambar TTD). Timesheet PDF tetap mengikuti mergeMode.
  const siteForceFrontSplit = skcKind === 'site' && outputFormat === 'docx';
  // Folder Halaman_Depan/Halaman_Belakang hanya dipakai saat mode 'pisah'.
  // Saat 'gabung' (termasuk SKC Site yang front-nya di-split), file langsung
  // di root ZIP (dibedakan oleh prefix "SKC " / "TS " atau nama merged).
  const useFolders = mode === 'both' && effectiveMergeMode === 'pisah';
  const frontDir = useFolders ? zip.folder('Halaman_Depan')! : zip;
  const backDir = useFolders ? zip.folder('Halaman_Belakang')! : zip;
  if (needFront && !template) throw new Error('Template SKC wajib dipilih untuk mode ini.');
  const usedCount = new Map<string, number>();
  const frontExt = outputFormat === 'docx' ? 'docx' : 'pdf';

  // Saat mergeMode = 'gabung', kita kumpulkan buffer dulu, baru gabungkan
  // di akhir. Indeks per slot supaya urutan deterministik mengikuti `slots`.
  const frontBuffers: Array<ArrayBuffer | null> = [];
  const backBuffers: Array<ArrayBuffer | null> = [];

  const failed: Array<{ employee: Employee; error: string }> = [];
  let success = 0;
  let done = 0;
  const pool = Math.max(1, Math.min(6, concurrency | 0 || 4));

  // Reserve unique filenames + docIndex up-front (deterministic ordering)
  const slots = employees.map((emp, i) => {
    const baseName = sanitizeFilename(`${emp.nik || ''} ${emp.name || ''}`) || `DOC_${i + 1}`;
    const seen = usedCount.get(baseName) || 0;
    usedCount.set(baseName, seen + 1);
    const suffix = seen === 0 ? '' : ` (${seen + 1})`;
    return {
      emp, i, docIndex: i,
      nameFront: `${baseName}${suffix}.${frontExt}`,
      nameBack: `${baseName}${suffix}.pdf`,
    };
  });

  const processOne = async (slot: typeof slots[number]) => {
    if (shouldCancel?.()) return;
    const { emp, i, nameFront, nameBack, docIndex } = slot;
    const label = emp.name || emp.nik || `Karyawan ${i + 1}`;
    const mark = (stage: string) => onProgress?.(done, employees.length, `${stage}: ${label}`);
    mark('Mulai');
    const cycle = detectSkcCycleByLeaveDate(emp, fromDate, toDate, leaveRequests, customSymbols, overrides, skcKind);
    if (!cycle) {
      failed.push({ employee: emp, error: 'Tidak ditemukan cycle Cr di rentang.' });
      done++; onProgress?.(done, employees.length, label);
      return;
    }
    try {
      if (needFront && template) {
        if (shouldCancel?.()) return;
        mark('Render SKC');
        const { values, signatureFields } = buildSkcValues(template, emp, cycle, {
          berangkatTernateMode, signature, docIndex, startNumberBase,
          payrollAnchorLokal, payrollAnchorNonLokal,
        });
        const images: Record<string, string> = {};
        if (signature?.url) for (const k of signatureFields) images[k] = signature.url;
        const front = await renderSkcDocxTemplate(template.docxUrl, values, images, {
          signal: abortSignal, format: outputFormat,
        });
        if (shouldCancel?.() || front.error === 'cancelled') return;
        const fileUrl = outputFormat === 'docx' ? front.docxUrl : front.pdfUrl;
        if (front.error || !fileUrl) {
          failed.push({ employee: emp, error: front.message || front.error || 'render gagal' });
          done++; onProgress?.(done, employees.length, label);
          return;
        }
        if (shouldCancel?.()) return;
        mark('Download SKC');
        const frontResp = await fetchArrayBufferWithTimeout(fileUrl, 120_000, abortSignal);
        if (!frontResp.ok) {
          failed.push({ employee: emp, error: `PDF front HTTP ${frontResp.status}` });
          done++; onProgress?.(done, employees.length, label);
          return;
        }
        const frontBuf = await frontResp.arrayBuffer();
        if (effectiveMergeMode === 'gabung' && !siteForceFrontSplit) {
          frontBuffers[i] = frontBuf;
        } else {
          const targetName = useFolders ? nameFront : `SKC ${nameFront}`;
          frontDir.file(targetName, frontBuf);
        }
      }

      if (needBack) {
        try {
          if (shouldCancel?.()) return;
          mark('Buat timesheet');
          const backBuf = await backPagePdf(emp);
          if (effectiveMergeMode === 'gabung') {
            backBuffers[i] = backBuf;
          } else {
            const targetName = useFolders ? nameBack : `TS ${nameBack}`;
            backDir.file(targetName, backBuf);
          }
        } catch (e) {
          failed.push({ employee: emp, error: 'Timesheet PDF: ' + (e instanceof Error ? e.message : String(e)) });
          done++; onProgress?.(done, employees.length, label);
          return;
        }
      }
      success++;
    } catch (e) {
      failed.push({ employee: emp, error: e instanceof Error ? e.message : String(e) });
    }
    done++; onProgress?.(done, employees.length, label);
  };

  // Worker pool
  let cursor = 0;
  const worker = async () => {
    while (true) {
      if (shouldCancel?.()) return;
      const idx = cursor++;
      if (idx >= slots.length) return;
      await processOne(slots[idx]);
    }
  };
  const workers = Array.from({ length: Math.min(pool, slots.length) }, () => worker());
  await Promise.all(workers);

  // ---------- Merge (mode 'gabung') ----------
  if (effectiveMergeMode === 'gabung') {
    onProgress?.(employees.length, employees.length, 'Menggabungkan hasil…');
    const dateTag = `${fromDate}_${toDate}`;
    if (needFront && !siteForceFrontSplit) {
      const bufs = frontBuffers.filter((b): b is ArrayBuffer => !!b);
      if (bufs.length > 0) {
        try {
          if (outputFormat === 'docx') {
            const merged = await mergeDocxBuffers(bufs);
            zip.file(`SKC_${dateTag}.docx`, merged);
          } else {
            const merged = await mergePdfBuffers(bufs);
            zip.file(`SKC_${dateTag}.pdf`, merged);
          }
        } catch (e) {
          failed.push({
            employee: { id: '', nik: '', name: 'MERGE SKC' } as Employee,
            error: 'Gagal menggabungkan SKC: ' + (e instanceof Error ? e.message : String(e)),
          });
        }
      }
    }
    if (needBack) {
      const bufs = backBuffers.filter((b): b is ArrayBuffer => !!b);
      if (bufs.length > 0) {
        try {
          const merged = await mergePdfBuffers(bufs);
          zip.file(`Timesheet_${dateTag}.pdf`, merged);
        } catch (e) {
          failed.push({
            employee: { id: '', nik: '', name: 'MERGE TS' } as Employee,
            error: 'Gagal menggabungkan Timesheet: ' + (e instanceof Error ? e.message : String(e)),
          });
        }
      }
    }
  }

  onProgress?.(employees.length, employees.length, 'Mengemas ZIP…');
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const prefix = mode === 'skc' ? 'SKC' : mode === 'timesheet' ? 'Timesheets' : 'SKC_TS';
  const suffix = outputFormat === 'docx' && mode !== 'timesheet' ? '_DOCX' : '';
  const mergeTag = effectiveMergeMode === 'gabung' ? '_GABUNG' : '';
  const filename = `${prefix}${suffix}${mergeTag}_${fromDate}_${toDate}.zip`;
  return { zipBlob, filename, successCount: success, failed };
}

// ---------- Merge helpers ----------

async function mergePdfBuffers(buffers: ArrayBuffer[]): Promise<Uint8Array> {
  const PDFDocument = await loadPdfLib();
  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p: any) => out.addPage(p));
  }
  return await out.save();
}

/**
 * Merge beberapa .docx menjadi satu file tunggal dengan cara meng-append
 * body content tiap dokumen ke dokumen pertama, sambil meremap relationship
 * (terutama gambar TTD) dan menyalin media ke paket gabungan dengan rId baru.
 * Semua dokumen dianggap berasal dari template yang sama (styles/fonts/
 * numbering identik) — sehingga hanya body + media + relationship yang perlu
 * digabung. Pendekatan ini lebih reliable daripada altChunk (yang sering
 * ditolak Word saat sub-dokumen memuat gambar).
 */
async function mergeDocxBuffers(buffers: ArrayBuffer[]): Promise<Uint8Array> {
  if (buffers.length === 0) throw new Error('No buffers to merge');
  if (buffers.length === 1) return new Uint8Array(buffers[0]);

  const JSZipM = await loadJsZip();
  const baseZip = await JSZipM.loadAsync(buffers[0]);
  const docFile = baseZip.file('word/document.xml');
  if (!docFile) throw new Error('word/document.xml tidak ditemukan');
  const relsPath = 'word/_rels/document.xml.rels';
  const relsFile = baseZip.file(relsPath);
  if (!relsFile) throw new Error(`${relsPath} tidak ditemukan`);
  const ctPath = '[Content_Types].xml';
  const ctFile = baseZip.file(ctPath);
  if (!ctFile) throw new Error(`${ctPath} tidak ditemukan`);

  let baseDocXml = await docFile.async('string');
  let baseRelsXml = await relsFile.async('string');
  let baseCtXml = await ctFile.async('string');

  // --- helpers
  const splitBody = (xml: string): { head: string; body: string; tail: string } => {
    const m = xml.match(/^([\s\S]*?<w:body[^>]*>)([\s\S]*?)(<\/w:body>[\s\S]*)$/);
    if (!m) throw new Error('Struktur document.xml tidak dikenali (tidak ada w:body)');
    return { head: m[1], body: m[2], tail: m[3] };
  };

  // Pisahkan body base: ambil isi sebelum sectPr terakhir (sectPr disimpan untuk akhir)
  const baseParts = splitBody(baseDocXml);
  const sectPrRe = /<w:sectPr\b[\s\S]*?<\/w:sectPr>\s*$/;
  let baseBodyContent = baseParts.body;
  let finalSectPr = '';
  const sectMatch = baseBodyContent.match(sectPrRe);
  if (sectMatch) {
    finalSectPr = sectMatch[0];
    baseBodyContent = baseBodyContent.slice(0, sectMatch.index!);
  }

  // Cari nomor rId terbesar dari relationships base
  const findMaxRid = (xml: string): number => {
    let max = 0;
    const re = /Id="rId(\d+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
    return max;
  };
  let nextRid = findMaxRid(baseRelsXml) + 1;
  let nextMediaIdx = 1000;

  // Kumpulkan extension media yg sudah ada di Content Types
  const knownExts = new Set<string>();
  const ctExtRe = /<Default\s+Extension="([^"]+)"/g;
  let cm: RegExpExecArray | null;
  while ((cm = ctExtRe.exec(baseCtXml)) !== null) knownExts.add(cm[1].toLowerCase());

  const ctMime: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml',
    emf: 'image/x-emf', wmf: 'image/x-wmf', tif: 'image/tiff', tiff: 'image/tiff',
  };

  // Parse satu Relationship element ringan
  const parseRel = (relXml: string): { id: string; type: string; target: string; mode?: string } | null => {
    const idM = relXml.match(/Id="([^"]+)"/);
    const tyM = relXml.match(/Type="([^"]+)"/);
    const tgM = relXml.match(/Target="([^"]+)"/);
    if (!idM || !tyM || !tgM) return null;
    const modeM = relXml.match(/TargetMode="([^"]+)"/);
    return { id: idM[1], type: tyM[1], target: tgM[1], mode: modeM?.[1] };
  };

  // Body parts yang akan di-append
  let appendedBody = '';
  const newRelEls: string[] = [];

  for (let i = 1; i < buffers.length; i++) {
    const subZip = await JSZipM.loadAsync(buffers[i]);
    const sDocF = subZip.file('word/document.xml');
    const sRelsF = subZip.file('word/_rels/document.xml.rels');
    if (!sDocF) continue;
    let sDocXml = await sDocF.async('string');
    const sRelsXml = sRelsF ? await sRelsF.async('string') : '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

    // Map oldRid -> newRid
    const ridMap: Record<string, string> = {};
    const relRe = /<Relationship\s[^>]*\/?>/g;
    let rm: RegExpExecArray | null;
    while ((rm = relRe.exec(sRelsXml)) !== null) {
      const rel = parseRel(rm[0]);
      if (!rel) continue;
      const newId = `rId${nextRid++}`;
      ridMap[rel.id] = newId;

      const isImage = rel.type.endsWith('/image');
      if (isImage) {
        // Resolve target relatif terhadap word/
        const targetPath = rel.target.startsWith('/')
          ? rel.target.slice(1)
          : `word/${rel.target.replace(/^\.\//, '')}`;
        const mediaFile = subZip.file(targetPath);
        if (!mediaFile) continue;
        const data = await mediaFile.async('uint8array');
        const extM = targetPath.match(/\.([a-zA-Z0-9]+)$/);
        const ext = (extM ? extM[1] : 'png').toLowerCase();
        const newName = `media/skcMerge_${nextMediaIdx++}.${ext}`;
        baseZip.file(`word/${newName}`, data);
        newRelEls.push(
          `<Relationship Id="${newId}" Type="${rel.type}" Target="${newName}"/>`
        );
        if (!knownExts.has(ext) && ctMime[ext]) {
          baseCtXml = baseCtXml.replace(
            /<\/Types>/,
            `<Default Extension="${ext}" ContentType="${ctMime[ext]}"/></Types>`
          );
          knownExts.add(ext);
        }
      } else if (rel.mode === 'External') {
        newRelEls.push(
          `<Relationship Id="${newId}" Type="${rel.type}" Target="${rel.target}" TargetMode="External"/>`
        );
      } else {
        // Relationship internal non-image (header/footer/styles/dll) — skip;
        // dokumen base sudah punya versi-nya sendiri yang identik.
        // Hapus dari map supaya referensi di body kalau ada tidak salah arah.
        delete ridMap[rel.id];
      }
    }

    // Ekstrak body sub-doc, buang sectPr
    const subParts = splitBody(sDocXml);
    let subBody = subParts.body.replace(sectPrRe, '');

    // Remap rId references di body (r:embed, r:link, r:id pada drawings/hyperlinks)
    subBody = subBody.replace(/(r:(?:embed|link|id)=")([^"]+)(")/g, (full, p1, oldId, p3) => {
      const newId = ridMap[oldId];
      return newId ? `${p1}${newId}${p3}` : full;
    });

    // Page break sebelum sub-doc → 1 halaman per form
    appendedBody +=
      `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` + subBody;
  }

  // Susun ulang relationships
  if (newRelEls.length > 0) {
    baseRelsXml = baseRelsXml.replace(
      /<\/Relationships>/,
      newRelEls.join('') + '</Relationships>'
    );
    baseZip.file(relsPath, baseRelsXml);
    baseZip.file(ctPath, baseCtXml);
  }

  // Susun ulang document.xml
  const newBody = baseBodyContent + appendedBody + finalSectPr;
  const newDocXml = baseParts.head + newBody + baseParts.tail;
  baseZip.file('word/document.xml', newDocXml);

  return await baseZip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
