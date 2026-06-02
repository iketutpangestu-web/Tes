import ExcelJS from 'exceljs';
import { format, eachDayOfInterval } from 'date-fns';
import { Employee, ManualOverride } from '../types';
import { SYMBOL_COLUMNS } from './timesheetExport';

// Helper: convert exceljs ARGB ("FFRRGGBB") → "#RRGGBB"
function argbToHex(argb?: string): string | undefined {
  if (!argb) return undefined;
  const s = argb.replace(/^#/, '');
  if (s.length === 8) {
    if (s.slice(0, 2).toLowerCase() === '00') return undefined;
    return '#' + s.slice(2).toLowerCase();
  }
  if (s.length === 6) return '#' + s.toLowerCase();
  return undefined;
}

async function loadWorkbook(file: File): Promise<ExcelJS.Workbook> {
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0, januari: 0,
  feb: 1, february: 1, februari: 1, pebruari: 1,
  mar: 2, march: 2, maret: 2,
  apr: 3, april: 3,
  may: 4, mei: 4,
  jun: 5, june: 5, juni: 5,
  jul: 6, july: 6, juli: 6,
  aug: 7, august: 7, agustus: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, oktober: 9,
  nov: 10, november: 10, nopember: 10,
  dec: 11, december: 11, desember: 11,
};

/**
 * Parse a themed worksheet for a single employee. Tracks "Tahun YYYY"
 * section headers so multi-year exports import into the correct year.
 */
function parseThemedSheet(ws: ExcelJS.Worksheet, employeeId: string): ManualOverride[] {
  const out: ManualOverride[] = [];
  if (!ws) return out;
  let currentYear: number | null = null;

  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const a = String(row.getCell(1).value ?? '').trim();

    const ym = a.match(/Tahun\s+(\d{4})/i);
    if (ym) { currentYear = parseInt(ym[1]); continue; }

    const monthIdx = MONTH_MAP[a.toLowerCase()];
    if (monthIdx === undefined) continue;
    if (currentYear === null) continue; // skip month rows before any year header

    for (let day = 1; day <= 31; day++) {
      const cell = row.getCell(day + 1);
      const sym = String(cell.value ?? '').trim();
      if (!sym) continue;
      const dateObj = new Date(currentYear, monthIdx, day);
      if (dateObj.getMonth() !== monthIdx) continue;
      const fill: any = cell.fill;
      let color: string | undefined;
      if (fill && fill.type === 'pattern' && fill.fgColor && fill.fgColor.argb) {
        color = argbToHex(fill.fgColor.argb);
        if (color === '#282828') continue; // blank fill
      }
      // X regular (white) → 'transparent' to distinguish from X extra (black).
      let finalColor = color;
      if (/^X\d+$/.test(sym)) {
        if (!finalColor || finalColor === '#ffffff') finalColor = 'transparent';
        else if (finalColor === '#000000') finalColor = '#000000';
      }
      out.push({
        employeeId,
        date: format(dateObj, 'yyyy-MM-dd'),
        symbol: sym,
        color: finalColor,
      });
    }
  }
  return out;
}

export async function importThemedExcel(file: File, employeeId: string): Promise<ManualOverride[]> {
  const wb = await loadWorkbook(file);
  const ws = wb.getWorksheet('Timesheet') || wb.worksheets[0];
  if (!ws) return [];
  return parseThemedSheet(ws, employeeId);
}

/**
 * Multi-sheet themed import. Each sheet represents one employee, identified
 * by NIK in the info rows (or the sheet name as fallback).
 */
function findNikInSheet(ws: ExcelJS.Worksheet): string | null {
  for (let r = 1; r <= 15; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= 5; c++) {
      const v = String(row.getCell(c).value ?? '').trim();
      if (v.toUpperCase() === 'NIK') {
        for (let cc = c + 1; cc <= 32; cc++) {
          const vv = String(row.getCell(cc).value ?? '').trim();
          if (vv && vv !== '-') return vv;
        }
      }
    }
  }
  return null;
}

export async function importThemedExcelAll(file: File, employees: Employee[]): Promise<ManualOverride[]> {
  const wb = await loadWorkbook(file);
  const out: ManualOverride[] = [];
  wb.worksheets.forEach(ws => {
    const nik = findNikInSheet(ws) || ws.name;
    const emp = employees.find(e => e.nik === nik);
    if (!emp) return;
    out.push(...parseThemedSheet(ws, emp.id));
  });
  return out;
}

// ---- Raw template parsing ----
function parseDateToken(s: string, year: number): Date | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const d = parseInt(m[1]);
  const mo = parseInt(m[2]) - 1;
  const y = m[3] ? parseInt(m[3]) : year;
  const yy = y < 100 ? 2000 + y : y;
  const dt = new Date(yy, mo, d);
  if (dt.getMonth() !== mo) return null;
  return dt;
}

function expandRanges(text: string, year: number): Date[] {
  // Flat list — kept for backward compat; internal code prefers expandRangeGroups.
  return expandRangeGroups(text, year).flat();
}

/**
 * Pisah teks per token koma/semicolon. Setiap token = satu periode kontinu.
 * Ini dipakai untuk reset counter (X1, Cr1, dst.) per periode kerja/cuti,
 * sehingga setelah selesai Cuti Roster, X kerja kembali ke X1 — bukan X200++.
 */
function expandRangeGroups(text: string, year: number): Date[][] {
  if (!text) return [];
  const groups: Date[][] = [];
  text.split(/[,;]/).map(s => s.trim()).filter(Boolean).forEach(part => {
    const range = part.split('-').map(s => s.trim());
    const grp: Date[] = [];
    if (range.length === 2) {
      const a = parseDateToken(range[0], year);
      const b = parseDateToken(range[1], year);
      if (a && b) eachDayOfInterval({ start: a, end: b }).forEach(d => grp.push(d));
    } else {
      const a = parseDateToken(range[0], year);
      if (a) grp.push(a);
    }
    if (grp.length) groups.push(grp);
  });
  return groups;
}

function rowToOverrides(employeeId: string, year: number, dataByCol: Record<string, string>): ManualOverride[] {
  const out: ManualOverride[] = [];

  // Helper: emit dates dengan opsi reset counter per grup kontinu.
  const emit = (
    text: string,
    build: (d: Date, idxInGroup: number) => { symbol: string; color?: string },
  ) => {
    if (!text) return;
    const groups = expandRangeGroups(text, year);
    groups.forEach(grp => {
      grp.forEach((d, i) => {
        const { symbol, color } = build(d, i);
        out.push({ employeeId, date: format(d, 'yyyy-MM-dd'), symbol, color });
      });
    });
  };

  SYMBOL_COLUMNS.forEach(col => {
    const text = dataByCol[col.key];
    if (!text) return;
    switch (col.key) {
      case 'XP':     emit(text, () => ({ symbol: 'XP',  color: '#15803d' })); break;
      case 'Cr':     emit(text, (_d, i) => ({ symbol: `Cr${i + 1}`, color: '#bbf7d0' })); break;
      case 'Cs':     emit(text, (_d, i) => ({ symbol: `Cs${i + 1}`, color: '#fa8072' })); break;
      case 'Ct':     emit(text, (_d, i) => ({ symbol: `Ct${i + 1}`, color: '#000000' })); break;
      case 'TS':     emit(text, () => ({ symbol: 'TS',  color: '#ec4899' })); break;
      case 'UIs':    emit(text, (_d, i) => ({ symbol: `UIs${i + 1}`, color: '#ec4899' })); break;
      case 'II':     emit(text, () => ({ symbol: 'II',  color: '#ec4899' })); break;
      case 'KL':     emit(text, () => ({ symbol: 'KL',  color: '#ec4899' })); break;
      case 'TV Out': emit(text, () => ({ symbol: 'TV',  color: '#dc2626' })); break;
      case 'CI':     emit(text, (_d, i) => ({ symbol: `CI${i + 1}`, color: '#93c5fd' })); break;
      case 'IS':     emit(text, (_d, i) => ({ symbol: `IS${i + 1}`, color: '#93c5fd' })); break;
      case 'Ce':     emit(text, (_d, i) => ({ symbol: `Ce${i + 1}`, color: '#15803d' })); break;
      case 'Ce1o':   emit(text, () => ({ symbol: 'Ce1', color: '#f97316' })); break;
      case 'X':      emit(text, (_d, i) => ({ symbol: `X${i + 1}`, color: '#000000' })); break;
      case 'Xk':     emit(text, (_d, i) => ({ symbol: `X${i + 1}`, color: 'transparent' })); break;
      case 'Cx':     emit(text, () => ({ symbol: 'Cx',  color: '#93c5fd' })); break;
      case 'UI':     emit(text, (_d, i) => ({ symbol: `UI${i + 1}`, color: '#93c5fd' })); break;
      case 'KS':     emit(text, () => ({ symbol: 'KS',  color: '#93c5fd' })); break;
      case 'SS':     emit(text, () => ({ symbol: 'SS',  color: '#93c5fd' })); break;
      case 'XS':     emit(text, () => ({ symbol: 'XS',  color: '#000000' })); break;
      case 'A':      emit(text, (_d, i) => ({ symbol: `A${i + 1}`, color: '#ef4444' })); break;
      case 'DD':     emit(text, (_d, i) => ({ symbol: `DD${i + 1}`, color: '#1e3a8a' })); break;
      case 'DI':     emit(text, (_d, i) => ({ symbol: `DI${i + 1}`, color: '#1e3a8a' })); break;
      case 'BP':     emit(text, () => ({ symbol: 'BP',  color: '#1e3a8a' })); break;
      case 'IK':     emit(text, (_d, i) => ({ symbol: `IK${i + 1}`, color: '#1e3a8a' })); break;
      case 'TT':     emit(text, () => ({ symbol: 'TT',  color: '#1e3a8a' })); break;
      case 'TV In':  emit(text, () => ({ symbol: 'TV',  color: '#1e3a8a' })); break;
      case 'SI':     emit(text, () => ({ symbol: 'SI',  color: '#1e3a8a' })); break;
    }
  });
  return out;
}

interface RawParseResult {
  byNik: Map<string, Record<string, string>>;
  year: number;
}

async function parseRawWorkbook(file: File): Promise<RawParseResult> {
  const wb = await loadWorkbook(file);
  const ws = wb.getWorksheet('Raw Timesheet') || wb.worksheets[0];
  const result: RawParseResult = { byNik: new Map(), year: new Date().getFullYear() };
  if (!ws) return result;

  const header: string[] = [];
  const hdr = ws.getRow(1);
  hdr.eachCell((c, idx) => { header[idx] = String(c.value ?? '').trim(); });

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nik = String(row.getCell(1).value ?? '').trim();
    if (!nik) continue;
    const data: Record<string, string> = {};
    row.eachCell((c, idx) => {
      const key = header[idx];
      if (!key) return;
      data[key] = String(c.value ?? '').trim();
    });
    result.byNik.set(nik, data);
  }
  return result;
}

export async function importRawExcelOne(file: File, employee: Employee): Promise<ManualOverride[]> {
  const { byNik, year } = await parseRawWorkbook(file);
  const data = byNik.get(employee.nik);
  if (!data) return [];
  return rowToOverrides(employee.id, year, data);
}

export async function importRawExcelAll(file: File, employees: Employee[]): Promise<ManualOverride[]> {
  const { byNik, year } = await parseRawWorkbook(file);
  const out: ManualOverride[] = [];
  employees.forEach(emp => {
    const data = byNik.get(emp.nik);
    if (data) out.push(...rowToOverrides(emp.id, year, data));
  });
  return out;
}

/**
 * Compare-view import: parse the wide grid (rows=employees, cols=days "d/m").
 * Defaults missing year to `defaultYear`. Reads cell fill color so that
 * X-with-white = work (transparent), X-with-black = extra work — matching
 * the themed import behavior.
 */
export async function importCompareExcel(
  file: File,
  employees: Employee[],
  defaultYear: number,
): Promise<ManualOverride[]> {
  const wb = await loadWorkbook(file);
  const ws = wb.worksheets[0];
  const out: ManualOverride[] = [];
  if (!ws) return out;

  // Find header row containing "NIK" in column A.
  let headerRow = -1;
  for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
    const v = String(ws.getRow(r).getCell(1).value ?? '').trim().toUpperCase();
    if (v === 'NIK') { headerRow = r; break; }
  }
  if (headerRow < 0) return out;

  // Parse date columns from header (col 3+). Format "d/m" or "d/m/yyyy".
  const dateCols: { col: number; date: Date }[] = [];
  const hdr = ws.getRow(headerRow);
  for (let c = 3; c <= ws.columnCount; c++) {
    const raw = String(hdr.getCell(c).value ?? '').trim();
    if (!raw) continue;
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (!m) continue;
    const day = parseInt(m[1]);
    const mo = parseInt(m[2]) - 1;
    const y = m[3] ? (parseInt(m[3]) < 100 ? 2000 + parseInt(m[3]) : parseInt(m[3])) : defaultYear;
    const dt = new Date(y, mo, day);
    if (dt.getMonth() !== mo) continue;
    dateCols.push({ col: c, date: dt });
  }

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nik = String(row.getCell(1).value ?? '').trim();
    if (!nik) continue;
    const emp = employees.find(e => e.nik === nik);
    if (!emp) continue;
    dateCols.forEach(({ col, date }) => {
      const cell = row.getCell(col);
      const sym = String(cell.value ?? '').trim();
      if (!sym) return;
      const fill: any = cell.fill;
      let color: string | undefined;
      if (fill && fill.type === 'pattern' && fill.fgColor && fill.fgColor.argb) {
        color = argbToHex(fill.fgColor.argb);
        if (color === '#282828') return;
      }
      let finalColor = color;
      if (/^X\d+$/.test(sym)) {
        if (!finalColor || finalColor === '#ffffff') finalColor = 'transparent';
        else if (finalColor === '#000000') finalColor = '#000000';
      }
      out.push({
        employeeId: emp.id,
        date: format(date, 'yyyy-MM-dd'),
        symbol: sym,
        color: finalColor,
      });
    });
  }
  return out;
}
