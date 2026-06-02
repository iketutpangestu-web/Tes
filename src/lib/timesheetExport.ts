// Heavy libraries are loaded lazily — they only run when the user actually
// triggers an export. This keeps them out of the initial bundle.
import type * as XLSXType from 'xlsx';
import type ExcelJSNs from 'exceljs';
import type jsPDFType from 'jspdf';
import type autoTableType from 'jspdf-autotable';
import type JSZipType from 'jszip';

type WorkbookT = ExcelJSNs.Workbook;
type WorksheetT = ExcelJSNs.Worksheet;

let XLSX: typeof XLSXType | undefined;
let ExcelJSMod: { Workbook: new () => WorkbookT } | undefined;
let jsPDFCtor: typeof jsPDFType | undefined;
let autoTableFn: typeof autoTableType | undefined;
let JSZipCtor: typeof JSZipType | undefined;

async function loadXlsx() {
  if (!XLSX) XLSX = await import('xlsx');
  return XLSX!;
}
async function loadExcelJS() {
  if (!ExcelJSMod) {
    const m: any = await import('exceljs');
    ExcelJSMod = m.default ?? m;
  }
  return ExcelJSMod!;
}
async function loadJsPdf() {
  if (!jsPDFCtor || !autoTableFn) {
    const pdfMod: any = await import('jspdf');
    jsPDFCtor = pdfMod.default ?? pdfMod.jsPDF;
    const atMod: any = await import('jspdf-autotable');
    autoTableFn = atMod.default ?? atMod;
  }
  return { jsPDF: jsPDFCtor!, autoTable: autoTableFn! };
}
async function loadJsZip() {
  if (!JSZipCtor) {
    const m: any = await import('jszip');
    JSZipCtor = m.default ?? m;
  }
  return JSZipCtor!;
}
import {
  format, eachDayOfInterval,
  startOfMonth, endOfMonth, addMonths, subMonths, addDays, parseISO,
} from 'date-fns';
import { Employee, ManualOverride, LeaveRequest, CustomSymbol } from '../types';
import { calculateTimesheet, resolveCustomSymbolForCell, safeParse } from './roster';
import { LEGEND } from './builtinSymbols';
import { id as idLocale } from 'date-fns/locale';

/** Data Site Block (untuk SKC Site PDF Halaman Belakang). */
export interface SiteBlockData {
  /** Label periode (mis. "Mei 2026") — biasanya {{anchor_bln}} + tahun. */
  periodLabel: string;
  /** Nilai yang ditampilkan pada kolom Jumlah. */
  jumlah: number;
  /** "Disimpan" — biasanya kosong; isi jika user override. */
  disimpan?: number | string;
  /** "Dibayarkan" — biasanya = jumlah. */
  dibayarkan?: number | string;
  /** Teks Keterangan (mis. "Dibayarkan Penggajian Mei 2026"). */
  keterangan: string;
  /** Nama karyawan ybs (auto dari employee). */
  employeeName: string;
  /** 3 nama penandatangan opsional, urut: Diverifikasi, Diketahui, Disetujui. */
  diverifikasiName?: string;
  diverifikasiTitle?: string;
  diketahuiName?: string;
  diketahuiTitle?: string;
  disetujuiName?: string;
  disetujuiTitle?: string;
}

// Symbol columns for raw template. Some are bucketed by color (handled inline).
export const SYMBOL_COLUMNS: Array<{ key: string; match: (s: string) => boolean }> = [
  { key: 'XP',   match: s => s === 'XP' },
  { key: 'Cr',   match: s => /^Cr\d*$/i.test(s) },
  { key: 'Cs',   match: s => /^Cs\d*$/i.test(s) },
  { key: 'Ct',   match: s => /^Ct\d*$/i.test(s) },
  { key: 'TS',   match: s => s === 'TS' },
  { key: 'UIs',  match: s => /^UIs\d*$/i.test(s) },
  { key: 'II',   match: s => s === 'II' },
  { key: 'KL',   match: s => s === 'KL' },
  { key: 'TV Out', match: () => false }, // bucketed via color
  { key: 'CI',   match: s => /^CI\d*$/i.test(s) },
  { key: 'IS',   match: s => /^IS\d*$/i.test(s) },
  { key: 'Ce',   match: () => false },   // green Ce — bucketed via color
  { key: 'Ce1o', match: () => false },   // orange Ce1 (Extra Cuti) — bucketed via color
  { key: 'Xk',   match: () => false },   // X regular (transparent/white) — bucketed via color
  { key: 'X',    match: () => false },   // X extra (#000000) — bucketed via color
  { key: 'Cx',   match: s => s === 'Cx' },
  { key: 'UI',   match: s => /^UI\d*$/i.test(s) && !/^UIs/i.test(s) },
  { key: 'KS',   match: s => s === 'KS' },
  { key: 'SS',   match: s => s === 'SS' },
  { key: 'XS',   match: s => s === 'XS' },
  { key: 'A',    match: s => /^A\d*$/i.test(s) },
  { key: 'DD',   match: s => /^DD\d*$/i.test(s) },
  { key: 'DI',   match: s => /^DI\d*$/i.test(s) },
  { key: 'BP',   match: s => s === 'BP' },
  { key: 'IK',   match: s => /^IK\d*$/i.test(s) },
  { key: 'TT',   match: s => s === 'TT' },
  { key: 'TV In',  match: () => false },
  { key: 'SI',   match: s => s === 'SI' },
];

interface ExportCtx {
  employees: Employee[];
  overrides: ManualOverride[];
  leaveRequests: LeaveRequest[];
  customSymbols: CustomSymbol[];
  selectedEmployee: Employee;
  year: number;
  monthsBack?: number;
  monthsAhead?: number;
}

// Pilih warna teks readable untuk warna latar arbitrer (custom symbol)
function pickFg(bgHex: string): string {
  const h = bgHex.replace('#', '');
  if (h.length < 6) return '#000000';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // perceived luminance
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#000000' : '#ffffff';
}

// Bangun legenda dari customSymbols (yang sudah berisi built-in + custom).
// Fallback ke LEGEND default jika customSymbols kosong (mis. SSR / belum hydrate).
function legendWithCustom(customSymbols: CustomSymbol[]): Array<{ code: string; bg: string; fg: string; label: string }> {
  if (!customSymbols || customSymbols.length === 0) {
    return LEGEND.slice();
  }
  return customSymbols.map(s => {
    const bg = s.color || '#3b82f6';
    const fg = s.textColor || pickFg(bg);
    return {
      code: s.code,
      bg,
      fg,
      label: s.builtin ? s.label : `${s.label}${s.rules ? ` [${s.rules}]` : ''}`,
    };
  });
}

function normalizeHex(value?: string): string | null {
  const raw = String(value || '').trim();
  if (!raw || raw.toLowerCase() === 'transparent') return null;
  const hex = raw.replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(hex)) return hex.split('').map(ch => ch + ch).join('').toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(hex)) return hex.toUpperCase();
  return null;
}

function hexToRgb(value?: string): [number, number, number] | null {
  const hex = normalizeHex(value);
  if (!hex) return null;
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

// Default range (selected employee themed export): N months back, M months forward (clamped to join date)
function computeRange(
  emp: Employee,
  opts?: { monthsBack?: number; monthsAhead?: number },
  today = new Date(),
) {
  const back = Number.isFinite(opts?.monthsBack as number) ? Math.max(0, Math.round(opts!.monthsBack as number)) : 11;
  const ahead = Number.isFinite(opts?.monthsAhead as number) ? Math.max(0, Math.round(opts!.monthsAhead as number)) : 1;
  let start = startOfMonth(subMonths(today, back));
  const end = endOfMonth(addMonths(today, ahead));
  if (emp.joinDate) {
    try {
      const join = startOfMonth(safeParse(emp.joinDate));
      if (join > start) start = join;
    } catch { /* ignore */ }
  }
  return { start, end };
}

// Full range (themed-all & raw): from join date → 3 months after current month
function computeRangeFull(emp: Employee, today = new Date()) {
  const end = endOfMonth(addMonths(today, 3));
  let start: Date;
  if (emp.joinDate) {
    try { start = startOfMonth(safeParse(emp.joinDate)); }
    catch { start = startOfMonth(subMonths(today, 24)); }
  } else {
    start = startOfMonth(subMonths(today, 24));
  }
  if (start > end) start = startOfMonth(subMonths(end, 1));
  return { start, end };
}

interface SectionRow {
  month: string;
  cells: ({ date: string; symbol: string; color: string; textColor?: string } | null)[];
}
interface YearSection {
  year: number;
  rows: SectionRow[];
}

function buildSectionsFor(emp: Employee, ctx: ExportCtx, range: { start: Date; end: Date }): YearSection[] {
  const { leaveRequests, customSymbols, overrides } = ctx;
  const empOverrides = overrides.filter(o => o.employeeId === emp.id);
  const overrideByDate = new Map(empOverrides.map(o => [o.date, o]));
  const months: Date[] = [];
  let cur = startOfMonth(range.start);
  while (cur <= range.end) {
    months.push(cur);
    cur = addMonths(cur, 1);
  }
  const byYear = new Map<number, Date[]>();
  for (const m of months) {
    const y = m.getFullYear();
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(m);
  }
  const sections: YearSection[] = [];
  Array.from(byYear.keys()).sort((a, b) => a - b).forEach(year => {
    const ms = byYear.get(year)!;
    const rows: SectionRow[] = ms.map(month => {
      const start = startOfMonth(month);
      const end = endOfMonth(month);
      const data = calculateTimesheet(
        emp,
        format(start, 'yyyy-MM-dd'),
        format(end, 'yyyy-MM-dd'),
        leaveRequests,
        customSymbols,
        overrides,
      );
      const days = eachDayOfInterval({ start, end });
      const cells = Array.from({ length: 31 }, (_, i) => {
        const day = days[i];
        if (!day) return null;
        const ds = format(day, 'yyyy-MM-dd');
        // Termination overlay: setelah tanggal resign, sel jadi hitam, simbol hilang.
        if (emp.terminationDate && ds >= emp.terminationDate) {
          return { date: ds, symbol: '', color: '#000000', textColor: '#FFFFFF' };
        }
        const a = data.find(d => d.date === ds);
        const ov = overrideByDate.get(ds);
        const live = a?.symbol ? resolveCustomSymbolForCell(a.symbol, ov?.color ?? a.color, customSymbols) : undefined;
        return { date: ds, symbol: a?.symbol || '', color: live?.color || a?.color || 'transparent', textColor: live?.textColor || a?.textColor };
      });
      return { month: format(month, 'MMM'), cells };
    });
    sections.push({ year, rows });
  });
  return sections;
}

function buildSections(ctx: ExportCtx, range: { start: Date; end: Date }): YearSection[] {
  return buildSectionsFor(ctx.selectedEmployee, ctx, range);
}

const fgFor = (sym: string, bg: string): string => {
  const u = sym.toUpperCase();
  const normalizedBg = normalizeHex(bg);
  if (u.startsWith('CR') || normalizedBg === 'BBF7D0' || normalizedBg === '93C5FD' || normalizedBg === 'FA8072' || normalizedBg === 'FFFFFF') return '000000';
  if (bg === '#f97316') return '000000'; // orange Ce1 = black text
  if (bg === 'transparent' || !bg) return '000000';
  return pickFg(bg).replace('#', '').toUpperCase();
};

const exportFgFor = (sym: string, bg?: string, explicit?: string): string => {
  if (explicit) return explicit.replace('#', '').toUpperCase();
  return fgFor(sym, bg || '');
};

// ---------- Themed sheet drawing (shared by single & all) ----------
function drawThemedSheet(ws: WorksheetT, emp: Employee, sections: YearSection[], customSymbols: CustomSymbol[] = []) {
  // Title
  ws.mergeCells('A1:AF1');
  const titleCell = ws.getCell('A1');
  titleCell.value = 'PT. Gane Tambang Sentosa';
  titleCell.font = { bold: true, size: 14, underline: true };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

  ws.mergeCells('A2:AF2');
  const nameCell = ws.getCell('A2');
  nameCell.value = emp.name;
  nameCell.font = { bold: true, size: 12 };
  nameCell.alignment = { horizontal: 'center', vertical: 'middle' };

  ws.addRow([]);

  const leftLabelCol = 1;
  const leftValueCol = 3;
  const rightLabelCol = 18;
  const rightValueCol = 20;

  const setInfoPair = (rowIdx: number, lLabel: string, lValue: string, rLabel: string, rValue: string) => {
    const row = ws.getRow(rowIdx);
    row.getCell(leftLabelCol).value = lLabel;
    row.getCell(leftLabelCol).font = { bold: true, size: 9 };
    ws.mergeCells(rowIdx, leftValueCol, rowIdx, rightLabelCol - 1);
    row.getCell(leftValueCol).value = lValue;
    row.getCell(leftValueCol).font = { size: 9 };
    row.getCell(rightLabelCol).value = rLabel;
    row.getCell(rightLabelCol).font = { bold: true, size: 9 };
    ws.mergeCells(rowIdx, rightValueCol, rowIdx, 32);
    row.getCell(rightValueCol).value = rValue;
    row.getCell(rightValueCol).font = { size: 9 };
  };

  setInfoPair(4, 'NIK', emp.nik || '-', 'Jabatan', emp.position || '-');
  setInfoPair(5, 'Department', emp.department || '-', 'Golongan', emp.grade || '-');
  setInfoPair(6, 'POH', emp.poh || '-', 'Join Date', emp.joinDate || '-');
  ws.addRow([]);

  sections.forEach(section => {
    const yrRowNum = ws.lastRow!.number + 1;
    ws.mergeCells(yrRowNum, 1, yrRowNum, 32);
    const yrCell = ws.getCell(yrRowNum, 1);
    yrCell.value = `Tahun ${section.year}`;
    yrCell.font = { bold: true, size: 11 };
    yrCell.alignment = { horizontal: 'left' };

    const dayHeaderRow = ws.addRow(['Bulan', ...Array.from({ length: 31 }, (_, i) => i + 1)]);
    dayHeaderRow.font = { bold: true, size: 9 };
    dayHeaderRow.alignment = { horizontal: 'center' };
    dayHeaderRow.eachCell((c: any) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
      c.border = {
        top: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        right: { style: 'thin', color: { argb: 'FFDDDDDD' } },
      };
    });

    section.rows.forEach(row => {
      const r = ws.addRow([row.month, ...row.cells.map(c => (c ? c.symbol : ''))]);
      r.alignment = { horizontal: 'center', vertical: 'middle' };
      r.font = { size: 8 };
      r.getCell(1).font = { bold: true, size: 9 };
      r.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      row.cells.forEach((c, i) => {
        const cell = r.getCell(i + 2);
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFDDDDDD' } },
          bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
          left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
          right: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        };
        if (!c) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF282828' } };
          return;
        }
        const bg = normalizeHex(c.color);
        cell.font = {
          bold: true,
          size: 8,
          color: { argb: 'FF' + (bg ? exportFgFor(c.symbol, c.color, c.textColor) : '000000') },
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF' + (bg ?? 'FFFFFF') },
        };
      });
    });
    ws.addRow([]);
  });

  // Termination note "Efektif Tidak Bekerja" — tepat di atas legend, di bawah grid.
  if (emp.terminationDate) {
    try {
      const termStr = format(parseISO(emp.terminationDate), 'dd MMMM yyyy', { locale: idLocale });
      const noteRowNum = ws.lastRow!.number + 1;
      // Kolom 1: "Note :" putih.
      const noteRow = ws.getRow(noteRowNum);
      noteRow.getCell(1).value = 'Note :';
      noteRow.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF000000' } };
      noteRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
      noteRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
      // Kolom 2..32 (merge): "Efektif Tidak Bekerja ..." bold black bg oranye.
      ws.mergeCells(noteRowNum, 2, noteRowNum, 32);
      const txtCell = ws.getCell(noteRowNum, 2);
      txtCell.value = `Efektif Tidak Bekerja ${termStr}`;
      txtCell.font = { bold: true, size: 10, color: { argb: 'FF000000' } };
      txtCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF97316' } };
      txtCell.alignment = { horizontal: 'left', vertical: 'middle' };
      noteRow.height = 18;
      ws.addRow([]);
    } catch { /* ignore */ }
  }

  // Legend
  const legendStartRow = ws.lastRow!.number + 1;
  ws.mergeCells(legendStartRow, 1, legendStartRow, 32);
  const legHdr = ws.getCell(legendStartRow, 1);
  legHdr.value = 'Legend / Keterangan Simbol';
  legHdr.font = { bold: true, size: 9 };
  legHdr.alignment = { horizontal: 'left' };

  const itemsPerRow = 6;
  const colsPerItem = Math.floor(32 / itemsPerRow);
  const legend = legendWithCustom(customSymbols);
  for (let i = 0; i < legend.length; i += itemsPerRow) {
    const rowItems = legend.slice(i, i + itemsPerRow);
    const rowNum = ws.lastRow!.number + 1;
    const r = ws.getRow(rowNum);
    rowItems.forEach((it, idx) => {
      const baseCol = idx * colsPerItem + 1;
      const swatch = r.getCell(baseCol);
      swatch.value = it.code;
      swatch.alignment = { horizontal: 'center', vertical: 'middle' };
      swatch.font = { bold: true, size: 7, color: { argb: 'FF' + (normalizeHex(it.fg) || '000000') } };
      swatch.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + (normalizeHex(it.bg) || 'FFFFFF') } };
      const labelStart = baseCol + 1;
      const labelEnd = baseCol + colsPerItem - 1;
      ws.mergeCells(rowNum, labelStart, rowNum, labelEnd);
      const lab = r.getCell(labelStart);
      lab.value = it.label;
      lab.font = { size: 7 };
      lab.alignment = { horizontal: 'left', vertical: 'middle' };
    });
    r.height = 14;
  }

  ws.getColumn(1).width = 8;
  for (let i = 2; i <= 32; i++) ws.getColumn(i).width = 3.2;
}

async function newThemedWorkbook(): Promise<WorkbookT> {
  const mod = await loadExcelJS();
  return new mod.Workbook();
}

function addThemedWorksheet(wb: WorkbookT, name: string) {
  return wb.addWorksheet(name, {
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 },
    },
  });
}

function safeSheetName(s: string) {
  // Excel sheet names: ≤31 chars, no : \ / ? * [ ]
  return (s || 'Sheet').replace(/[:\\/?*\[\]]/g, '_').slice(0, 31);
}

async function downloadWorkbook(wb: WorkbookT, filename: string) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Excel: themed (single employee) ----------
export async function exportThemedExcel(ctx: ExportCtx) {
  const emp = ctx.selectedEmployee;
  const range = computeRange(emp, { monthsBack: ctx.monthsBack, monthsAhead: ctx.monthsAhead });
  const sections = buildSections(ctx, range);
  const wb = await newThemedWorkbook();
  const ws = addThemedWorksheet(wb, 'Timesheet');
  drawThemedSheet(ws, emp, sections, ctx.customSymbols);
  await downloadWorkbook(wb, `TS ${emp.name || ''} ${emp.nik || ''}.xlsx`.replace(/\s+/g, ' ').trim());
}

// ---------- Excel: themed (single employee, joinDate→3mo from now) ----------
export async function exportThemedExcelOneAll(ctx: ExportCtx) {
  const emp = ctx.selectedEmployee;
  const range = computeRangeFull(emp);
  const sections = buildSectionsFor(emp, ctx, range);
  const wb = await newThemedWorkbook();
  const ws = addThemedWorksheet(wb, 'Timesheet');
  drawThemedSheet(ws, emp, sections, ctx.customSymbols);
  await downloadWorkbook(wb, `TS ${emp.name || ''} ${emp.nik || ''}.xlsx`.replace(/\s+/g, ' ').trim());
}

// ---------- Excel: themed (all employees, joinDate→3mo from now) ----------
export async function exportThemedExcelAll(ctx: ExportCtx, allEmployees: Employee[]) {
  const wb = await newThemedWorkbook();
  allEmployees.forEach(emp => {
    const range = computeRangeFull(emp);
    const sections = buildSectionsFor(emp, ctx, range);
    const sheetName = safeSheetName(emp.nik || emp.name || 'Emp');
    const ws = addThemedWorksheet(wb, sheetName);
    drawThemedSheet(ws, emp, sections, ctx.customSymbols);
  });
  await downloadWorkbook(wb, `Timesheet_All_themed_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
}

// ---------- Raw data (per emp: joinDate → 3mo from now) ----------
function groupRanges(dates: string[]): string {
  if (dates.length === 0) return '';
  const sorted = [...dates].sort();
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const expected = format(addDays(parseISO(prev), 1), 'yyyy-MM-dd');
    if (cur === expected) {
      prev = cur;
    } else {
      ranges.push(start === prev ? fmt(start) : `${fmt(start)}-${fmt(prev)}`);
      start = cur;
      prev = cur;
    }
  }
  ranges.push(start === prev ? fmt(start) : `${fmt(start)}-${fmt(prev)}`);
  return ranges.join(', ');
}
const fmt = (d: string) => format(parseISO(d), 'd/M/yyyy');

function buildRawRows(ctx: ExportCtx, employees: Employee[]) {
  const headers = [
    'NIK', 'Nama', 'Golongan', 'Departemen', 'Jabatan', 'Join Date', 'POH',
    ...SYMBOL_COLUMNS.map(c => c.key),
  ];
  const rows: any[][] = [headers];
  employees.forEach(emp => {
    const range = computeRangeFull(emp);
    const yStart = format(range.start, 'yyyy-MM-dd');
    const yEnd = format(range.end, 'yyyy-MM-dd');
    const data = calculateTimesheet(emp, yStart, yEnd, ctx.leaveRequests, ctx.customSymbols, ctx.overrides);
    const overrideByDate = new Map(ctx.overrides.filter(o => o.employeeId === emp.id).map(o => [o.date, o]));
    const colorForFunction = (fn: string) => (ctx.customSymbols.find(s => (s.function || '').toLowerCase() === fn.toLowerCase())?.color || '').toLowerCase();
    const tvInColor = colorForFunction('Travel Perjalanan Ke Site') || '#1e3a8a';
    const extraWorkColor = colorForFunction('Kelebihan Hari Kerja') || '#000000';
    const extraLeaveColor = colorForFunction('Cuti Extra') || '#f97316';
    const buckets: Record<string, string[]> = {};
    SYMBOL_COLUMNS.forEach(c => { buckets[c.key] = []; });
    data.forEach(d => {
      if (!d.symbol) return;
      // Skip tanggal setelah resign — tidak masuk Raw template.
      if (emp.terminationDate && d.date >= emp.terminationDate) return;
      const sym = d.symbol;
      const ov = overrideByDate.get(d.date);
      const live = resolveCustomSymbolForCell(sym, ov?.color ?? d.color, ctx.customSymbols);
      const color = (live?.color || d.color || '').toLowerCase();
      if (sym.toUpperCase() === 'TV') {
        if ((d.function || '').toLowerCase() === 'travel perjalanan ke site' || color === tvInColor) buckets['TV In'].push(d.date);
        else buckets['TV Out'].push(d.date);
        return;
      }
      if (/^X\d+$/.test(sym)) {
        if (color === extraWorkColor) buckets['X'].push(d.date);
        else buckets['Xk'].push(d.date);
        return;
      }
      if (/^Ce\d*$/i.test(sym)) {
        if (color === extraLeaveColor) buckets['Ce1o'].push(d.date);
        else buckets['Ce'].push(d.date);
        return;
      }
      const col = SYMBOL_COLUMNS.find(c => c.match(sym));
      if (col) buckets[col.key].push(d.date);
    });
    rows.push([
      emp.nik, emp.name, emp.grade, emp.department, emp.position, emp.joinDate, emp.poh,
      ...SYMBOL_COLUMNS.map(c => groupRanges(buckets[c.key])),
    ]);
  });
  return rows;
}

export async function exportRawExcel(ctx: ExportCtx, allEmployees: Employee[]) {
  const rows = buildRawRows(ctx, allEmployees);
  const xlsx = await loadXlsx();
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 12 }, { wch: 22 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 10 },
    ...SYMBOL_COLUMNS.map(() => ({ wch: 22 })),
  ];
  xlsx.utils.book_append_sheet(wb, ws, 'Raw Timesheet');
  xlsx.writeFile(wb, `Timesheet_RawData_All.xlsx`);
}

// ---------- Excel: Compare View (1 dept × full year, rows=employees, cols=days) ----------
export async function exportCompareExcel(
  ctx: ExportCtx,
  deptEmployees: Employee[],
  department: string,
) {
  const wb = await newThemedWorkbook();
  const ws = wb.addWorksheet(safeSheetName(`Compare ${department}`), {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', xSplit: 2, ySplit: 3 }],
  });
  const yStart = new Date(ctx.year, 0, 1);
  const yEnd = new Date(ctx.year, 11, 31);
  const days = eachDayOfInterval({ start: yStart, end: yEnd });

  // Title
  ws.mergeCells(1, 1, 1, days.length + 2);
  const t = ws.getCell(1, 1);
  t.value = `Compare Timesheet — ${department} — ${ctx.year}`;
  t.font = { bold: true, size: 14 };
  t.alignment = { horizontal: 'center' };

  // Header rows (row 2: month label per day-1; row 3: day/month "d/m")
  const hdr = ws.getRow(3);
  hdr.getCell(1).value = 'NIK';
  hdr.getCell(2).value = 'Nama';
  days.forEach((d, i) => {
    const c = hdr.getCell(i + 3);
    c.value = `${d.getDate()}/${d.getMonth() + 1}`;
  });
  hdr.font = { bold: true, size: 8 };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
    c.border = { top: { style: 'thin', color: { argb: 'FFDDDDDD' } }, bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } }, left: { style: 'thin', color: { argb: 'FFDDDDDD' } }, right: { style: 'thin', color: { argb: 'FFDDDDDD' } } };
  });

  // Body rows
  deptEmployees.forEach(emp => {
    const data = calculateTimesheet(
      emp,
      format(yStart, 'yyyy-MM-dd'),
      format(yEnd, 'yyyy-MM-dd'),
      ctx.leaveRequests, ctx.customSymbols, ctx.overrides,
    );
    const overrideByDate = new Map(ctx.overrides.filter(o => o.employeeId === emp.id).map(o => [o.date, o]));
    const byDate = new Map(data.map(d => [d.date, d]));
    const r = ws.addRow([emp.nik, emp.name, ...days.map(d => {
      const a = byDate.get(format(d, 'yyyy-MM-dd'));
      return a?.symbol || '';
    })]);
    r.font = { size: 8 };
    r.alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(1).font = { bold: true, size: 8 };
    r.getCell(2).font = { bold: true, size: 8 };
    r.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };
    days.forEach((d, i) => {
      const cell = r.getCell(i + 3);
      const a = byDate.get(format(d, 'yyyy-MM-dd'));
      cell.border = { top: { style: 'thin', color: { argb: 'FFDDDDDD' } }, bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } }, left: { style: 'thin', color: { argb: 'FFDDDDDD' } }, right: { style: 'thin', color: { argb: 'FFDDDDDD' } } };
      const ds = format(d, 'yyyy-MM-dd');
      // Termination overlay: sel jadi hitam tanpa simbol setelah tanggal resign.
      if (emp.terminationDate && ds >= emp.terminationDate) {
        cell.value = '';
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
        return;
      }
      if (!a || !a.symbol) return;
      const ov = overrideByDate.get(a.date);
      const live = resolveCustomSymbolForCell(a.symbol, ov?.color ?? a.color, ctx.customSymbols);
      const bgColor = live?.color || a.color;
      const textColor = live?.textColor || a.textColor;
      const bg = normalizeHex(bgColor);
      cell.font = { bold: true, size: 7, color: { argb: 'FF' + (bg ? exportFgFor(a.symbol, bgColor, textColor) : '000000') } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + (bg ?? 'FFFFFF') } };
    });
  });

  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 22;
  for (let i = 3; i < 3 + days.length; i++) ws.getColumn(i).width = 3;

  await downloadWorkbook(wb, `Compare_${department}_${ctx.year}.xlsx`.replace(/\s+/g, '_'));
}

// ---------- PDF (themed grid for selected employee) ----------
async function buildPdfDoc(
  emp: Employee,
  sections: YearSection[],
  customSymbols: CustomSymbol[] = [],
  siteBlock?: SiteBlockData,
) {
  const { jsPDF, autoTable } = await loadJsPdf();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 24;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  const title = 'PT. Gane Tambang Sentosa';
  const titleW = doc.getTextWidth(title);
  const titleX = (pageW - titleW) / 2;
  let y = margin + 14;
  doc.text(title, titleX, y);
  doc.setLineWidth(0.8);
  doc.line(titleX, y + 2, titleX + titleW, y + 2);

  y += 18;
  doc.setFontSize(11);
  const nm = emp.name || '-';
  doc.text(nm, (pageW - doc.getTextWidth(nm)) / 2, y);

  y += 16;
  doc.setFontSize(9);
  const colLeftX = margin;
  const rightEdgeX = pageW - margin;
  const labelW = 60;
  const lineH = 12;

  const drawPairLeft = (x: number, yy: number, label: string, value: string) => {
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}`, x, yy);
    doc.setFont('helvetica', 'normal');
    doc.text(`: ${value}`, x + labelW, yy);
  };

  const drawPairRight = (rightX: number, yy: number, label: string, value: string) => {
    const valueText = `: ${value}`;
    doc.setFont('helvetica', 'normal');
    const valueW = doc.getTextWidth(valueText);
    doc.text(valueText, rightX - valueW, yy);
    doc.setFont('helvetica', 'bold');
    const labelText = `${label}`;
    const labelW2 = doc.getTextWidth(labelText);
    doc.text(labelText, rightX - valueW - labelW2, yy);
  };

  drawPairLeft(colLeftX, y, 'NIK', emp.nik || '-');
  drawPairRight(rightEdgeX, y, 'Jabatan', emp.position || '-');
  drawPairLeft(colLeftX, y + lineH, 'Department', emp.department || '-');
  drawPairRight(rightEdgeX, y + lineH, 'Golongan', emp.grade || '-');
  drawPairLeft(colLeftX, y + lineH * 2, 'POH', emp.poh || '-');
  drawPairRight(rightEdgeX, y + lineH * 2, 'Join Date', emp.joinDate || '-');

  y += lineH * 3 + 8;

  const legend = legendWithCustom(customSymbols);
  const legendRows = Math.ceil(legend.length / 9);
  const legendHeaderH = 14;
  const legendH = legendHeaderH + legendRows * 11 + 8;
  // Tinggi site block (bila ada): tabel rangkuman + baris TTD + margin.
  // Disediakan jarak ekstra agar tabel Cuti Site tidak terlalu mepet dengan
  // label/kolom tanda tangan di bawahnya.
  const siteBlockShift = 0;
  const siteBlockH = siteBlock ? 134 : 0;
  // Tinggi note "Efektif Tidak Bekerja" (bila karyawan resign).
  const termH = emp.terminationDate ? 20 : 0;
  const tablesAreaBottom = pageH - margin - legendH - siteBlockH - termH;

  const head = [['Bulan', ...Array.from({ length: 31 }, (_, i) => String(i + 1))]];
  const totalSectionsHeight = tablesAreaBottom - y;
  const interSectionGap = 6;
  const totalDataRows = sections.reduce((a, s) => a + s.rows.length + 1, 0);
  const perRowH = (totalSectionsHeight - sections.length * 14 - Math.max(0, sections.length - 1) * interSectionGap) / Math.max(1, totalDataRows);
  const cellMinH = Math.max(8, Math.min(13, perRowH));

  sections.forEach((section) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`Tahun ${section.year}`, margin, y + 10);
    y += 12;

    const body = section.rows.map(row => [row.month, ...row.cells.map(c => (c ? c.symbol : ''))]);

    autoTable(doc, {
      head, body,
      startY: y,
      margin: { left: margin, right: margin },
      tableWidth: pageW - margin * 2,
      styles: {
        fontSize: 6, halign: 'center', valign: 'middle',
        cellPadding: 1, lineWidth: 0.2, lineColor: [220, 220, 220],
        minCellHeight: cellMinH,
      },
      headStyles: { fillColor: [240, 240, 240], textColor: [60, 60, 60], fontStyle: 'bold', fontSize: 6.5 },
      columnStyles: { 0: { cellWidth: 28, fontStyle: 'bold', halign: 'left', fontSize: 7 } },
      didParseCell: (data: any) => {
        if (data.section !== 'body' || data.column.index === 0) return;
        const row = section.rows[data.row.index];
        const cell = row.cells[data.column.index - 1];
        if (!cell) { data.cell.styles.fillColor = [40, 40, 40]; return; }
        const rgb = hexToRgb(cell.color);
        if (rgb) {
          data.cell.styles.fillColor = rgb;
          const fg = exportFgFor(cell.symbol, cell.color, cell.textColor);
          data.cell.styles.textColor = hexToRgb(fg) || (fg === 'FFFFFF' ? [255, 255, 255] : [0, 0, 0]);
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
    // @ts-ignore
    y = doc.lastAutoTable.finalY + interSectionGap;
  });

  // ---------- Site Block ----------
  if (siteBlock) {
    const sbTop = pageH - margin - legendH - siteBlockH + 4 - siteBlockShift;
    // Tabel rangkuman: 5 kolom (Periode | Jumlah | Disimpan | Dibayarkan | Keterangan).
    autoTable(doc, {
      startY: sbTop,
      margin: { left: margin + (pageW - margin * 2) * 0.30, right: margin },
      tableWidth: (pageW - margin * 2) * 0.70,
      head: [[`Cuti Site Periode ${siteBlock.periodLabel}`, 'Jumlah', 'Disimpan', 'Dibayarkan', 'Keterangan']],
      body: [[
        '',
        String(siteBlock.jumlah || ''),
        siteBlock.disimpan != null ? String(siteBlock.disimpan) : '',
        siteBlock.dibayarkan != null ? String(siteBlock.dibayarkan) : String(siteBlock.jumlah || ''),
        siteBlock.keterangan || '',
      ]],
      styles: { fontSize: 7, halign: 'center', valign: 'middle', cellPadding: 3, lineWidth: 0.4, lineColor: [120, 120, 120] },
      headStyles: { fillColor: [253, 230, 200], textColor: [60, 30, 0], fontStyle: 'bold' },
      columnStyles: {
        0: { halign: 'left', cellWidth: 'auto' },
        4: { halign: 'left' },
      },
    });

    // 4 kolom tanda tangan: Karyawan | Diverifikasi | Diketahui | Disetujui
    const sigTop = sbTop + 54;
    const sigCols = [
      { label: 'Karyawan ybs,',       name: siteBlock.employeeName || '-',         title: 'Karyawan' },
      { label: 'Diverifikasi Oleh,',  name: siteBlock.diverifikasiName || '',      title: siteBlock.diverifikasiTitle || 'HR Operation' },
      { label: 'Diketahui Oleh,',     name: siteBlock.diketahuiName || '',         title: siteBlock.diketahuiTitle || 'HR Superintendent' },
      { label: 'Disetujui Oleh,',     name: siteBlock.disetujuiName || '',         title: siteBlock.disetujuiTitle || 'Head Of Site' },
    ];
    const colW = (pageW - margin * 2) / 4;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    sigCols.forEach((s, idx) => {
      const cx = margin + colW * idx + 8;
      doc.setFont('helvetica', 'normal');
      doc.text(s.label, cx, sigTop);
      // Garis bawah nama (40pt di bawah)
      doc.setFont('helvetica', 'bold');
      const nameY = sigTop + 44;
      doc.text(s.name || ' ', cx, nameY);
      // underline
      const nameW = Math.max(80, doc.getTextWidth(s.name || ''));
      doc.setLineWidth(0.5);
      doc.line(cx, nameY + 1.5, cx + nameW, nameY + 1.5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.text(s.title, cx, nameY + 11);
      doc.setFontSize(8);
    });
  }

  // Termination note — tepat di atas legend, di bawah grid.
  if (emp.terminationDate) {
    try {
      const termStr = format(parseISO(emp.terminationDate), 'dd MMMM yyyy', { locale: idLocale });
      const noteY = pageH - margin - legendH - termH + 14;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const prefix = 'Note : ';
      doc.setTextColor(0, 0, 0);
      doc.text(prefix, margin, noteY);
      const prefixW = doc.getTextWidth(prefix);
      doc.setFont('helvetica', 'bold');
      const noteTxt = `Efektif Tidak Bekerja ${termStr}`;
      const noteW = doc.getTextWidth(noteTxt) + 8;
      // background oranye
      doc.setFillColor(249, 115, 22);
      doc.rect(margin + prefixW, noteY - 9, noteW, 13, 'F');
      doc.setTextColor(0, 0, 0);
      doc.text(noteTxt, margin + prefixW + 4, noteY);
      doc.setFont('helvetica', 'normal');
    } catch { /* ignore */ }
  }

  const legendTop = pageH - margin - legendH;
  const legendHeaderY = legendTop + 8;
  const legendRowsStartY = legendTop + legendHeaderH + 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Legend / Keterangan Simbol', margin, legendHeaderY);

  const itemsPerRow = 9;
  const itemW = (pageW - margin * 2) / itemsPerRow;
  const swatchW = 16;
  const swatchH = 9;
  const rowH = 11;
  legend.forEach((it, i) => {
    const col = i % itemsPerRow;
    const row = Math.floor(i / itemsPerRow);
    const x = margin + col * itemW;
    const yy = legendRowsStartY + row * rowH + swatchH;
    const bgRgb = hexToRgb(it.bg) || [255, 255, 255];
    doc.setFillColor(bgRgb[0], bgRgb[1], bgRgb[2]);
    doc.rect(x, yy - swatchH + 1, swatchW, swatchH, 'F');
    const fgRgb = hexToRgb(it.fg) || [0, 0, 0];
    doc.setTextColor(fgRgb[0], fgRgb[1], fgRgb[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5);
    doc.text(it.code, x + swatchW / 2, yy - 1.5, { align: 'center' });
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.text(it.label, x + swatchW + 3, yy - 1.5, { maxWidth: itemW - swatchW - 5 });
  });

  return doc;
}

export async function exportPdf(ctx: ExportCtx, opts: { print?: boolean } = {}) {
  const emp = ctx.selectedEmployee;
  const range = computeRange(emp, { monthsBack: ctx.monthsBack, monthsAhead: ctx.monthsAhead });
  const sections = buildSections(ctx, range);
  const doc = await buildPdfDoc(emp, sections, ctx.customSymbols);
  const filename = `TS ${emp.name || ''} ${emp.nik || ''}.pdf`.replace(/\s+/g, ' ').trim();
  if (opts.print) {
    try {
      doc.autoPrint();
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.visibility = 'hidden';
      iframe.src = url;
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          doc.save(filename);
        }
        setTimeout(() => {
          URL.revokeObjectURL(url);
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        }, 60_000);
      };
      document.body.appendChild(iframe);
    } catch {
      doc.save(filename);
    }
  } else {
    doc.save(filename);
  }
}

// ---------- Bulk PDF export (date range → ZIP) ----------
/** Helper: bangun PDF timesheet (arraybuffer) untuk 1 karyawan, format sama
 *  dengan tombol Export PDF di menu Timesheet (11 bln ke belakang + 1 ke depan). */
export async function buildTimesheetPdfBuffer(
  ctx: Omit<ExportCtx, 'selectedEmployee'>,
  emp: Employee,
  siteBlock?: SiteBlockData,
): Promise<ArrayBuffer> {
  const empRange = computeRange(emp, { monthsBack: ctx.monthsBack, monthsAhead: ctx.monthsAhead });
  const sections = buildSectionsFor(emp, { ...ctx, selectedEmployee: emp }, empRange);
  const doc = await buildPdfDoc(emp, sections, ctx.customSymbols, siteBlock);
  return doc.output('arraybuffer');
}

export async function exportBulkPdfZip(
  ctx: Omit<ExportCtx, 'selectedEmployee'>,
  employees: Employee[],
  fromDate: Date,
  toDate: Date,
  onProgress?: (done: number, total: number) => void,
) {
  const JSZipMod = await loadJsZip();
  const zip = new JSZipMod();
  const used = new Set<string>();
  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    // Sama persis dengan export PDF di Menu Timesheet (range dari Settings).
    const empRange = computeRange(emp, { monthsBack: ctx.monthsBack, monthsAhead: ctx.monthsAhead });
    const sections = buildSectionsFor(emp, { ...ctx, selectedEmployee: emp }, empRange);
    const doc = await buildPdfDoc(emp, sections, ctx.customSymbols);
    let base = `TS ${emp.name || ''} ${emp.nik || ''}`.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || `TS_${i + 1}`;
    let name = `${base}.pdf`;
    let n = 2;
    while (used.has(name)) { name = `${base} (${n++}).pdf`; }
    used.add(name);
    zip.file(name, doc.output('arraybuffer'));
    onProgress?.(i + 1, employees.length);
    // yield to UI
    await new Promise(r => setTimeout(r, 0));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Timesheets_${format(fromDate, 'yyyy-MM-dd')}_to_${format(toDate, 'yyyy-MM-dd')}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
