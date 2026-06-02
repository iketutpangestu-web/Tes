import React, { useRef, useState, useMemo, useEffect } from 'react';
import { useApp } from '../AppContext';
import { Upload, Download, Search, Edit2, X, Save, Trash2, UserPlus, ShieldCheck, ChevronDown, ChevronUp, Filter, ArrowDownAZ, ArrowUpAZ, ArrowUpDown } from 'lucide-react';
import SuperuserPasswordModal from './SuperuserPasswordModal';
import { format, isValid } from 'date-fns';
import * as XLSX from 'xlsx';
import { Employee, EMPLOYEE_COMPACT_COLUMNS, EMPLOYEE_COLUMN_LABELS, EMPLOYEE_IMPORT_COLMAP } from '../types';
import { safeParse } from '../lib/roster';
import AccountManagement from './AccountManagement';

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string; }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] uppercase font-black text-gray-400">{label}</label>
      <input
        type={type}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-50 border-0 border-b-2 border-gray-200 focus:border-blue-600 focus:ring-0 px-0 py-2 text-sm font-bold transition-all"
      />
    </div>
  );
}

function genderLabel(g?: string): string {
  const v = String(g ?? '').trim();
  if (v.toUpperCase() === 'L') return 'Laki-laki';
  if (v.toUpperCase() === 'P') return 'Perempuan';
  return v;
}

function genderCode(g?: string): 'L' | 'P' | '' {
  const v = String(g ?? '').trim().toUpperCase();
  if (v === 'L' || v === 'LAKI-LAKI' || v === 'LAKI LAKI' || v === 'PRIA') return 'L';
  if (v === 'P' || v === 'PEREMPUAN' || v === 'WANITA') return 'P';
  return '';
}

export default function EmployeeList() {
  const { user, employees, importEmployees, updateEmployee, setEmployees, verifySuperuserPassword } = useApp();
  const isReadOnly = user?.role === 'ADMIN';
  const isSuperuser = user?.role === 'SUPERUSER';
  const canToggleAllCols = user?.role === 'SUPERUSER' || user?.role === 'APPROVAL_HR';
  const [showAccounts, setShowAccounts] = useState(false);
  const visibleEmployees = useMemo(() =>
    user?.role === 'ADMIN'
      ? employees.filter(e => e.department === user.department)
      : employees
  , [employees, user]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('ALL');
  const [filterGrade, setFilterGrade] = useState('ALL');
  // Per-column filter & sort
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({});
  const [colSort, setColSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null);
  const [openColMenu, setOpenColMenu] = useState<string | null>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteAllPwd, setDeleteAllPwd] = useState('');
  const [deleteAllErr, setDeleteAllErr] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [showExportAllPwd, setShowExportAllPwd] = useState(false);

  const verifySuperPwd = (p: string) => verifySuperuserPassword(p);

  const allColumns = useMemo(() => Object.keys(EMPLOYEE_IMPORT_COLMAP), []);
  const visibleCols = (canToggleAllCols && showAll) ? allColumns : EMPLOYEE_COMPACT_COLUMNS;
  const dateColSet = new Set(['28','29','36','39']);

  // Nilai unik per kolom untuk dropdown filter
  const colUniqueValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    visibleCols.forEach(col => {
      const field = EMPLOYEE_IMPORT_COLMAP[col];
      const set = new Set<string>();
      visibleEmployees.forEach(e => {
        const v = (e as any)[field];
        if (v !== undefined && v !== null && String(v).trim() !== '') set.add(String(v));
      });
      map[col] = Array.from(set).sort((a, b) => a.localeCompare(b, 'id', { sensitivity: 'base' }));
    });
    return map;
  }, [visibleEmployees, visibleCols]);

  const departments = useMemo(() => {
    const s = new Set<string>();
    visibleEmployees.forEach(e => { if (e.department) s.add(e.department); });
    return Array.from(s).sort();
  }, [visibleEmployees]);

  const grades = useMemo(() => {
    const s = new Set<string>();
    visibleEmployees.forEach(e => { if (e.grade) s.add(e.grade); });
    return Array.from(s).sort();
  }, [visibleEmployees]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = visibleEmployees.filter(e => {
      if (filterDept !== 'ALL' && e.department !== filterDept) return false;
      if (filterGrade !== 'ALL' && e.grade !== filterGrade) return false;
      if (q && !(e.name?.toLowerCase().includes(q) || e.nik?.toLowerCase().includes(q))) return false;
      // per-column filter
      for (const [col, values] of Object.entries(colFilters)) {
        if (!values || values.length === 0) continue;
        const field = EMPLOYEE_IMPORT_COLMAP[col];
        const v = (e as any)[field];
        if (!values.includes(String(v ?? ''))) return false;
      }
      return true;
    });
    if (colSort) {
      const field = EMPLOYEE_IMPORT_COLMAP[colSort.col];
      const dir = colSort.dir === 'asc' ? 1 : -1;
      return [...base].sort((a, b) => {
        const va = String((a as any)[field] ?? '');
        const vb = String((b as any)[field] ?? '');
        return va.localeCompare(vb, 'id', { sensitivity: 'base' }) * dir;
      });
    }
    return base.sort((a, b) => {
      const d = (a.department || '').localeCompare(b.department || '', 'id', { sensitivity: 'base' });
      if (d !== 0) return d;
      return (a.name || '').localeCompare(b.name || '', 'id', { sensitivity: 'base' });
    });
  }, [visibleEmployees, search, filterDept, filterGrade, colFilters, colSort]);

  const formatDateLabel = (dateStr: string) => {
    if (!dateStr) return 'N/A';
    if (/^\d{5}$/.test(dateStr)) {
      try {
        const d = XLSX.SSF.parse_date_code(Number(dateStr));
        return format(new Date(d.y, d.m - 1, d.d), 'dd MMM yyyy').toLowerCase();
      } catch { return dateStr; }
    }
    try {
      const d = safeParse(dateStr);
      return format(d, 'dd MMM yyyy').toLowerCase();
    } catch { return dateStr; }
  };

  const ensureISODate = (dateStr: string) => {
    if (!dateStr) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    if (/^\d{5}$/.test(dateStr)) {
      try {
        const d = XLSX.SSF.parse_date_code(Number(dateStr));
        return format(new Date(d.y, d.m - 1, d.d), 'yyyy-MM-dd');
      } catch { return ''; }
    }
    try {
      const d = safeParse(dateStr);
      if (isValid(d)) return format(d, 'yyyy-MM-dd');
      const fb = new Date(dateStr);
      if (isValid(fb)) return format(fb, 'yyyy-MM-dd');
    } catch { /* ignore */ }
    return '';
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) importEmployees(e.target.files[0]);
  };

  const handleExport = () => {
    const rows = filtered.map((e, i) => ({
      No: i + 1,
      NIK: e.nik,
      Nama: e.name,
      Jabatan: e.position,
      'Jenis Kelamin': genderLabel(e.gender),
      Status: e.status || '',
      Departemen: e.department,
      Golongan: e.grade,
      Role: e.role,
      Grading: e.grading || '',
      POH: e.poh,
      Mess: e.mess || '',
      'Tanggal Join': ensureISODate(e.joinDate),
      'Tanggal Lahir': ensureISODate(e.birthDate || ''),
      Email: e.email,
      'No HP': e.phone || '',
      'Cuti Terakhir': ensureISODate(e.lastLeaveDate || ''),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Employees');
    const stamp = format(new Date(), 'yyyyMMdd-HHmm');
    XLSX.writeFile(wb, `employees-${stamp}.xlsx`);
  };

  // Export semua karyawan dalam format yang kompatibel dengan template import (Sheet "DB",
  // kolom 1-indexed sesuai EMPLOYEE_IMPORT_COLMAP). Header row di baris 1, data mulai baris 2.
  const handleExportAll = () => {
    const colNums = Object.keys(EMPLOYEE_IMPORT_COLMAP).map(n => Number(n));
    const maxCol = Math.max(64, ...colNums);
    const header: any[] = new Array(maxCol).fill('');
    colNums.forEach(n => { header[n - 1] = EMPLOYEE_COLUMN_LABELS[String(n)] || String(n); });
    const aoa: any[][] = [header];
    employees.forEach(emp => {
      const row: any[] = new Array(maxCol).fill('');
      Object.entries(EMPLOYEE_IMPORT_COLMAP).forEach(([colNum, field]) => {
        const v = (emp as any)[field];
        if (v === undefined || v === null) return;
        if ((['joinDate','joinDateLatest','birthDate','terminationDate','lastLeaveDate'] as string[]).includes(field as string)) {
          row[Number(colNum) - 1] = ensureISODate(String(v));
        } else {
          row[Number(colNum) - 1] = String(v);
        }
      });
      aoa.push(row);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'DB');
    const stamp = format(new Date(), 'yyyyMMdd-HHmm');
    XLSX.writeFile(wb, `employees-all-${stamp}.xlsx`);
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingEmployee) {
      updateEmployee(editingEmployee);
      setEditingEmployee(null);
    }
  };

  const setField = (k: keyof Employee, v: string | number | undefined) => {
    if (!editingEmployee) return;
    setEditingEmployee({ ...editingEmployee, [k]: v } as Employee);
  };

  return (
    <div className="space-y-6">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Personnel Database</h2>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-widest mt-1">
            Sumber: data lokal aplikasi
          </p>
        </div>
        <div className="flex gap-3">
          <input type="file" ref={fileInputRef} onChange={handleImport} className="hidden" accept=".xlsx, .xls" />
          {!isReadOnly && (
            <>
              <button
                onClick={() => setEditingEmployee({
                  id: `emp-${Date.now()}`,
                  nik: '', name: '', position: '', department: '', grade: '5',
                  joinDate: new Date().toISOString().split('T')[0],
                  poh: '', nextLeaveDate: '', role: 'REGULAR', email: '',
                  gender: '', status: '', grading: '', mess: '', birthDate: '', phone: '', lastLeaveDate: '',
                })}
                className="bg-blue-600 text-white px-5 py-2.5 rounded-lg flex items-center gap-2 text-xs font-bold hover:bg-blue-700 transition-all shadow-sm"
              >
                <UserPlus size={14} /><span>Tambah Karyawan</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="bg-white border border-gray-200 text-gray-700 px-5 py-2.5 rounded-lg flex items-center gap-2 text-xs font-bold hover:bg-gray-50 transition-all shadow-sm"
              >
                <Upload size={14} /><span>Import XLSX</span>
              </button>
            </>
          )}
          <div className="relative">
            <button
              onClick={() => setExportMenu(m => !m)}
              className="bg-white border border-gray-200 text-gray-700 px-5 py-2.5 rounded-lg flex items-center gap-2 text-xs font-bold hover:bg-gray-50 transition-all shadow-sm"
            >
              <Download size={14} /><span>Export XLSX</span><ChevronDown size={12} />
            </button>
            {exportMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setExportMenu(false)} />
                <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-xl z-20 overflow-hidden">
                  <button
                    onClick={() => { setExportMenu(false); handleExport(); }}
                    disabled={filtered.length === 0}
                    className="w-full text-left px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Export This
                    <div className="text-[10px] text-gray-400 font-medium mt-0.5">Data terfilter saat ini</div>
                  </button>
                  <button
                    onClick={() => { setExportMenu(false); setShowExportAllPwd(true); }}
                    disabled={employees.length === 0}
                    className="w-full text-left px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50 border-t border-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Export All
                    <div className="text-[10px] text-gray-400 font-medium mt-0.5">Semua karyawan, format template import (perlu password Superuser)</div>
                  </button>
                </div>
              </>
            )}
          </div>
          {canToggleAllCols && (
            <button
              onClick={() => setShowAll(s => !s)}
              className="bg-white border border-gray-200 text-gray-700 px-5 py-2.5 rounded-lg flex items-center gap-2 text-xs font-bold hover:bg-gray-50 transition-all shadow-sm"
            >
              {showAll ? <><ChevronUp size={14} /><span>Tampilkan Ringkas</span></> : <><ChevronDown size={14} /><span>Lihat Semua Kolom</span></>}
            </button>
          )}
          {isSuperuser && (
            <>
              <button
                onClick={() => setShowAccounts(true)}
                className="bg-gray-900 text-white px-5 py-2.5 rounded-lg flex items-center gap-2 text-xs font-bold hover:bg-gray-800 transition-all shadow-sm"
              >
                <ShieldCheck size={14} /><span>Lihat Akun</span>
              </button>
              <button
                onClick={() => { setDeleteAllPwd(''); setDeleteAllErr(''); setShowDeleteAll(true); }}
                disabled={employees.length === 0}
                className="bg-red-600 text-white px-5 py-2.5 rounded-lg flex items-center gap-2 text-xs font-bold hover:bg-red-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 size={14} /><span>Hapus Semua</span>
              </button>
            </>
          )}
        </div>
      </header>

      {showAccounts && <AccountManagement onClose={() => setShowAccounts(false)} />}

      <SuperuserPasswordModal
        open={showExportAllPwd}
        title="Export Semua Karyawan"
        description="Masukkan password Superuser untuk mengekspor seluruh data karyawan dalam format template import."
        confirmLabel="Export"
        verify={verifySuperPwd}
        onConfirm={handleExportAll}
        onClose={() => setShowExportAllPwd(false)}
      />

      {showDeleteAll && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="font-bold text-gray-900 uppercase tracking-widest text-xs flex items-center gap-2 mb-2">
              <Trash2 size={14} className="text-red-600" /> Hapus Semua Karyawan
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Tindakan ini akan menghapus <b>{employees.length}</b> karyawan dari aplikasi dan tidak dapat dibatalkan. Masukkan password Superuser untuk mengonfirmasi.
            </p>
            <input
              type="password"
              autoFocus
              value={deleteAllPwd}
              onChange={(e) => { setDeleteAllPwd(e.target.value); setDeleteAllErr(''); }}
              placeholder="Password Superuser"
              className="w-full bg-gray-50 border-2 border-gray-200 focus:border-red-500 focus:ring-0 px-3 py-2 text-sm font-bold rounded-lg"
            />
            {deleteAllErr && <p className="text-xs text-red-600 font-bold mt-2">{deleteAllErr}</p>}
            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => setShowDeleteAll(false)}
                className="px-5 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg uppercase tracking-widest"
              >Batal</button>
              <button
                onClick={async () => {
                  const ok = await verifySuperuserPassword(deleteAllPwd);
                  if (!ok) {
                    setDeleteAllErr('Password salah');
                    return;
                  }
                  setEmployees([]);
                  setShowDeleteAll(false);
                  setDeleteAllPwd('');
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg uppercase tracking-widest"
              >Hapus Semua</button>
            </div>
          </div>
        </div>
      )}

      {editingEmployee && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 sticky top-0 z-10">
              <h3 className="font-bold text-gray-900 uppercase tracking-widest text-xs flex items-center gap-2">
                <Edit2 size={14} /> Detail Karyawan: {editingEmployee.name || '(baru)'}
              </h3>
              <button onClick={() => setEditingEmployee(null)} className="p-2 hover:bg-white rounded-full transition-colors text-gray-400 hover:text-gray-900">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleUpdate} className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Field label="NIK" value={editingEmployee.nik} onChange={(v) => setField('nik', v)} />
                <Field label="Nama" value={editingEmployee.name} onChange={(v) => setField('name', v)} />
                <Field label="Jabatan" value={editingEmployee.position} onChange={(v) => setField('position', v)} />
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-black text-gray-400">Jenis Kelamin</label>
                  <select value={genderCode(editingEmployee.gender)} onChange={(e) => setField('gender', e.target.value)}
                    className="w-full bg-gray-50 border-0 border-b-2 border-gray-200 focus:border-blue-600 focus:ring-0 px-0 py-2 text-sm font-bold">
                    <option value="">—</option>
                    <option value="L">Laki-laki</option>
                    <option value="P">Perempuan</option>
                  </select>
                </div>
                <Field label="Status" value={editingEmployee.status || ''} onChange={(v) => setField('status', v)} />
                <Field label="Departemen" value={editingEmployee.department} onChange={(v) => setField('department', v)} />
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-black text-gray-400">Golongan</label>
                  <select value={editingEmployee.grade} onChange={(e) => setField('grade', e.target.value)}
                    className="w-full bg-gray-50 border-0 border-b-2 border-gray-200 focus:border-blue-600 focus:ring-0 px-0 py-2 text-sm font-bold">
                    {['1','I','2','II','3','III','4','IV','5','V','6','VI','Admin'].map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <Field label="Grading" value={editingEmployee.grading || ''} onChange={(v) => setField('grading', v)} />
                <Field label="POH" value={editingEmployee.poh} onChange={(v) => setField('poh', v)} />
                <Field label="Fasilitas Mess" value={editingEmployee.mess || ''} onChange={(v) => setField('mess', v)} />
                <Field label="Tanggal Join" type="date" value={ensureISODate(editingEmployee.joinDate)} onChange={(v) => setField('joinDate', v)} />
                <Field label="Tanggal Lahir" type="date" value={ensureISODate(editingEmployee.birthDate || '')} onChange={(v) => setField('birthDate', v)} />
                <Field label="Email" type="email" value={editingEmployee.email} onChange={(v) => setField('email', v)} />
                <Field label="No HP" value={editingEmployee.phone || ''} onChange={(v) => setField('phone', v)} />
                <Field label="Tanggal Cuti Terakhir" type="date" value={ensureISODate(editingEmployee.lastLeaveDate || '')} onChange={(v) => setField('lastLeaveDate', v)} />
                <Field label="Tanggal Join Terbaru" type="date" value={ensureISODate(editingEmployee.joinDateLatest || '')} onChange={(v) => setField('joinDateLatest', v)} />
                <Field label="Lokasi Penggajian" value={editingEmployee.payrollLocation || ''} onChange={(v) => setField('payrollLocation', v)} />
                <Field label="No Rekening" value={editingEmployee.bankAccount || ''} onChange={(v) => setField('bankAccount', v)} />
                <Field label="Bank" value={editingEmployee.bank || ''} onChange={(v) => setField('bank', v)} />
                <Field label="Tanggal Berhenti" type="date" value={ensureISODate(editingEmployee.terminationDate || '')} onChange={(v) => setField('terminationDate', v)} />
                <Field label="Alasan Resign" value={editingEmployee.resignReason || ''} onChange={(v) => setField('resignReason', v)} />
                <Field label="Tempat Lahir" value={editingEmployee.birthPlace || ''} onChange={(v) => setField('birthPlace', v)} />
                <Field label="Usia" value={editingEmployee.age || ''} onChange={(v) => setField('age', v)} />
                <Field label="Agama" value={editingEmployee.religion || ''} onChange={(v) => setField('religion', v)} />
                <Field label="No KTP" value={editingEmployee.ktp || ''} onChange={(v) => setField('ktp', v)} />
                <Field label="No KK" value={editingEmployee.kk || ''} onChange={(v) => setField('kk', v)} />
                <Field label="Alamat" value={editingEmployee.address || ''} onChange={(v) => setField('address', v)} />
                <Field label="Provinsi" value={editingEmployee.province || ''} onChange={(v) => setField('province', v)} />
                <Field label="Kota" value={editingEmployee.city || ''} onChange={(v) => setField('city', v)} />
                <Field label="Telp Darurat" value={editingEmployee.emergencyPhone || ''} onChange={(v) => setField('emergencyPhone', v)} />
                <Field label="Nama Kontak Darurat" value={editingEmployee.emergencyName || ''} onChange={(v) => setField('emergencyName', v)} />
                <Field label="Hubungan Kontak Darurat" value={editingEmployee.emergencyRelation || ''} onChange={(v) => setField('emergencyRelation', v)} />
                <Field label="Pendidikan" value={editingEmployee.education || ''} onChange={(v) => setField('education', v)} />
                <Field label="Jurusan" value={editingEmployee.major || ''} onChange={(v) => setField('major', v)} />
                <Field label="NPWP" value={editingEmployee.npwp || ''} onChange={(v) => setField('npwp', v)} />
                <Field label="BPJS Ketenagakerjaan" value={editingEmployee.bpjsTk || ''} onChange={(v) => setField('bpjsTk', v)} />
                <Field label="BPJS Kesehatan" value={editingEmployee.bpjsKes || ''} onChange={(v) => setField('bpjsKes', v)} />
                <Field label="Status Pernikahan" value={editingEmployee.maritalStatus || ''} onChange={(v) => setField('maritalStatus', v)} />
                <Field label="Status Perkawinan" value={editingEmployee.marriageStatus || ''} onChange={(v) => setField('marriageStatus', v)} />
                <Field label="Nama Ayah" value={editingEmployee.fatherName || ''} onChange={(v) => setField('fatherName', v)} />
                <Field label="Nama Ibu" value={editingEmployee.motherName || ''} onChange={(v) => setField('motherName', v)} />
                <Field label="Saldo Cuti Tahunan" value={String(editingEmployee.annualLeaveBalance ?? '')} onChange={(v) => setField('annualLeaveBalance', v === '' ? undefined : Number(v))} />
                <Field label="Saldo Cuti Tambahan" value={String(editingEmployee.extraLeaveBalance ?? '')} onChange={(v) => setField('extraLeaveBalance', v === '' ? undefined : Number(v))} />
                <Field label="Tipe Roster" value={editingEmployee.rosterType || ''} onChange={(v) => setField('rosterType', v)} />
                <div className="space-y-1.5 col-span-2">
                  <label className="text-[10px] uppercase font-black text-gray-400">Role</label>
                  <div className="w-full bg-gray-50 border-0 border-b-2 border-gray-200 px-0 py-2 text-sm font-bold text-gray-700 flex items-center justify-between">
                    <span>{editingEmployee.role}</span>
                    <span className="text-[9px] font-medium text-gray-400 italic">Ubah lewat tombol "Lihat Akun"</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 justify-between pt-4 border-t border-gray-100">
                <button type="button"
                  onClick={() => {
                    if (confirm('Hapus karyawan ini? (Hanya dari tampilan; baris di Sheet DB tidak dihapus)')) {
                      setEmployees(employees.filter(e => e.id !== editingEmployee.id));
                      setEditingEmployee(null);
                    }
                  }}
                  className="px-6 py-2.5 text-xs font-bold text-red-500 hover:bg-red-50 rounded-lg uppercase tracking-widest flex items-center gap-2">
                  <Trash2 size={14} /> Hapus
                </button>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setEditingEmployee(null)}
                    className="px-6 py-2.5 text-xs font-bold text-gray-500 hover:text-gray-900 uppercase tracking-widest">
                    Batal
                  </button>
                  <button type="submit"
                    className="bg-blue-600 text-white px-8 py-2.5 rounded-lg flex items-center gap-2 text-xs font-bold hover:bg-blue-700 shadow-lg shadow-blue-200">
                    <Save size={14} /><span>Simpan</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 justify-between items-center bg-gray-50/50">
          <div className="relative w-full sm:w-80">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Cari NIK atau Nama..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <div className="flex flex-wrap gap-2 sm:gap-3 items-center">
            <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20">
              <option value="ALL">All Departemen</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={filterGrade} onChange={(e) => setFilterGrade(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20">
              <option value="ALL">All Golongan</option>
              {grades.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <span className="text-[10px] uppercase tracking-widest font-black text-gray-400">{filtered.length} / {employees.length}</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="bg-gray-50 text-[10px] uppercase tracking-widest text-gray-500 border-b border-gray-100">
                {visibleCols.map(col => {
                  const isSorted = colSort?.col === col;
                  const activeFilter = (colFilters[col]?.length || 0) > 0;
                  const values = colUniqueValues[col] || [];
                  return (
                    <th key={col} className="px-4 py-3 font-bold whitespace-nowrap align-middle">
                      <div className="flex items-center gap-1.5">
                        <span>{EMPLOYEE_COLUMN_LABELS[col] || col}</span>
                        <button
                          type="button"
                          title="Urutkan A-Z"
                          onClick={() => {
                            setColSort(prev => {
                              if (!prev || prev.col !== col) return { col, dir: 'asc' };
                              if (prev.dir === 'asc') return { col, dir: 'desc' };
                              return null;
                            });
                          }}
                          className={`p-0.5 rounded hover:bg-gray-200 transition-colors ${isSorted ? 'text-blue-600' : 'text-gray-400'}`}
                        >
                          {isSorted ? (colSort!.dir === 'asc' ? <ArrowDownAZ size={11} /> : <ArrowUpAZ size={11} />) : <ArrowUpDown size={11} />}
                        </button>
                        <div className="relative">
                          <button
                            type="button"
                            title="Filter"
                            onClick={() => setOpenColMenu(m => m === col ? null : col)}
                            className={`p-0.5 rounded hover:bg-gray-200 transition-colors ${activeFilter ? 'text-blue-600' : 'text-gray-400'}`}
                          >
                            <Filter size={11} fill={activeFilter ? 'currentColor' : 'none'} />
                          </button>
                          {openColMenu === col && (
                            <>
                              <div className="fixed inset-0 z-30" onClick={() => setOpenColMenu(null)} />
                              <div className="absolute left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-xl z-40 max-h-72 overflow-y-auto normal-case tracking-normal">
                                <div className="sticky top-0 bg-white border-b border-gray-100 px-2 py-1.5 flex justify-between items-center">
                                  <span className="text-[10px] font-black text-gray-500 uppercase">Filter</span>
                                  <button
                                    type="button"
                                    onClick={() => { setColFilters(prev => { const c = { ...prev }; delete c[col]; return c; }); }}
                                    className="text-[9px] font-black text-red-500 hover:text-red-700 uppercase"
                                  >Reset</button>
                                </div>
                                {values.length === 0 && (
                                  <div className="p-3 text-[11px] text-gray-400 italic">Tidak ada nilai</div>
                                )}
                                {values.map(v => {
                                  const selected = colFilters[col]?.includes(v) || false;
                                  return (
                                    <label key={v} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 cursor-pointer text-[11px] font-medium text-gray-700">
                                      <input
                                        type="checkbox"
                                        checked={selected}
                                        onChange={() => {
                                          setColFilters(prev => {
                                            const cur = prev[col] || [];
                                            const next = selected ? cur.filter(x => x !== v) : [...cur, v];
                                            const c = { ...prev };
                                            if (next.length === 0) delete c[col]; else c[col] = next;
                                            return c;
                                          });
                                        }}
                                        className="w-3 h-3"
                                      />
                                      <span className="truncate">{v}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="text-[11px] font-medium text-gray-600">
              {filtered.map((emp) => (
                <tr key={emp.id} onClick={() => { if (!isReadOnly) setEditingEmployee(emp); }}
                  className={`border-b border-gray-50 last:border-0 transition-colors ${isReadOnly ? '' : 'hover:bg-blue-50/40 cursor-pointer'}`}>
                  {visibleCols.map(col => {
                    const field = EMPLOYEE_IMPORT_COLMAP[col];
                    const raw = (emp as any)[field] ?? '';
                    let display: React.ReactNode = String(raw);
                    if (col === '5') display = <span className="font-mono text-gray-400">{raw}</span>;
                    else if (col === '6') display = <span className="text-sm font-bold text-blue-700 hover:underline">{raw}</span>;
                    else if (col === '8') display = raw === 'L' ? 'Laki-laki' : raw === 'P' ? 'Perempuan' : String(raw);
                    else if (col === '15') display = <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-[10px] font-black">{raw}</span>;
                    else if (dateColSet.has(col)) display = <span className="font-mono tracking-tighter">{raw ? formatDateLabel(String(raw)) : ''}</span>;
                    return <td key={col} className="px-4 py-4 whitespace-nowrap">{display}</td>;
                  })}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={visibleCols.length} className="p-20 text-center text-gray-400 italic text-sm">Tidak ada karyawan yang cocok dengan filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
