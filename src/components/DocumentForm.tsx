import React, { useMemo, useState } from 'react';
import { useApp } from '../AppContext';
import { Send, FileText, CheckCircle, Clock, CheckCircle2, XCircle, Download } from 'lucide-react';
import { gradeNum } from '../lib/auth';
import { renderDocxTemplate } from '../lib/serverStore';
import type {
  DocumentTemplate, DocumentTemplateField, DocumentRequest, DocumentAutoSource, Employee,
} from '../types';
import { format, addMonths, parseISO } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import { calculateTimesheet } from '../lib/roster';
import { differenceInCalendarDays } from 'date-fns';

// ===== Jenis Ijin: definisi sub-jenis & mapping ke placeholder =====
// Section A (dengan upah): poin 1..9. Hanya poin 2..9 yang punya tgl
// (poin 1 = "seperlunya"). Poin n → {{jns(n-1)}}, {{smp(n-1)}}.
export const JENIS_A: { n: number; label: string; hasDate: boolean }[] = [
  { n: 1, label: '1. Memenuhi panggilan negara', hasDate: false },
  { n: 2, label: '2. Pernikahan sah pekerja menurut UU perkawinan', hasDate: true },
  { n: 3, label: '3. Pernikahan anak pekerja', hasDate: true },
  { n: 4, label: '4. Istri pekerja melahirkan/keguguran', hasDate: true },
  { n: 5, label: '5. Kematian istri/suami/anak/orang tua kandung/mertua', hasDate: true },
  { n: 6, label: '6. Kematian saudara kandung', hasDate: true },
  { n: 7, label: '7. Khitanan/pembaptisan anak pekerja', hasDate: true },
  { n: 8, label: '8. Pindah rumah, kebakaran/bencana banjir', hasDate: true },
  { n: 9, label: '9. Anggota Keluarga serumah meninggal dunia', hasDate: true },
];
// Section B (tidak ditanggung): poin 1..4. Poin 2..4 punya jam.
export const JENIS_B: { n: number; label: string; hasJam: boolean }[] = [
  { n: 1, label: '1. Ijin tidak masuk bekerja', hasJam: false },
  { n: 2, label: '2. Ijin selama jam kerja', hasJam: true },
  { n: 3, label: '3. Ijin meninggalkan lokasi kerja', hasJam: true },
  { n: 4, label: '4. Ijin Datang Terlambat/Pulang Cepat', hasJam: true },
];

interface JenisIjinState {
  A: Record<number, { from?: string; to?: string }>;
  B: Record<number, { from?: string; to?: string; jam_s?: string; jam_h?: string }>;
}

function emptyJenisState(): JenisIjinState { return { A: {}, B: {} }; }

function parseJenisState(raw: string): JenisIjinState {
  if (!raw) return emptyJenisState();
  try {
    const p = JSON.parse(raw);
    return { A: p.A || {}, B: p.B || {} };
  } catch { return emptyJenisState(); }
}

/** Expand JenisIjinState ke map placeholder ({{jns1}}..{{jam_h4}}). */
export function expandJenisIjin(state: JenisIjinState): Record<string, string> {
  const out: Record<string, string> = {};
  // Section A: poin n (>=2) → jns(n-1), smp(n-1)
  for (const item of JENIS_A) {
    if (!item.hasDate) continue;
    const idx = item.n - 1;
    const v = state.A[item.n];
    out[`jns${idx}`] = v?.from || '';
    out[`smp${idx}`] = v?.to || '';
  }
  // Section B: poin n → start n, end n, jmlh n (+ jam_s/jam_h jika hasJam)
  for (const item of JENIS_B) {
    const v = state.B[item.n];
    out[`start${item.n}`] = v?.from || '';
    out[`end${item.n}`] = v?.to || '';
    let jmlh = '';
    if (v?.from && v?.to) {
      try {
        const d = differenceInCalendarDays(parseISO(v.to), parseISO(v.from)) + 1;
        if (Number.isFinite(d) && d > 0) jmlh = String(d);
      } catch { /* ignore */ }
    }
    out[`jmlh${item.n}`] = jmlh;
    if (item.hasJam) {
      out[`jam_s${item.n}`] = v?.jam_s || '';
      out[`jam_h${item.n}`] = v?.jam_h || '';
    }
  }
  return out;
}

function autoValue(src: DocumentAutoSource | undefined, emp: Employee | null, extras?: { csDate?: string }): string {
  if (!src || !emp) return '';
  const today = new Date();
  switch (src) {
    case 'employee_name': return emp.name || '';
    case 'employee_nik': return emp.nik || '';
    case 'employee_department': return emp.department || '';
    case 'employee_position': return emp.position || '';
    case 'employee_grade': return emp.grade || '';
    case 'employee_poh': return emp.poh || '';
    case 'employee_email': return emp.email || '';
    case 'employee_phone': return emp.phone || '';
    case 'today_date': return format(today, 'yyyy-MM-dd');
    case 'today_long': return format(today, 'dd MMMM yyyy');
    case 'employee_cs_date': return extras?.csDate || '';
    case 'form_grade': {
      const g = (emp as any).grading || '';
      return g.slice(0, 2);
    }
    case 'form_job_grade': {
      const g = (emp as any).grading || '';
      return g.slice(0, 4);
    }
    case 'form_employee_level': {
      const g = (emp as any).grading || '';
      const parts = g.split('.');
      return parts[2] || '';
    }
    case 'form_month_long':
      return format(today, 'MMMM', { locale: idLocale });
  }
  return '';
}

export default function DocumentForm() {
  const {
    user, employees, documentTemplates, documentRequests, addDocumentRequest,
    leaveRequests, customSymbols, overrides, signatures,
  } = useApp();

  const [templateId, setTemplateId] = useState<string>('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [directSupervisorId, setDirectSupervisorId] = useState('');
  const [indirectSupervisorId, setIndirectSupervisorId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedOk, setSubmittedOk] = useState(false);
  const [err, setErr] = useState('');
  const canSubmitForOthers = !!user && (user.role === 'SUPERUSER' || user.role === 'ADMIN');
  const [onBehalfId, setOnBehalfId] = useState<string>('');
  const [filterDept, setFilterDept] = useState<string>('');
  const [filterGrade, setFilterGrade] = useState<string>('');
  const rawSelectedEmp = canSubmitForOthers && onBehalfId
    ? (employees.find(e => e.id === onBehalfId) || user)
    : user;
  // Resolve ke record Employee penuh (by id, fallback by NIK) supaya
  // department/grade pasti terisi meski objek `user` dari sesi sparse.
  const selectedEmp = useMemo(() => {
    if (!rawSelectedEmp) return null;
    const byId = employees.find(e => e.id === rawSelectedEmp.id);
    if (byId) return { ...rawSelectedEmp, ...byId };
    const nik = (rawSelectedEmp as any).nik;
    const byNik = nik ? employees.find(e => (e.nik || '') === nik) : undefined;
    if (byNik) return { ...rawSelectedEmp, ...byNik };
    return rawSelectedEmp;
  }, [rawSelectedEmp, employees]);

  // Hitung tanggal "Cs" (Cuti Site) terdekat untuk selectedEmp.
  // Catatan: selectedEmp bisa berasal dari `user` (logged-in) yang field
  // Employee-nya tidak lengkap → resolve ke record Employee penuh agar
  // calculateTimesheet bisa membaca leaveRequest/override Cs dengan benar.
  const csDateLong = useMemo(() => {
    if (!selectedEmp) return '';
    const empFull: Employee | null =
      (employees.find(e => e.id === selectedEmp.id) as Employee | undefined) ||
      ((employees.find(e => (e.nik || '') === ((selectedEmp as any).nik || '')) as Employee | undefined) || null) ||
      (selectedEmp as Employee);
    if (!empFull) return '';
    const today = new Date();
    const start = format(addMonths(today, -6), 'yyyy-MM-dd');
    const end = format(addMonths(today, 6), 'yyyy-MM-dd');
    try {
      const data = calculateTimesheet(empFull, start, end, leaveRequests, customSymbols, overrides);
      const todayStr = format(today, 'yyyy-MM-dd');
      const isCsSym = (s: string) => /^Cs\d*$/i.test(s || '');
      // Cari Cs1 (awal blok Cs) ≥ hari ini; fallback ke Cs1 terakhir sebelum hari ini.
      const isCsHead = (i: number) => isCsSym(data[i].symbol) && (i === 0 || !isCsSym(data[i - 1].symbol));
      let pickIdx = -1;
      for (let i = 0; i < data.length; i++) {
        if (isCsHead(i) && data[i].date >= todayStr) { pickIdx = i; break; }
      }
      if (pickIdx < 0) {
        for (let i = data.length - 1; i >= 0; i--) {
          if (isCsHead(i) && data[i].date < todayStr) { pickIdx = i; break; }
        }
      }
      // Fallback terakhir: Cs apa pun (bukan hanya Cs1) bila simbol di timesheet
      // tidak bernomor (mis. tersimpan sebagai "Cs" saja).
      if (pickIdx < 0) {
        const forward = data.findIndex(d => isCsSym(d.symbol) && d.date >= todayStr);
        pickIdx = forward >= 0 ? forward : [...data].map((d, i) => ({ d, i })).reverse().find(x => isCsSym(x.d.symbol) && x.d.date < todayStr)?.i ?? -1;
      }
      return pickIdx >= 0 ? format(parseISO(data[pickIdx].date), 'dd MMMM yyyy', { locale: idLocale }) : '';
    } catch { return ''; }
  }, [selectedEmp, employees, leaveRequests, customSymbols, overrides]);

  const tpl = documentTemplates.find(t => t.id === templateId) || null;

  // Hitung tanggal terdekat untuk semua simbol Timesheet yang dipakai
  // oleh template (untuk field type='timesheet_symbol'). Key = kode simbol.
  const symbolDateMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (!selectedEmp || !tpl) return map;
    const codes = Array.from(new Set(
      tpl.fields.filter(f => f.type === 'timesheet_symbol' && f.timesheetSymbol)
        .map(f => String(f.timesheetSymbol)),
    ));
    if (codes.length === 0) return map;
    const empFull: Employee | null =
      (employees.find(e => e.id === selectedEmp.id) as Employee | undefined) ||
      (employees.find(e => (e.nik || '') === ((selectedEmp as any).nik || '')) as Employee | undefined) ||
      (selectedEmp as Employee);
    if (!empFull) return map;
    const today = new Date();
    const start = format(addMonths(today, -6), 'yyyy-MM-dd');
    const end = format(addMonths(today, 6), 'yyyy-MM-dd');
    try {
      const data = calculateTimesheet(empFull, start, end, leaveRequests, customSymbols, overrides);
      const todayStr = format(today, 'yyyy-MM-dd');
      for (const code of codes) {
        const re = new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d*$`, 'i');
        const match = (s: string) => re.test(s || '');
        let idx = data.findIndex(d => match(d.symbol) && d.date >= todayStr);
        if (idx < 0) {
          for (let i = data.length - 1; i >= 0; i--) {
            if (match(data[i].symbol) && data[i].date < todayStr) { idx = i; break; }
          }
        }
        map[code] = idx >= 0 ? format(parseISO(data[idx].date), 'dd MMMM yyyy', { locale: idLocale }) : '';
      }
    } catch { /* ignore */ }
    return map;
  }, [selectedEmp, employees, leaveRequests, customSymbols, overrides, tpl]);
  const symbolDateKey = JSON.stringify(symbolDateMap);

  // Admin: dikunci ke departemennya sendiri. Superuser: bebas.
  const isSuperuser = user?.role === 'SUPERUSER';
  const isAdmin = user?.role === 'ADMIN';
  const deptOptions = useMemo(() => {
    if (isAdmin) return user?.department ? [user.department] : [];
    const set = new Set<string>();
    employees.forEach(e => { if (e.department) set.add(e.department); });
    return Array.from(set).sort();
  }, [employees, isAdmin, user]);
  const gradeOptions = useMemo(() => {
    const pool = isAdmin
      ? employees.filter(e => e.department === user?.department)
      : employees;
    const set = new Set<string>();
    pool.forEach(e => { if (e.grade) set.add(e.grade); });
    return Array.from(set).sort((a, b) => (gradeNum(a) - gradeNum(b)) || a.localeCompare(b));
  }, [employees, isAdmin, user]);

  // Lock filter dept untuk admin
  React.useEffect(() => {
    if (isAdmin && user?.department) setFilterDept(user.department);
  }, [isAdmin, user]);

  const filteredEmployees = useMemo(() => {
    return employees
      .filter(e => e.id !== user?.id)
      .filter(e => !filterDept || e.department === filterDept)
      .filter(e => !filterGrade || e.grade === filterGrade)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [employees, user, filterDept, filterGrade]);

  // Reset values setiap kali template berubah, isi auto fields.
  React.useEffect(() => {
    if (!tpl) { setValues({}); return; }
    const next: Record<string, string> = {};
    for (const f of tpl.fields) {
      if (f.type === 'auto') next[f.key] = autoValue(f.autoSource, selectedEmp, { csDate: csDateLong });
      else if (f.type === 'employee_field' && f.employeeField) next[f.key] = String((selectedEmp as any)?.[f.employeeField] ?? '');
      else if (f.type === 'timesheet_symbol' && f.timesheetSymbol) next[f.key] = symbolDateMap[f.timesheetSymbol] || '';
      else if (f.defaultValue) next[f.key] = f.defaultValue;
      else next[f.key] = '';
    }
    setValues(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, onBehalfId, csDateLong, symbolDateKey]);

  const submitterGrade = gradeNum(selectedEmp?.grade);
  const submitterDept = selectedEmp?.department;

  // Daftar Atasan Langsung:
  //  1) Utama: karyawan satu dept dengan golongan lebih tinggi dari pengaju.
  //  2) Fallback: jika golongan pengaju tidak diketahui (0) ATAU tidak ada
  //     yang ber-golongan lebih tinggi, tampilkan semua karyawan satu dept
  //     (kecuali diri sendiri) supaya user tetap bisa memilih.
  // Daftar Atasan Langsung:
  //  1) Utama: karyawan satu dept dengan golongan lebih tinggi dari pengaju.
  //  2) Fallback: jika golongan pengaju tidak diketahui (0) ATAU tidak ada
  //     yang ber-golongan lebih tinggi, tampilkan semua karyawan satu dept
  //     (kecuali diri sendiri) supaya user tetap bisa memilih.
  const directOptions = useMemo(() => {
    if (!submitterDept) return [];
    // KHUSUS: jika pengaju Golongan III/IV/V/VI (grade 3..6), Atasan Langsung
    // dropdown = semua karyawan Golongan IV/V/VI dari SEMUA departemen.
    const submitterHigh = submitterGrade >= 3 && submitterGrade <= 6;
    if (submitterHigh) {
      const pool = employees.filter(e => {
        if (e.id === selectedEmp?.id) return false;
        const g = gradeNum(e.grade);
        return g >= 4 && g <= 6;
      });
      return pool.sort((a, b) =>
        (gradeNum(b.grade) - gradeNum(a.grade)) || (a.name || '').localeCompare(b.name || ''),
      );
    }
    const sameDept = employees
      .filter(e => e.department === submitterDept && e.id !== selectedEmp?.id);
    const strict = submitterGrade
      ? sameDept.filter(e => gradeNum(e.grade) > submitterGrade)
      : [];
    const pool = strict.length > 0 ? strict : sameDept;
    return pool.sort((a, b) =>
      (gradeNum(b.grade) - gradeNum(a.grade)) || (a.name || '').localeCompare(b.name || ''),
    );
  }, [employees, submitterDept, submitterGrade, selectedEmp]);

  const directSup = employees.find(e => e.id === directSupervisorId);
  const directGrade = gradeNum(directSup?.grade);

  // Dept Head:
  //  KHUSUS: jika Atasan Langsung Golongan IV/V/VI, Dept Head dropdown =
  //  semua karyawan Golongan IV/V/VI dari SEMUA departemen.
  //  Selain itu: aturan normal (golongan lebih tinggi dari Atasan Langsung, satu dept).
  const indirectOptions = useMemo(() => {
    if (!directSup) return [];
    const isHighGrade = directGrade >= 4 && directGrade <= 6;
    if (isHighGrade) {
      const pool = employees.filter(e => {
        if (e.id === directSup.id || e.id === selectedEmp?.id) return false;
        const g = gradeNum(e.grade);
        return g >= 4 && g <= 6;
      });
      return pool.sort((a, b) =>
        (gradeNum(b.grade) - gradeNum(a.grade)) || (a.name || '').localeCompare(b.name || ''),
      );
    }
    if (!submitterDept) return [];
    const sameDept = employees
      .filter(e => e.department === submitterDept && e.id !== directSup.id && e.id !== selectedEmp?.id);
    const strict = directGrade ? sameDept.filter(e => gradeNum(e.grade) > directGrade) : [];
    const pool = strict.length > 0 ? strict : sameDept;
    return pool.sort((a, b) =>
      (gradeNum(b.grade) - gradeNum(a.grade)) || (a.name || '').localeCompare(b.name || ''),
    );
  }, [employees, submitterDept, directSup, directGrade, selectedEmp]);

  const myHistory = useMemo(() => {
    if (!user) return [];
    return documentRequests
      .filter(r => r.employeeId === user.id)
      .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''))
      .slice(0, 10);
  }, [documentRequests, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!user || !tpl || !selectedEmp) return;
    if (!directSupervisorId) { setErr('Pilih Atasan Langsung terlebih dahulu.'); return; }
    // Validasi wajib.
    for (const f of tpl.fields) {
      if (f.type === 'approval_block') continue;
      if (f.required && !values[f.key]?.trim()) {
        setErr(`Field "${f.label}" wajib diisi.`); return;
      }
    }
    setSubmitting(true);
    try {
      // Expand field bertipe 'jenis_ijin' (JSON state) ke placeholder
      // {{jns*}}, {{smp*}}, {{start*}}, {{end*}}, {{jmlh*}}, {{jam_s*}}, {{jam_h*}}.
      const expanded: Record<string, string> = { ...values };
      for (const f of tpl.fields) {
        if (f.type === 'jenis_ijin') {
          const st = parseJenisState(values[f.key] || '');
          const exp = expandJenisIjin(st);
          for (const k of Object.keys(exp)) {
            if (expanded[k] === undefined || expanded[k] === '') expanded[k] = exp[k];
          }
          // Buang nilai JSON dari placeholder asli (key field jenis_ijin
          // biasanya tidak match placeholder di .docx — tapi jaga-jaga).
          expanded[f.key] = '';
        }
      }
      // Auto-isi nama atasan langsung & dept head untuk placeholder teks.
      const directEmpForName = employees.find(em => em.id === directSupervisorId);
      const indirectEmpForName = employees.find(em => em.id === indirectSupervisorId);
      if (!expanded['atasan_langsung'] && directEmpForName) expanded['atasan_langsung'] = directEmpForName.name || '';
      if (!expanded['dept_head'] && indirectEmpForName) expanded['dept_head'] = indirectEmpForName.name || '';
      // Resolve auto fields bertipe form_atasan_langsung / form_dept_head ke nama yang dipilih.
      for (const f of tpl.fields) {
        if (f.type === 'auto' && f.autoSource === 'form_atasan_langsung') {
          expanded[f.key] = directEmpForName?.name || '';
        }
        if (f.type === 'auto' && f.autoSource === 'form_dept_head') {
          expanded[f.key] = indirectEmpForName?.name || '';
        }
      }
      // Blok Persetujuan: validasi & isi nama + TTD dari supervisor yang dipilih.
      const sigForOwner = (ownerId?: string) => {
        if (!ownerId) return undefined;
        return [...signatures]
          .filter(s => s.ownerId === ownerId)
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
      };
      const approvalBlocks = tpl.fields.filter(f => f.type === 'approval_block');
      for (const f of approvalBlocks) {
        if (f.approvalRole === 'atasan_langsung') {
          if (!directEmpForName) throw new Error('Blok Atasan Langsung butuh Atasan Langsung dipilih.');
          expanded['atasan_langsung'] = directEmpForName.name || '';
        } else if (f.approvalRole === 'dept_head') {
          if (!indirectEmpForName) throw new Error('Blok Dept Head butuh Dept Head dipilih di form.');
          expanded['dept_head'] = indirectEmpForName.name || '';
        }
      }
      // TTD sendiri: ambil TTD terbaru milik karyawan yang diajukan (ownerId = selectedEmp.id).
      const ownSig = [...signatures]
        .filter(s => s.ownerId && selectedEmp && s.ownerId === selectedEmp.id)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
      // Jika template butuh {%ttd_sendiri} tapi TTD tidak ada → blokir submit.
      const needsOwnTtd = (tpl.imagePlaceholders || []).includes('ttd_sendiri');
      if (needsOwnTtd && !ownSig) {
        const who = selectedEmp?.id === user?.id ? 'Anda' : (selectedEmp?.name || 'karyawan ini');
        throw new Error(`Tanda Tangan untuk ${who} belum diupload. Buka menu "Tanda Tangan Saya" dan upload TTD dulu sebelum mengajukan dokumen ini.`);
      }
      const images: Record<string, string> = {};
      if (ownSig) images['ttd_sendiri'] = ownSig.url;
      // TTD untuk blok persetujuan (kalau TTD-nya tersedia di sistem).
      for (const f of approvalBlocks) {
        if (f.approvalRole === 'atasan_langsung') {
          const s = sigForOwner(directSupervisorId);
          if (s) images['ttd_atasan'] = s.url;
        } else if (f.approvalRole === 'dept_head') {
          const s = sigForOwner(indirectSupervisorId);
          if (s) images['ttd_dept_head'] = s.url;
        }
      }
      const r = await renderDocxTemplate(tpl.docxUrl, expanded, { format: 'docx', images });
      if (r.error && !r.docxUrl) {
        throw new Error(r.message || r.error);
      }
      const req: DocumentRequest = {
        id: `doc-${Date.now()}`,
        templateId: tpl.id,
        templateName: tpl.name,
        employeeId: selectedEmp.id,
        values: { ...expanded },
        pdfUrl: r.pdfUrl,
        docxUrl: r.docxUrl,
        submittedAt: new Date().toISOString(),
        submittedById: user.id,
        submittedByName: user.name,
        status: 'PENDING',
        directSupervisorId,
        directSupervisorName: directSup?.name || '',
        indirectSupervisorId: indirectSupervisorId || undefined,
        indirectSupervisorName: indirectEmpForName?.name || undefined,
      };
      addDocumentRequest(req);
      setSubmittedOk(true);
      setTimeout(() => setSubmittedOk(false), 3500);
      setValues({});
      setTemplateId('');
      setDirectSupervisorId('');
      setIndirectSupervisorId('');
      setOnBehalfId('');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <header>
        <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Ajukan Dokumen</h2>
        <p className="text-xs text-gray-500 font-medium uppercase tracking-widest mt-1">Pilih template, isi data, dan ajukan untuk approval</p>
      </header>

      {myHistory.length > 0 && (
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between">
            <h3 className="text-[11px] font-black uppercase tracking-widest text-gray-700">Riwayat Dokumen Saya</h3>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{myHistory.length} terakhir</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {myHistory.map(r => (
              <li key={r.id} className="px-5 py-3 flex items-center gap-3 text-[11px]">
                <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                  r.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                  r.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {r.status === 'APPROVED' ? <CheckCircle2 size={10} /> : r.status === 'REJECTED' ? <XCircle size={10} /> : <Clock size={10} />}
                  {r.status}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 truncate">{r.templateName}</p>
                  <p className="text-[10px] text-gray-500 truncate">
                    {r.directSupervisorName ? <>Atasan: {r.directSupervisorName}{r.directApprovedAt ? ' ✓' : ''}</> : null}
                    {r.indirectSupervisorName ? <> • Dept Head: {r.indirectSupervisorName}{r.indirectApprovedAt ? ' ✓' : ''}</> : null}
                    {r.status === 'REJECTED' && r.rejectionReason ? <> • <span className="text-red-600 font-bold">Alasan: {r.rejectionReason}</span></> : null}
                  </p>
                </div>
                {r.pdfUrl && (
                  <a href={r.pdfUrl} target="_blank" rel="noopener noreferrer"
                    className="text-[10px] font-bold inline-flex items-center gap-1 text-blue-600 hover:underline">
                    <Download size={11} /> PDF
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 p-8 shadow-sm space-y-6">
        <div>
          <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Pilih Template Dokumen</label>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} required
            className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500">
            <option value="">— Pilih Template —</option>
            {documentTemplates.filter(t => !t.isSkc).map(t => (
              <option key={t.id} value={t.id}>{t.name}{t.category ? ` • ${t.category}` : ''}</option>
            ))}
          </select>
          {documentTemplates.length === 0 && (
            <p className="text-[10px] text-amber-600 mt-2 font-bold">Belum ada template. Minta admin/HR untuk meng-upload template terlebih dahulu.</p>
          )}
        </div>

        {tpl && (
          <>
            {tpl.description && (
              <p className="text-xs text-gray-500 italic">{tpl.description}</p>
            )}
            {canSubmitForOthers && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Departemen</label>
                    <select value={filterDept} onChange={(e) => { setFilterDept(e.target.value); setOnBehalfId(''); setDirectSupervisorId(''); setIndirectSupervisorId(''); }}
                      disabled={isAdmin}
                      className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 disabled:bg-gray-100">
                      {isSuperuser && <option value="">— Semua Departemen —</option>}
                      {deptOptions.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Golongan</label>
                    <select value={filterGrade} onChange={(e) => { setFilterGrade(e.target.value); setOnBehalfId(''); setDirectSupervisorId(''); setIndirectSupervisorId(''); }}
                      className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500">
                      <option value="">— Semua Golongan —</option>
                      {gradeOptions.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">
                  Diajukan untuk (opsional — kosongkan jika untuk diri sendiri)
                </label>
                <select value={onBehalfId} onChange={(e) => { setOnBehalfId(e.target.value); setDirectSupervisorId(''); setIndirectSupervisorId(''); }}
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500">
                  <option value="">— Untuk Diri Sendiri ({user?.name}) —</option>
                  {filteredEmployees.map(e => (
                      <option key={e.id} value={e.id}>{e.name} • {e.nik} • {e.department}</option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-500 mt-1">
                  Sebagai {user?.role}, Anda boleh mengajukan dokumen atas nama karyawan lain.
                  {isAdmin && ' Admin hanya bisa memilih karyawan di departemennya sendiri.'}
                </p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              {tpl.fields.filter(f => f.type !== 'approval_block').map(f => (
                <FieldInput
                  key={f.key}
                  field={f}
                  value={values[f.key] || ''}
                  onChange={(v) => setValues(prev => ({ ...prev, [f.key]: v }))}
                />
              ))}
            </div>
            {tpl.fields.some(f => f.type === 'approval_block') && (
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 text-[11px] text-indigo-800">
                <b className="block text-[10px] uppercase tracking-widest mb-1">Blok Persetujuan Aktif</b>
                Template ini mengisi otomatis nama & TTD dari pilihan Atasan Langsung / Dept Head di bawah ini.
              </div>
            )}

            <div>
              <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Atasan Langsung</label>
              <select value={directSupervisorId} onChange={(e) => { setDirectSupervisorId(e.target.value); setIndirectSupervisorId(''); }} required
                className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500">
                <option value="">— Pilih Atasan Langsung —</option>
                {directOptions.map(e => (
                  <option key={e.id} value={e.id}>{e.name} • Gol {e.grade} • {e.position}</option>
                ))}
              </select>
              {directOptions.length === 0 && (
                <p className="text-[10px] text-amber-600 mt-1 font-bold">
                  {!submitterDept
                    ? 'Departemen pengaju belum diisi pada data Employees — Atasan Langsung tidak bisa ditentukan.'
                    : `Tidak ada karyawan lain di departemen ${submitterDept}.`}
                </p>
              )}
            </div>

            <div>
              <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Dept Head</label>
              <select value={indirectSupervisorId} onChange={(e) => setIndirectSupervisorId(e.target.value)} disabled={!directSupervisorId}
                className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400">
                <option value="">(Tidak Ada)</option>
                {indirectOptions.map(e => (
                  <option key={e.id} value={e.id}>{e.name} • Gol {e.grade} • {e.position}</option>
                ))}
              </select>
            </div>
          </>
        )}

        {err && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg px-4 py-3 whitespace-pre-line">{err}</div>
        )}

        <button type="submit" disabled={!tpl || submitting}
          className={`w-full py-4 rounded-xl flex items-center justify-center gap-3 font-bold text-sm transition-all shadow-md ${
            submittedOk ? 'bg-green-600 text-white' :
            submitting ? 'bg-gray-400 text-white' :
            'bg-[var(--sidebar)] text-white hover:opacity-90 disabled:opacity-50'
          }`}>
          {submittedOk ? (<><CheckCircle size={18} /><span>Dokumen Diajukan</span></>) :
           submitting ? (<><Clock size={18} className="animate-spin" /><span>Membuat dokumen…</span></>) :
           (<><Send size={18} /><span>Generate & Ajukan{tpl ? ` — ${tpl.name}` : ''}</span></>)}
        </button>
      </form>

      <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 flex gap-4">
        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
          <FileText size={18} />
        </div>
        <div>
          <h4 className="text-[10px] font-black uppercase text-blue-900 tracking-widest mb-1">Alur Approval</h4>
          <p className="text-[10px] text-blue-700/70 font-bold uppercase leading-relaxed">
            Atasan Langsung → Dept Head → HR. PDF bisa diunduh oleh Anda dan para approver. Status final: APPROVED setelah HR menyetujui.
          </p>
        </div>
      </div>
    </div>
  );
}

function FieldInput({ field, value, onChange }: {
  field: DocumentTemplateField;
  value: string;
  onChange: (v: string) => void;
}) {
  const baseClass = 'w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500';
  const isAuto = field.type === 'auto' || field.type === 'employee_field';
  const autoLabel = field.type === 'employee_field' ? '(from Employees)' : '(auto)';
  const span = (field.type === 'textarea' || field.type === 'jenis_ijin') ? 'col-span-2' : 'col-span-2 md:col-span-1';
  return (
    <div className={span}>
      <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">
        {field.label}
        {field.required && <span className="text-red-500 ml-1">*</span>}
        {isAuto && <span className="ml-2 text-[9px] text-blue-500">{autoLabel}</span>}
      </label>
      {field.type === 'textarea' ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} className={`${baseClass} h-24 resize-none`} required={field.required} />
      ) : field.type === 'date' ? (
        <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={baseClass} required={field.required} />
      ) : field.type === 'number' ? (
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)} className={baseClass} required={field.required} />
      ) : field.type === 'start_number' ? (
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)} className={baseClass}
          placeholder="mis. 121" required={field.required} />
      ) : field.type === 'select' ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={baseClass} required={field.required}>
          <option value="">— Pilih —</option>
          {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : field.type === 'jenis_ijin' ? (
        <JenisIjinInput value={value} onChange={onChange} />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={baseClass + (isAuto ? ' bg-gray-50 text-gray-600' : '')} readOnly={isAuto} required={field.required} />
      )}
    </div>
  );
}

function JenisIjinInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const state = parseJenisState(value);
  const setA = (n: number, patch: Partial<{ from: string; to: string }>) => {
    const next: JenisIjinState = { A: { ...state.A }, B: { ...state.B } };
    next.A[n] = { ...(next.A[n] || {}), ...patch };
    onChange(JSON.stringify(next));
  };
  const setB = (n: number, patch: Partial<{ from: string; to: string; jam_s: string; jam_h: string }>) => {
    const next: JenisIjinState = { A: { ...state.A }, B: { ...state.B } };
    next.B[n] = { ...(next.B[n] || {}), ...patch };
    onChange(JSON.stringify(next));
  };
  const toggleA = (n: number, on: boolean) => {
    const next: JenisIjinState = { A: { ...state.A }, B: { ...state.B } };
    if (on) next.A[n] = next.A[n] || {};
    else delete next.A[n];
    onChange(JSON.stringify(next));
  };
  const toggleB = (n: number, on: boolean) => {
    const next: JenisIjinState = { A: { ...state.A }, B: { ...state.B } };
    if (on) next.B[n] = next.B[n] || {};
    else delete next.B[n];
    onChange(JSON.stringify(next));
  };
  const cellInput = 'w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-400';
  return (
    <div className="space-y-4 border border-gray-200 rounded-xl p-4 bg-gray-50/50">
      {/* Section A */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-700 mb-2">I. Ijin tidak masuk bekerja dengan mendapat upah / ditanggung perusahaan</p>
        <div className="space-y-1.5">
          {JENIS_A.map(item => {
            const sel = !!state.A[item.n];
            const v = state.A[item.n] || {};
            return (
              <div key={item.n} className="grid grid-cols-12 gap-2 items-center">
                <label className="col-span-12 md:col-span-6 inline-flex items-start gap-2 text-[11px] font-medium text-gray-800 cursor-pointer">
                  <input type="checkbox" checked={sel} onChange={(e) => toggleA(item.n, e.target.checked)} className="mt-0.5" />
                  <span>{item.label}</span>
                </label>
                {item.hasDate ? (
                  <>
                    <input type="date" disabled={!sel} value={v.from || ''} onChange={(e) => setA(item.n, { from: e.target.value })} className={`col-span-6 md:col-span-3 ${cellInput}`} placeholder="Dari" />
                    <input type="date" disabled={!sel} value={v.to || ''} onChange={(e) => setA(item.n, { to: e.target.value })} className={`col-span-6 md:col-span-3 ${cellInput}`} placeholder="Sampai" />
                  </>
                ) : (
                  <div className="col-span-12 md:col-span-6 text-[10px] italic text-gray-400">seperlunya</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {/* Section B */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-700 mb-2">II. Ijin tidak masuk bekerja tidak ditanggung perusahaan</p>
        <div className="space-y-1.5">
          {JENIS_B.map(item => {
            const sel = !!state.B[item.n];
            const v = state.B[item.n] || {};
            return (
              <div key={item.n} className="grid grid-cols-12 gap-2 items-center">
                <label className="col-span-12 md:col-span-4 inline-flex items-start gap-2 text-[11px] font-medium text-gray-800 cursor-pointer">
                  <input type="checkbox" checked={sel} onChange={(e) => toggleB(item.n, e.target.checked)} className="mt-0.5" />
                  <span>{item.label}</span>
                </label>
                <input type="date" disabled={!sel} value={v.from || ''} onChange={(e) => setB(item.n, { from: e.target.value })} className={`col-span-6 md:col-span-2 ${cellInput}`} />
                <input type="date" disabled={!sel} value={v.to || ''} onChange={(e) => setB(item.n, { to: e.target.value })} className={`col-span-6 md:col-span-2 ${cellInput}`} />
                {item.hasJam ? (
                  <>
                    <input type="time" disabled={!sel} value={v.jam_s || ''} onChange={(e) => setB(item.n, { jam_s: e.target.value })} className={`col-span-6 md:col-span-2 ${cellInput}`} />
                    <input type="time" disabled={!sel} value={v.jam_h || ''} onChange={(e) => setB(item.n, { jam_h: e.target.value })} className={`col-span-6 md:col-span-2 ${cellInput}`} />
                  </>
                ) : (
                  <div className="hidden md:block col-span-4" />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-[10px] text-gray-500">
        Centang jenis yang diajukan, isi tanggal/jam-nya. Saat submit, sistem mengisi placeholder
        <code className="bg-white px-1 rounded mx-1">{'{{jns1..8}}'}</code>
        <code className="bg-white px-1 rounded mx-1">{'{{smp1..8}}'}</code>
        <code className="bg-white px-1 rounded mx-1">{'{{start1..4}}'}</code>
        <code className="bg-white px-1 rounded mx-1">{'{{end1..4}}'}</code>
        <code className="bg-white px-1 rounded mx-1">{'{{jmlh1..4}}'}</code>
        <code className="bg-white px-1 rounded mx-1">{'{{jam_s2..4}}'}</code>
        <code className="bg-white px-1 rounded mx-1">{'{{jam_h2..4}}'}</code>
        otomatis. <b>{'{{jmlh}}'}</b> = (sampai − dari) + 1 hari.
      </p>
    </div>
  );
}
