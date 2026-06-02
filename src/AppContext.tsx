import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Employee, LeaveRequest, CustomSymbol, LeaveType, ManualOverride, SignupRequest, BoatTimeOverride, CellNote, EMPLOYEE_IMPORT_COLMAP, EMPLOYEE_DATE_FIELDS, DocumentTemplate, DocumentRequest, Signature } from './types';
import { resolveRole } from './lib/auth';
import * as serverStore from './lib/serverStore';
import { mergeBuiltinSymbols } from './lib/builtinSymbols';

interface AppContextType {
  user: Employee | null;
  employees: Employee[];
  leaveRequests: LeaveRequest[];
  customSymbols: CustomSymbol[];
  leaveTypes: LeaveType[];
  overrides: ManualOverride[];
  signupRequests: SignupRequest[];
  boatOverrides: BoatTimeOverride[];
  cellNotes: CellNote[];
  loading: boolean;
  syncing: boolean;
  refreshFromSheets: () => Promise<void>;
  refreshSignupEmployees: () => Promise<Employee[]>;
  login: (email: string, password?: string) => Promise<boolean>;
  logout: () => void;
  importEmployees: (file: File) => Promise<void>;
  submitLeave: (request: Omit<LeaveRequest, 'id' | 'submittedAt'>) => Promise<void>;
  approveLeave: (requestId: string, adminId: string) => Promise<void>;
  approveLeaveAsDirect: (requestId: string, approverId: string) => void;
  approveLeaveAsIndirect: (requestId: string, approverId: string) => void;
  rejectLeave: (requestId: string, rejectorId: string, reason?: string) => void;
  updateSymbols: (symbols: CustomSymbol[]) => void;
  setEmployees: (employees: Employee[]) => void;
  setManualOverride: (override: ManualOverride) => void;
  setManualOverridesBulk: (overrides: ManualOverride[]) => void;
  removeManualOverride: (employeeId: string, date: string) => void;
  removeManualOverridesBulk: (employeeId: string, dates: string[]) => void;
  replaceAllOverrides: (overrides: ManualOverride[]) => void;
  importTimesheet: (file: File) => Promise<void>;
  updateEmployee: (employee: Employee) => void;
  setLeaveTypes: React.Dispatch<React.SetStateAction<LeaveType[]>>;
  // Signup
  submitSignupRequest: (req: Omit<SignupRequest, 'id' | 'submittedAt' | 'status'>) => Promise<{ ok: boolean; error?: string }>;
  approveSignupRequest: (id: string) => Promise<void>;
  rejectSignupRequest: (id: string) => void;
  // Accounts (login credentials)
  accounts: Employee[];
  updateAccountPassword: (accountId: string, newPassword: string) => Promise<void>;
  deleteAccount: (accountId: string) => Promise<void>;
  /** Ubah role akun login (Superuser only). Sync ke server, accounts, employees, dan user aktif. */
  setAccountRole: (accountId: string, role: import('./types').UserRole) => Promise<void>;
  // Boat
  setBoatOverride: (date: string, time: string) => void;
  removeBoatOverride: (date: string) => void;
  // Cell notes (Timesheet)
  setCellNote: (employeeId: string, date: string, text: string) => void;
  removeCellNote: (employeeId: string, date: string) => void;
  // HR Approval flow
  hrApproveLeave: (requestId: string, hrApproverId: string) => void;
  setHrApprover: (employeeId: string, value: boolean) => void;
  // Settings
  autoCalc: boolean;
  setAutoCalc: (v: boolean) => void;
  leavePreviewDays: number;
  setLeavePreviewDays: (v: number) => void;
  exportMonthsBack: number;
  setExportMonthsBack: (v: number) => void;
  exportMonthsAhead: number;
  setExportMonthsAhead: (v: number) => void;
  /** Anchor tanggal penggajian Lokal (1-31). Dipakai SKC Site bulk download. */
  payrollAnchorLokal: number;
  setPayrollAnchorLokal: (v: number) => void;
  payrollAnchorNonLokal: number;
  setPayrollAnchorNonLokal: (v: number) => void;
  // Bulk delete (Superuser)
  verifySuperuserPassword: (password: string) => Promise<boolean>;
  deleteLeaveRequests: (ids: string[]) => void;
  deleteAllLeaveRequests: () => void;
  deleteSignupRequests: (ids: string[]) => void;
  deleteAllSignupRequests: () => void;
  // ---- Document templates & requests ----
  documentTemplates: DocumentTemplate[];
  documentRequests: DocumentRequest[];
  addDocumentTemplate: (tpl: DocumentTemplate) => void;
  updateDocumentTemplate: (tpl: DocumentTemplate) => void;
  deleteDocumentTemplate: (id: string) => void;
  addDocumentRequest: (req: DocumentRequest) => void;
  approveDocumentAsDirect: (id: string, approverId: string) => void;
  approveDocumentAsIndirect: (id: string, approverId: string) => void;
  hrApproveDocument: (id: string, approverId: string) => void;
  approveDocument: (id: string, approverId: string) => void;
  rejectDocument: (id: string, rejectorId: string, reason?: string) => void;
  deleteDocumentRequests: (ids: string[]) => void;
  // ---- Signatures (TTD PNG untuk SKC) ----
  signatures: Signature[];
  addSignature: (sig: Signature) => void;
  updateSignature: (sig: Signature) => void;
  deleteSignature: (id: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// ----- Seed akun login (TIDAK muncul di daftar Employees) -----
function buildSeedAccounts(): Employee[] {
  const today = new Date().toISOString().split('T')[0];
  return [
    {
      id: 'acc-super', nik: '-', name: 'Super Admin',
      role: 'SUPERUSER', grade: 'Admin', department: 'Management',
      position: 'Superuser', poh: 'HO', joinDate: today, nextLeaveDate: '',
      email: 'super@gts.com', password: 'super123',
    },
    {
      id: 'acc-admin', nik: '-', name: 'Demo Admin',
      role: 'ADMIN', grade: '4', department: 'Plant',
      position: 'Admin Plant', poh: 'TERNATE', joinDate: today, nextLeaveDate: '',
      email: 'admin@gts.com', password: 'admin123',
    },
    {
      id: 'acc-user', nik: '-', name: 'Demo User',
      role: 'REGULAR', grade: '6', department: 'Plant',
      position: 'Operator', poh: 'FLUK', joinDate: today, nextLeaveDate: '',
      email: 'user@gts.com', password: 'user123',
    },
  ];
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [loading] = useState(false);
  const [syncing] = useState(false);
  const [user, setUser] = useState<Employee | null>(() => {
    const saved = localStorage.getItem('mineroster_user');
    if (!saved) return null;
    const expiry = Number(localStorage.getItem('mineroster_user_expiry') || '0');
    if (!expiry || Date.now() > expiry) {
      localStorage.removeItem('mineroster_user');
      localStorage.removeItem('mineroster_user_expiry');
      return null;
    }
    return JSON.parse(saved);
  });

  const [accounts, setAccounts] = useState<Employee[]>(() => {
    const SEED_VERSION = 'v3-accounts';
    if (localStorage.getItem('mineroster_seed_version') !== SEED_VERSION) {
      localStorage.removeItem('mineroster_employees');
      localStorage.removeItem('mineroster_user');
      localStorage.removeItem('mineroster_accounts');
      localStorage.setItem('mineroster_seed_version', SEED_VERSION);
      return buildSeedAccounts();
    }
    const saved = localStorage.getItem('mineroster_accounts');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Employee[];
        if (parsed.length > 0) return parsed;
      } catch { /* fall through */ }
    }
    return buildSeedAccounts();
  });

  const [employees, setEmployees] = useState<Employee[]>(() => {
    const saved = localStorage.getItem('mineroster_employees');
    if (saved) {
      try { return JSON.parse(saved) as Employee[]; } catch { /* ignore */ }
    }
    return [];
  });
  const signupEmployeesRef = useRef<Employee[] | null>(null);

  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>(() => {
    const saved = localStorage.getItem('mineroster_leaves');
    return saved ? JSON.parse(saved) : [];
  });

  const [customSymbols, setCustomSymbolsRaw] = useState<CustomSymbol[]>(() => {
    const saved = localStorage.getItem('mineroster_symbols');
    let parsed: CustomSymbol[] = [];
    if (saved) { try { parsed = JSON.parse(saved) as CustomSymbol[]; } catch { /* ignore */ } }
    return mergeBuiltinSymbols(parsed);
  });
  // Wrapper: setiap pembaruan customSymbols selalu di-merge ulang dengan built-in,
  // sehingga simbol bawaan tidak bisa hilang dan code-nya tetap konsisten.
  const setCustomSymbols: typeof setCustomSymbolsRaw = (next) => {
    setCustomSymbolsRaw(prev => {
      const value = typeof next === 'function' ? (next as (p: CustomSymbol[]) => CustomSymbol[])(prev) : next;
      return mergeBuiltinSymbols(value || []);
    });
  };

  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>(() => {
    const saved = localStorage.getItem('mineroster_leavetypes');
    if (saved) { try { return JSON.parse(saved); } catch { /* fall through */ } }
    return [
      { id: '1', name: 'Cuti Tahunan', description: 'Annual Leave' },
      { id: '2', name: 'Sakit', description: 'Sick Leave' },
      { id: '3', name: 'Dinas HO', description: 'Head Office Duty' },
      { id: '4', name: 'Cuti Melahirkan', description: 'Maternity Leave' },
    ];
  });

  const [signupRequests, setSignupRequests] = useState<SignupRequest[]>(() => {
    const saved = localStorage.getItem('mineroster_signups');
    return saved ? JSON.parse(saved) : [];
  });

  const [boatOverrides, setBoatOverrides] = useState<BoatTimeOverride[]>(() => {
    const saved = localStorage.getItem('mineroster_boatoverrides');
    return saved ? JSON.parse(saved) : [];
  });

  const [cellNotes, setCellNotes] = useState<CellNote[]>(() => {
    const saved = localStorage.getItem('mineroster_cellnotes');
    return saved ? JSON.parse(saved) : [];
  });

  const [documentTemplates, setDocumentTemplates] = useState<DocumentTemplate[]>(() => {
    const saved = localStorage.getItem('fluksite_doc_templates');
    return saved ? JSON.parse(saved) : [];
  });
  const [documentRequests, setDocumentRequests] = useState<DocumentRequest[]>(() => {
    const saved = localStorage.getItem('fluksite_doc_requests');
    return saved ? JSON.parse(saved) : [];
  });
  const [signatures, setSignatures] = useState<Signature[]>(() => {
    const saved = localStorage.getItem('fluksite_signatures');
    return saved ? JSON.parse(saved) : [];
  });

  const [autoCalc, setAutoCalcState] = useState<boolean>(() => {
    const saved = localStorage.getItem('mineroster_autocalc');
    return saved === null ? true : saved === '1';
  });
  const setAutoCalc = (v: boolean) => {
    setAutoCalcState(v);
    serverStore.setItem('mineroster_autocalc', v ? '1' : '0');
  };

  const [leavePreviewDays, setLeavePreviewDaysState] = useState<number>(() => {
    const saved = localStorage.getItem('mineroster_leave_preview_days');
    const n = saved === null ? 3 : Number(saved);
    return Number.isFinite(n) && n >= 1 && n <= 60 ? Math.round(n) : 3;
  });
  const setLeavePreviewDays = (v: number) => {
    const clamped = Math.min(60, Math.max(1, Math.round(v || 1)));
    setLeavePreviewDaysState(clamped);
    serverStore.setItem('mineroster_leave_preview_days', String(clamped));
  };

  const [exportMonthsBack, setExportMonthsBackState] = useState<number>(() => {
    const saved = localStorage.getItem('mineroster_export_months_back');
    const n = saved === null ? 11 : Number(saved);
    return Number.isFinite(n) && n >= 0 && n <= 36 ? Math.round(n) : 11;
  });
  const setExportMonthsBack = (v: number) => {
    const clamped = Math.min(36, Math.max(0, Math.round(v || 0)));
    setExportMonthsBackState(clamped);
    serverStore.setItem('mineroster_export_months_back', String(clamped));
  };
  const [exportMonthsAhead, setExportMonthsAheadState] = useState<number>(() => {
    const saved = localStorage.getItem('mineroster_export_months_ahead');
    const n = saved === null ? 1 : Number(saved);
    return Number.isFinite(n) && n >= 0 && n <= 12 ? Math.round(n) : 1;
  });
  const setExportMonthsAhead = (v: number) => {
    const clamped = Math.min(12, Math.max(0, Math.round(v || 0)));
    setExportMonthsAheadState(clamped);
    serverStore.setItem('mineroster_export_months_ahead', String(clamped));
  };

  const clampAnchor = (v: number) => Math.min(31, Math.max(1, Math.round(v || 1)));
  const [payrollAnchorLokal, setPayrollAnchorLokalState] = useState<number>(() => {
    const saved = localStorage.getItem('mineroster_payroll_anchor_lokal');
    return saved ? clampAnchor(Number(saved)) : 15;
  });
  const setPayrollAnchorLokal = (v: number) => {
    const c = clampAnchor(v);
    setPayrollAnchorLokalState(c);
    serverStore.setItem('mineroster_payroll_anchor_lokal', String(c));
  };
  const [payrollAnchorNonLokal, setPayrollAnchorNonLokalState] = useState<number>(() => {
    const saved = localStorage.getItem('mineroster_payroll_anchor_nonlokal');
    return saved ? clampAnchor(Number(saved)) : 15;
  });
  const setPayrollAnchorNonLokal = (v: number) => {
    const c = clampAnchor(v);
    setPayrollAnchorNonLokalState(c);
    serverStore.setItem('mineroster_payroll_anchor_nonlokal', String(c));
  };

  // Hidrasi awal dari server: kalau Express server hidup, tarik state terbaru
  // dan timpa cache lokal. Kalau server mati, tetap pakai cache localStorage.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let cancelled = false;
    serverStore.initServer().then((res) => {
      if (cancelled) return;
      if (res) {
        const d = res.data || {};
        if (d.mineroster_employees) setEmployees(d.mineroster_employees as Employee[]);
        if (d.mineroster_accounts) setAccounts(d.mineroster_accounts as Employee[]);
        if (d.mineroster_leaves) setLeaveRequests(d.mineroster_leaves as LeaveRequest[]);
        if (d.mineroster_symbols) setCustomSymbols(d.mineroster_symbols as CustomSymbol[]);
        if (d.mineroster_leavetypes) setLeaveTypes(d.mineroster_leavetypes as LeaveType[]);
        if (d.mineroster_signups) setSignupRequests(d.mineroster_signups as SignupRequest[]);
        if (d.mineroster_boatoverrides) setBoatOverrides(d.mineroster_boatoverrides as BoatTimeOverride[]);
        if (d.mineroster_cellnotes) setCellNotes(d.mineroster_cellnotes as CellNote[]);
        if (d.mineroster_overrides) setOverrides(d.mineroster_overrides as ManualOverride[]);
        if (d.fluksite_doc_templates) setDocumentTemplates(d.fluksite_doc_templates as DocumentTemplate[]);
        if (d.fluksite_doc_requests) setDocumentRequests(d.fluksite_doc_requests as DocumentRequest[]);
        if (d.fluksite_signatures) setSignatures(d.fluksite_signatures as Signature[]);
        if (d.mineroster_autocalc !== undefined) {
          const v = d.mineroster_autocalc;
          setAutoCalcState(v === '1' || v === 1 || v === true);
        }
        if (d.mineroster_payroll_anchor_lokal !== undefined) {
          const n = Number(d.mineroster_payroll_anchor_lokal); if (Number.isFinite(n)) setPayrollAnchorLokalState(clampAnchor(n));
        }
        if (d.mineroster_payroll_anchor_nonlokal !== undefined) {
          const n = Number(d.mineroster_payroll_anchor_nonlokal); if (Number.isFinite(n)) setPayrollAnchorNonLokalState(clampAnchor(n));
        }
        if (res.user) setUser(res.user as Employee);
      }
      setHydrated(true);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling sync: tiap 5 detik tarik perubahan dari server (multi-device).
  useEffect(() => {
    if (!hydrated) return;
    const apply = (key: string, v: unknown) => {
      switch (key) {
        case 'mineroster_employees': setEmployees(v as Employee[]); break;
        case 'mineroster_accounts': setAccounts(v as Employee[]); break;
        case 'mineroster_leaves': setLeaveRequests(v as LeaveRequest[]); break;
        case 'mineroster_symbols': setCustomSymbols(v as CustomSymbol[]); break;
        case 'mineroster_leavetypes': setLeaveTypes(v as LeaveType[]); break;
        case 'mineroster_signups': setSignupRequests(v as SignupRequest[]); break;
        case 'mineroster_boatoverrides': setBoatOverrides(v as BoatTimeOverride[]); break;
        case 'mineroster_cellnotes': setCellNotes(v as CellNote[]); break;
        case 'mineroster_overrides': setOverrides(v as ManualOverride[]); break;
        case 'fluksite_doc_templates': setDocumentTemplates(v as DocumentTemplate[]); break;
        case 'fluksite_doc_requests': setDocumentRequests(v as DocumentRequest[]); break;
        case 'fluksite_signatures': setSignatures(v as Signature[]); break;
        case 'mineroster_autocalc':
          setAutoCalcState(v === '1' || v === 1 || v === true);
          break;
      }
    };
    const tick = () => { serverStore.pollServer(apply); };
    tick();
    const id = window.setInterval(tick, 5000);
    const onFocus = () => tick();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [hydrated]);

  // Sync ke server (+ localStorage). Hanya setelah hydrated supaya tidak menimpa
  // server dengan cache localStorage saat boot pertama.
  useEffect(() => { if (hydrated) serverStore.setItem('mineroster_leavetypes', JSON.stringify(leaveTypes)); }, [leaveTypes, hydrated]);
  useEffect(() => { if (hydrated) serverStore.setItem('mineroster_employees', JSON.stringify(employees)); }, [employees, hydrated]);
  useEffect(() => { if (hydrated) serverStore.setItem('mineroster_accounts', JSON.stringify(accounts)); }, [accounts, hydrated]);
  useEffect(() => {
    if (user) {
      // Jangan simpan foto base64 ke localStorage (bisa >5MB → QuotaExceededError).
      // Foto akan dimuat ulang dari server saat boot via /api/auth/me.
      const { photo: _photo, ...slim } = user as Employee & { photo?: string };
      try {
        localStorage.setItem('mineroster_user', JSON.stringify(slim));
      } catch (err) {
        console.warn('[AppContext] gagal simpan user ke localStorage:', err);
        try { localStorage.removeItem('mineroster_user'); } catch { /* ignore */ }
      }
    } else {
      localStorage.removeItem('mineroster_user');
    }
  }, [user]);
  useEffect(() => { if (hydrated) serverStore.setItem('mineroster_leaves', JSON.stringify(leaveRequests)); }, [leaveRequests, hydrated]);
  useEffect(() => { if (hydrated) serverStore.setItem('mineroster_symbols', JSON.stringify(customSymbols)); }, [customSymbols, hydrated]);
  useEffect(() => { if (hydrated) serverStore.setItem('mineroster_signups', JSON.stringify(signupRequests)); }, [signupRequests, hydrated]);
  useEffect(() => { if (hydrated) serverStore.setItem('mineroster_boatoverrides', JSON.stringify(boatOverrides)); }, [boatOverrides, hydrated]);
  useEffect(() => { if (hydrated) serverStore.setItem('mineroster_cellnotes', JSON.stringify(cellNotes)); }, [cellNotes, hydrated]);
  useEffect(() => { if (hydrated) serverStore.setItem('fluksite_doc_templates', JSON.stringify(documentTemplates)); }, [documentTemplates, hydrated]);
  useEffect(() => { if (hydrated) serverStore.setItem('fluksite_doc_requests', JSON.stringify(documentRequests)); }, [documentRequests, hydrated]);
  useEffect(() => { if (hydrated) serverStore.setItem('fluksite_signatures', JSON.stringify(signatures)); }, [signatures, hydrated]);

  const login = async (email: string, password?: string) => {
    const markSession = () => {
      localStorage.setItem('mineroster_user_expiry', String(Date.now() + 12 * 60 * 60 * 1000));
    };
    // Mode server: validasi via API (bcrypt di backend).
    if (serverStore.isServerMode()) {
      const u = await serverStore.loginApi(email, password || '');
      if (u) { setUser(u as Employee); markSession(); return true; }
      return false;
    }
    // Mode offline/Lovable preview: pakai akun in-memory (legacy).
    const found = accounts.find(a => a.email.toLowerCase() === email.toLowerCase());
    if (!found) return false;
    if (found.password && password !== undefined && found.password !== password) return false;
    setUser(found);
    markSession();
    return true;
  };

  const logout = () => {
    serverStore.logoutApi();
    setUser(null);
    localStorage.removeItem('mineroster_user');
    localStorage.removeItem('mineroster_user_expiry');
  };

  // Auto-logout ketika sesi 12 jam habis (tanpa perlu reload).
  useEffect(() => {
    if (!user) return;
    const expiry = Number(localStorage.getItem('mineroster_user_expiry') || '0');
    if (!expiry) return;
    const ms = expiry - Date.now();
    if (ms <= 0) { logout(); return; }
    const t = setTimeout(() => { logout(); }, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const importEmployees = async (file: File) => {
    const XLSX = await import('xlsx');
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array', cellDates: false });
      const sheetName = workbook.SheetNames.find((n: string) => n.toLowerCase() === 'db') || workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];

      const normalizeDate = (val: any): string => {
        if (val === null || val === undefined || val === '') return '';
        if (val instanceof Date) {
          if (isNaN(val.getTime())) return '';
          const y = val.getFullYear();
          const m = String(val.getMonth() + 1).padStart(2, '0');
          const d = String(val.getDate()).padStart(2, '0');
          return `${y}-${m}-${d}`;
        }
        const num = typeof val === 'number' ? val : (/^\d+(\.\d+)?$/.test(String(val)) ? Number(val) : NaN);
        if (!isNaN(num) && num > 0) {
          try {
            const d = XLSX.SSF.parse_date_code(num);
            if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
          } catch { /* ignore */ }
        }
        const s = String(val).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        const monthsId: Record<string, string> = {
          januari: 'january', pebruari: 'february', februari: 'february', maret: 'march',
          april: 'april', mei: 'may', juni: 'june', juli: 'july', agustus: 'august',
          september: 'september', oktober: 'october', nopember: 'november', november: 'november', desember: 'december',
        };
        let lower = s.toLowerCase();
        Object.entries(monthsId).forEach(([id, en]) => { lower = lower.replace(id, en); });
        const d = new Date(lower);
        if (!isNaN(d.getTime())) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const da = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${da}`;
        }
        return s;
      };

      const newEmployees: Employee[] = [];
      const dateFieldSet = new Set<string>(EMPLOYEE_DATE_FIELDS as readonly string[]);
      rows.slice(1).forEach((r, idx) => {
        if (!r) return;
        // Map kolom XLSX (1-indexed) → field Employee, sesuai EMPLOYEE_IMPORT_COLMAP.
        const get = (colNum1: string) => {
          const v = r[Number(colNum1) - 1];
          return v === undefined || v === null ? '' : String(v).trim();
        };
        const nik = get('5');
        const name = get('6');
        if (!nik && !name) return;

        const baseEmp: Employee = {
          id: nik ? `emp-${nik}` : `emp-row-${idx}-${Date.now()}`,
          nik: '', name: '', position: '', department: '', grade: '5',
          joinDate: '', poh: '', nextLeaveDate: '', role: 'REGULAR', email: '',
        };

        Object.entries(EMPLOYEE_IMPORT_COLMAP).forEach(([colNum, field]) => {
          const raw = r[Number(colNum) - 1];
          if (dateFieldSet.has(field as string)) {
            (baseEmp as any)[field] = normalizeDate(raw);
          } else {
            (baseEmp as any)[field] = raw === undefined || raw === null ? '' : String(raw).trim();
          }
        });

        if (!baseEmp.grade) baseEmp.grade = '5';
        if (!baseEmp.email) baseEmp.email = `${baseEmp.nik || idx}@gts.com`;
        baseEmp.role = resolveRole(baseEmp);
        newEmployees.push(baseEmp);
      });

      setEmployees(prev => {
        const map = new Map<string, Employee>();
        prev.forEach(e => map.set(e.nik || e.id, e));
        newEmployees.forEach(e => {
          const existing = map.get(e.nik || e.id);
          map.set(e.nik || e.id, existing ? { ...existing, ...e, role: resolveRole({ ...existing, ...e }) } : e);
        });
        return Array.from(map.values());
      });
    };
    reader.readAsArrayBuffer(file);
  };

  const submitLeave = async (request: Omit<LeaveRequest, 'id' | 'submittedAt'>) => {
    const newRequest: LeaveRequest = {
      ...request,
      id: `leave-${Date.now()}`,
      submittedAt: new Date().toISOString()
    };
    setLeaveRequests(prev => [...prev, newRequest]);
  };

  /** Hapus override pada [startDate, endDate] untuk employee, supaya simbol leave muncul di timesheet. */
  const clearOverridesForLeave = (employeeId: string, startDate: string, endDate: string) => {
    setOverrides(prev => prev.filter(o => {
      if (o.employeeId !== employeeId) return true;
      return o.date < startDate || o.date > endDate;
    }));
  };

  const approveLeave = async (requestId: string, adminId: string) => {
    let target: LeaveRequest | undefined;
    setLeaveRequests(prev => prev.map(r => {
      if (r.id !== requestId) return r;
      target = r;
      return { ...r, status: 'APPROVED', approvedBy: adminId, approvedAt: new Date().toISOString(), rejectedBy: undefined, rejectedAt: undefined, rejectionReason: undefined };
    }));
    if (target) clearOverridesForLeave(target.employeeId, target.startDate, target.endDate);
  };

  const approveLeaveAsDirect = (requestId: string, approverId: string) => {
    setLeaveRequests(prev => prev.map(r =>
      r.id === requestId ? { ...r, directApprovedBy: approverId, directApprovedAt: new Date().toISOString() } : r
    ));
  };

  const approveLeaveAsIndirect = (requestId: string, approverId: string) => {
    setLeaveRequests(prev => prev.map(r =>
      r.id === requestId ? { ...r, indirectApprovedBy: approverId, indirectApprovedAt: new Date().toISOString() } : r
    ));
  };

  const rejectLeave = (requestId: string, rejectorId: string, reason?: string) => {
    setLeaveRequests(prev => prev.map(r =>
      r.id === requestId
        ? { ...r, status: 'REJECTED', rejectedBy: rejectorId, rejectedAt: new Date().toISOString(), rejectionReason: reason }
        : r
    ));
  };

  /** HR final approval — set status APPROVED + record HR id/timestamp. */
  const hrApproveLeave = (requestId: string, hrApproverId: string) => {
    let target: LeaveRequest | undefined;
    setLeaveRequests(prev => prev.map(r => {
      if (r.id !== requestId) return r;
      target = r;
      return { ...r, status: 'APPROVED', hrApprovedBy: hrApproverId, hrApprovedAt: new Date().toISOString(), approvedBy: hrApproverId, approvedAt: new Date().toISOString() };
    }));
    if (target) clearOverridesForLeave(target.employeeId, target.startDate, target.endDate);
  };

  /** Set/unset isHrApprover untuk satu employee + sync ke akun login. */
  const setHrApprover = (employeeId: string, value: boolean) => {
    setEmployees(prev => prev.map(e => {
      if (e.id !== employeeId) return e;
      const upd = { ...e, isHrApprover: value };
      return { ...upd, role: resolveRole(upd) };
    }));
    setAccounts(prev => prev.map(a => {
      if (a.id !== employeeId) return a;
      const upd = { ...a, isHrApprover: value };
      return { ...upd, role: resolveRole(upd) };
    }));
    if (user?.id === employeeId) {
      const upd = { ...user, isHrApprover: value };
      setUser({ ...upd, role: resolveRole(upd) });
    }
  };

  const updateSymbols = (symbols: CustomSymbol[]) => setCustomSymbols(symbols);

  const [overrides, setOverrides] = useState<ManualOverride[]>(() => {
    const saved = localStorage.getItem('mineroster_overrides');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => { if (hydrated) serverStore.setItem('mineroster_overrides', JSON.stringify(overrides)); }, [overrides, hydrated]);

  useEffect(() => {
    if (localStorage.getItem('mineroster_migrated_materialized') === '1') return;
    setOverrides(prev => prev.filter(o => {
      const s = String(o.symbol || '');
      if (s === '__BLANK__' || s === '') return false;
      if (/^__SKIP\d+__$/.test(s)) return false;
      return true;
    }));
    setEmployees(prev => prev.map(e => ({
      ...e, rosterAnchors: undefined, rosterWorkAnchors: undefined,
      clearBeforeDate: undefined, migratedToMaterialized: true,
    })));
    localStorage.setItem('mineroster_migrated_materialized', '1');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setManualOverride = (override: ManualOverride) => {
    setOverrides(prev => {
      const filtered = prev.filter(o => !(o.employeeId === override.employeeId && o.date === override.date));
      return [...filtered, override];
    });
  };

  const setManualOverridesBulk = (newOverrides: ManualOverride[]) => {
    setOverrides(prev => {
      const filtered = prev.filter(o =>
        !newOverrides.some(n => n.employeeId === o.employeeId && n.date === o.date)
      );
      return [...filtered, ...newOverrides];
    });
  };

  const removeManualOverride = (employeeId: string, date: string) => {
    setOverrides(prev => prev.filter(o => !(o.employeeId === employeeId && o.date === date)));
  };

  const removeManualOverridesBulk = (employeeId: string, dates: string[]) => {
    setOverrides(prev => prev.filter(o => {
      if (o.employeeId !== employeeId) return true;
      return !dates.includes(o.date);
    }));
  };

  const replaceAllOverrides = (next: ManualOverride[]) => {
    setOverrides(next);
  };

  const importTimesheet = async (file: File) => {
    // Legacy: not used anymore; the new TimesheetView calls timesheetImport helpers directly.
    const reader = new FileReader();
    reader.onload = () => {/* no-op */};
    reader.readAsArrayBuffer(file);
  };

  const updateEmployee = (employee: Employee) => {
    // Respect manually-set role from the Employee form. Only auto-resolve
    // when role is missing so admin can override Reguler → Admin/Superuser.
    const withRole = { ...employee, role: employee.role || resolveRole(employee) };
    setEmployees(prev => {
      const exists = prev.some(e => e.id === withRole.id);
      if (exists) return prev.map(e => e.id === withRole.id ? withRole : e);
      return [...prev, withRole];
    });
    if (user?.id === withRole.id) setUser(withRole);
    // Sync role to the login account so the next login reflects the change.
    setAccounts(prev => prev.map(a => a.id === withRole.id ? { ...a, role: withRole.role } : a));
  };

  // ---- Signup ----
  const refreshSignupEmployees = async (): Promise<Employee[]> => {
    const fresh = await serverStore.fetchSignupEmployees<Pick<Employee, 'id' | 'nik' | 'name'>>();
    if (!fresh) return signupEmployeesRef.current ?? employees;
    const normalized = fresh
      .map((e) => ({
        id: String(e.id || e.nik).trim(),
        nik: String(e.nik || '').trim(),
        name: String(e.name || '').trim(),
        position: '', department: '', grade: '', joinDate: '', poh: '', nextLeaveDate: '',
        role: 'REGULAR' as const,
        email: '',
      }))
      .filter((e) => e.nik && e.name);
    signupEmployeesRef.current = normalized;
    return normalized;
  };

  const submitSignupRequest = async (req: Omit<SignupRequest, 'id' | 'submittedAt' | 'status'>): Promise<{ ok: boolean; error?: string }> => {
    const nikNorm = req.nik.trim();
    const nikKey = nikNorm.toLowerCase();
    // Tarik daftar karyawan terbaru dari server dulu supaya pendaftar baru
    // (device baru, cache lokal masih kosong, initServer mungkin belum
    // selesai) tidak ditolak hanya karena database belum sempat sinkron.
    let pool = await refreshSignupEmployees();
    if (!serverStore.isServerMode()) {
      // Paksa cek server sekali lagi — bisa jadi initServer belum selesai
      // ketika user buru-buru menekan Daftar.
      try { await serverStore.initServer(); } catch { /* ignore */ }
    }
    if (serverStore.isServerMode()) {
      try {
        const fresh = await serverStore.fetchKey<Employee[]>('mineroster_employees');
        if (Array.isArray(fresh)) {
          pool = fresh;
          setEmployees(fresh);
        }
      } catch { /* ignore — fallback ke pool lokal */ }
    } else {
      // Server tidak terjangkau sama sekali — beri pesan yang jelas, jangan
      // menyalahkan NIK.
      return { ok: false, error: 'Database belum termuat. Periksa koneksi ke server lalu coba lagi.' };
    }
    const matched = pool.find(e => e.nik.trim().toLowerCase() === nikKey);
    if (!matched) {
      return { ok: false, error: 'NIK tidak ditemukan di daftar karyawan. Hubungi admin.' };
    }
    if (accounts.some(a => a.id === matched.id || a.nik === matched.nik)) {
      return { ok: false, error: 'Akun untuk karyawan ini sudah terdaftar.' };
    }
    if (signupRequests.some(r => r.status === 'PENDING' && r.nik.trim() === nikNorm)) {
      return { ok: false, error: 'Permintaan untuk NIK ini sudah ada dan menunggu approval.' };
    }
    if (serverStore.isServerMode()) {
      const r = await serverStore.submitSignupApi({
        name: matched.name, nik: nikNorm, password: req.password, photo: req.photo,
      });
      if (!r.ok) {
        if (r.error === 'nik_tidak_ditemukan') {
          return { ok: false, error: 'NIK tidak ditemukan di daftar karyawan. Hubungi admin.' };
        }
        if (r.error === 'permintaan_sudah_ada') {
          return { ok: false, error: 'Permintaan untuk NIK ini sudah ada dan menunggu approval.' };
        }
        return { ok: false, error: 'Gagal mengirim ke server. Coba lagi.' };
      }
      return { ok: true };
    }
    setSignupRequests(prev => [...prev, {
      ...req, name: matched.name, id: `signup-${Date.now()}`, submittedAt: new Date().toISOString(), status: 'PENDING',
    }]);
    return { ok: true };
  };

  const approveSignupRequest = async (id: string) => {
    const req = signupRequests.find(r => r.id === id);
    if (!req) return;
    const matched = employees.find(e => e.nik.trim() === req.nik.trim());
    if (!matched) {
      // Karyawan sudah dihapus / berubah — tolak request.
      setSignupRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'REJECTED' } : r));
      return;
    }
    const newAccount: Employee = {
      ...matched,
      id: matched.id,
      role: resolveRole(matched),
      email: `${matched.nik}@gts.com`,
      password: req.password,
      photo: req.photo,
    };
    // Server mode: kirim ke DB supaya user bisa login dari device manapun.
    if (serverStore.isServerMode()) {
      const ok = await serverStore.upsertUserApi({
        id: newAccount.id,
        email: newAccount.email!,
        name: newAccount.name,
        nik: newAccount.nik,
        role: newAccount.role,
        password: req.password,
        profile: {
          nik: matched.nik,
          department: matched.department,
          position: matched.position,
          grade: matched.grade,
          poh: matched.poh,
          joinDate: matched.joinDate,
          nextLeaveDate: matched.nextLeaveDate,
          isHrApprover: matched.isHrApprover,
          photo: req.photo,
        },
      });
      if (!ok) {
        alert('Gagal menyimpan akun ke server. Coba lagi.');
        return;
      }
    }
    setAccounts(prev => [...prev.filter(a => a.id !== newAccount.id), newAccount]);
    setSignupRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'APPROVED' } : r));
  };

  const rejectSignupRequest = (id: string) => {
    setSignupRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'REJECTED' } : r));
  };

  // ---- Boat ----
  const setBoatOverride = (date: string, time: string) => {
    setBoatOverrides(prev => {
      const filtered = prev.filter(o => o.date !== date);
      return [...filtered, { date, time }];
    });
  };
  const removeBoatOverride = (date: string) => {
    setBoatOverrides(prev => prev.filter(o => o.date !== date));
  };

  const SEED_ACCOUNT_IDS = new Set(['acc-super', 'acc-admin', 'acc-user']);
  const updateAccountPassword = async (accountId: string, newPassword: string) => {
    if (serverStore.isServerMode()) {
      const ok = await serverStore.changePasswordApi(accountId, newPassword);
      if (!ok) {
        alert('Gagal mengubah password di server.');
        return;
      }
    }
    setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, password: newPassword } : a));
  };
  const deleteAccount = async (accountId: string) => {
    if (SEED_ACCOUNT_IDS.has(accountId)) return;
    if (serverStore.isServerMode()) {
      const ok = await serverStore.deleteUserApi(accountId);
      if (!ok) {
        alert('Gagal menghapus akun di server.');
        return;
      }
    }
    setAccounts(prev => prev.filter(a => a.id !== accountId));
  };

  const setAccountRole = async (accountId: string, role: import('./types').UserRole) => {
    const acc = accounts.find(a => a.id === accountId);
    if (!acc) return;
    // Ambil data lengkap dari employee record (lebih kaya daripada account)
    // supaya privilage role baru bisa langsung berfungsi (mis. ADMIN butuh
    // department yang valid untuk melihat data se-departemen).
    const emp = employees.find(e => e.id === accountId);
    const src: any = emp || acc;
    const profile = {
      nik: src.nik,
      department: src.department,
      position: src.position,
      grade: src.grade,
      poh: src.poh,
      joinDate: src.joinDate,
      nextLeaveDate: src.nextLeaveDate,
      isHrApprover: src.isHrApprover,
      ...(src.photo ? { photo: src.photo } : {}),
    };
    if (serverStore.isServerMode()) {
      const ok = await serverStore.upsertUserApi({
        id: acc.id,
        email: acc.email || `${acc.nik}@gts.com`,
        name: acc.name,
        nik: src.nik || acc.nik,
        role,
        profile,
      });
      if (!ok) {
        alert('Gagal mengubah role di server.');
        return;
      }
    }
    // Tarik field privilage ke akun lokal supaya pengecekan client-side
    // (canViewEmployee, canSubmitLeaveFor, dll) langsung melihat data lengkap.
    setAccounts(prev => prev.map(a => a.id === accountId ? {
      ...a, role,
      department: src.department || a.department,
      position: src.position || a.position,
      grade: src.grade || a.grade,
    } : a));
    setEmployees(prev => prev.map(e => e.id === accountId ? { ...e, role } : e));
    if (user?.id === accountId) setUser({
      ...user, role,
      department: src.department || user.department,
      position: src.position || user.position,
      grade: src.grade || user.grade,
    });
  };

  const refreshFromSheets = async () => {};

  // ---- Superuser bulk delete ----
  const verifySuperuserPassword = async (password: string): Promise<boolean> => {
    if (!password) return false;
    if (serverStore.isServerMode()) {
      return await serverStore.verifySuperuserPasswordApi(password);
    }
    return accounts.some(a => a.role === 'SUPERUSER' && a.password === password);
  };
  const deleteLeaveRequests = (ids: string[]) => {
    if (!ids.length) return;
    const set = new Set(ids);
    setLeaveRequests(prev => prev.filter(r => !set.has(r.id)));
  };
  const deleteAllLeaveRequests = () => setLeaveRequests([]);
  const deleteSignupRequests = (ids: string[]) => {
    if (!ids.length) return;
    const set = new Set(ids);
    setSignupRequests(prev => prev.filter(r => !set.has(r.id)));
  };
  const deleteAllSignupRequests = () => setSignupRequests([]);

  // ---- Document templates & requests ----
  const addDocumentTemplate = (tpl: DocumentTemplate) => {
    setDocumentTemplates(prev => [...prev.filter(t => t.id !== tpl.id), tpl]);
  };
  const updateDocumentTemplate = (tpl: DocumentTemplate) => {
    setDocumentTemplates(prev => prev.map(t => t.id === tpl.id ? tpl : t));
  };
  const deleteDocumentTemplate = (id: string) => {
    setDocumentTemplates(prev => prev.filter(t => t.id !== id));
  };
  const addDocumentRequest = (req: DocumentRequest) => {
    setDocumentRequests(prev => [...prev, req]);
  };
  /**
   * Re-render dokumen pengajuan dengan menyisipkan TTD pengaju + approver
   * yang sudah tanda tangan. Placeholder image yang dipakai:
   *   {%ttd_sendiri}    → TTD pengaju (selalu, kalau ada)
   *   {%ttd_atasan}     → TTD direct supervisor (setelah approve)
   *   {%ttd_dept_head}  → TTD indirect supervisor (setelah approve)
   *   {%ttd_hr}         → TTD HR approver (setelah HR approve)
   * docxUrl pada request akan diganti dengan hasil render terbaru.
   */
  const rerenderDocumentWithSignatures = async (
    reqId: string,
    overrides: Partial<{
      directApproverId: string;
      indirectApproverId: string;
      hrApproverId: string;
    }>,
  ) => {
    const req = documentRequests.find(r => r.id === reqId);
    if (!req) return;
    const tpl = documentTemplates.find(t => t.id === req.templateId);
    if (!tpl?.docxUrl) return;
    const sigFor = (ownerId?: string) => {
      if (!ownerId) return undefined;
      return [...signatures]
        .filter(s => s.ownerId === ownerId)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
    };
    const images: Record<string, string> = {};
    const ownSig = sigFor(req.employeeId);
    if (ownSig) images['ttd_sendiri'] = ownSig.url;
    const directId = overrides.directApproverId || req.directApprovedBy;
    if (directId) {
      const s = sigFor(directId);
      if (s) images['ttd_atasan'] = s.url;
    }
    const indirectId = overrides.indirectApproverId || req.indirectApprovedBy;
    if (indirectId) {
      const s = sigFor(indirectId);
      if (s) images['ttd_dept_head'] = s.url;
    }
    const hrId = overrides.hrApproverId || req.hrApprovedBy;
    if (hrId) {
      const s = sigFor(hrId);
      if (s) images['ttd_hr'] = s.url;
    }
    try {
      const r = await serverStore.renderDocxTemplate(tpl.docxUrl, req.values || {}, {
        format: 'docx', images,
      });
      if (r.docxUrl) {
        setDocumentRequests(prev => prev.map(x =>
          x.id === reqId ? { ...x, docxUrl: r.docxUrl } : x,
        ));
      }
    } catch (e) {
      console.warn('[doc-rerender] gagal', e);
    }
  };

  const approveDocumentAsDirect = (id: string, approverId: string) => {
    setDocumentRequests(prev => prev.map(r =>
      r.id === id ? { ...r, directApprovedBy: approverId, directApprovedAt: new Date().toISOString() } : r
    ));
    rerenderDocumentWithSignatures(id, { directApproverId: approverId });
  };
  const approveDocumentAsIndirect = (id: string, approverId: string) => {
    setDocumentRequests(prev => prev.map(r =>
      r.id === id ? { ...r, indirectApprovedBy: approverId, indirectApprovedAt: new Date().toISOString() } : r
    ));
    rerenderDocumentWithSignatures(id, { indirectApproverId: approverId });
  };
  const hrApproveDocument = (id: string, approverId: string) => {
    setDocumentRequests(prev => prev.map(r => r.id === id ? {
      ...r, status: 'APPROVED',
      hrApprovedBy: approverId, hrApprovedAt: new Date().toISOString(),
      approvedBy: approverId, approvedAt: new Date().toISOString(),
    } : r));
    rerenderDocumentWithSignatures(id, { hrApproverId: approverId });
  };
  const approveDocument = (id: string, approverId: string) => {
    setDocumentRequests(prev => prev.map(r => r.id === id ? {
      ...r, status: 'APPROVED',
      approvedBy: approverId, approvedAt: new Date().toISOString(),
      rejectedBy: undefined, rejectedAt: undefined, rejectionReason: undefined,
    } : r));
  };
  const rejectDocument = (id: string, rejectorId: string, reason?: string) => {
    setDocumentRequests(prev => prev.map(r => r.id === id ? {
      ...r, status: 'REJECTED',
      rejectedBy: rejectorId, rejectedAt: new Date().toISOString(),
      rejectionReason: reason,
    } : r));
  };
  const deleteDocumentRequests = (ids: string[]) => {
    if (!ids.length) return;
    const set = new Set(ids);
    setDocumentRequests(prev => prev.filter(r => !set.has(r.id)));
  };

  const addSignature = (sig: Signature) => {
    setSignatures(prev => [...prev.filter(s => s.id !== sig.id), sig]);
  };
  const updateSignature = (sig: Signature) => {
    setSignatures(prev => prev.map(s => s.id === sig.id ? sig : s));
  };
  const deleteSignature = (id: string) => {
    setSignatures(prev => prev.filter(s => s.id !== id));
  };

  const setCellNote = (employeeId: string, date: string, text: string) => {
    setCellNotes(prev => {
      const filtered = prev.filter(n => !(n.employeeId === employeeId && n.date === date));
      if (!text.trim()) return filtered;
      return [...filtered, { employeeId, date, text, updatedAt: new Date().toISOString() }];
    });
  };
  const removeCellNote = (employeeId: string, date: string) => {
    setCellNotes(prev => prev.filter(n => !(n.employeeId === employeeId && n.date === date)));
  };

  return (
    <AppContext.Provider value={{
      user, employees, leaveRequests, customSymbols, leaveTypes, overrides,
      signupRequests, boatOverrides,
      cellNotes,
      loading, syncing, refreshFromSheets, refreshSignupEmployees,
      login, logout, importEmployees, submitLeave, approveLeave, approveLeaveAsDirect, approveLeaveAsIndirect, rejectLeave, updateSymbols, setEmployees,
      setManualOverride, setManualOverridesBulk, removeManualOverride, removeManualOverridesBulk, replaceAllOverrides, importTimesheet, updateEmployee, setLeaveTypes,
      submitSignupRequest, approveSignupRequest, rejectSignupRequest,
      accounts, updateAccountPassword, deleteAccount, setAccountRole,
      setBoatOverride, removeBoatOverride,
      setCellNote, removeCellNote,
      hrApproveLeave, setHrApprover,
      autoCalc, setAutoCalc,
      leavePreviewDays, setLeavePreviewDays,
      exportMonthsBack, setExportMonthsBack,
      exportMonthsAhead, setExportMonthsAhead,
      payrollAnchorLokal, setPayrollAnchorLokal,
      payrollAnchorNonLokal, setPayrollAnchorNonLokal,
      verifySuperuserPassword,
      deleteLeaveRequests, deleteAllLeaveRequests,
      deleteSignupRequests, deleteAllSignupRequests,
      documentTemplates, documentRequests,
      addDocumentTemplate, updateDocumentTemplate, deleteDocumentTemplate,
      addDocumentRequest,
      approveDocumentAsDirect, approveDocumentAsIndirect, hrApproveDocument,
      approveDocument, rejectDocument, deleteDocumentRequests,
      signatures, addSignature, updateSignature, deleteSignature,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) throw new Error('useApp must be used within an AppProvider');
  return context;
}
