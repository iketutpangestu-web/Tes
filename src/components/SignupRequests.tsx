import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { Check, X, Clock, Trash2, CheckSquare, Square } from 'lucide-react';
import { format } from 'date-fns';
import ImageViewer from './ImageViewer';
import SuperuserPasswordModal from './SuperuserPasswordModal';

export default function SignupRequests() {
  const {
    user, signupRequests, approveSignupRequest, rejectSignupRequest,
    verifySuperuserPassword, deleteSignupRequests, deleteAllSignupRequests,
  } = useApp();
  const [previewImg, setPreviewImg] = useState<{ src: string; name: string } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pwdModal, setPwdModal] = useState<null | { mode: 'selected' | 'all' }>(null);
  const sorted = [...signupRequests].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const isSuper = user?.role === 'SUPERUSER';

  const toggleId = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };

  return (
    <div className="space-y-6">
      <header className="flex justify-between items-end gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Sign Up Requests</h2>
          <p className="text-xs text-gray-500 uppercase tracking-widest mt-1">Approve or reject new account requests</p>
        </div>
        {isSuper && (
          <div className="flex gap-2">
            {!selectMode ? (
              <>
                <button
                  onClick={() => setSelectMode(true)}
                  className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-lg flex items-center gap-2 text-xs font-bold hover:bg-gray-50 shadow-sm"
                >
                  <CheckSquare size={14} /> Select to Delete
                </button>
                <button
                  onClick={() => setPwdModal({ mode: 'all' })}
                  disabled={signupRequests.length === 0}
                  className="bg-red-600 text-white px-4 py-2.5 rounded-lg flex items-center gap-2 text-xs font-bold hover:bg-red-700 shadow-sm disabled:opacity-50"
                >
                  <Trash2 size={14} /> Delete All Request
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setPwdModal({ mode: 'selected' })}
                  disabled={selectedIds.size === 0}
                  className="bg-red-600 text-white px-4 py-2.5 rounded-lg flex items-center gap-2 text-xs font-bold hover:bg-red-700 shadow-sm disabled:opacity-50"
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
          </div>
        )}
      </header>

      {sorted.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-400 text-sm italic">
          Tidak ada permintaan pendaftaran.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sorted.map(req => (
            <div key={req.id} className={`relative bg-white border rounded-2xl overflow-hidden shadow-sm ${
              selectMode && selectedIds.has(req.id) ? 'border-red-500 ring-2 ring-red-200' : 'border-gray-200'
            }`}>
              {selectMode && (
                <button
                  onClick={() => toggleId(req.id)}
                  className="absolute top-2 left-2 z-10 bg-white/95 backdrop-blur p-1.5 rounded-md shadow border border-gray-200 hover:bg-red-50"
                  title="Pilih untuk dihapus"
                >
                  {selectedIds.has(req.id)
                    ? <CheckSquare size={16} className="text-red-600" />
                    : <Square size={16} className="text-gray-500" />}
                </button>
              )}
              {req.photo ? (
                <button type="button" onClick={() => setPreviewImg({ src: req.photo!, name: req.name })} className="block w-full">
                  <img src={req.photo} alt={req.name} className="w-full h-44 object-cover cursor-zoom-in hover:opacity-90" />
                </button>
              ) : (
                <div className="w-full h-44 bg-gray-100 flex items-center justify-center text-gray-400 text-xs">No photo</div>
              )}
              <div className="p-4 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-black text-gray-900 text-sm">{req.name}</p>
                    <p className="text-[10px] font-mono text-gray-500">NIK {req.nik}</p>
                    <p className="text-[10px] font-mono text-blue-700 mt-0.5">{req.nik}@gts.com</p>
                  </div>
                  <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                    req.status === 'PENDING' ? 'bg-amber-100 text-amber-700'
                    : req.status === 'APPROVED' ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700'
                  }`}>{req.status}</span>
                </div>
                <p className="text-[10px] text-gray-400 flex items-center gap-1">
                  <Clock size={10} /> {format(new Date(req.submittedAt), 'dd MMM yyyy HH:mm')}
                </p>
                {req.status === 'PENDING' && (
                  <div className="flex gap-2 pt-2">
                    <button onClick={() => approveSignupRequest(req.id)}
                      className="flex-1 bg-green-600 text-white text-xs font-bold py-2 rounded-lg hover:bg-green-700 flex items-center justify-center gap-1">
                      <Check size={14} /> Approve
                    </button>
                    <button onClick={() => rejectSignupRequest(req.id)}
                      className="flex-1 bg-red-600 text-white text-xs font-bold py-2 rounded-lg hover:bg-red-700 flex items-center justify-center gap-1">
                      <X size={14} /> Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {previewImg && (
        <ImageViewer src={previewImg.src} alt={previewImg.name} filename={`signup-${previewImg.name}.jpg`} onClose={() => setPreviewImg(null)} />
      )}

      <SuperuserPasswordModal
        open={!!pwdModal}
        title={pwdModal?.mode === 'all' ? 'Hapus SEMUA Sign Up Request' : 'Hapus Sign Up Request Terpilih'}
        description={
          pwdModal?.mode === 'all'
            ? `Aksi ini akan menghapus seluruh ${signupRequests.length} permintaan sign up dan tidak bisa dibatalkan.`
            : `Aksi ini akan menghapus ${selectedIds.size} permintaan sign up terpilih dan tidak bisa dibatalkan.`
        }
        verify={verifySuperuserPassword}
        onConfirm={() => {
          if (pwdModal?.mode === 'all') {
            deleteAllSignupRequests();
          } else {
            deleteSignupRequests(Array.from(selectedIds));
          }
          exitSelectMode();
        }}
        onClose={() => setPwdModal(null)}
      />
    </div>
  );
}
