import React, { useMemo, useState } from 'react';
import { useApp } from '../AppContext';
import { uploadSignaturePng } from '../lib/serverStore';
import { Upload, Trash2, PenTool, X } from 'lucide-react';
import type { Signature, Employee } from '../types';

/**
 * Menu "Tanda Tangan Saya".
 *
 * Visibility per role:
 *  - REGULAR / APPROVAL: hanya bisa lihat & kelola TTD miliknya sendiri (ownerId = user.id).
 *  - ADMIN: bisa kelola TTD untuk semua karyawan di departemennya (termasuk dirinya).
 *  - APPROVAL_HR / SUPERUSER: bisa kelola semua TTD karyawan.
 *
 * TTD di-upload sebagai PNG (max 2MB). Saat dokumen disetujui oleh user
 * tersebut, sistem otomatis menyisipkan PNG ini ke placeholder
 * {%ttd_atasan} / {%ttd_dept_head} / {%ttd_hr} di .docx hasil render.
 */
export default function MySignatures() {
  const {
    user, employees, signatures, addSignature, deleteSignature,
  } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ownerId, setOwnerId] = useState<string>('');
  const [name, setName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Signature | null>(null);

  if (!user) return null;

  const isHr = user.role === 'APPROVAL_HR' || user.role === 'SUPERUSER';
  const isAdmin = user.role === 'ADMIN';
  const isSelfOnly = !isHr && !isAdmin;

  // Daftar karyawan yang bisa dipilih sebagai pemilik TTD.
  const ownerOptions = useMemo<Employee[]>(() => {
    if (isSelfOnly) return [];
    let pool = employees;
    if (isAdmin) pool = pool.filter(e => e.department === user.department);
    return [...pool].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [employees, isSelfOnly, isAdmin, user.department]);

  // Sinkronisasi: kalau self-only, pemilik = diri sendiri.
  React.useEffect(() => {
    if (isSelfOnly) setOwnerId(user.id);
  }, [isSelfOnly, user.id]);

  // Daftar TTD yang boleh dilihat user ini.
  const visible = useMemo(() => {
    return signatures.filter(s => {
      if (!s.ownerId) {
        // TTD lama tanpa owner (global, dipakai untuk Bulk SKC). Hanya HR/SU.
        return isHr;
      }
      if (isHr) return true;
      if (isAdmin) {
        const emp = employees.find(e => e.id === s.ownerId);
        return emp?.department === user.department;
      }
      return s.ownerId === user.id;
    }).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [signatures, employees, isHr, isAdmin, user.id, user.department]);

  const ownerEmployee = ownerOptions.find(e => e.id === ownerId)
    || (isSelfOnly ? (user as Employee) : null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const targetId = isSelfOnly ? user.id : ownerId;
    if (!targetId) { setErr('Pilih pemilik TTD dulu.'); return; }
    setErr(''); setBusy(true);
    try {
      const url = await uploadSignaturePng(f);
      if (!url) throw new Error('Upload gagal. Pastikan file PNG (maks 2MB) dan server hidup.');
      const targetEmp = employees.find(e2 => e2.id === targetId);
      const labelName = name.trim()
        || `TTD ${targetEmp?.name || (targetId === user.id ? user.name : targetId)}`;
      addSignature({
        id: `sig-${Date.now()}`,
        name: labelName,
        url,
        ownerId: targetId,
        uploadedBy: user.id,
        uploadedByName: user.name,
        createdAt: new Date().toISOString(),
      });
      setName('');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Tanda Tangan Saya</h2>
        <p className="text-xs text-gray-500 font-medium uppercase tracking-widest mt-1">
          {isSelfOnly ? 'TTD pribadi — dipakai saat Anda menyetujui dokumen.' :
            isAdmin ? `Kelola TTD karyawan di departemen ${user.department}.` :
            'Kelola TTD seluruh karyawan.'}
        </p>
      </header>

      <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          {!isSelfOnly && (
            <div>
              <label className="block text-[10px] uppercase font-black text-gray-400 mb-1 tracking-widest">Pemilik TTD</label>
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs font-bold">
                <option value="">— Pilih Karyawan —</option>
                {ownerOptions.map(e => (
                  <option key={e.id} value={e.id}>{e.name} • {e.nik}{e.department ? ` • ${e.department}` : ''}</option>
                ))}
              </select>
            </div>
          )}
          <div className={isSelfOnly ? 'md:col-span-2' : ''}>
            <label className="block text-[10px] uppercase font-black text-gray-400 mb-1 tracking-widest">Label (opsional)</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder={ownerEmployee ? `TTD ${ownerEmployee.name}` : 'TTD …'}
              className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs font-bold" />
          </div>
          <div>
            <label className={`cursor-pointer inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold w-full justify-center ${busy ? 'bg-gray-300 text-gray-500' : 'bg-[var(--sidebar)] text-white hover:opacity-90'}`}>
              <Upload size={13} /> {busy ? 'Mengunggah…' : 'Upload PNG'}
              <input type="file" accept="image/png" className="hidden" onChange={handleUpload}
                disabled={busy || (!isSelfOnly && !ownerId)} />
            </label>
          </div>
        </div>
        {err && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg px-4 py-3">{err}</div>
        )}
        <p className="text-[10px] text-gray-500 leading-relaxed">
          PNG dengan latar transparan akan terlihat paling rapi. Saat Anda menyetujui pengajuan dokumen,
          TTD ini otomatis disisipkan ke placeholder <code className="bg-gray-100 px-1 rounded">{'{%ttd_atasan}'}</code>,
          <code className="bg-gray-100 px-1 rounded ml-1">{'{%ttd_dept_head}'}</code>, atau
          <code className="bg-gray-100 px-1 rounded ml-1">{'{%ttd_hr}'}</code> sesuai peran Anda di pengajuan tersebut.
          Pengaju memakai placeholder <code className="bg-gray-100 px-1 rounded">{'{%ttd_sendiri}'}</code>.
        </p>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-100">
        <header className="px-5 py-3 bg-gray-50/60 flex items-center justify-between">
          <h3 className="text-[11px] font-black uppercase tracking-widest text-gray-700 inline-flex items-center gap-2">
            <PenTool size={12} /> Daftar TTD
          </h3>
          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{visible.length} TTD</span>
        </header>
        {visible.length === 0 ? (
          <div className="p-10 text-center text-gray-400 italic text-sm">Belum ada TTD.</div>
        ) : visible.map(sig => {
          const owner = employees.find(e => e.id === sig.ownerId);
          const canDelete = isHr || (isAdmin && owner?.department === user.department) || sig.ownerId === user.id;
          return (
            <div key={sig.id} className="p-4 flex items-center gap-4 hover:bg-gray-50/50 flex-wrap">
              <div className="w-28 h-14 bg-white border border-gray-200 rounded flex items-center justify-center overflow-hidden shrink-0">
                <img src={sig.url} alt={sig.name} className="max-w-full max-h-full object-contain" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-gray-900 truncate">{sig.name}</p>
                <p className="text-[10px] text-gray-500">
                  Pemilik: <b>{owner?.name || (sig.ownerId === user.id ? user.name : (sig.ownerId || '— TTD lama (global) —'))}</b>
                  {owner?.department ? ` • ${owner.department}` : ''}
                </p>
                <p className="text-[10px] text-gray-400">
                  {sig.uploadedByName ? `Diupload oleh ${sig.uploadedByName} • ` : ''}{sig.createdAt?.slice(0, 10)}
                </p>
              </div>
              {canDelete && (
                <button onClick={() => setDeleteTarget(sig)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-red-100 text-red-700 hover:bg-red-200">
                  <Trash2 size={12} /> Hapus
                </button>
              )}
            </div>
          );
        })}
      </section>

      {deleteTarget && (
        <div className="fixed inset-0 z-[2100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">Hapus Tanda Tangan</h3>
              <button onClick={() => setDeleteTarget(null)} className="text-gray-400 hover:text-gray-900"><X size={18} /></button>
            </div>
            <div className="p-5 text-sm text-gray-700">Hapus TTD "{deleteTarget.name}"? File PNG di server tetap, hanya entry-nya yang dihapus.</div>
            <div className="p-4 border-t border-gray-100 flex justify-end gap-2 bg-gray-50">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900">Batal</button>
              <button onClick={() => { deleteSignature(deleteTarget.id); setDeleteTarget(null); }}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-red-600 text-white hover:bg-red-700">Hapus</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
