import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useApp } from '../AppContext';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  addMonths, 
  addDays,
  subMonths,
  isSameMonth,
  isToday,
  startOfYear,
  parseISO,
  differenceInMonths
} from 'date-fns';
import { ChevronLeft, ChevronRight, Printer, Info, X, Upload, Trash2, Download, ChevronDown, ArrowDownAZ, ArrowUpAZ, Undo2, Redo2, Lock, Unlock } from 'lucide-react';
import type { ManualOverride } from '../types';
import { calculateTimesheet, safeParse, generateCycle, generateExtraWork, resolveCustomSymbolForCell } from '../lib/roster';
import { exportPdf, exportThemedExcel, exportThemedExcelAll, exportThemedExcelOneAll, exportRawExcel, exportCompareExcel } from '../lib/timesheetExport';
import { importThemedExcel, importThemedExcelAll, importRawExcelOne, importRawExcelAll, importCompareExcel } from '../lib/timesheetImport';

function SyncedScrollGrid({ minWidth, children }: { minWidth: number; children: React.ReactNode }) {
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const onTop = () => {
    if (lock.current || !bottomRef.current || !topRef.current) return;
    lock.current = true;
    bottomRef.current.scrollLeft = topRef.current.scrollLeft;
    requestAnimationFrame(() => { lock.current = false; });
  };
  const onBottom = () => {
    if (lock.current || !bottomRef.current || !topRef.current) return;
    lock.current = true;
    topRef.current.scrollLeft = bottomRef.current.scrollLeft;
    requestAnimationFrame(() => { lock.current = false; });
  };
  return (
    <div className="shadow-xl border border-gray-200 bg-white relative">
      <div ref={topRef} onScroll={onTop} className="overflow-x-auto sticky top-0 z-40 bg-white border-b border-gray-100" style={{ height: 14 }}>
        <div style={{ width: minWidth, height: 1 }} />
      </div>
      <div ref={bottomRef} onScroll={onBottom} className="data-grid-container no-scrollbar overflow-x-auto relative">
        <div style={{ minWidth }}>{children}</div>
      </div>
    </div>
  );
}

export default function TimesheetView() {
  const { 
    user, 
    employees, 
    leaveRequests, 
    customSymbols, 
    overrides, 
    setManualOverride, 
    setManualOverridesBulk,
    removeManualOverride, 
    removeManualOverridesBulk,
    replaceAllOverrides,
    importTimesheet, 
    updateEmployee,
    autoCalc,
    setAutoCalc,
    verifySuperuserPassword,
    exportMonthsBack,
    exportMonthsAhead,
    cellNotes,
    setCellNote,
    removeCellNote,
  } = useApp();
  const canManage = user?.role === 'ADMIN' || user?.role === 'SUPERUSER' || user?.role === 'APPROVAL_HR';
  const canToggleAutoCalc = user?.role === 'SUPERUSER' || user?.role === 'APPROVAL_HR';
  const canCompare = user?.role === 'ADMIN' || user?.role === 'SUPERUSER';
  // ADMIN hanya bisa mengedit setelah memasukkan password Superuser sekali per sesi.
  // SUPERUSER & APPROVAL_HR selalu bisa edit. Role lain mengikuti canManage.
  const [adminEditUnlocked, setAdminEditUnlocked] = useState(false);
  const [showAdminUnlock, setShowAdminUnlock] = useState(false);
  const [adminUnlockPwd, setAdminUnlockPwd] = useState('');
  const [adminUnlockErr, setAdminUnlockErr] = useState('');
  const canEdit = user?.role === 'SUPERUSER' || user?.role === 'APPROVAL_HR'
    || (user?.role === 'ADMIN' && adminEditUnlocked);
  const [targetYear, setTargetYear] = useState(new Date().getFullYear());
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(user?.id);
  const [filterDept, setFilterDept] = useState('ALL');
  const [filterGrades, setFilterGrades] = useState<string[]>([]);
  const [compareView, setCompareView] = useState(false);
  const [filterPositions, setFilterPositions] = useState<string[]>([]);
  const [sortPositionAsc, setSortPositionAsc] = useState<boolean>(false);
  const [openMenu, setOpenMenu] = useState<null | 'grade' | 'position'>(null);
  const [personnelSearch, setPersonnelSearch] = useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const departments = useMemo(() => {
    const s = new Set<string>();
    employees.forEach(e => { if (e.department) s.add(e.department); });
    return Array.from(s).sort();
  }, [employees]);

  const compareDept = user?.role === 'ADMIN'
    ? (user.department || '')
    : (filterDept && filterDept !== 'ALL' ? filterDept : (user?.department || departments[0] || ''));

  const normGrade = (g?: string) =>
    (g || '').trim().toUpperCase().replace(/^GOLONGAN\s+/, '');

  const gradeMatches = (e: any) =>
    filterGrades.length === 0 || filterGrades.includes(normGrade(e.grade));
  const positionMatches = (e: any) =>
    filterPositions.length === 0 || filterPositions.includes(e.position || '');

  // Role-based employee scope
  const scopedEmployees = useMemo(() => {
    if (!user) return employees;
    if (user.role === 'REGULAR' || user.role === 'APPROVAL') return employees.filter(e => e.id === user.id);
    if (user.role === 'ADMIN') return employees.filter(e => e.department === user.department);
    return employees; // APPROVAL_HR & SUPERUSER → all
  }, [employees, user]);

  const grades = useMemo(() => {
    const s = new Set<string>();
    scopedEmployees.forEach(e => { const n = normGrade(e.grade); if (n) s.add(n); });
    return Array.from(s).sort();
  }, [scopedEmployees]);

  const filteredEmployees = useMemo(() => scopedEmployees
    .filter(e => {
      if (filterDept !== 'ALL' && e.department !== filterDept) return false;
      if (!gradeMatches(e)) return false;
      return true;
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
  [scopedEmployees, filterDept, filterGrades]);

  const personnelOptions = useMemo(() => {
    const q = personnelSearch.trim().toLowerCase();
    if (!q) return filteredEmployees;
    return filteredEmployees.filter(e =>
      (e.name || '').toLowerCase().includes(q) ||
      (e.nik || '').toLowerCase().includes(q)
    );
  }, [filteredEmployees, personnelSearch]);

  const selectedEmployee = useMemo(() => 
    employees.find(e => e.id === selectedEmployeeId) || user
  , [employees, selectedEmployeeId, user]);

  // Auto-select first filtered employee if current selection is filtered out
  useEffect(() => {
    if (filteredEmployees.length === 0) return;
    if (!filteredEmployees.some(e => e.id === selectedEmployeeId)) {
      setSelectedEmployeeId(filteredEmployees[0].id);
    }
  }, [filteredEmployees, selectedEmployeeId]);

  const [editingCell, setEditingCell] = useState<{ date: string; symbol: string } | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>('');
  useEffect(() => {
    if (editingCell && selectedEmployee) {
      const existing = cellNotes.find(n => n.employeeId === selectedEmployee.id && n.date === editingCell.date);
      setNoteDraft(existing?.text || '');
    } else {
      setNoteDraft('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingCell]);
  const [deleteSelectionStart, setDeleteSelectionStart] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [customColor, setCustomColor] = useState('#3b82f6');
  const customSymbolRef = React.useRef<HTMLInputElement>(null);
  const [rangeMode, setRangeMode] = useState<{ prefix: string; color: string; textColor: string; withNumber: boolean; displayColor?: string } | null>(null);
  const [rangeValue, setRangeValue] = useState('');
  const [hiddenFrequents, setHiddenFrequents] = useState<Set<string>>(new Set());
  const [exportMenu, setExportMenu] = useState<null | 'root' | 'excel'>(null);
  const [importMenu, setImportMenu] = useState<null | 'root' | 'this'>(null);
  const importPickerRef = React.useRef<{ kind: 'themed' | 'themedAll' | 'rawOne' | 'rawAll' | 'compare' } | null>(null);

  // ---- Undo / Redo for overrides ----
  // Pakai ref untuk stack supaya tidak race dengan setState dan effect-batching.
  // State terpisah cuma menyimpan panjang stack supaya tombol disabled re-render.
  const undoRef = useRef<ManualOverride[][]>([]);
  const redoRef = useRef<ManualOverride[][]>([]);
  const lastSeenRef = useRef<ManualOverride[]>(overrides);
  const skipHistoryRef = useRef(false);
  const [historyTick, setHistoryTick] = useState(0);
  const bumpHistory = () => setHistoryTick(t => t + 1);

  useEffect(() => {
    if (lastSeenRef.current === overrides) return;
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
    } else {
      const ns = [...undoRef.current, lastSeenRef.current];
      undoRef.current = ns.length > 50 ? ns.slice(ns.length - 50) : ns;
      redoRef.current = [];
      bumpHistory();
    }
    lastSeenRef.current = overrides;
  }, [overrides]);

  const undoStackLen = undoRef.current.length;
  const redoStackLen = redoRef.current.length;
  // historyTick dipakai sebagai trigger render — dereferensi supaya linter tidak komplain
  void historyTick;

  const doUndo = () => {
    if (undoRef.current.length === 0) return;
    const prev = undoRef.current[undoRef.current.length - 1];
    undoRef.current = undoRef.current.slice(0, -1);
    redoRef.current = [...redoRef.current, lastSeenRef.current];
    skipHistoryRef.current = true;
    lastSeenRef.current = prev;
    replaceAllOverrides(prev);
    bumpHistory();
  };
  const doRedo = () => {
    if (redoRef.current.length === 0) return;
    const next = redoRef.current[redoRef.current.length - 1];
    redoRef.current = redoRef.current.slice(0, -1);
    undoRef.current = [...undoRef.current, lastSeenRef.current];
    skipHistoryRef.current = true;
    lastSeenRef.current = next;
    replaceAllOverrides(next);
    bumpHistory();
  };

  // ---- Clear menu + superuser password gate ----
  const [clearMenu, setClearMenu] = useState(false);
  const [pwdPrompt, setPwdPrompt] = useState<null | { kind: 'thisAll' | 'deptYear' }>(null);
  const [pwdInput, setPwdInput] = useState('');
  const [pwdError, setPwdError] = useState('');
  const verifySuperPwd = (p: string) => verifySuperuserPassword(p);

  const triggerImport = (kind: 'themed' | 'themedAll' | 'rawOne' | 'rawAll' | 'compare') => {
    importPickerRef.current = { kind };
    fileInputRef.current?.click();
    setImportMenu(null);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !importPickerRef.current || !selectedEmployee) return;
    const kind = importPickerRef.current.kind;
    importPickerRef.current = null;
    try {
      let news: any[] = [];
      if (kind === 'themed') news = await importThemedExcel(f, selectedEmployee.id);
      else if (kind === 'themedAll') news = await importThemedExcelAll(f, employees);
      else if (kind === 'rawOne') news = await importRawExcelOne(f, selectedEmployee);
      else if (kind === 'rawAll') news = await importRawExcelAll(f, employees);
      else news = await importCompareExcel(f, employees, targetYear);
      if (news.length > 0) setManualOverridesBulk(news);
      alert(`Import selesai: ${news.length} entri.`);
    } catch (err: any) {
      alert(`Gagal import: ${err?.message || err}`);
    }
  };

  const exportCtx = () => ({
    employees, overrides, leaveRequests, customSymbols,
    selectedEmployee: selectedEmployee!, year: targetYear,
    monthsBack: exportMonthsBack, monthsAhead: exportMonthsAhead,
  });
  const doExport = (kind: 'pdf' | 'themed' | 'themedOneAll' | 'themedAll' | 'raw' | 'compare') => {
    if (!selectedEmployee) return;
    if (kind === 'pdf') exportPdf(exportCtx());
    else if (kind === 'themed') exportThemedExcel(exportCtx());
    else if (kind === 'themedOneAll') exportThemedExcelOneAll(exportCtx());
    else if (kind === 'themedAll') {
      const list = user?.role === 'ADMIN'
        ? employees.filter(e => e.department === user.department)
        : employees;
      exportThemedExcelAll(exportCtx(), list);
    }
    else if (kind === 'raw') {
      const list = user?.role === 'ADMIN'
        ? employees.filter(e => e.department === user.department)
        : employees;
      exportRawExcel(exportCtx(), list);
    }
    else {
      const dept = compareDept || user?.department || departments[0] || '';
      const list = scopedEmployees.filter(e =>
        e.department === dept &&
        gradeMatches(e) &&
        positionMatches(e)
      );
      exportCompareExcel(exportCtx(), list, dept);
    }
    setExportMenu(null);
  };

  const applyRange = () => {
    if (!editingCell || !selectedEmployee || !rangeMode) return;
    const trimmed = rangeValue.trim();
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    const singleMatch = trimmed.match(/^(\d+)$/);
    const startDate = safeParse(editingCell.date);

    const storedRangeColor = rangeMode.color;

    if (rangeMode.withNumber) {
      if (rangeMatch) {
        const aN = parseInt(rangeMatch[1]);
        const bN = parseInt(rangeMatch[2]);
        const news = [];
        if (aN <= bN) {
          // Ascending: tanggal awal = aN, ke depan.
          for (let i = 0; i <= bN - aN; i++) {
            news.push({
              employeeId: selectedEmployee.id,
              date: format(addDays(startDate, i), 'yyyy-MM-dd'),
              symbol: `${rangeMode.prefix}${aN + i}`,
              color: storedRangeColor,
            });
          }
        } else {
          // Descending: tanggal awal = aN, lalu mundur ke hari sebelumnya.
          for (let i = 0; i <= aN - bN; i++) {
            news.push({
              employeeId: selectedEmployee.id,
              date: format(addDays(startDate, -i), 'yyyy-MM-dd'),
              symbol: `${rangeMode.prefix}${aN - i}`,
              color: storedRangeColor,
            });
          }
        }
        if (news.length > 0) setManualOverridesBulk(news);
      } else if (singleMatch) {
        setManualOverride({
          employeeId: selectedEmployee.id,
          date: editingCell.date,
          symbol: `${rangeMode.prefix}${singleMatch[1]}`,
          color: storedRangeColor,
        });
      } else {
        // Default: nilai 1
        setManualOverride({
          employeeId: selectedEmployee.id,
          date: editingCell.date,
          symbol: `${rangeMode.prefix}1`,
          color: storedRangeColor,
        });
      }
    } else {
      // Symbol tanpa angka: input menentukan jumlah hari berurutan
      let count = 1;
      if (rangeMatch) {
        count = Math.abs(parseInt(rangeMatch[2]) - parseInt(rangeMatch[1])) + 1;
      } else if (singleMatch) {
        count = parseInt(singleMatch[1]);
      }
      // Default count = 1 jika input kosong
      const news = [];
      for (let i = 0; i < count; i++) {
        news.push({
          employeeId: selectedEmployee.id,
          date: format(addDays(startDate, i), 'yyyy-MM-dd'),
          symbol: rangeMode.prefix,
            color: storedRangeColor,
        });
      }
      if (news.length > 0) setManualOverridesBulk(news);
    }

    setRangeMode(null);
    setRangeValue('');
    setEditingCell(null);
  };

  const readableTextColor = (bg?: string) => {
    const raw = String(bg || '').trim();
    if (!raw || raw === 'transparent') return 'black';
    const hex = raw.replace('#', '');
    if (hex.length < 6) return 'black';
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? 'black' : 'white';
  };

  // Daftar simbol resmi sesuai legenda
  const SYMBOL_BUTTONS: Array<{ s: string; color: string; fg: string; withNumber: boolean; label?: string }> = [
    // Kolom 1
    { s: 'XP',  color: '#15803d', fg: 'white', withNumber: false },
    { s: 'Cr',  color: '#bbf7d0', fg: 'black', withNumber: true },
    { s: 'Cs',  color: '#fa8072', fg: 'black', withNumber: true },
    { s: 'Ct',  color: '#000000', fg: 'white', withNumber: true },
    { s: 'TS',  color: '#ec4899', fg: 'white', withNumber: false },
    { s: 'UIs', color: '#ec4899', fg: 'white', withNumber: true },
    { s: 'II',  color: '#ec4899', fg: 'white', withNumber: false },
    { s: 'KL',  color: '#ec4899', fg: 'white', withNumber: false },
    { s: 'TV',  color: '#dc2626', fg: 'white', withNumber: false, label: 'Out' },
    // Kolom 2
    { s: 'CI',  color: '#93c5fd', fg: 'black', withNumber: true },
    { s: 'IS',  color: '#93c5fd', fg: 'black', withNumber: true },
    { s: 'Ce',  color: '#15803d', fg: 'white', withNumber: true },
    { s: 'Ce', color: '#f97316', fg: 'black', withNumber: true, label: 'Extra Cuti' },
    { s: 'X',   color: '#000000', fg: 'white', withNumber: true },
    { s: 'Cx',  color: '#93c5fd', fg: 'black', withNumber: false },
    { s: 'UI',  color: '#93c5fd', fg: 'black', withNumber: true },
    { s: 'KS',  color: '#93c5fd', fg: 'black', withNumber: false },
    { s: 'SS',  color: '#93c5fd', fg: 'black', withNumber: false },
    // Kolom 3
    { s: 'XS',  color: '#000000', fg: 'white', withNumber: false },
    { s: 'X',   color: '#ffffff', fg: 'black', withNumber: true, label: 'Kerja' },
    { s: 'A',   color: '#ef4444', fg: 'white', withNumber: true },
    { s: 'DD',  color: '#1e3a8a', fg: 'white', withNumber: true },
    { s: 'DI',  color: '#1e3a8a', fg: 'white', withNumber: true },
    { s: 'BP',  color: '#1e3a8a', fg: 'white', withNumber: false },
    { s: 'IK',  color: '#1e3a8a', fg: 'white', withNumber: true },
    { s: 'TT',  color: '#1e3a8a', fg: 'white', withNumber: false },
    { s: 'TV',  color: '#1e3a8a', fg: 'white', withNumber: false, label: 'In' },
    { s: 'SI',  color: '#1e3a8a', fg: 'white', withNumber: false },
  ];

  const deleteSymbolEverywhere = (symbol: string) => {
    if (!selectedEmployee) return;
    const dates = overrides
      .filter(o => o.employeeId === selectedEmployee.id && o.symbol.toUpperCase() === symbol.toUpperCase())
      .map(o => o.date);
    if (dates.length > 0) removeManualOverridesBulk(selectedEmployee.id, dates);
  };

  const frequentSymbols = useMemo(() => {
    if (!selectedEmployee) return [];
    const standard = ['XP', 'TT', 'TV', 'X1', 'X2', 'X3', 'L1', 'L2', 'OFF', 'CR1', 'CR'];
    const fromOverrides = overrides
      .filter(o => o.employeeId === selectedEmployee.id)
      .map(o => String(o.symbol ?? '').toUpperCase())
      .filter(Boolean);
    
    const fromCustoms = customSymbols.map(s => String(s.code ?? '').toUpperCase()).filter(Boolean);
    
    return Array.from(new Set([...fromOverrides, ...fromCustoms]))
      .filter(s => {
        if (standard.includes(s) || s === '') return false;
        if (s === '__BLANK__' || /^__SKIP\d+__$/.test(s)) return false;
        // Don't show roster counters (X1, X2, etc) or Leave counters (Cr1, Cr2, etc) in frequent symbols
        if (/^X\d+$/i.test(s)) return false;
        if (/^CR\d+$/i.test(s)) return false;
        return true;
      })
      .filter(s => !hiddenFrequents.has(s))
      .slice(0, 12);
  }, [overrides, selectedEmployee, customSymbols, hiddenFrequents]);

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      importTimesheet(e.target.files[0]);
    }
  };

  const handleCellClick = (date: string, symbol: string) => {
    if (!selectedEmployee) return;
    if (!canEdit) return;

    if (deleteSelectionStart) {
      if (deleteSelectionStart === date) {
        setDeleteSelectionStart(null);
        return;
      }
      const start = safeParse(deleteSelectionStart);
      const end = safeParse(date);
      const [d1, d2] = start <= end ? [start, end] : [end, start];

      const dayRange = eachDayOfInterval({ start: d1, end: d2 });
      const dateStrings = dayRange.map(d => format(d, 'yyyy-MM-dd'));

      // Materialized: just remove the overrides — cells become truly empty.
      removeManualOverridesBulk(selectedEmployee.id, dateStrings);
      setDeleteSelectionStart(null);
      return;
    }

    setEditingCell({ date, symbol });
  };

  const applyOverride = (symbol: string, color?: string) => {
    if (!editingCell || !selectedEmployee) return;

    if (symbol === '') {
      // Materialized: empty = remove the cell entirely.
      removeManualOverride(selectedEmployee.id, editingCell.date);
    } else {
      // Cek rule custom symbol (jika ada)
      const csList = customSymbols.filter(c => c.code.toUpperCase() === symbol.toUpperCase());
      const cs = csList[0];
      const rule = (cs?.rules || 'Replace').toLowerCase();
      // Kalau simbol terdaftar di Custom Symbol dan UNIK (tidak punya varian),
      // jangan simpan color — warna dirender live dari Custom Symbol terbaru.
      // Tapi untuk simbol multi-varian seperti TV (Out merah / In biru),
      // Ce (hijau / oranye), X (kerja putih / kelebihan hitam), color WAJIB
      // disimpan supaya varian tidak hilang.
      const hasVariants = csList.length > 1;
      const storedColor = cs && !hasVariants ? undefined : color;
      if (rule === 'substitute' || rule === 'subtitute') {
        // Substitute: geser simbol existing ke kanan, tidak boleh menimpa apapun
        applySubstituteShift(selectedEmployee.id, editingCell.date, { symbol, color: storedColor });
      } else {
        setManualOverride({
          employeeId: selectedEmployee.id,
          date: editingCell.date,
          symbol,
          color: storedColor,
        });
      }
    }
    setEditingCell(null);
  };

  // Geser semua override yang ada mulai `date` satu hari ke kanan secara
  // berantai sampai menemukan slot kosong, lalu sisipkan simbol baru di
  // posisi `date`. Tidak ada simbol yang ditimpa/dihilangkan.
  const applySubstituteShift = (
    employeeId: string,
    date: string,
    inserted: { symbol: string; color?: string }
  ) => {
    const empOv = overrides
      .filter(o => o.employeeId === employeeId)
      .reduce<Record<string, ManualOverride>>((m, o) => { m[o.date] = o; return m; }, {});
    // Kumpulkan rantai berurutan mulai dari tanggal target
    const chain: ManualOverride[] = [];
    let cur = safeParse(date);
    while (empOv[format(cur, 'yyyy-MM-dd')]) {
      chain.push(empOv[format(cur, 'yyyy-MM-dd')]);
      cur = addDays(cur, 1);
    }
    // Geser semua isi chain satu hari ke kanan
    const shifted: ManualOverride[] = chain.map((o, idx) => ({
      ...o,
      date: format(addDays(safeParse(date), idx + 1), 'yyyy-MM-dd'),
    }));
    // Sisipkan simbol baru di tanggal awal
    shifted.unshift({
      employeeId,
      date,
      symbol: inserted.symbol,
      color: inserted.color,
    });
    setManualOverridesBulk(shifted);
  };

  const months = useMemo(() => {
    const yearStart = startOfYear(new Date(targetYear, 0, 1));
    return Array.from({ length: 12 }, (_, i) => addMonths(yearStart, i));
  }, [targetYear]);

  const extraLeaveInfo = useMemo(() => {
    if (!selectedEmployee) return { earned: 0, extraWorkDays: 0, usedExtra: 0, usedAnnual: 0, annualEntitlement: 0 };

    const yearStart = startOfYear(new Date(targetYear, 0, 1));
    const yearEnd = endOfMonth(addMonths(yearStart, 11));
    const yStart = format(yearStart, 'yyyy-MM-dd');
    const yEnd = format(yearEnd, 'yyyy-MM-dd');

    const empOverrides = overrides.filter(o => o.employeeId === selectedEmployee.id);

    // Extra Work = X{n} with black color (manually added via Ekstra Kerja)
    const extraWorkDays = empOverrides.filter(o =>
      o.date >= yStart && o.date <= yEnd &&
      /^X\d+$/i.test(o.symbol) && o.color === '#000000'
    ).length;

    const usedExtra = empOverrides.filter(o =>
      o.date >= yStart && o.date <= yEnd &&
      o.symbol.toUpperCase().startsWith('CE')
    ).length;

    let usedAnnual = 0;
    let annualEntitlement = 0;

    const joinSrc = selectedEmployee.joinDateLatest || selectedEmployee.joinDate;
    if (joinSrc) {
      const join = safeParse(joinSrc);
      const now = new Date();
      const monthsWorked = differenceInMonths(now, join);

      if (monthsWorked >= 12) {
        annualEntitlement = 12;
        let lastAnniversary = new Date(join);
        lastAnniversary.setFullYear(now.getFullYear());
        if (lastAnniversary > now) lastAnniversary.setFullYear(now.getFullYear() - 1);

        usedAnnual = empOverrides.filter(o => {
          if (!o.symbol.toUpperCase().startsWith('CT')) return false;
          const dDate = safeParse(o.date);
          return dDate >= lastAnniversary;
        }).length;
      }
    }

    // Divisor: Gol I or jabatan mengandung "admin" = 5; II/III = 4; IV = 3.5; V/VI = 3
    let divisor = 3;
    const g = (selectedEmployee.grade || '').trim();
    const pos = (selectedEmployee.position || '').toLowerCase();
    if (pos.includes('admin') || /^(I|1|Golongan\s*I|Golongan\s*1|Grade\s*1)$/i.test(g)) divisor = 5;
    else if (/^(II|III|2|3|Golongan\s*II|Golongan\s*III|Golongan\s*2|Golongan\s*3)$/i.test(g)) divisor = 4;
    else if (/^(IV|4|Golongan\s*IV|Golongan\s*4)$/i.test(g)) divisor = 3.5;
    else divisor = 3;

    const raw = extraWorkDays / divisor;
    const floor = Math.floor(raw);
    const decimal = raw - floor;
    // <=0.5 dibulatkan ke bawah, >0.5 dibulatkan ke atas
    const earned = decimal > 0.5 ? floor + 1 : floor;

    return { earned, extraWorkDays, usedExtra, usedAnnual, annualEntitlement };
  }, [selectedEmployee, targetYear, overrides]);

  // Generate a leave cycle (Cr1 first) starting from the editing cell, until end of selected year.
  const startLeaveCycle = () => {
    if (!editingCell || !selectedEmployee) return;
    const yearEnd = format(endOfMonth(addMonths(startOfYear(new Date(targetYear + 2, 0, 1)), 11)), 'yyyy-MM-dd');
    const newOverrides = generateCycle({
      employee: selectedEmployee,
      startDate: editingCell.date,
      endDate: yearEnd,
      startWith: 'leave',
      existingOverrides: overrides,
      overwrite: true,
    });
    if (newOverrides.length > 0) setManualOverridesBulk(newOverrides);
    setEditingCell(null);
  };

  // Generate hanya 1 siklus cuti (TVout + Cr1..CrN + TVin) — tidak berulang.
  const startLeaveDayOnce = () => {
    if (!editingCell || !selectedEmployee) return;
    // Hitung panjang satu periode cuti: travel/2 (out) + leaveDays + (travel - travel/2) (in)
    const grade = selectedEmployee.rosterType || selectedEmployee.grade || '5';
    const ROSTER: Record<string, { work: number; leave: number }> = {
      '1':{work:70,leave:14},'I':{work:70,leave:14},'2':{work:56,leave:14},'II':{work:56,leave:14},
      '3':{work:56,leave:14},'III':{work:56,leave:14},'4':{work:49,leave:14},'IV':{work:49,leave:14},
      '5':{work:42,leave:14},'V':{work:42,leave:14},'6':{work:42,leave:14},'VI':{work:42,leave:14},
    };
    const cfg = ROSTER[grade] || ROSTER[grade.replace('Golongan ','')] || { work: 42, leave: 14 };
    const poh = (selectedEmployee.poh || '').toUpperCase();
    const travel = poh === 'FLUK' ? 0 : poh === 'TERNATE' ? 2 : 4;
    const oneCycleDays = travel + cfg.leave; // hanya periode cuti+travel, tidak termasuk hari kerja
    const endDate = format(addDays(safeParse(editingCell.date), oneCycleDays - 1), 'yyyy-MM-dd');
    const newOverrides = generateCycle({
      employee: selectedEmployee,
      startDate: editingCell.date,
      endDate,
      startWith: 'leave',
      existingOverrides: overrides,
      overwrite: true,
    });
    if (newOverrides.length > 0) setManualOverridesBulk(newOverrides);
    setEditingCell(null);
  };

  // Two modes per work-day button:
  //   'auto'  → siklus berulang lengkap (kerja + cuti + travel) hingga akhir tahun (perilaku lama)
  //   'plain' → hanya isi X1..Xn (n = workDays) latar putih, font hitam — tanpa siklus cuti
  const [workCyclePrompt, setWorkCyclePrompt] = useState<number | null>(null);
  const startWorkCycle = (workDays: number, mode: 'auto' | 'plain' = 'auto') => {
    if (!editingCell || !selectedEmployee) return;
    if (mode === 'plain') {
      const start = safeParse(editingCell.date);
      const news: ManualOverride[] = [];
      for (let i = 0; i < workDays; i++) {
        news.push({
          employeeId: selectedEmployee.id,
          date: format(addDays(start, i), 'yyyy-MM-dd'),
          symbol: `X${i + 1}`,
          color: '#ffffff',
        });
      }
      if (news.length > 0) setManualOverridesBulk(news);
      setEditingCell(null);
      setWorkCyclePrompt(null);
      return;
    }
    const yearEnd = format(endOfMonth(addMonths(startOfYear(new Date(targetYear + 2, 0, 1)), 11)), 'yyyy-MM-dd');
    const newOverrides = generateCycle({
      employee: { ...selectedEmployee, rosterType: workDays.toString() },
      startDate: editingCell.date,
      endDate: yearEnd,
      startWith: 'work',
      workDaysOverride: workDays,
      existingOverrides: overrides,
      overwrite: true,
    });
    if (selectedEmployee.rosterType !== workDays.toString()) {
      updateEmployee({ ...selectedEmployee, rosterType: workDays.toString() });
    }
    if (newOverrides.length > 0) setManualOverridesBulk(newOverrides);
    setEditingCell(null);
    setWorkCyclePrompt(null);
  };

  const bulkAddExtraWorkUntilTV = () => {
    if (!editingCell || !selectedEmployee) return;
    const yearEnd = format(endOfMonth(addMonths(startOfYear(new Date(targetYear + 2, 0, 1)), 11)), 'yyyy-MM-dd');
    const newOverrides = generateExtraWork(selectedEmployee, editingCell.date, yearEnd, overrides);
    if (newOverrides.length > 0) setManualOverridesBulk(newOverrides);
    setEditingCell(null);
  };

  const annualLeaveDefault = useMemo(() => {
    if (!selectedEmployee || !selectedEmployee.joinDate) return 0;
    try {
      const join = safeParse(selectedEmployee.joinDate);
      const now = new Date();
      // Tenure check: must be at least 12 months
      const monthsWorked = differenceInMonths(now, join);
      return monthsWorked >= 12 ? 12 : 0;
    } catch {
      return 0;
    }
  }, [selectedEmployee]);

  const timesheetLegendItems = useMemo(() => customSymbols.map(s => ({
    id: s.id,
    code: s.code,
    bg: s.color || 'transparent',
    fg: s.textColor || readableTextColor(s.color),
    label: s.label,
  })), [customSymbols]);

  if (!selectedEmployee) return null;

  return (
    <div className="space-y-6">
      {/* Manual Edit Popover */}
      {editingCell && (
        <div 
          className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] sm:p-4"
          onClick={() => { setEditingCell(null); setRangeMode(null); setRangeValue(''); }}
        >
          <div 
            className="bg-white p-4 sm:p-6 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-200 w-full max-w-sm max-h-[90vh] sm:max-h-[85vh] overflow-y-auto animate-in fade-in zoom-in duration-200"
            onClick={(e) => e.stopPropagation()}
          >
             <div className="flex justify-between items-center border-b pb-3 mb-4">
               <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">
                 {format(safeParse(editingCell.date), 'dd MMM yyyy').toLowerCase()}
               </h3>
               <button 
                type="button"
                onClick={() => { setEditingCell(null); setRangeMode(null); setRangeValue(''); }}
                className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-900 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
             </div>

             {rangeMode && (
               <div className="mb-4 p-4 rounded-xl border-2" style={{ borderColor: rangeMode.displayColor || rangeMode.color, backgroundColor: `${rangeMode.displayColor || rangeMode.color}15` }}>
                 <p className="text-[10px] font-black uppercase mb-2 tracking-widest" style={{ color: (rangeMode.displayColor || rangeMode.color) === '#000000' ? '#000' : (rangeMode.displayColor || rangeMode.color) }}>
                   Input range {rangeMode.prefix}
                 </p>
                 <p className="text-[10px] text-gray-500 mb-2">
                   Mulai dari <b>{format(safeParse(editingCell.date), 'dd MMM yyyy')}</b>.{' '}
                   {rangeMode.withNumber
                    ? <>Masukan <code className="bg-white px-1 rounded">1-3</code> → {rangeMode.prefix}1, {rangeMode.prefix}2, {rangeMode.prefix}3 (maju). <code className="bg-white px-1 rounded">3-1</code> → {rangeMode.prefix}3, {rangeMode.prefix}2, {rangeMode.prefix}1 (mundur per hari)</>
                     : <>Masukan <code className="bg-white px-1 rounded">1-3</code> → {rangeMode.prefix}, {rangeMode.prefix}, {rangeMode.prefix} (3 hari berturut)</>}
                 </p>
                 <div className="flex gap-2">
                   <input
                     type="text"
                     autoFocus
                     value={rangeValue}
                     onChange={(e) => setRangeValue(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') applyRange(); }}
                     placeholder={`1-3`}
                     className="flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2"
                   />
                   <button
                     type="button"
                     onClick={applyRange}
                     className="px-4 rounded-lg text-xs font-black shadow-md cursor-pointer active:scale-95"
                      style={{ backgroundColor: rangeMode.displayColor || rangeMode.color, color: rangeMode.textColor }}
                   >
                     SET
                   </button>
                   <button
                     type="button"
                     onClick={() => { setRangeMode(null); setRangeValue(''); }}
                     className="px-3 rounded-lg text-xs font-black bg-gray-100 text-gray-600 hover:bg-gray-200 cursor-pointer"
                   >
                     ✕
                   </button>
                 </div>
               </div>
             )}
             
              <div className="grid grid-cols-4 gap-2 mb-6">
                {SYMBOL_BUTTONS.map(({ s, color, fg, withNumber, label }, idx) => (
                  <button
                    key={`${s}-${label || ''}-${idx}`}
                    type="button"
                    onClick={() => {
                      const cs = resolveCustomSymbolForCell(`${s}${withNumber ? '1' : ''}`, color, customSymbols);
                      setRangeMode({ prefix: s, color, displayColor: cs?.color || color, textColor: cs?.textColor || fg, withNumber });
                      setRangeValue('');
                    }}
                    style={(() => {
                      const cs = resolveCustomSymbolForCell(`${s}${withNumber ? '1' : ''}`, color, customSymbols);
                      return { backgroundColor: cs?.color || color, color: cs?.textColor || fg };
                    })()}
                    className="h-10 text-[10px] font-black border border-gray-200 rounded-lg hover:scale-105 active:scale-95 transition-all shadow-md cursor-pointer flex flex-col items-center justify-center"
                  >
                    <span>{s}{withNumber ? '1' : ''}</span>
                    {label && <span className="text-[7px] opacity-70 leading-none">{label}</span>}
                  </button>
                ))}
                {frequentSymbols.map(s => {
                  const ov = overrides.find(o => o.employeeId === selectedEmployee.id && o.symbol.toUpperCase() === s);
                  const cs = resolveCustomSymbolForCell(s, ov?.color, customSymbols);
                  const color = cs?.color || ov?.color;
                  const fg = cs?.textColor || readableTextColor(color);
                  
                  return (
                    <div key={s} className="relative group">
                      <button 
                        type="button"
                        onClick={() => applyOverride(s, color)}
                        className="w-full h-10 text-[10px] font-black border border-blue-200 bg-blue-50 text-blue-700 rounded-lg hover:scale-105 active:scale-95 transition-all uppercase shadow-sm cursor-pointer flex items-center justify-center overflow-hidden"
                        style={color ? { backgroundColor: color, color: fg, borderColor: color } : {}}
                      >
                        {s}
                      </button>
                      <button
                        type="button"
                        title={`Sembunyikan tombol ${s}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setHiddenFrequents(prev => new Set(prev).add(s));
                        }}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-[9px] font-black flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
                <button 
                   type="button"
                   onClick={bulkAddExtraWorkUntilTV}
                   className="col-span-4 h-10 text-[10px] font-black bg-black text-white rounded-lg hover:bg-gray-800 transition-all uppercase mt-2 shadow-md cursor-pointer flex items-center justify-center gap-2"
                   title="Tambah X1, X2, X3... berhenti saat menyentuh TV (Out)"
                 >
                   <span>Ekstra Kerja (X1, X2, X3…)</span>
                   <span className="text-[8px] font-bold opacity-70">→ stop di TV</span>
                 </button>
                <button 
                   type="button"
                   onClick={() => applyOverride('')}
                   className="col-span-4 h-10 text-[10px] font-black bg-white text-red-600 border-2 border-red-200 rounded-lg hover:bg-red-600 hover:text-white hover:border-red-600 transition-all uppercase mt-2 shadow-md cursor-pointer"
                >
                  Hapus Simbol
                </button>
                <div className="col-span-4 mt-2">
                  <p className="text-[8px] font-black text-gray-400 uppercase mb-1 text-center">Start New Cycle (Work Day 1)</p>
                  <div className="flex gap-1">
                    {['42', '49', '56', '63', '70', '84'].map(days => (
                      <button 
                        key={days}
                        type="button"
                        onClick={() => setWorkCyclePrompt(parseInt(days))}
                        className="flex-1 h-8 text-[10px] font-black bg-blue-50 text-blue-600 border border-blue-100 rounded-lg hover:bg-blue-600 hover:text-white transition-all uppercase shadow-sm cursor-pointer"
                      >
                        {days}
                      </button>
                    ))}
                  </div>
                </div>
               <div className="col-span-4 mt-1 flex gap-1">
                 <button
                    type="button"
                    onClick={startLeaveCycle}
                    className="flex-1 h-10 text-[10px] font-black bg-green-50 text-green-600 rounded-lg hover:bg-green-600 hover:text-white transition-all uppercase shadow-sm cursor-pointer"
                    title="Buat siklus cuti berulang hingga akhir tahun"
                 >
                   Start Leave Cycle
                 </button>
                 <button
                    type="button"
                    onClick={startLeaveDayOnce}
                    className="flex-1 h-10 text-[10px] font-black bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-600 hover:text-white transition-all uppercase shadow-sm cursor-pointer"
                    title="Buat 1 siklus cuti saja (tanpa pengulangan)"
                 >
                   Leave Day 1
                 </button>
               </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!editingCell || !selectedEmployee) return;
                    setDeleteSelectionStart(editingCell.date);
                    setEditingCell(null);
                  }}
                  className={`col-span-4 h-10 text-[10px] font-black rounded-lg transition-all uppercase mt-1 shadow-sm cursor-pointer ${
                    deleteSelectionStart
                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                    : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white'
                  }`}
               >
                 {deleteSelectionStart ? 'Deleting Range...' : 'Select to Delete'}
               </button>
             </div>
             
             <div className="space-y-3">
                <p className="text-[10px] font-black text-gray-400 uppercase text-center">Custom Symbol & Color</p>
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    {['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#6366f1', '#1e293b'].map(c => (
                      <button 
                        key={c}
                        type="button"
                        onClick={() => setCustomColor(c)}
                        className={`w-6 h-6 rounded-full border-2 transition-all cursor-pointer ${customColor === c ? 'border-black scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <button 
                      type="button"
                      onClick={() => setCustomColor('transparent')}
                      className={`w-6 h-6 rounded-full border-2 transition-all cursor-pointer flex items-center justify-center bg-white ${customColor === 'transparent' ? 'border-blue-600 scale-110' : 'border-gray-300'}`}
                    >
                      <div className="w-full h-[1px] bg-red-500 rotate-45" />
                    </button>
                    <input 
                      type="color" 
                      value={customColor === 'transparent' ? '#ffffff' : customColor} 
                      onChange={(e) => setCustomColor(e.target.value)}
                      className="w-6 h-6 p-0 border-none bg-transparent cursor-pointer"
                    />
                  </div>
                  <div className="flex gap-2">
                    <input 
                      ref={customSymbolRef}
                      type="text" 
                      placeholder="CODE (e.g. s1)"
                      className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-center text-sm font-black focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') applyOverride(customSymbolRef.current?.value || '', customColor);
                      }}
                      autoFocus
                    />
                    <button 
                      type="button"
                      onClick={() => {
                        if (customSymbolRef.current?.value) applyOverride(customSymbolRef.current.value, customColor);
                      }}
                      className="text-white px-4 rounded-lg text-xs font-bold shadow-md cursor-pointer transition-all active:scale-95"
                      style={{ backgroundColor: customColor }}
                    >
                      SET
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-gray-400 uppercase">Catatan</p>
                  {noteDraft && user?.role === 'SUPERUSER' && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!editingCell || !selectedEmployee) return;
                        removeCellNote(selectedEmployee.id, editingCell.date);
                        setNoteDraft('');
                      }}
                      className="text-[9px] font-black text-red-500 hover:text-red-700 uppercase tracking-wider cursor-pointer"
                    >
                      Hapus
                    </button>
                  )}
                </div>
                {user?.role === 'SUPERUSER' ? (
                  <>
                    <textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Tulis catatan untuk tanggal ini…"
                      rows={3}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-500/20 outline-none resize-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!editingCell || !selectedEmployee) return;
                        setCellNote(selectedEmployee.id, editingCell.date, noteDraft);
                        setEditingCell(null);
                      }}
                      className="w-full h-9 text-[10px] font-black bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all uppercase shadow-sm cursor-pointer"
                    >
                      Simpan Catatan
                    </button>
                  </>
                ) : (
                  <div className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs font-medium text-gray-700 min-h-[3rem] whitespace-pre-wrap">
                    {noteDraft || <span className="italic text-gray-400">Belum ada catatan. Hanya Superuser yang bisa menambahkan.</span>}
                  </div>
                )}
              </div>
          </div>
        </div>
      )}

      {/* Pilihan Auto / Don't Create Cycle untuk tombol 42–84 */}
      {workCyclePrompt !== null && (
        <div
          className="fixed inset-0 z-[2100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] sm:p-4"
          onClick={() => setWorkCyclePrompt(null)}
        >
          <div
            className="bg-white p-4 sm:p-6 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-200 w-full max-w-sm max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-black uppercase tracking-widest text-gray-900 mb-2">
              Mode Siklus Kerja ({workCyclePrompt} hari)
            </h3>
            <p className="text-[11px] text-gray-500 mb-4">
              Pilih bagaimana tombol ini bekerja saat ditekan.
            </p>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => startWorkCycle(workCyclePrompt!, 'auto')}
                className="w-full text-left p-3 rounded-lg border-2 border-blue-200 hover:bg-blue-50 cursor-pointer"
              >
                <p className="text-xs font-black text-blue-700 uppercase">Auto Create Cycle</p>
                <p className="text-[10px] text-gray-500 mt-1">Buat X1..X{workCyclePrompt} lalu otomatis sambung TVout + Cuti + TVin secara berulang hingga akhir tahun.</p>
              </button>
              <button
                type="button"
                onClick={() => startWorkCycle(workCyclePrompt!, 'plain')}
                className="w-full text-left p-3 rounded-lg border-2 border-gray-200 hover:bg-gray-50 cursor-pointer"
              >
                <p className="text-xs font-black text-gray-800 uppercase">Don't Create Cycle</p>
                <p className="text-[10px] text-gray-500 mt-1">Hanya isi X1..X{workCyclePrompt} (latar putih, font hitam). Tidak membuat siklus cuti.</p>
              </button>
              <button
                type="button"
                onClick={() => setWorkCyclePrompt(null)}
                className="w-full mt-2 h-9 text-[10px] font-black uppercase bg-gray-100 text-gray-600 hover:bg-gray-200 rounded-lg cursor-pointer"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Superuser password gate for destructive clears */}
      {pwdPrompt && (
        <div
          className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] sm:p-4"
          onClick={() => setPwdPrompt(null)}
        >
          <div
            className="bg-white p-4 sm:p-6 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-200 w-full max-w-sm max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-black uppercase tracking-widest text-gray-900 mb-2">
              Konfirmasi Superuser
            </h3>
            <p className="text-xs text-gray-600 mb-3">
              {pwdPrompt.kind === 'thisAll' ? (
                <>Hapus <b>seluruh</b> simbol timesheet untuk <b>{selectedEmployee.name}</b> di <b>semua tahun</b>. Tindakan tidak dapat dibatalkan tanpa Undo.</>
              ) : (
                <>Hapus simbol tahun <b>{targetYear}</b> untuk <b>seluruh karyawan</b> pada filter saat ini ({filterDept === 'ALL' ? 'Semua Dept' : filterDept}, {filteredEmployees.length} orang).</>
              )}
            </p>
            <input
              type="password"
              autoFocus
              value={pwdInput}
              onChange={(e) => { setPwdInput(e.target.value); setPwdError(''); }}
              placeholder="Password Superuser"
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold mb-2 focus:outline-none focus:ring-2 focus:ring-red-500/20"
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  if (!(await verifySuperPwd(pwdInput))) { setPwdError('Password salah.'); return; }
                  if (pwdPrompt.kind === 'thisAll') {
                    replaceAllOverrides(overrides.filter(o => o.employeeId !== selectedEmployee.id));
                  } else {
                    const ids = new Set(filteredEmployees.map(emp => emp.id));
                    const yStart = format(startOfYear(new Date(targetYear, 0, 1)), 'yyyy-MM-dd');
                    const yEnd = format(endOfMonth(addMonths(startOfYear(new Date(targetYear, 0, 1)), 11)), 'yyyy-MM-dd');
                    replaceAllOverrides(overrides.filter(o => !(ids.has(o.employeeId) && o.date >= yStart && o.date <= yEnd)));
                  }
                  setPwdInput(''); setPwdError(''); setPwdPrompt(null);
                }
              }}
            />
            {pwdError && <p className="text-[10px] text-red-600 font-bold mb-2">{pwdError}</p>}
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => { setPwdPrompt(null); setPwdInput(''); setPwdError(''); }}
                className="flex-1 h-10 text-xs font-black bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-all uppercase"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!(await verifySuperPwd(pwdInput))) { setPwdError('Password salah.'); return; }
                  if (pwdPrompt.kind === 'thisAll') {
                    replaceAllOverrides(overrides.filter(o => o.employeeId !== selectedEmployee.id));
                  } else {
                    const ids = new Set(filteredEmployees.map(emp => emp.id));
                    const yStart = format(startOfYear(new Date(targetYear, 0, 1)), 'yyyy-MM-dd');
                    const yEnd = format(endOfMonth(addMonths(startOfYear(new Date(targetYear, 0, 1)), 11)), 'yyyy-MM-dd');
                    replaceAllOverrides(overrides.filter(o => !(ids.has(o.employeeId) && o.date >= yStart && o.date <= yEnd)));
                  }
                  setPwdInput(''); setPwdError(''); setPwdPrompt(null);
                }}
                className="flex-1 h-10 text-xs font-black bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all uppercase shadow-md"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Edit Unlock (perlu password Superuser) */}
      {showAdminUnlock && user?.role === 'ADMIN' && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4"
          onClick={() => { setShowAdminUnlock(false); setAdminUnlockErr(''); setAdminUnlockPwd(''); }}
        >
          <div
            className="bg-white p-6 rounded-2xl shadow-2xl border border-gray-200 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-black uppercase tracking-widest text-gray-900 mb-2 flex items-center gap-2">
              <Lock size={14} /> Buka Kunci Edit
            </h3>
            <p className="text-xs text-gray-600 mb-3">
              Sebagai Admin, Anda perlu password <b>Superuser</b> untuk mengaktifkan mode edit pada timesheet. Sesi tetap aktif sampai Anda menguncinya kembali atau logout.
            </p>
            <input
              type="password"
              autoFocus
              value={adminUnlockPwd}
              onChange={(e) => { setAdminUnlockPwd(e.target.value); setAdminUnlockErr(''); }}
              placeholder="Password Superuser"
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold mb-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  if (!(await verifySuperPwd(adminUnlockPwd))) { setAdminUnlockErr('Password salah.'); return; }
                  setAdminEditUnlocked(true);
                  setShowAdminUnlock(false);
                  setAdminUnlockPwd(''); setAdminUnlockErr('');
                }
              }}
            />
            {adminUnlockErr && <p className="text-[10px] text-red-600 font-bold mb-2">{adminUnlockErr}</p>}
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => { setShowAdminUnlock(false); setAdminUnlockErr(''); setAdminUnlockPwd(''); }}
                className="flex-1 h-10 text-xs font-black bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-all uppercase"
              >Batal</button>
              <button
                type="button"
                onClick={async () => {
                  if (!(await verifySuperPwd(adminUnlockPwd))) { setAdminUnlockErr('Password salah.'); return; }
                  setAdminEditUnlocked(true);
                  setShowAdminUnlock(false);
                  setAdminUnlockPwd(''); setAdminUnlockErr('');
                }}
                className="flex-1 h-10 text-xs font-black bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all uppercase shadow-md"
              >Buka</button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Timesheet Confirmation */}
      {showClearConfirm && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4"
          onClick={() => setShowClearConfirm(false)}
        >
          <div
            className="bg-white p-6 rounded-2xl shadow-2xl border border-gray-200 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-black uppercase tracking-widest text-gray-900 mb-2">Clear Timesheet?</h3>
            <p className="text-xs text-gray-600 mb-5">
              Semua simbol di tahun <b>{targetYear}</b> untuk <b>{selectedEmployee.name}</b> akan dihapus total. Tindakan ini tidak dapat dibatalkan.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 h-10 text-xs font-black bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-all uppercase"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  const yearStart = startOfYear(new Date(targetYear, 0, 1));
                  const yearEnd = endOfMonth(addMonths(yearStart, 11));
                  const yStart = format(yearStart, 'yyyy-MM-dd');
                  const yEnd = format(yearEnd, 'yyyy-MM-dd');
                  const datesToRemove = overrides
                    .filter(o => o.employeeId === selectedEmployee.id && o.date >= yStart && o.date <= yEnd)
                    .map(o => o.date);
                  if (datesToRemove.length > 0) {
                    removeManualOverridesBulk(selectedEmployee.id, datesToRemove);
                  }
                  setShowClearConfirm(false);
                }}
                className="flex-1 h-10 text-xs font-black bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all uppercase shadow-md"
              >
                Hapus Semua
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="flex flex-col lg:flex-row lg:justify-between lg:items-end gap-4 no-print">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Roster Timesheet</h2>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-widest mt-1">Personnel Schedule Logs • Desa Fluk Site</p>
          
          
          <div className="mt-4 flex gap-6 items-center flex-wrap">
            {autoCalc && (
              <>
            <div className="bg-orange-50 border border-orange-100 px-4 py-2 rounded-xl flex items-center gap-3">
              <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center text-white font-black text-xs">Ce</div>
              <div>
                <p className="text-[9px] font-black text-orange-600 uppercase leading-none mb-1">Extra Cuti</p>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black">{(selectedEmployee.extraLeaveBalance || 0) + (extraLeaveInfo.earned - extraLeaveInfo.usedExtra)}</span>
                  <span className="text-[10px] font-medium text-gray-400 uppercase">Hari</span>
                </div>
                <p className="text-[7px] text-orange-400 font-bold uppercase mt-1 flex items-center gap-1">
                  <span>Adj:</span>
                  {canEdit ? (
                    <input
                      type="number"
                      value={selectedEmployee.extraLeaveBalance || 0}
                      onChange={(e) => updateEmployee({ ...selectedEmployee, extraLeaveBalance: parseInt(e.target.value) || 0 })}
                      className="w-8 bg-transparent text-[8px] font-black focus:outline-none border-b border-orange-200"
                    />
                  ) : (
                    <span>{selectedEmployee.extraLeaveBalance || 0}</span>
                  )}
                  <span>· E:{extraLeaveInfo.earned} − U:{extraLeaveInfo.usedExtra}</span>
                </p>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-100 px-4 py-2 rounded-xl flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center text-white font-black text-xs">ct</div>
              <div>
                <p className="text-[9px] font-black text-blue-600 uppercase leading-none mb-1">Cuti Tahunan</p>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black">{(selectedEmployee.annualLeaveBalance || 0) + (extraLeaveInfo.annualEntitlement - extraLeaveInfo.usedAnnual)}</span>
                  <span className="text-[10px] font-medium text-gray-400 uppercase">Hari</span>
                </div>
                <p className="text-[7px] text-blue-400 font-bold uppercase mt-1 flex items-center gap-1">
                  <span>Adj:</span>
                  {canEdit ? (
                    <input
                      type="number"
                      value={selectedEmployee.annualLeaveBalance || 0}
                      onChange={(e) => updateEmployee({ ...selectedEmployee, annualLeaveBalance: parseInt(e.target.value) || 0 })}
                      className="w-8 bg-transparent text-[8px] font-black focus:outline-none border-b border-blue-200"
                    />
                  ) : (
                    <span>{selectedEmployee.annualLeaveBalance || 0}</span>
                  )}
                  <span>· E:{extraLeaveInfo.annualEntitlement} − U:{extraLeaveInfo.usedAnnual}</span>
                </p>
              </div>
            </div>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 lg:gap-3 items-center">
          {canToggleAutoCalc && (
            <label className="flex items-center gap-2 bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg cursor-pointer select-none h-10">
              <input
                type="checkbox"
                checked={autoCalc}
                onChange={(e) => setAutoCalc(e.target.checked)}
                className="h-4 w-4 accent-blue-600 cursor-pointer"
              />
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-700">Auto Calc</span>
              <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${autoCalc ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                {autoCalc ? 'ON' : 'OFF'}
              </span>
            </label>
          )}
          {canCompare && (
            <label className="flex items-center gap-2 bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg cursor-pointer select-none h-10">
              <input
                type="checkbox"
                checked={compareView}
                onChange={(e) => setCompareView(e.target.checked)}
                className="h-4 w-4 accent-purple-600 cursor-pointer"
              />
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-700">Compare View</span>
            </label>
          )}
          {canManage && (
            <div className="flex items-center gap-2">
              <select 
                value={filterDept}
                onChange={(e) => setFilterDept(e.target.value)}
                className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                title="Filter Departemen"
              >
                <option value="ALL">All Departemen</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenMenu(openMenu === 'grade' ? null : 'grade')}
                  className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 flex items-center gap-1 h-9"
                  title="Filter Golongan"
                >
                  Golongan{filterGrades.length > 0 ? ` (${filterGrades.length})` : ''}
                  <ChevronDown size={12} />
                </button>
                {openMenu === 'grade' && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 min-w-[180px] max-h-72 overflow-auto">
                      <div className="flex items-center justify-between px-3 py-2 border-b text-[9px] font-black uppercase text-gray-500">
                        <span>Pilih Golongan</span>
                        <button type="button" className="text-blue-600 hover:underline" onClick={() => setFilterGrades([])}>Clear</button>
                      </div>
                      {grades.length === 0 && <div className="px-3 py-2 text-[10px] text-gray-400">— Kosong —</div>}
                      {grades.map(g => {
                        const checked = filterGrades.includes(g);
                        return (
                          <label key={g} className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setFilterGrades(prev => checked ? prev.filter(x => x !== g) : [...prev, g])}
                              className="h-3.5 w-3.5 accent-blue-600"
                            />
                            <span>{g}</span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
              {compareView && canCompare ? (
                <>
                  {(() => {
                    const positions = Array.from(new Set(scopedEmployees
                      .filter(e => e.department === compareDept && gradeMatches(e))
                      .map(e => e.position)
                      .filter(Boolean))).sort() as string[];
                    return (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setOpenMenu(openMenu === 'position' ? null : 'position')}
                          className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 flex items-center gap-1 h-9"
                          title="Filter Jabatan"
                        >
                          Jabatan{filterPositions.length > 0 ? ` (${filterPositions.length})` : ''}
                          <ChevronDown size={12} />
                        </button>
                        {openMenu === 'position' && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
                            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 min-w-[220px] max-h-72 overflow-auto">
                              <div className="flex items-center justify-between px-3 py-2 border-b text-[9px] font-black uppercase text-gray-500">
                                <span>Pilih Jabatan</span>
                                <button type="button" className="text-blue-600 hover:underline" onClick={() => setFilterPositions([])}>Clear</button>
                              </div>
                              {positions.length === 0 && <div className="px-3 py-2 text-[10px] text-gray-400">— Kosong —</div>}
                              {positions.map(p => {
                                const checked = filterPositions.includes(p);
                                return (
                                  <label key={p} className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => setFilterPositions(prev => checked ? prev.filter(x => x !== p) : [...prev, p])}
                                      className="h-3.5 w-3.5 accent-blue-600"
                                    />
                                    <span className="truncate">{p}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={() => setSortPositionAsc(v => !v)}
                    className={`h-9 w-9 inline-flex items-center justify-center rounded-lg border ${sortPositionAsc ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600'}`}
                    title={sortPositionAsc ? 'Sort Jabatan A-Z: ON' : 'Sort Jabatan A-Z: OFF'}
                  >
                    {sortPositionAsc ? <ArrowDownAZ size={14} /> : <ArrowUpAZ size={14} />}
                  </button>
                </>
              ) : (
                <>
                  <span className="text-[9px] font-black text-gray-400 uppercase">Personnel:</span>
                  <input
                    type="search"
                    value={personnelSearch}
                    onChange={(e) => setPersonnelSearch(e.target.value)}
                    placeholder="Cari nama/NIK…"
                    className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20 w-[160px]"
                  />
                  <select
                    value={selectedEmployeeId}
                    onChange={(e) => setSelectedEmployeeId(e.target.value)}
                    className="bg-white border border-gray-200 rounded-lg px-4 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20 max-w-[260px]"
                  >
                    {personnelOptions.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.nik} - {emp.name}</option>
                    ))}
                    {personnelOptions.length === 0 && <option value="">— Tidak ada —</option>}
                  </select>
                </>
              )}
            </div>
          )}
          {(() => {
            const currentYear = new Date().getFullYear();
            const minYear = currentYear - 2;
            const maxYear = currentYear + 2;
            return (
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setTargetYear(prev => Math.max(minYear, prev - 1))}
                  disabled={targetYear <= minYear}
                  className="p-1.5 hover:bg-white rounded-md transition-all shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
                ><ChevronLeft size={16} /></button>
                <span className="px-4 font-bold text-sm self-center text-gray-700">{targetYear}</span>
                <button
                  onClick={() => setTargetYear(prev => Math.min(maxYear, prev + 1))}
                  disabled={targetYear >= maxYear}
                  className="p-1.5 hover:bg-white rounded-md transition-all shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
                ><ChevronRight size={16} /></button>
              </div>
            );
          })()}
          {user?.role === 'ADMIN' && (
            <button
              onClick={() => {
                if (adminEditUnlocked) {
                  setAdminEditUnlocked(false);
                } else {
                  setAdminUnlockPwd('');
                  setAdminUnlockErr('');
                  setShowAdminUnlock(true);
                }
              }}
              className={`h-10 px-4 rounded-lg flex items-center gap-2 text-xs font-bold shadow-sm border transition-all ${
                adminEditUnlocked
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
              title={adminEditUnlocked ? 'Klik untuk mengunci kembali' : 'Buka kunci edit (perlu password Superuser)'}
            >
              {adminEditUnlocked ? <Unlock size={14} /> : <Lock size={14} />}
              <span className="hidden sm:inline">{adminEditUnlocked ? 'Edit Aktif' : 'Buka Kunci Edit'}</span>
            </button>
          )}
          {canEdit && (
            <>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImportFile}
                accept=".xlsx, .xls"
                className="hidden"
              />
              <div className="relative">
                <button
                  onClick={() => setImportMenu(importMenu ? null : 'root')}
                  className="bg-white border border-gray-200 text-gray-700 h-10 px-4 rounded-lg hover:bg-gray-50 transition-all flex items-center gap-2 text-xs font-bold shadow-sm"
                >
                  <Upload size={16} />
                  <span className="hidden sm:inline">Import Override</span>
                  <ChevronDown size={14} />
                </button>
                {importMenu === 'root' && (
                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 min-w-[220px] overflow-hidden">
                    <button onClick={() => setImportMenu('this')} className="w-full text-left px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50 flex items-center justify-between">Import this Employee <ChevronRight size={12} /></button>
                    <button onClick={() => triggerImport('themedAll')} className="w-full text-left px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50">Import All (With Themes)</button>
                    <button onClick={() => triggerImport('rawAll')} className="w-full text-left px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50">Import All (Raw template)</button>
                    {canCompare && compareView && (
                      <button onClick={() => triggerImport('compare')} className="w-full text-left px-4 py-2.5 text-xs font-bold text-purple-700 hover:bg-purple-50 border-t">Import Compare (this dept)</button>
                    )}
                  </div>
                )}
                {importMenu === 'this' && (
                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 min-w-[200px] overflow-hidden">
                    <button onClick={() => triggerImport('themed')} className="w-full text-left px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50">Import with Theme</button>
                    <button onClick={() => triggerImport('rawOne')} className="w-full text-left px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50">Import Raw</button>
                    <button onClick={() => setImportMenu('root')} className="w-full text-left px-4 py-2 text-[10px] text-gray-500 hover:bg-gray-50 border-t">← Back</button>
                  </div>
                )}
              </div>
              <button
                onClick={doUndo}
                disabled={undoStackLen === 0}
                className="bg-white border border-gray-200 text-gray-700 h-10 px-3 rounded-lg hover:bg-gray-50 transition-all flex items-center gap-1.5 text-xs font-bold shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                title={`Undo (${undoStackLen})`}
              >
                <Undo2 size={14} />
                <span className="hidden sm:inline">Undo</span>
              </button>
              <button
                onClick={doRedo}
                disabled={redoStackLen === 0}
                className="bg-white border border-gray-200 text-gray-700 h-10 px-3 rounded-lg hover:bg-gray-50 transition-all flex items-center gap-1.5 text-xs font-bold shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                title={`Redo (${redoStackLen})`}
              >
                <Redo2 size={14} />
                <span className="hidden sm:inline">Redo</span>
              </button>
              <div className="relative">
                <button
                  onClick={() => setClearMenu(v => !v)}
                  className="bg-white border border-red-200 text-red-600 h-10 px-4 rounded-lg hover:bg-red-50 transition-all flex items-center gap-2 text-xs font-bold shadow-sm"
                  title="Opsi penghapusan timesheet"
                >
                  <Trash2 size={16} />
                  <span className="hidden sm:inline">Clear Timesheet</span>
                  <ChevronDown size={14} />
                </button>
                {clearMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setClearMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 min-w-[260px] overflow-hidden">
                      <button
                        onClick={() => { setClearMenu(false); setShowClearConfirm(true); }}
                        className="w-full text-left px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50"
                      >
                        Clear This Year
                        <div className="text-[9px] text-gray-400 font-medium">Karyawan ini, tahun {targetYear}</div>
                      </button>
                      <button
                        onClick={() => { setClearMenu(false); setPwdInput(''); setPwdError(''); setPwdPrompt({ kind: 'thisAll' }); }}
                        className="w-full text-left px-4 py-2.5 text-xs font-bold text-red-700 hover:bg-red-50 border-t"
                      >
                        Clear This Employee (All)
                        <div className="text-[9px] text-gray-400 font-medium">Semua tahun • butuh password Superuser</div>
                      </button>
                      <button
                        onClick={() => { setClearMenu(false); setPwdInput(''); setPwdError(''); setPwdPrompt({ kind: 'deptYear' }); }}
                        className="w-full text-left px-4 py-2.5 text-xs font-bold text-red-700 hover:bg-red-50 border-t"
                      >
                        Clear All Employee
                        <div className="text-[9px] text-gray-400 font-medium">Semua karyawan (filter dept) • tahun {targetYear} • butuh password Superuser</div>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
          <div className="relative">
            <button
              onClick={() => setExportMenu(exportMenu ? null : 'root')}
              className="bg-white border border-gray-200 text-gray-700 h-10 px-4 rounded-lg hover:bg-gray-50 transition-all flex items-center gap-2 text-xs font-bold shadow-sm"
            >
              <Download size={16} />
              <span className="hidden sm:inline">Export</span>
              <ChevronDown size={14} />
            </button>
            {exportMenu === 'root' && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 min-w-[180px] overflow-hidden">
                <button onClick={() => doExport('pdf')} className="w-full text-left px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50">Export to PDF</button>
                <button onClick={() => setExportMenu('excel')} className="w-full text-left px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50 flex items-center justify-between">Export to Excel <ChevronRight size={12} /></button>
              </div>
            )}
            {exportMenu === 'excel' && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 min-w-[220px] overflow-hidden">
                <button onClick={() => doExport('themed')} className="w-full text-left px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50">Export With Themes</button>
                <button onClick={() => doExport('themedOneAll')} className="w-full text-left px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50">Export this employee (All)</button>
                {user?.role !== 'REGULAR' && user?.role !== 'APPROVAL' && (
                  <>
                    <button onClick={() => doExport('raw')} className="w-full text-left px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50">Raw Data{user?.role === 'ADMIN' ? ' (Dept)' : ''}</button>
                    <button onClick={() => doExport('themedAll')} className="w-full text-left px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50">Export With Themes (All){user?.role === 'ADMIN' ? ' (Dept)' : ''}</button>
                  </>
                )}
                {canCompare && compareView && (
                  <button onClick={() => doExport('compare')} className="w-full text-left px-4 py-2.5 text-xs font-bold text-purple-700 hover:bg-purple-50 border-t">Export Compare (this dept)</button>
                )}
                <button onClick={() => setExportMenu('root')} className="w-full text-left px-4 py-2 text-[10px] text-gray-500 hover:bg-gray-50 border-t">← Back</button>
              </div>
            )}
          </div>
          <button
            onClick={() => selectedEmployee && exportPdf(exportCtx(), { print: true })}
            className="bg-white border border-gray-200 text-gray-700 h-10 px-4 rounded-lg hover:bg-gray-50 transition-all flex items-center gap-2 text-xs font-bold shadow-sm"
          >
            <Printer size={16} />
            <span className="hidden sm:inline">Print Sheet</span>
          </button>
        </div>
      </header>

      {/* Profile Header for Print */}
      <div className="hidden print:block p-8 bg-white border border-gray-200 rounded-2xl mb-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 uppercase">MineRoster Personnel Form</h1>
            <p className="text-xs text-gray-500 mt-2"><b>LOCATION:</b> SITE DESA FLUK • <b>YEAR:</b> {targetYear}</p>
          </div>
          <div className="space-y-1 text-right text-[10px] font-bold text-gray-600 uppercase border-l pl-8 border-gray-100">
            <p>NAME: <span className="text-gray-900">{selectedEmployee.name}</span></p>
            <p>NIK: <span className="text-gray-900">{selectedEmployee.nik}</span></p>
            <p>DEPT: <span className="text-gray-900">{selectedEmployee.department}</span></p>
            <p>GRADE: <span className="text-gray-900">{selectedEmployee.grade}</span></p>
            <p>POH: <span className="text-gray-900">{selectedEmployee.poh}</span></p>
          </div>
        </div>
      </div>

      {compareView && canCompare ? (
        (() => {
          const dept = compareDept || user?.department || '';
          const yearStart = new Date(targetYear, 0, 1);
          const yearEnd = new Date(targetYear, 11, 31);
          const days = eachDayOfInterval({ start: yearStart, end: yearEnd });
          let deptEmployees = scopedEmployees.filter(e =>
            e.department === dept &&
            gradeMatches(e)
          );
          if (filterPositions.length > 0) deptEmployees = deptEmployees.filter(e => positionMatches(e));
          if (sortPositionAsc) {
            deptEmployees = [...deptEmployees].sort((a, b) =>
              (a.position || '').localeCompare(b.position || '') ||
              (a.name || '').localeCompare(b.name || '')
            );
          }
          return (
            <SyncedScrollGrid minWidth={220 + days.length * 28}>
                <div className="flex sticky top-0 z-20 bg-white">
                  <div className="data-grid-cell data-grid-header sticky left-0 z-30 bg-[#f9fafb] border-r-2 border-gray-200 shadow-[2px_0_4px_rgba(0,0,0,0.05)]" style={{ minWidth: 220, width: 220 }}>Karyawan</div>
                  {days.map((d, i) => {
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                    const dayName = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'][d.getDay()];
                    return (
                      <div key={i} className={`data-grid-cell data-grid-header flex flex-col items-center justify-center leading-tight ${isWeekend ? 'bg-red-50 text-red-600' : 'text-gray-500'}`} style={{ width: 28, minWidth: 28, fontSize: 9 }}>
                        <span style={{ fontSize: 7 }} className="opacity-70 font-normal">{dayName}</span>
                        <span>{d.getDate()}/{d.getMonth() + 1}</span>
                      </div>
                    );
                  })}
                </div>
                {deptEmployees.length === 0 && (
                  <div className="p-6 text-center text-xs text-gray-500">Tidak ada karyawan di departemen ini.</div>
                )}
                {deptEmployees.map(emp => {
                  const data = calculateTimesheet(
                    emp,
                    format(yearStart, 'yyyy-MM-dd'),
                    format(yearEnd, 'yyyy-MM-dd'),
                    leaveRequests, customSymbols, overrides,
                  );
                  const byDate = new Map(data.map(d => [d.date, d]));
                  return (
                    <div key={emp.id} className="flex group hover:bg-blue-50/20">
                      <div className="data-grid-cell sticky left-0 z-10 bg-[#f9fafb] border-r-2 border-gray-200 shadow-[2px_0_4px_rgba(0,0,0,0.05)] text-[10px] font-bold text-left px-2" style={{ minWidth: 220, width: 220 }}>
                        <div className="truncate">{emp.name}</div>
                        <div className="text-[8px] text-gray-400 font-medium">{emp.nik}</div>
                      </div>
                      {days.map((day, i) => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const activity = byDate.get(dateStr);
                        const s = activity?.symbol || '';
                        const isSelectedStart = dateStr === deleteSelectionStart && emp.id === selectedEmployeeId;
                        const termDate = emp.terminationDate || '';
                        const isTerminated = !!termDate && dateStr >= termDate;
                        let symbolClass = '';
                        if (isSelectedStart) symbolClass = 'bg-purple-600 text-white animate-pulse';
                        else if (isTerminated) symbolClass = 'bg-black text-white';
                        else if (s.startsWith('Cr')) symbolClass = 'symbol-cr';
                        else if (activity?.color === '#000000') symbolClass = 'bg-black text-white';
                        else if (s === 'XP') symbolClass = 'symbol-xp';
                        else if (s === 'TT') symbolClass = 'symbol-tt';
                        else if (s === 'TV') {
                          const fn = (activity as any)?.function || '';
                          const isIn = fn
                            ? fn === 'Travel Perjalanan Ke Site'
                            : (activity?.color === '#1e3a8a' || activity?.color === '#1d4ed8');
                          symbolClass = isIn ? 'symbol-tv-in' : 'symbol-tv-out';
                        }
                        return (
                          <div
                            key={i}
                            onClick={() => {
                              if (!canEdit) return;
                              setSelectedEmployeeId(emp.id);
                              handleCellClick(dateStr, s);
                            }}
                            className={`data-grid-cell text-[8px] font-bold cursor-pointer hover:scale-110 active:scale-95 transition-all text-center flex items-center justify-center ${symbolClass} ${isToday(day) ? 'ring-2 ring-inset ring-blue-500 z-10' : ''}`}
                            style={{
                              width: 28, minWidth: 28,
                              ...(isTerminated ? { backgroundColor: '#000000', color: 'white' } : activity?.color && activity.color !== 'transparent' && activity.color !== '#000000' ? {
                                backgroundColor: activity.color,
                                color: (s.toUpperCase().includes('CR') || activity.color === '#bbf7d0' || activity.color === '#ffffff') ? 'black' : 'white',
                              } : {}),
                            }}
                            title={(() => {
                              const base = isTerminated ? `${emp.name} • ${format(day, 'PP')}: Sudah tidak bekerja` : `${emp.name} • ${format(day, 'PP')}: ${activity?.label || ''}`;
                              const note = cellNotes.find(n => n.employeeId === emp.id && n.date === dateStr)?.text;
                              return note ? `${base}\n📝 Catatan: ${note}` : base;
                            })()}
                          >
                            {isTerminated ? '' : s}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
            </SyncedScrollGrid>
          );
        })()
      ) : (
      <SyncedScrollGrid minWidth={1240}>
          {/* Header row: Days 1-31 */}
          <div className="flex">
            <div className="data-grid-cell data-grid-header min-w-[100px] sticky left-0 z-10 border-r-2 border-gray-200 shadow-[2px_0_4px_rgba(0,0,0,0.05)]">Bulan</div>
            {Array.from({ length: 31 }, (_, i) => {
              const headerDate = new Date(targetYear, 0, i + 1);
              const dayName = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'][headerDate.getDay()];
              const isWeekend = headerDate.getDay() === 0 || headerDate.getDay() === 6;
              return (
                <div key={i} className={`data-grid-cell data-grid-header flex-1 flex flex-col items-center justify-center leading-tight ${isWeekend ? 'bg-red-50 text-red-600' : 'text-gray-500'}`}>
                  <span className="text-[7px] font-normal opacity-70">{dayName}</span>
                  <span>{i + 1}</span>
                </div>
              );
            })}
          </div>

          {/* Data rows per month */}
          {months.map((month) => {
            const start = startOfMonth(month);
            const end = endOfMonth(month);
            const daysInMonth = eachDayOfInterval({ start, end });
            const timesheetData = calculateTimesheet(
               selectedEmployee,
               format(start, 'yyyy-MM-dd'),
               format(end, 'yyyy-MM-dd'),
               leaveRequests,
               customSymbols,
               overrides
            );

            return (
              <div key={month.toISOString()} className="flex group hover:bg-blue-50/20 transition-colors">
                <div className="data-grid-cell bg-[#f9fafb] min-w-[100px] font-bold text-[10px] uppercase tracking-wider sticky left-0 z-10 border-r-2 border-gray-200 transition-colors group-hover:bg-blue-600 group-hover:text-white shadow-[2px_0_4px_rgba(0,0,0,0.05)]">
                  {format(month, 'MMM')}
                </div>
                {Array.from({ length: 31 }, (_, i) => {
                  const day = daysInMonth[i];
                  if (!day) return <div key={i} className="data-grid-cell flex-1 bg-gray-900/90 border-r-gray-800"></div>;
                  
                  const dateStr = format(day, 'yyyy-MM-dd');
                  const activity = timesheetData.find(d => d.date === dateStr);
                  
                  // Improved Symbol mapping
                  let symbolClass = '';
                  const s = activity?.symbol || '';
                  
                  // Selection Marker (Purple)
                  const isSelectedStart = dateStr === deleteSelectionStart;

                  // Termination: kalau employee resign, semua tanggal sejak terminationDate jadi hitam.
                  const termDate = selectedEmployee?.terminationDate || '';
                  const isTerminated = !!termDate && dateStr >= termDate;

                  if (isSelectedStart) symbolClass = 'bg-purple-600 text-white animate-pulse shadow-lg ring-2 ring-purple-300';
                  else if (isTerminated) symbolClass = 'bg-black text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]';
                  else if (s.startsWith('Cr') && !activity?.color) symbolClass = 'symbol-cr';
                  else if (activity?.color === '#000000') symbolClass = 'bg-black text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]';
                  else if (s === 'XP') symbolClass = 'symbol-xp';
                  else if (s === 'TT') symbolClass = 'symbol-tt';
                  else if (s === 'TV') {
                    const fn = (activity as any)?.function || '';
                    const isIn = fn
                      ? fn === 'Travel Perjalanan Ke Site'
                      : (activity?.color === '#1e3a8a' || activity?.color === '#1d4ed8');
                    symbolClass = isIn ? 'symbol-tv-in' : 'symbol-tv-out';
                  }

                  return (
                    <div 
                      key={i} 
                      onClick={() => handleCellClick(dateStr, s)}
                      className={`data-grid-cell relative flex-1 text-[9px] font-bold cursor-pointer hover:scale-110 active:scale-95 transition-all text-center flex items-center justify-center h-full ${symbolClass} ${isToday(day) ? 'ring-2 ring-inset ring-blue-500 z-10' : ''} ${activity?.label === 'Manual Override' ? 'ring-1 ring-inset ring-black/10' : ''}`}
                      style={isSelectedStart ? {
                        backgroundColor: '#9333ea',
                        color: 'white'
                      } : isTerminated ? {
                        backgroundColor: '#000000',
                        color: 'white',
                      } : (activity?.color && activity.color !== 'transparent' ? {
                        backgroundColor: activity.color,
                        color: activity.textColor || readableTextColor(activity.color)
                      } : {})}
                      title={(() => {
                        const base = isTerminated ? `${format(day, 'PP')}: Sudah tidak bekerja` : `${format(day, 'PP')}: ${activity?.label}`;
                        const note = cellNotes.find(n => n.employeeId === selectedEmployee.id && n.date === dateStr)?.text;
                        return note ? `${base}\n📝 Catatan: ${note}` : base;
                      })()}
                    >
                      {isTerminated ? '' : activity?.symbol}
                      {cellNotes.some(n => n.employeeId === selectedEmployee.id && n.date === dateStr) && (
                        <div
                          className="absolute bottom-0 right-0 w-0 h-0 border-l-[6px] border-l-transparent border-b-[6px] border-b-blue-500 shadow-sm"
                          title="Ada catatan"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
      </SyncedScrollGrid>
      )}

      {!compareView && selectedEmployee?.terminationDate && (
        <div className="mt-4 inline-flex items-stretch rounded-lg overflow-hidden border-2 border-orange-500 shadow-md text-[12px] font-black tracking-wide">
          <span className="px-3 py-3 bg-white text-black">Note :</span>
          <span className="px-3 py-3 bg-orange-500 text-black">Efektif Tidak Bekerja {format(parseISO(selectedEmployee.terminationDate), 'dd MMMM yyyy')}</span>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-8 mt-12 bg-white p-8 rounded-2xl border border-gray-200 no-print">
        <div className="space-y-4 flex-1">
          <h4 className="text-[10px] uppercase font-black text-gray-900 tracking-widest flex items-center gap-2">
            <Info size={14} className="text-blue-600" />
            Legend / Symbol Guide
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {timesheetLegendItems.map(item => (
              <div key={item.id} className="flex items-center gap-3 text-[10px] font-bold text-gray-600">
                <div
                  className={`w-7 h-7 rounded flex items-center justify-center text-[9px] font-black shrink-0`}
                  style={{ backgroundColor: item.bg, color: item.fg }}
                >
                  {item.code.split(/[…\s]/)[0]}
                </div>
                <div className="leading-tight">
                  <p className="text-[10px] font-black text-gray-900 uppercase tracking-wider">{item.code}</p>
                  <p className="text-[9px] font-medium text-gray-500 normal-case">{item.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="lg:w-80 bg-gray-50 rounded-xl p-6 space-y-3">
           <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest border-b pb-2">Policy Overview</p>
           <ul className="text-[9px] font-bold text-gray-600 space-y-2 uppercase leading-relaxed">
             <li>● OTHER POH: 4 TRAVEL DAYS</li>
             <li>● TERNATE POH: 2 TRAVEL DAYS</li>
             <li>● BOAT DAYS: MON, WED, THU, SAT</li>
             <li>● EXTRA LEAVE (Ce) EXPIRES IN 6 MONTHS</li>
             <li>● ANNUAL LEAVE (Ct) RESET TIAP ULANG TAHUN MASA KERJA</li>
             <li>● ROSTER CYCLE: 42 / 49 / 56 / 63 / 70 / 84 HARI</li>
           </ul>
        </div>
      </div>
    </div>
  );
}
