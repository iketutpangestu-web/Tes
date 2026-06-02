import React, { useMemo, useState } from 'react';
import { useApp } from '../AppContext';
import { Send, FileText, CheckCircle, Camera, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { gradeNum } from '../lib/auth';
import { computeLeaveBalance } from '../lib/leaveBalance';
import { compressImageToDataUrl } from '../lib/imageCompression';
import { uploadFile } from '../lib/serverStore';
import ImageViewer from './ImageViewer';

interface SubType {
  /** Symbol code yang disimpan di leave_requests.type */
  code: string;
  label: string;
  /** Function (lihat LEAVE_FUNCTIONS) — penentu simbol di timesheet. */
  function: string;
}

const CATEGORIES: Record<string, SubType[]> = {
  Cuti: [
    { code: 'Cr', label: 'Cuti Roster',           function: 'Cuti Roster' },
    { code: 'Cs', label: 'Cuti Roster On Site',   function: 'Cuti Roster On Site' },
    { code: 'Ct', label: 'Cuti Tahunan',          function: 'Cuti Tahunan' },
    { code: 'TS', label: 'Cuti Tahunan On Site',  function: 'Cuti Tahunan on Site' },
    { code: 'Ce', label: 'Cuti Extra',            function: 'Cuti Extra' },
    { code: 'Ce', label: 'Sisa Cuti Sebelumnya',  function: 'Sisa Cuti Sebelumnya' },
    { code: 'CI', label: 'Cuti Istimewa',         function: 'Cuti Istimewa' },
    { code: 'IS', label: 'Cuti Istimewa On Site', function: 'Cuti istimewa on site' },
  ],
  Izin: [
    { code: 'UI', label: 'Ijin',                  function: 'Ijin' },
    { code: 'UIs',label: 'Ijin On Site',          function: 'Ijin on Site' },
    { code: 'IK', label: 'Ijin Khusus',           function: 'Ijin Khusus' },
    { code: 'II', label: 'Ijin Khusus On Site',   function: 'Ijin Khusus on site' },
  ],
  Sakit: [
    { code: 'SI', label: 'Sakit',                 function: 'Sakit' },
    { code: 'SS', label: 'Sakit On Site',         function: 'Sakit on site' },
  ],
  Dinas: [
    { code: 'DI', label: 'Dinas Luar',            function: 'Dinas Luar' },
    { code: 'DD', label: 'Dinas Antar Site',      function: 'Dinas Antar Site' },
    { code: 'BP', label: 'Dinas Jabodetabek',     function: 'Dinas Jabodetabek Bandara / Pelabuhan' },
  ],
  Lainnya: [
    { code: 'TT', label: 'Tidak Ada Transportasi',function: 'Tdk ada Transportasi' },
  ],
};

export default function LeaveForm() {
  const { user, employees, submitLeave, autoCalc, overrides, leaveRequests } = useApp();
  const canPickOther = user?.role === 'ADMIN' || user?.role === 'SUPERUSER' || user?.role === 'APPROVAL_HR';

  const [filterDept, setFilterDept] = useState<string>('ALL');
  const [filterGrade, setFilterGrade] = useState<string>('ALL');

  const [category, setCategory] = useState<string>('Cuti');
  const [subTypeIdx, setSubTypeIdx] = useState<number>(0);

  const [formData, setFormData] = useState({
    employeeId: user?.id || '',
    startDate: '',
    endDate: '',
    reason: '',
    directSupervisorId: '',
    indirectSupervisorId: '',
    attachmentImage: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [imageError, setImageError] = useState('');
  const [showCrDialog, setShowCrDialog] = useState(false);
  const [previewImg, setPreviewImg] = useState<string | null>(null);

  const departments = useMemo(() => {
    const s = new Set<string>();
    employees.forEach(e => { if (e.department) s.add(e.department); });
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'id', { sensitivity: 'base' }));
  }, [employees]);

  const grades = useMemo(() => {
    const s = new Set<string>();
    employees.forEach(e => { if (e.grade) s.add(e.grade); });
    return Array.from(s).sort();
  }, [employees]);

  const eligibleEmployees = useMemo(() => {
    let pool = employees;
    if (user?.role === 'ADMIN') pool = pool.filter(e => e.department === user.department);
    if (user?.role !== 'SUPERUSER') pool = pool.filter(e => e.role !== 'SUPERUSER' || e.id === user?.id);
    return pool
      .filter(e => filterDept === 'ALL' || e.department === filterDept)
      .filter(e => filterGrade === 'ALL' || e.grade === filterGrade)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id', { sensitivity: 'base' }));
  }, [employees, filterDept, filterGrade, user]);

  const selectedEmp = employees.find(e => e.id === formData.employeeId) || user;
  const submitterGrade = gradeNum(selectedEmp?.grade);
  const submitterDept = selectedEmp?.department;

  const directOptions = useMemo(() => {
    if (!submitterDept || !submitterGrade) return [];
    // KHUSUS: pengaju Golongan III/IV/V/VI → Atasan Langsung = semua Golongan IV/V/VI dari semua dept.
    if (submitterGrade >= 3 && submitterGrade <= 6) {
      return employees
        .filter(e => e.id !== selectedEmp?.id && gradeNum(e.grade) >= 4 && gradeNum(e.grade) <= 6)
        .sort((a, b) => gradeNum(a.grade) - gradeNum(b.grade) || (a.name || '').localeCompare(b.name || ''));
    }
    return employees
      .filter(e => e.department === submitterDept && e.id !== selectedEmp?.id && gradeNum(e.grade) > submitterGrade)
      .sort((a, b) => gradeNum(a.grade) - gradeNum(b.grade) || (a.name || '').localeCompare(b.name || ''));
  }, [employees, submitterDept, submitterGrade, selectedEmp]);

  const directSup = employees.find(e => e.id === formData.directSupervisorId);
  const directGrade = gradeNum(directSup?.grade);

  const indirectOptions = useMemo(() => {
    if (!directSup || !directGrade) return [];
    // KHUSUS: Atasan Langsung Golongan IV/V/VI → Dept Head = semua Golongan IV/V/VI dari semua dept.
    if (directGrade >= 4 && directGrade <= 6) {
      return employees
        .filter(e => e.id !== directSup.id && e.id !== selectedEmp?.id && gradeNum(e.grade) >= 4 && gradeNum(e.grade) <= 6)
        .sort((a, b) => gradeNum(a.grade) - gradeNum(b.grade) || (a.name || '').localeCompare(b.name || ''));
    }
    return employees
      .filter(e => e.department === submitterDept && e.id !== directSup.id && e.id !== selectedEmp?.id && gradeNum(e.grade) > directGrade)
      .sort((a, b) => gradeNum(a.grade) - gradeNum(b.grade) || (a.name || '').localeCompare(b.name || ''));
  }, [employees, submitterDept, directSup, directGrade, selectedEmp]);

  const balance = useMemo(() => {
    if (!selectedEmp) return null;
    return computeLeaveBalance(selectedEmp, overrides, new Date().getFullYear());
  }, [selectedEmp, overrides]);

  /**
   * Riwayat Leave milik akun yang login (user.id), termasuk yang diajukan
   * oleh ADMIN/SUPERUSER atas namanya. Diurutkan terbaru → terlama, ambil 10.
   */
  const myHistory = useMemo(() => {
    if (!user) return [];
    return leaveRequests
      .filter(r => r.employeeId === user.id)
      .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''))
      .slice(0, 10);
  }, [leaveRequests, user]);

  const isPdfAttachment = (s: string) =>
    s.startsWith('data:application/pdf') || /\.pdf($|\?)/i.test(s);

  const openPdfAttachment = (val: string) => {
    // URL biasa (mis. /uploads/2026/05/abc.pdf) → buka langsung.
    if (!val.startsWith('data:')) {
      const w = window.open(val, '_blank');
      if (!w) {
        const a = document.createElement('a');
        a.href = val; a.download = 'lampiran.pdf'; a.click();
      }
      return;
    }
    try {
      const base64 = val.split(',')[1] || '';
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (!w) {
        const a = document.createElement('a');
        a.href = url; a.download = 'lampiran.pdf'; a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      alert('Gagal membuka PDF.');
    }
  };

  const handleImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImageError('');
    try {
      let attachmentImage = '';
      let uploadBlob: Blob | null = null;
      let uploadName = f.name;
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        if (f.size > 5 * 1024 * 1024) throw new Error('Ukuran PDF maksimal 5 MB.');
        attachmentImage = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result || ''));
          r.onerror = () => reject(new Error('Gagal membaca PDF.'));
          r.readAsDataURL(f);
        });
        uploadBlob = f;
      } else if (f.type.startsWith('image/')) {
        attachmentImage = await compressImageToDataUrl(f, { maxWidth: 1280, maxHeight: 1280, quality: 0.72 });
        uploadBlob = await (await fetch(attachmentImage)).blob();
        uploadName = f.name.replace(/\.[^.]+$/, '') + '.jpg';
      } else {
        throw new Error('Format tidak didukung. Gunakan gambar atau PDF.');
      }
      // Coba simpan sebagai file fisik di server (folder uploads/). Kalau gagal/offline, pakai base64.
      const url = uploadBlob ? await uploadFile(uploadBlob, { filename: uploadName }) : null;
      setFormData(prev => ({ ...prev, attachmentImage: url || attachmentImage }));
    } catch (err) {
      setFormData(prev => ({ ...prev, attachmentImage: '' }));
      setImageError(err instanceof Error ? err.message : 'Gagal memproses lampiran.');
    }
  };

  const doSubmit = async (finalCode: string, finalFunction: string) => {
    const isDelegated = canPickOther && user && formData.employeeId !== user.id;
    const indirectEmp = employees.find(em => em.id === formData.indirectSupervisorId);
    await submitLeave({
      employeeId: formData.employeeId,
      type: finalCode,
      function: finalFunction,
      startDate: formData.startDate,
      endDate: formData.endDate,
      reason: formData.reason,
      status: 'PENDING',
      directSupervisorId: formData.directSupervisorId,
      directSupervisorName: directSup?.name || '',
      indirectSupervisorId: formData.indirectSupervisorId || undefined,
      indirectSupervisorName: indirectEmp?.name || undefined,
      attachmentImage: formData.attachmentImage || undefined,
      ...(isDelegated && user ? {
        submittedById: user.id,
        submittedByName: user.name,
        submittedByPosition: user.position,
      } : {}),
    });
    setSubmitted(true);
    setFormData(prev => ({ ...prev, startDate: '', endDate: '', reason: '', directSupervisorId: '', indirectSupervisorId: '', attachmentImage: '' }));
    setTimeout(() => setSubmitted(false), 3000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.directSupervisorId) {
      alert('Pilih Atasan Langsung terlebih dahulu.');
      return;
    }
    const sel = (CATEGORIES[category] || [])[subTypeIdx];
    if (!sel) return;
    // Cuti Roster → tampilkan dialog
    if (sel.function === 'Cuti Roster') {
      setShowCrDialog(true);
      return;
    }
    await doSubmit(sel.code, sel.function);
  };

  const subOptions = CATEGORIES[category] || [];
  const currentSub = subOptions[subTypeIdx];

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <header>
        <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Request Application</h2>
        <p className="text-xs text-gray-500 font-medium uppercase tracking-widest mt-1">Leave, Permit, or Duty Authorization Form</p>
      </header>

      {myHistory.length > 0 && (
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between">
            <h3 className="text-[11px] font-black uppercase tracking-widest text-gray-700">Riwayat Leave Saya</h3>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{myHistory.length} terakhir</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {myHistory.map(r => {
              const submittedByOther = r.submittedById && r.submittedById !== user?.id;
              return (
                <li key={r.id} className="px-5 py-3 flex items-center gap-3 text-[11px]">
                  <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                    r.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                    r.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {r.status === 'APPROVED' ? <CheckCircle2 size={10} /> : r.status === 'REJECTED' ? <XCircle size={10} /> : <Clock size={10} />}
                    {r.status}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 truncate">
                      {r.type} <span className="text-gray-400 font-medium">• {r.startDate} → {r.endDate}</span>
                    </p>
                    <p className="text-[10px] text-gray-500 truncate">
                      {submittedByOther ? <>Diajukan oleh <b>{r.submittedByName || '—'}</b>{r.submittedByPosition ? ` (${r.submittedByPosition})` : ''} • </> : null}
                      {r.directSupervisorName ? <>Atasan: {r.directSupervisorName}{r.directApprovedAt ? ' ✓' : ''}</> : null}
                      {r.indirectSupervisorName ? <> • Dept Head: {r.indirectSupervisorName}{r.indirectApprovedAt ? ' ✓' : ''}</> : null}
                      {r.status === 'REJECTED' && r.rejectionReason ? <> • <span className="text-red-600 font-bold">Alasan: {r.rejectionReason}</span></> : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 p-10 shadow-sm space-y-8">
        <div className="grid grid-cols-2 gap-8">
          {canPickOther ? (
            <>
              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Departemen</label>
                <select
                  value={filterDept}
                  onChange={(e) => { setFilterDept(e.target.value); setFormData(prev => ({ ...prev, employeeId: '', directSupervisorId: '', indirectSupervisorId: '' })); }}
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500"
                >
                  <option value="ALL">Semua Departemen</option>
                  {departments.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Golongan</label>
                <select
                  value={filterGrade}
                  onChange={(e) => { setFilterGrade(e.target.value); setFormData(prev => ({ ...prev, employeeId: '', directSupervisorId: '', indirectSupervisorId: '' })); }}
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500"
                >
                  <option value="ALL">Semua Golongan</option>
                  {grades.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Nama Karyawan</label>
                <select
                  value={formData.employeeId}
                  onChange={(e) => setFormData(prev => ({ ...prev, employeeId: e.target.value, directSupervisorId: '', indirectSupervisorId: '' }))}
                  required
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500"
                >
                  <option value="">— Pilih Karyawan —</option>
                  {eligibleEmployees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name} • {emp.nik}</option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <div className="col-span-2">
              <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Applicant Personnel</label>
              <div className="px-4 py-3 bg-gray-50 rounded-xl border border-gray-100 text-sm font-bold text-gray-900">
                {selectedEmp?.name} <span className="text-gray-400 mx-2">•</span> {selectedEmp?.nik}
                <span className="text-gray-400 mx-2">•</span> Gol {selectedEmp?.grade} • {selectedEmp?.department}
              </div>
            </div>
          )}

          <div className="col-span-2 md:col-span-1">
            <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Kategori</label>
            <select
              value={category}
              onChange={(e) => {
                const cat = e.target.value;
                setCategory(cat);
                setSubTypeIdx(0);
              }}
              className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500"
            >
              {Object.keys(CATEGORIES).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="col-span-2 md:col-span-1">
            <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Sub Tipe</label>
            <select
              value={String(subTypeIdx)}
              onChange={(e) => setSubTypeIdx(Number(e.target.value))}
              className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500"
            >
              {subOptions.map((s, i) => <option key={`${s.code}-${i}`} value={String(i)}>{s.label} ({s.code})</option>)}
            </select>
          </div>

          <div className="col-span-2 md:col-span-1">
            <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Start Date</label>
            <input 
              type="date"
              value={formData.startDate}
              onChange={(e) => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
              className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500"
              required
            />
          </div>

          <div className="col-span-2 md:col-span-1">
            <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">End Date</label>
            <input 
              type="date"
              value={formData.endDate}
              onChange={(e) => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
              className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500"
              required
            />
          </div>

          <div className="col-span-2">
            <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Atasan Langsung</label>
            <select
              value={formData.directSupervisorId}
              onChange={(e) => setFormData(prev => ({ ...prev, directSupervisorId: e.target.value, indirectSupervisorId: '' }))}
              required
              className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500"
            >
              <option value="">— Pilih Atasan Langsung —</option>
              {directOptions.map(e => (
                <option key={e.id} value={e.id}>{e.name} • Gol {e.grade} • {e.position}</option>
              ))}
            </select>
            {directOptions.length === 0 && submitterDept && (
              <p className="text-[10px] text-amber-600 mt-1 font-bold">Tidak ada karyawan di {submitterDept} dengan golongan lebih tinggi.</p>
            )}
          </div>

          <div className="col-span-2">
            <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Dept Head</label>
            <select
              value={formData.indirectSupervisorId}
              onChange={(e) => setFormData(prev => ({ ...prev, indirectSupervisorId: e.target.value }))}
              disabled={!formData.directSupervisorId}
              className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
            >
              <option value="">(Tidak Ada)</option>
              {indirectOptions.map(e => (
                <option key={e.id} value={e.id}>{e.name} • Gol {e.grade} • {e.position}</option>
              ))}
            </select>
          </div>

          <div className="col-span-2">
            <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Description / Reason</label>
            <textarea 
              value={formData.reason}
              onChange={(e) => setFormData(prev => ({ ...prev, reason: e.target.value }))}
              className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 h-24 resize-none"
              placeholder="Provide a detailed explanation..."
            />
          </div>

          <div className="col-span-2">
            <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Lampiran Gambar / PDF (opsional)</label>
            <label className="cursor-pointer flex items-center gap-2 px-4 py-3 bg-gray-50 border border-dashed border-gray-300 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100">
              <Camera size={14} />
              <span>{formData.attachmentImage ? 'Ganti lampiran' : 'Pilih gambar atau PDF (foto sakit, surat, dll)'}</span>
              <input type="file" accept="image/*,application/pdf" onChange={handleImage} className="hidden" />
            </label>
            {imageError && <p className="text-[10px] text-red-500 mt-2 font-bold">{imageError}</p>}
            {formData.attachmentImage && (
              isPdfAttachment(formData.attachmentImage) ? (
                <button type="button" onClick={() => openPdfAttachment(formData.attachmentImage)}
                  className="mt-3 flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-xs font-bold text-red-700 hover:bg-red-100 w-full">
                  📄 Lihat PDF terlampir (klik untuk buka)
                </button>
              ) : (
                <button type="button" onClick={() => setPreviewImg(formData.attachmentImage)} className="block w-full mt-3">
                  <img src={formData.attachmentImage} alt="lampiran" className="w-full max-h-48 object-contain rounded-lg border border-gray-200 cursor-zoom-in hover:opacity-90" />
                </button>
              )
            )}
          </div>
        </div>

        <button 
          type="submit"
          className={`w-full py-4 rounded-xl flex items-center justify-center gap-3 font-bold text-sm transition-all shadow-md ${
            submitted ? 'bg-green-600 text-white' : 'bg-[var(--sidebar)] text-white hover:opacity-90'
          }`}
        >
          {submitted ? (
            <>
              <CheckCircle size={18} />
              <span>Application Submitted</span>
            </>
          ) : (
            <>
              <Send size={18} />
              <span>Send Application — {currentSub?.label}</span>
            </>
          )}
        </button>
      </form>

      <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 flex gap-4">
        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
          <FileText size={18} />
        </div>
        <div>
          <h4 className="text-[10px] font-black uppercase text-blue-900 tracking-widest mb-1">Site Leave Policy</h4>
          <p className="text-[10px] text-blue-700/70 font-bold uppercase leading-relaxed">
            Applications must be submitted 14 days in advance. approval subject to logistics availability.
          </p>
        </div>
      </div>

      {/* Dialog: Cuti Roster — pakai saldo lain? */}
      {showCrDialog && (
        <div className="fixed inset-0 z-[2000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowCrDialog(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">Pilih Saldo</h3>
              <p className="text-[11px] text-gray-500 mt-1">
                Apakah karyawan ingin menggunakan saldo <b>Extra Cuti</b> atau <b>Cuti Tahunan</b>?
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={async () => { setShowCrDialog(false); await doSubmit('Cr', 'Cuti Roster'); }}
                className="text-left px-4 py-3 rounded-xl border-2 border-green-200 bg-green-50 hover:bg-green-100 transition"
              >
                <p className="text-xs font-black text-green-800 uppercase">Tetap Cuti Roster (Cr)</p>
                <p className="text-[10px] text-green-700/70 mt-0.5">Tidak memotong saldo Extra Cuti / Cuti Tahunan</p>
              </button>

              <button
                type="button"
                onClick={async () => { setShowCrDialog(false); await doSubmit('Ce', 'Cuti Extra'); }}
                className="text-left px-4 py-3 rounded-xl border-2 border-orange-200 bg-orange-50 hover:bg-orange-100 transition"
              >
                <div className="flex justify-between items-center">
                  <p className="text-xs font-black text-orange-800 uppercase">Pakai Extra Cuti (Ce)</p>
                  {autoCalc && balance && (
                    <span className="text-[10px] font-black bg-orange-200 text-orange-900 px-2 py-0.5 rounded-full">
                      Saldo: {balance.extraAvailable} hari
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-orange-700/70 mt-0.5">Akan memotong saldo Extra Cuti</p>
              </button>

              <button
                type="button"
                onClick={async () => { setShowCrDialog(false); await doSubmit('Ct', 'Cuti Tahunan'); }}
                className="text-left px-4 py-3 rounded-xl border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 transition"
              >
                <div className="flex justify-between items-center">
                  <p className="text-xs font-black text-blue-800 uppercase">Pakai Cuti Tahunan (Ct)</p>
                  {autoCalc && balance && (
                    <span className="text-[10px] font-black bg-blue-200 text-blue-900 px-2 py-0.5 rounded-full">
                      Saldo: {balance.annualAvailable} hari
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-blue-700/70 mt-0.5">Akan memotong saldo Cuti Tahunan</p>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowCrDialog(false)}
              className="w-full py-2 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-gray-900"
            >
              Batal
            </button>
          </div>
        </div>
      )}
      {previewImg && <ImageViewer src={previewImg} alt="lampiran" onClose={() => setPreviewImg(null)} />}
    </div>
  );
}
