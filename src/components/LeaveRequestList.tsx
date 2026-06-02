import React, { useMemo, useState } from 'react';
import { useApp } from '../AppContext';
import { Download, Search, CheckCircle2, Clock, XCircle, Image as ImageIcon, Trash2, CheckSquare, Square } from 'lucide-react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { supervisorStageDone, gradeNum } from '../lib/auth';
import ImageViewer from './ImageViewer';
import SuperuserPasswordModal from './SuperuserPasswordModal';

export default function LeaveRequestList() {
  const {
    user, employees, leaveRequests,
    customSymbols,
    approveLeaveAsDirect, approveLeaveAsIndirect, approveLeave, hrApproveLeave,
    rejectLeave,
    verifySuperuserPassword, deleteLeaveRequests, deleteAllLeaveRequests,
  } = useApp();
  const [search, setSearch] = useState('');
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pwdModal, setPwdModal] = useState<null | { mode: 'selected' | 'all' }>(null);

  const isPdfAttachment = (s: string) =>
    s.startsWith('data:application/pdf') || /\.pdf($|\?)/i.test(s);

  const openPdfAttachment = (val: string) => {
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
        // popup blocked → trigger download
        const a = document.createElement('a');
        a.href = url; a.download = 'lampiran.pdf'; a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      alert('Gagal membuka PDF.');
    }
  };

  const isSuper = user?.role === 'SUPERUSER';

  const empById = useMemo(() => {
    const m = new Map<string, typeof employees[number]>();
    employees.forEach(e => m.set(e.id, e));
    return m;
  }, [employees]);

  const symbolMeaning = (r: typeof leaveRequests[number]): string => {
    if (r.function) {
      const byFn = customSymbols.find(s => s.function === r.function);
      if (byFn?.label) return byFn.label;
      return r.function;
    }
    const byCode = customSymbols.find(s => s.code === r.type);
    return byCode?.label || '';
  };

  const visible = useMemo(() => {
    if (!user) return [];
    let pool = leaveRequests;
    if (user.role === 'APPROVAL') {
      const myGrade = gradeNum(user.grade);
      pool = pool.filter(r => {
        const emp = empById.get(r.employeeId);
        if (!emp) return false;
        // Tetap tampilkan jika viewer dipilih sebagai atasan langsung/tidak langsung
        if (r.directSupervisorId === user.id || r.indirectSupervisorId === user.id) return true;
        // Selain itu: hanya satu departemen DAN tepat 1 golongan di bawah viewer
        const sameDept = emp.department === user.department;
        const empGrade = gradeNum(emp.grade);
        const oneBelow = myGrade > 0 && empGrade === myGrade - 1;
        return sameDept && oneBelow;
      });
    } else if (user.role === 'ADMIN') {
      pool = pool.filter(r => {
        const emp = empById.get(r.employeeId);
        return emp?.department === user.department;
      });
    }
    // APPROVAL_HR & SUPERUSER: lihat semua
    const q = search.trim().toLowerCase();
    if (q) {
      pool = pool.filter(r => {
        const emp = empById.get(r.employeeId);
        return (emp?.name || '').toLowerCase().includes(q) || (emp?.nik || '').toLowerCase().includes(q) || r.type.toLowerCase().includes(q);
      });
    }
    return [...pool].sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
  }, [leaveRequests, user, empById, search]);

  const exportXlsx = () => {
    const rows = visible.map((r, i) => {
      const emp = empById.get(r.employeeId);
      return {
        No: i + 1,
        NIK: emp?.nik || '',
        Nama: emp?.name || '',
        Departemen: emp?.department || '',
        Golongan: emp?.grade || '',
        'Tipe Izin': r.type,
        'Mulai': r.startDate,
        'Selesai': r.endDate,
        Alasan: r.reason || '',
        'Atasan Langsung': r.directSupervisorName || '',
        'Setuju Atasan Langsung': r.directApprovedAt ? 'YA' : 'BELUM',
        'Dept Head': r.indirectSupervisorName || '(Tidak Ada)',
        'Setuju Dept Head': r.indirectSupervisorId ? (r.indirectApprovedAt ? 'YA' : 'BELUM') : '-',
        Status: r.status,
        'Diajukan Oleh': r.submittedByName || emp?.name || '',
        'Diajukan Pada': r.submittedAt,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'LeaveRequests');
    const stamp = format(new Date(), 'yyyyMMdd-HHmm');
    const scope = user?.role === 'ADMIN' ? `dept-${user.department}` : 'all';
    XLSX.writeFile(wb, `leave-requests-${scope}-${stamp}.xlsx`);
  };

  if (!user) return null;

  const toggleId = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === visible.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(visible.map(r => r.id)));
  };
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };

  const handleReject = (id: string) => {
    // Satu dialog saja: kalau user menekan Cancel → batal; OK (boleh kosong) → tolak.
    const reason = window.prompt('Tolak permintaan leave ini?\n\nAlasan penolakan (opsional):');
    if (reason === null) return;
    rejectLeave(id, user!.id, reason.trim() || undefined);
  };

  const fmtSubmitted = (s?: string) => {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return format(d, 'dd/MM/yyyy HH:mm');
  };

  return (
    <div className="space-y-6">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Leave Request List</h2>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-widest mt-1">
            {user.role === 'APPROVAL' ? 'Permintaan yang menunjuk Anda sebagai atasan' :
              user.role === 'ADMIN' ? `Departemen ${user.department}` : 'Semua permintaan'}
          </p>
        </div>
        <div className="flex gap-3">
          {isSuper && (
            <>
              {!selectMode ? (
                <>
                  <button
                    onClick={() => setSelectMode(true)}
                    className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-lg flex items-center gap-2 text-xs font-bold hover:bg-gray-50 transition-all shadow-sm"
                  >
                    <CheckSquare size={14} /> Select to Delete
                  </button>
                  <button
                    onClick={() => setPwdModal({ mode: 'all' })}
                    disabled={leaveRequests.length === 0}
                    className="bg-red-600 text-white px-4 py-2.5 rounded-lg flex items-center gap-2 text-xs font-bold hover:bg-red-700 transition-all shadow-sm disabled:opacity-50"
                  >
                    <Trash2 size={14} /> Delete All Request
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setPwdModal({ mode: 'selected' })}
                    disabled={selectedIds.size === 0}
                    className="bg-red-600 text-white px-4 py-2.5 rounded-lg flex items-center gap-2 text-xs font-bold hover:bg-red-700 transition-all shadow-sm disabled:opacity-50"
                  >
                    <Trash2 size={14} /> Hapus Terpilih ({selectedIds.size})
                  </button>
                  <button
                    onClick={exitSelectMode}
                    className="bg-gray-100 text-gray-700 px-4 py-2.5 rounded-lg text-xs font-bold hover:bg-gray-200"
                  >
                    Batal
                  </button>
                </>
              )}
            </>
          )}
          <button
            onClick={exportXlsx}
            disabled={visible.length === 0}
            className="bg-white border border-gray-200 text-gray-700 px-5 py-2.5 rounded-lg flex items-center gap-2 text-xs font-bold hover:bg-gray-50 transition-all shadow-sm disabled:opacity-50"
          >
            <Download size={14} /><span>Export XLSX</span>
          </button>
        </div>
      </header>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div className="relative w-80">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Cari nama, NIK, tipe..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <span className="text-[10px] uppercase tracking-widest font-black text-gray-400">{visible.length} request</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 text-[10px] uppercase tracking-widest text-gray-500 border-b border-gray-100">
                {selectMode && (
                  <th className="px-3 py-3 font-bold w-10">
                    <button onClick={toggleSelectAll} title="Pilih semua" className="text-gray-600 hover:text-gray-900">
                      {selectedIds.size === visible.length && visible.length > 0
                        ? <CheckSquare size={14} /> : <Square size={14} />}
                    </button>
                  </th>
                )}
                <th className="px-4 py-3 font-bold">Karyawan</th>
                <th className="px-4 py-3 font-bold">Tipe / Periode</th>
                <th className="px-4 py-3 font-bold">Diajukan</th>
                <th className="px-4 py-3 font-bold">Atasan Langsung</th>
                <th className="px-4 py-3 font-bold">Dept Head</th>
                <th className="px-4 py-3 font-bold">Lampiran</th>
                <th className="px-4 py-3 font-bold">Status</th>
                <th className="px-4 py-3 font-bold">Aksi</th>
              </tr>
            </thead>
            <tbody className="text-[11px] font-medium text-gray-600">
              {visible.map(r => {
                const emp = empById.get(r.employeeId);
                const isDirect = r.directSupervisorId === user.id;
                const isIndirect = r.indirectSupervisorId === user.id;
                return (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-blue-50/30">
                    {selectMode && (
                      <td className="px-3 py-3">
                        <button onClick={() => toggleId(r.id)} className="text-gray-600 hover:text-red-600">
                          {selectedIds.has(r.id) ? <CheckSquare size={14} className="text-red-600" /> : <Square size={14} />}
                        </button>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <p className="text-sm font-bold text-gray-900">{emp?.name || '—'}</p>
                      <p className="text-[10px] text-gray-400">{emp?.nik} • {emp?.department}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-bold text-gray-900">{r.type}</p>
                      {symbolMeaning(r) && (
                        <p className="text-[10px] text-gray-500 italic">{symbolMeaning(r)}</p>
                      )}
                      <p className="text-[10px] text-gray-400">{r.startDate} → {r.endDate}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-900">{fmtSubmitted(r.submittedAt)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-900">{r.directSupervisorName || '—'}</p>
                      {r.directApprovedAt ? (
                        <p className="text-[10px] font-bold text-green-600">✓ Disetujui</p>
                      ) : r.status === 'REJECTED' && r.rejectedBy === r.directSupervisorId ? (
                        <p className="text-[10px] font-bold text-red-600">✗ Ditolak</p>
                      ) : r.status === 'REJECTED' ? (
                        <p className="text-[10px] font-bold text-red-600">✗ Ditolak</p>
                      ) : (
                        <p className="text-[10px] font-bold text-amber-600">○ Menunggu</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-900">{r.indirectSupervisorName || '(Tidak Ada)'}</p>
                      {r.indirectSupervisorId && (
                        r.indirectApprovedAt ? (
                          <p className="text-[10px] font-bold text-green-600">✓ Disetujui</p>
                        ) : r.status === 'REJECTED' ? (
                          <p className="text-[10px] font-bold text-red-600">✗ Ditolak</p>
                        ) : (
                          <p className="text-[10px] font-bold text-amber-600">○ Menunggu</p>
                        )
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.attachmentImage ? (
                        isPdfAttachment(r.attachmentImage) ? (
                          <button onClick={() => openPdfAttachment(r.attachmentImage!)}
                            className="text-red-600 hover:underline flex items-center gap-1 text-[10px] font-bold">
                            📄 PDF
                          </button>
                        ) : (
                          <button onClick={() => setPreviewImg(r.attachmentImage!)} className="text-blue-600 hover:underline flex items-center gap-1 text-[10px] font-bold">
                            <ImageIcon size={12} /> Lihat
                          </button>
                        )
                      ) : <span className="text-gray-300 text-[10px]">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                        r.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                        r.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {r.status === 'APPROVED' ? <CheckCircle2 size={10} /> : r.status === 'REJECTED' ? <XCircle size={10} /> : <Clock size={10} />}
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {isDirect && !r.directApprovedAt && r.status === 'PENDING' && (
                          <>
                            <button onClick={() => approveLeaveAsDirect(r.id, user.id)}
                              className="text-[10px] font-bold bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700">
                              Setujui (Atasan Langsung)
                            </button>
                            <button onClick={() => handleReject(r.id)}
                              className="text-[10px] font-bold bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">
                              Tolak
                            </button>
                          </>
                        )}
                        {isIndirect && !r.indirectApprovedAt && r.status === 'PENDING' && (
                          <>
                            {!r.directApprovedAt && (
                              <span className="text-[9px] text-amber-600 font-bold">Menunggu atasan langsung dulu</span>
                            )}
                            <button onClick={() => approveLeaveAsIndirect(r.id, user.id)}
                              disabled={!r.directApprovedAt}
                              className="text-[10px] font-bold bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
                              Setujui (Dept Head)
                            </button>
                            <button onClick={() => handleReject(r.id)}
                              className="text-[10px] font-bold bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">
                              Tolak
                            </button>
                          </>
                        )}
                        {r.status === 'REJECTED' && (isDirect || isIndirect || user.role === 'APPROVAL_HR') && (
                          <span className="text-[9px] text-red-600 font-bold italic">Ditolak{r.rejectionReason ? `: ${r.rejectionReason}` : ''}</span>
                        )}
                        {user.role === 'APPROVAL_HR' && r.status === 'PENDING' && (
                          supervisorStageDone(r) ? (
                            <>
                              <button onClick={() => hrApproveLeave(r.id, user.id)}
                                className="text-[10px] font-bold bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700">
                                HR Approve
                              </button>
                              <button onClick={() => handleReject(r.id)}
                                className="text-[10px] font-bold bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">
                                Tolak
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="text-[9px] text-amber-600 font-bold">Menunggu approval atasan</span>
                              <button onClick={() => handleReject(r.id)}
                                className="text-[10px] font-bold bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">
                                Tolak
                              </button>
                            </>
                          )
                        )}
                        {user.role === 'SUPERUSER' && r.status !== 'APPROVED' && (
                          <>
                            <button onClick={() => approveLeave(r.id, user.id)}
                              className="text-[10px] font-bold bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700">
                              {r.status === 'REJECTED' ? 'Superuser Override Approve' : 'Superuser Approve'}
                            </button>
                            {r.status === 'PENDING' && (
                              <button onClick={() => handleReject(r.id)}
                                className="text-[10px] font-bold bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">
                                Tolak
                              </button>
                            )}
                          </>
                        )}
                        {user.role === 'ADMIN' && r.status === 'PENDING' && supervisorStageDone(r) && (
                          <span className="text-[9px] text-gray-400 italic">Menunggu HR</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={selectMode ? 9 : 8} className="p-16 text-center text-gray-400 italic text-sm">Belum ada permintaan.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {previewImg && (
        <ImageViewer src={previewImg} alt="lampiran" onClose={() => setPreviewImg(null)} />
      )}

      <SuperuserPasswordModal
        open={!!pwdModal}
        title={pwdModal?.mode === 'all' ? 'Hapus SEMUA Leave Request' : 'Hapus Leave Request Terpilih'}
        description={
          pwdModal?.mode === 'all'
            ? `Aksi ini akan menghapus seluruh ${leaveRequests.length} permintaan leave dan tidak bisa dibatalkan.`
            : `Aksi ini akan menghapus ${selectedIds.size} permintaan leave terpilih dan tidak bisa dibatalkan.`
        }
        verify={verifySuperuserPassword}
        onConfirm={() => {
          if (pwdModal?.mode === 'all') {
            deleteAllLeaveRequests();
          } else {
            deleteLeaveRequests(Array.from(selectedIds));
          }
          exitSelectMode();
        }}
        onClose={() => setPwdModal(null)}
      />
    </div>
  );
}
