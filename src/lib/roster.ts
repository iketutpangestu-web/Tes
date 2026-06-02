import { addDays, format, getDay, isAfter, isBefore, parseISO, startOfDay } from 'date-fns';
import { BoatDay, ROSTER_CONFIG, BOAT_SCHEDULE, Employee, ManualOverride } from '../types';

export function getBoatDay(date: Date, direction: 'next' | 'prev'): Date {
  let current = new Date(date);
  const maxIterations = 7;
  let count = 0;
  
  while (!BOAT_SCHEDULE.includes(getDay(current) as BoatDay) && count < maxIterations) {
    current = addDays(current, direction === 'next' ? 1 : -1);
    count++;
  }
  return current;
}

export interface DayActivity {
  date: string;
  symbol: string;
  color: string;
  textColor?: string;
  label: string;
  function?: string;
}

type SymbolLike = { id?: string; code: string; color: string; label: string; rules?: string; textColor?: string; function?: string };

const normalizeCode = (value: string) => String(value || '').trim().toUpperCase();
const baseCode = (value: string) => normalizeCode(value).replace(/\d+$/, '');
const normalizeColor = (value?: string) => String(value || '').trim().toLowerCase();

function findByFunction(customSymbols: SymbolLike[], fn: string) {
  const needle = fn.trim().toLowerCase();
  return customSymbols.find(s => String((s as any).function || '').trim().toLowerCase() === needle);
}

export function resolveCustomSymbolForCell(
  symbol: string,
  color: string | undefined,
  customSymbols: SymbolLike[],
): SymbolLike | undefined {
  const sym = normalizeCode(symbol);
  const base = baseCode(symbol);
  const c = normalizeColor(color);

  if (sym === 'TV') {
    // Varian TV: merah = Dari Site / Travel Out, biru = Ke Site / Travel In.
    // Kalau color kosong (override tidak menyimpan color lagi), default ke Travel Out.
    if (c === '#1e3a8a' || c === '#1d4ed8') return findByFunction(customSymbols, 'Travel Perjalanan Ke Site');
    return findByFunction(customSymbols, 'Travel Perjalanan Dari Site');
  }
  if (/^X\d*$/i.test(sym)) {
    if (c === '#ffffff' || c === 'transparent' || c === '') return findByFunction(customSymbols, 'Kerja Lapangan');
    if (c === '#000000') return findByFunction(customSymbols, 'Kelebihan Hari Kerja');
  }
  if (/^CE\d*$/i.test(sym)) {
    if (c === '#f97316') return findByFunction(customSymbols, 'Cuti Extra');
    return findByFunction(customSymbols, 'Sisa Cuti Sebelumnya');
  }

  const byCode = customSymbols.find(s => {
    const sc = normalizeCode(s.code || '');
    const scBase = sc.replace(/\d+$/, '');
    return sc === sym || sc === base || scBase === base;
  });
  if (byCode) return byCode;

  const defaultFnByBase: Record<string, string> = {
    CR: 'Cuti Roster', CS: 'Cuti Roster On Site', CT: 'Cuti Tahunan', UIS: 'Ijin on Site',
    UI: 'Ijin', A: 'Alpa', DD: 'Dinas Antar Site', DI: 'Dinas Luar', IK: 'Ijin Khusus',
  };
  return defaultFnByBase[base] ? findByFunction(customSymbols, defaultFnByBase[base]) : undefined;
}

export function safeParse(dateInput: any): Date {
  if (!dateInput) return new Date();
  if (dateInput instanceof Date) return isNaN(dateInput.getTime()) ? new Date() : dateInput;
  if (typeof dateInput !== 'string') return new Date();
  try {
    const parsed = parseISO(dateInput);
    if (!isNaN(parsed.getTime())) return parsed;

    let str = String(dateInput).toLowerCase();
    const indonesianMonths: Record<string, string> = {
      'januari': 'january', 'pebruari': 'february', 'februari': 'february', 'maret': 'march',
      'april': 'april', 'mei': 'may', 'juni': 'june', 'juli': 'july', 'agustus': 'august',
      'september': 'september', 'oktober': 'october', 'nopember': 'november', 'november': 'november',
      'desember': 'december'
    };
    Object.entries(indonesianMonths).forEach(([id, en]) => { str = str.replace(id, en); });

    let fallback = new Date(str);
    if (isNaN(fallback.getTime())) {
      const parts = str.split(/[\s,/-]+/);
      if (parts.length === 3) {
        const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        let day = parseInt(parts[0]);
        let month = months.indexOf(parts[1]);
        let year = parseInt(parts[2]);
        if (month === -1) {
          month = months.indexOf(parts[0]);
          day = parseInt(parts[1]);
        }
        if (month !== -1 && !isNaN(day) && !isNaN(year)) {
          fallback = new Date(year, month, day);
        }
      }
    }

    if (!isNaN(fallback.getTime())) return fallback;
    return new Date();
  } catch (e) {
    return new Date();
  }
}

// Travel days based on POH
function getTravelDays(poh: string): number {
  const p = (poh || '').toUpperCase();
  if (p === 'FLUK') return 0;
  if (p === 'TERNATE') return 2;
  return 4;
}

// Resolve roster work/leave for an employee
function getRoster(employee: Employee): { work: number; leave: number } {
  const grade = employee.rosterType || employee.grade || '5';
  return ROSTER_CONFIG[grade] || ROSTER_CONFIG[grade.replace('Golongan ', '')] || ROSTER_CONFIG['5'];
}

// ----------- MATERIALIZED TIMESHEET (read) -----------
// Pure read: override > leave request > blank. No simulation, no anchors.
export function calculateTimesheet(
  employee: Employee,
  startDate: string,
  endDate: string,
  leaveRequests: Array<{ employeeId?: string; type: string; startDate: string; endDate: string; status: string }>,
  customSymbols: SymbolLike[],
  // Catatan: tipe sengaja dilebarkan via "any-style optional" untuk menerima
  // CustomSymbol penuh tanpa memaksa update signature pemanggil lain.
  overrides: Array<{ employeeId: string; date: string; symbol: string; color?: string }>
): DayActivity[] {
  const result: DayActivity[] = [];
  const start = startOfDay(safeParse(startDate));
  const end = startOfDay(safeParse(endDate));
  const empOverrides = overrides.filter(o => o.employeeId === employee.id);
  const empLeaves = leaveRequests.filter((l: any) =>
    l.status === 'APPROVED' && (!l.employeeId || l.employeeId === employee.id)
  );

  let cur = start;
  while (!isAfter(cur, end)) {
    const dateStr = format(cur, 'yyyy-MM-dd');
    const ov = empOverrides.find(o => o.date === dateStr);
    let activity: DayActivity = { date: dateStr, symbol: '', color: 'transparent', label: '' };

    // Prioritas: APPROVED Leave Request > Manual Override.
    // Simbol akibat leave request yang sudah disetujui Superuser/HR Approver
    // wajib muncul di timesheet meskipun ada override sebelumnya.
    const lrPriority = empLeaves.find(l =>
      !isBefore(cur, safeParse(l.startDate)) && !isAfter(cur, safeParse(l.endDate))
    );

    if (lrPriority) {
      const lrStart = safeParse(lrPriority.startDate);
      const lrEnd = safeParse(lrPriority.endDate);
      const totalDays = Math.round((+startOfDay(lrEnd) - +startOfDay(lrStart)) / 86400000) + 1;
      const dayIdx = Math.round((+cur - +startOfDay(lrStart)) / 86400000) + 1;
      // Mapping prioritas:
      //   1) lrPriority.function → cocokkan ke customSymbol.function (case-insensitive).
      //   2) Fallback lama: cocokkan code (untuk leave request lama tanpa field function).
      const lrFn = ((lrPriority as any).function || '').toString().trim().toLowerCase();
      const baseCodeFromType = (lrPriority.type || '').replace(/\d+$/, '');
      const lookup = baseCodeFromType.toUpperCase();
      let cs: any = lrFn
        ? findByFunction(customSymbols, lrFn)
        : undefined;
      if (!cs) {
        cs = customSymbols.find(s => {
          const sc = (s.code || '').toUpperCase();
          const scBase = sc.replace(/\d+$/, '');
          return sc === lookup || scBase === lookup;
        });
      }
      // Render code: pakai code dari simbol yang cocok (mis. "Ce1"); fallback ke code dari LR.type.
      const renderBase = (cs?.code || baseCodeFromType).replace(/\d+$/, '');
      const numbered = totalDays > 1 ? `${renderBase}${dayIdx}` : renderBase;
      activity = {
        date: dateStr,
        symbol: numbered,
        color: cs?.color || SYMBOL_COLORS[lookup] || '#3b82f6',
        textColor: cs?.textColor,
        label: (lrPriority as any).function || lrPriority.type,
        function: (lrPriority as any).function || cs?.function,
      };
    } else if (ov) {
      const sym = ov.symbol || '';
      const symUpper = sym.toUpperCase();
      const baseSym = symUpper.match(/^[A-Z]+/)?.[0] || symUpper;
      const csOv = resolveCustomSymbolForCell(sym, ov.color, customSymbols);
      const lookupSym = SYMBOL_COLORS[symUpper] ? symUpper : baseSym;
      // Varian multi-warna (TV Out/In, X Kerja/Kelebihan, Ce hijau/oranye)
      // dipilih dari ov.color lama, lalu warna final tetap mengambil Custom
      // Symbol terbaru supaya edit warna langsung tercermin di Timesheet/export.
      const liveColor = csOv?.color;
      const fallbackColor = SYMBOL_COLORS[lookupSym] || 'transparent';
      // KHUSUS TV: warna WAJIB mengikuti function (Dari Site/Out=merah, Ke Site/In=biru)
      // supaya arah travel tidak bisa terbalik gara-gara user mengedit warna
      // custom symbol TV di Settings.
      let finalColor: string = liveColor ?? ov.color ?? fallbackColor;
      if (symUpper === 'TV') {
        const fnLower = String(csOv?.function || '').toLowerCase();
        if (fnLower === 'travel perjalanan ke site') finalColor = '#1e3a8a';
        else finalColor = '#dc2626';
      }
      activity = {
        date: dateStr,
        symbol: sym,
        color: finalColor,
        textColor: csOv?.textColor,
        label: 'Manual Override',
        function: csOv?.function,
      };
    }

    result.push(activity);
    cur = addDays(cur, 1);
  }

  return result;
}

// ----------- CYCLE GENERATORS (write) -----------

interface Slot {
  symbol: string;
  color: string;
}

// Build one full cycle template starting either with leave (Cr1) or work (X1).
function buildTemplate(
  workDays: number,
  leaveDays: number,
  travelDays: number,
  startWith: 'leave' | 'work'
): Slot[] {
  const tvOut = Math.floor(travelDays / 2);
  const tvIn = travelDays - tvOut;

  const work: Slot[] = Array.from({ length: workDays }, (_, i) => ({
    symbol: `X${i + 1}`, color: 'transparent',
  }));
  const leave: Slot[] = Array.from({ length: leaveDays }, (_, i) => ({
    symbol: `Cr${i + 1}`, color: '#bbf7d0',
  }));
  const out: Slot[] = Array.from({ length: tvOut }, () => ({
    symbol: 'TV', color: '#dc2626',
  }));
  const inT: Slot[] = Array.from({ length: tvIn }, () => ({
    symbol: 'TV', color: '#1e3a8a',
  }));

  // Cycle order around a roster:  Work -> TVout -> Leave -> TVin -> Work ...
  // Starting at Cr1: TVout -> Leave -> TVin -> Work
  // Starting at X1 : Work -> TVout -> Leave -> TVin
  if (startWith === 'leave') return [...out, ...leave, ...inT, ...work];
  return [...work, ...out, ...leave, ...inT];
}

interface GenerateOpts {
  employee: Employee;
  startDate: string;        // 'yyyy-MM-dd'
  endDate: string;          // 'yyyy-MM-dd' inclusive
  startWith: 'leave' | 'work';
  workDaysOverride?: number; // for explicit 42/49/56/63/70/84 buttons
  existingOverrides: ManualOverride[]; // ALL overrides (filtered inside)
  overwrite: boolean;       // true = overwrite existing, false = skip & pause pointer
}

export function generateCycle(opts: GenerateOpts): ManualOverride[] {
  const { employee, startDate, endDate, startWith, workDaysOverride, existingOverrides, overwrite } = opts;
  const roster = getRoster(employee);
  const work = workDaysOverride ?? roster.work;
  const leave = roster.leave;
  const travel = getTravelDays(employee.poh || '');
  const template = buildTemplate(work, leave, travel, startWith);
  if (template.length === 0) return [];

  const empOverrides = existingOverrides.filter(o => o.employeeId === employee.id);
  const overrideMap = new Map(empOverrides.map(o => [o.date, o]));

  const start = startOfDay(safeParse(startDate));
  const end = startOfDay(safeParse(endDate));
  const out: ManualOverride[] = [];
  let pointer = 0;
  let cur = start;
  while (!isAfter(cur, end)) {
    const dateStr = format(cur, 'yyyy-MM-dd');
    const existing = overrideMap.get(dateStr);
    if (existing && !overwrite) {
      // Skip: keep manual entry, do not advance pattern pointer (acts as a pause).
    } else {
      const slot = template[pointer % template.length];
      out.push({
        employeeId: employee.id,
        date: dateStr,
        symbol: slot.symbol,
        color: slot.color,
      });
      pointer++;
    }
    cur = addDays(cur, 1);
  }
  return out;
}

// Generate Extra Work (X1, X2, ...) starting from a date until the next TV-out
// (red) is reached, or up to a horizon. Uses materialized overrides only.
export function generateExtraWork(
  employee: Employee,
  startDate: string,
  endDate: string,
  existingOverrides: ManualOverride[]
): ManualOverride[] {
  const empOverrides = existingOverrides.filter(o => o.employeeId === employee.id);
  const overrideMap = new Map(empOverrides.map(o => [o.date, o]));
  const start = startOfDay(safeParse(startDate));
  const end = startOfDay(safeParse(endDate));

  const out: ManualOverride[] = [];
  let counter = 1;
  let cur = start;
  while (!isAfter(cur, end)) {
    const dateStr = format(cur, 'yyyy-MM-dd');
    const existing = overrideMap.get(dateStr);
    // Stop ketika ketemu TV (untuk POH yang punya travel days) ATAU Cr*
    // (untuk POH Fluk yang tidak punya TV — langsung masuk Cuti Roster).
    // Ekstra Kerja dimaksudkan untuk mengisi gap sampai sebelum travel/cuti.
    if (existing) {
      const sym = String(existing.symbol).toUpperCase();
      if (sym === 'TV' || sym.startsWith('CR')) break;
    }
    out.push({
      employeeId: employee.id,
      date: dateStr,
      symbol: `X${counter}`,
      color: '#000000',
    });
    counter++;
    cur = addDays(cur, 1);
  }
  return out;
}

// ----------- COLORS -----------

const C = {
  darkGreen: '#006400',
  lightGreen: '#bbf7d0',
  black: '#000000',
  pink: '#ec4899',
  red: '#ef4444',
  lightBlue: '#93c5fd',
  olive: '#a3a300',
  darkBlue: '#1e3a8a',
};

export const SYMBOL_COLORS: Record<string, string> = {
  XP: C.darkGreen,
  CR: C.lightGreen,
  CS: C.lightGreen,
  CT: C.black,
  X: C.black,
  XS: C.black,
  TS: C.pink,
  UIS: C.pink,
  II: C.pink,
  KL: C.pink,
  TV: C.red,
  A: C.red,
  CI: C.lightBlue,
  IS: C.lightBlue,
  CX: C.lightBlue,
  UI: C.lightBlue,
  KS: C.lightBlue,
  SS: C.lightBlue,
  CE: C.darkGreen,
  TT: C.darkBlue,
  DD: C.darkBlue,
  DI: C.darkBlue,
  BP: C.darkBlue,
  IK: C.darkBlue,
  SI: C.darkBlue,
};
