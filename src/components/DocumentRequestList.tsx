import React, { useMemo, useState } from 'react';
import { useApp } from '../AppContext';
import { Search, CheckCircle2, Clock, XCircle, Download, Trash2, CheckSquare, Square, X, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { supervisorStageDone, gradeNum } from '../lib/auth';
import type { DocumentRequest, LeaveRequest } from '../types';
import SuperuserPasswordModal from './SuperuserPasswordModal';
import DocxPreviewModal from './DocxPreviewModal';

/** Adapter: pakai helper supervisorStageDone yang aslinya untuk LeaveRequest. */
function stageDone(r: DocumentRequest): boolean {
  return supervisorStageDone(r as unknown as LeaveRequest);
}

export default function DocumentRequestList() {
  const {
    user, employees, documentRequests,
    approveDocumentAsDirect, approveDocumentAsIndirect, hrApproveDocument,
    approveDocument, rejectDocument,
    deleteDocumentRequests, verifySuperuserPassword,
  } = useApp();
  const [search, setSearch] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pwModal, setPwModal] = useState<{ open: boolean; ids: string[] }>({ open: false, ids: [] });
  const [preview, setPreview] = useState<{ open: boolean; url?: string; title?: string }>({ open: false });

  const empById = useMemo(() => {
    const m = new Map<string, typeof employees[number]>();
    employees.forEach(e => m.set(e.id, e));
    return m;
  }, [employees]);

  const visible = useMemo(() => {
    if (!user) return [];
    let pool = documentRequests;
    if (user.role === 'APPROVAL') {
      const myGrade = gradeNum(user.grade);
      pool = pool.filter(r => {
        const emp = empById.get(r.employeeId);
        if (!emp) return false;
        if (r.directSupervisorId === user.id || r.indirectSupervisorId === user.id) return true;
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
    const q = search.trim().toLowerCase();
    if (q) {
      pool = pool.filter(r => {
        const emp = empById.get(r.employeeId);
        return (emp?.name || '').toLowerCase().includes(q)
          || (emp?.nik || '').toLowerCase().includes(q)
          || r.templateName.toLowerCase().includes(q);
      });
    }
    return [...pool].sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
  }, [documentRequests, user, empById, search]);

  if (!user) return null;

  const fmtSubmitted = (s?: string) => {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return format(d, 'dd/MM/yyyy HH:mm');
  };

  const handleReject = (id: string) => {
    const reason = window.prompt('Tolak pengajuan dokumen ini?\n\nAlasan penolakan (opsional):');
    if (reason === null) return;
    rejectDocument(id, user.id, reason.trim() || undefined);
  };

  const canDelete = user.role === 'SUPERUSER' || user.role === 'APPROVAL_HR' || user.role === 'ADMIN';
  const visibleIds = visible.map(v => v.id);
  const allSelected = selectMode && visibleIds.length > 0 && visibleIds.every(id => selected.has(id));

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(visibleIds));
  };
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };

  return (
    <div className="space-y-6">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Document Request List</h2>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-widest mt-1">
            {user.role === 'APPROVAL' ? 'Pengajuan yang menunjuk Anda sebagai atasan' :
              user.role === 'ADMIN' ? `Departemen ${user.department}` : 'Semua pengajuan'}
          </p>
        </div>
        {canDelete && (
          <div className="flex gap-2">
            {!selectMode ? (
              <>
                <button onClick={() => setSelectMode(true)}
                  className="text-[11px] font-bold bg-gray-100 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-200 inline-flex items-center gap-1.5">
                  <CheckSquare size={13} /> Select To Delete
                </button>
                <button onClick={() => { if (visibleIds.length) setPwModal({ open: true, ids: visibleIds }); }}
                  disabled={visibleIds.length === 0}
                  className="text-[11px] font-bold bg-red-600 text-white px-3 py-2 rounded-lg hover:bg-red-700 inline-flex items-center gap-1.5 disabled:opacity-40">
                  <Trash2 size={13} /> Delete All
                </button>
              </>
            ) : (
              <>
                <span className="text-[11px] font-bold text-gray-600 self-center">{selected.size} dipilih</span>
                <button onClick={() => { if (selected.size) setPwModal({ open: true, ids: Array.from(selected) }); }}
                  disabled={selected.size === 0}
                  className="text-[11px] font-bold bg-red-600 text-white px-3 py-2 rounded-lg hover:bg-red-700 inline-flex items-center gap-1.5 disabled:opacity-40">
                  <Trash2 size={13} /> Hapus Terpilih
                </button>
                <button onClick={exitSelect}
                  className="text-[11px] font-bold bg-gray-100 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-200 inline-flex items-center gap-1.5">
                  <X size={13} /> Batal
                </button>
              </>
            )}
          </div>
        )}
      </header>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div className="relative w-80">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Cari nama, NIK, template..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <span className="text-[10px] uppercase tracking-widest font-black text-gray-400">{visible.length} request</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 text-[10px] uppercase tracking-widest text-gray-500 border-b border-gray-100">
                {selectMode && (
                  <th className="px-3 py-3 font-bold w-8">
                    <button onClick={toggleAll} className="text-gray-600 hover:text-gray-900">
                      {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                    </button>
                  </th>
                )}
                <th className="px-4 py-3 font-bold">Karyawan</th>
                <th className="px-4 py-3 font-bold">Template</th>
                <th className="px-4 py-3 font-bold">Diajukan</th>
                <th className="px-4 py-3 font-bold">Atasan Langsung</th>
                <th className="px-4 py-3 font-bold">Dept Head</th>
                <th className="px-4 py-3 font-bold">Dokumen</th>
                <th className="px-4 py-3 font-bold">Status</th>
                <th className="px-4 py-3 font-bold">Aksi</th>
              </tr>
            </thead>
            <tbody className="text-[11px] font-medium text-gray-600">
              {visible.map(r => {
                const emp = empById.get(r.employeeId);
                const isDirect = r.directSupervisorId === user.id;
                const isIndirect = r.indirectSupervisorId === user.id;
                const checked = selected.has(r.id);
                return (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-blue-50/30">
                    {selectMode && (
                      <td className="px-3 py-3">
                        <button onClick={() => toggleOne(r.id)} className="text-gray-600 hover:text-red-600">
                          {checked ? <CheckSquare size={14} className="text-red-600" /> : <Square size={14} />}
                        </button>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <p className="text-sm font-bold text-gray-900">{emp?.name || '—'}</p>
                      <p className="text-[10px] text-gray-400">{emp?.nik} • {emp?.department}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-bold text-gray-900">{r.templateName}</p>
                    </td>
                    <td className="px-4 py-3"><p className="text-gray-900">{fmtSubmitted(r.submittedAt)}</p></td>
                    <td className="px-4 py-3">
                      <p className="text-gray-900">{r.directSupervisorName || '—'}</p>
                      {r.directApprovedAt ? (
                        <p className="text-[10px] font-bold text-green-600">✓ Disetujui</p>
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
                      <div className="flex flex-col gap-1">
                        {r.docxUrl ? (
                          <div className="flex items-center gap-2">
                            <button onClick={() => setPreview({ open: true, url: r.docxUrl, title: `${r.templateName} — ${emp?.name || ''}` })}
                              className="text-indigo-600 hover:underline inline-flex items-center gap-1 text-[10px] font-bold">
                              <Eye size={11} /> Preview
                            </button>
                            <a href={r.docxUrl} download
                              className="text-blue-600 hover:underline inline-flex items-center gap-1 text-[10px] font-bold">
                              <Download size={11} /> DOCX
                            </a>
                          </div>
                        ) : null}
                        {r.pdfUrl ? (
                          <a href={r.pdfUrl} target="_blank" rel="noopener noreferrer"
                            className="text-red-600 hover:underline inline-flex items-center gap-1 text-[10px] font-bold">
                            <Download size={11} /> PDF
                          </a>
                        ) : null}
                        {!r.docxUrl && !r.pdfUrl && <span className="text-gray-300 text-[10px]">—</span>}
                      </div>
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
                            <button onClick={() => approveDocumentAsDirect(r.id, user.id)}
                              className="text-[10px] font-bold bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700">
                              Setujui (Atasan Langsung)
                            </button>
                            <button onClick={() => handleReject(r.id)}
                              className="text-[10px] font-bold bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">Tolak</button>
                          </>
                        )}
                        {isIndirect && !r.indirectApprovedAt && r.status === 'PENDING' && (
                          <>
                            {!r.directApprovedAt && (
                              <span className="text-[9px] text-amber-600 font-bold">Menunggu atasan langsung dulu</span>
                            )}
                            <button onClick={() => approveDocumentAsIndirect(r.id, user.id)}
                              disabled={!r.directApprovedAt}
                              className="text-[10px] font-bold bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
                              Setujui (Dept Head)
                            </button>
                            <button onClick={() => handleReject(r.id)}
                              className="text-[10px] font-bold bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">Tolak</button>
                          </>
                        )}
                        {r.status === 'REJECTED' && (isDirect || isIndirect || user.role === 'APPROVAL_HR') && (
                          <span className="text-[9px] text-red-600 font-bold italic">Ditolak{r.rejectionReason ? `: ${r.rejectionReason}` : ''}</span>
                        )}
                        {user.role === 'APPROVAL_HR' && r.status === 'PENDING' && (
                          stageDone(r) ? (
                            <>
                              <button onClick={() => hrApproveDocument(r.id, user.id)}
                                className="text-[10px] font-bold bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700">HR Approve</button>
                              <button onClick={() => handleReject(r.id)}
                                className="text-[10px] font-bold bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">Tolak</button>
                            </>
                          ) : (
                            <>
                              <span className="text-[9px] text-amber-600 font-bold">Menunggu approval atasan</span>
                              <button onClick={() => handleReject(r.id)}
                                className="text-[10px] font-bold bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">Tolak</button>
                            </>
                          )
                        )}
                        {user.role === 'SUPERUSER' && r.status !== 'APPROVED' && (
                          <>
                            <button onClick={() => approveDocument(r.id, user.id)}
                              className="text-[10px] font-bold bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700">
                              {r.status === 'REJECTED' ? 'Superuser Override Approve' : 'Superuser Approve'}
                            </button>
                            {r.status === 'PENDING' && (
                              <button onClick={() => handleReject(r.id)}
                                className="text-[10px] font-bold bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">Tolak</button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={selectMode ? 9 : 8} className="p-16 text-center text-gray-400 italic text-sm">Belum ada pengajuan dokumen.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <SuperuserPasswordModal
        open={pwModal.open}
        title="Hapus Pengajuan Dokumen"
        description={`Anda akan menghapus ${pwModal.ids.length} pengajuan dokumen secara permanen. Masukkan password Superuser untuk melanjutkan.`}
        confirmLabel="Hapus Permanen"
        verify={verifySuperuserPassword}
        onConfirm={() => {
          deleteDocumentRequests(pwModal.ids);
          exitSelect();
        }}
        onClose={() => setPwModal({ open: false, ids: [] })}
      />

      <DocxPreviewModal
        open={preview.open}
        url={preview.url}
        title={preview.title}
        onClose={() => setPreview({ open: false })}
      />
    </div>
  );
}