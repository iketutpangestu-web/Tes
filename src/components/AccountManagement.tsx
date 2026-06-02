import React, { useMemo, useState } from 'react';
import { useApp } from '../AppContext';
import { Search, KeyRound, Trash2, X, Save, ShieldCheck } from 'lucide-react';
import { UserRole } from '../types';

const SEED_IDS = new Set(['acc-super', 'acc-admin', 'acc-user']);

export default function AccountManagement({ onClose }: { onClose: () => void }) {
  const { accounts, updateAccountPassword, deleteAccount, setHrApprover, setAccountRole, user } = useApp();
  const canManageHr = user?.role === 'SUPERUSER';
  const canChangeRole = user?.role === 'SUPERUSER';
  const [search, setSearch] = useState('');
  const [resetting, setResetting] = useState<string | null>(null);
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(a =>
      (a.name || '').toLowerCase().includes(q) ||
      (a.nik || '').toLowerCase().includes(q) ||
      (a.email || '').toLowerCase().includes(q)
    );
  }, [accounts, search]);

  const submitReset = (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (pwd.length < 4) { setErr('Password minimal 4 karakter.'); return; }
    if (pwd !== pwd2) { setErr('Konfirmasi password tidak cocok.'); return; }
    if (resetting) {
      updateAccountPassword(resetting, pwd);
      const acc = accounts.find(a => a.id === resetting);
      setOkMsg(`Password ${acc?.email} berhasil diubah.`);
      setResetting(null); setPwd(''); setPwd2('');
      setTimeout(() => setOkMsg(''), 2400);
    }
  };

  const handleDelete = (id: string, email: string) => {
    if (SEED_IDS.has(id)) return;
    if (confirm(`Hapus akun login ${email}? Data karyawan tidak ikut terhapus.`)) {
      deleteAccount(id);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div>
            <h3 className="font-bold text-gray-900 uppercase tracking-widest text-xs flex items-center gap-2">
              <ShieldCheck size={14} /> Account Management
            </h3>
            <p className="text-[10px] text-gray-500 mt-1">Kelola akun login &amp; reset password.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white rounded-full text-gray-400 hover:text-gray-900">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 border-b border-gray-100 bg-white flex justify-between items-center gap-3">
          <div className="relative w-80">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama, NIK, atau email…"
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <span className="text-[10px] uppercase tracking-widest font-black text-gray-400">{filtered.length} akun</span>
        </div>

        {okMsg && (
          <div className="px-6 py-2 bg-green-50 text-green-700 text-xs font-bold border-b border-green-100">{okMsg}</div>
        )}

        <div className="overflow-auto flex-1">
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-widest text-gray-500 sticky top-0">
              <tr>
                <th className="px-6 py-3 font-bold">Nama</th>
                <th className="px-6 py-3 font-bold">NIK</th>
                <th className="px-6 py-3 font-bold">Email (Login)</th>
                <th className="px-6 py-3 font-bold">Role</th>
                <th className="px-6 py-3 font-bold">Department</th>
                <th className="px-6 py-3 font-bold">HR Approver</th>
                <th className="px-6 py-3 font-bold text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="text-[11px] font-medium text-gray-600">
              {filtered.map(a => {
                const isSeed = SEED_IDS.has(a.id);
                return (
                  <tr key={a.id} className="border-b border-gray-50 last:border-0 hover:bg-blue-50/30">
                    <td className="px-6 py-3">
                      <p className="text-sm font-bold text-gray-900">{a.name}</p>
                      {isSeed && <span className="text-[9px] uppercase tracking-widest text-amber-600 font-black">Dummy account</span>}
                    </td>
                    <td className="px-6 py-3 font-mono text-gray-400">{a.nik}</td>
                    <td className="px-6 py-3 font-mono text-blue-700">{a.email}</td>
                    <td className="px-6 py-3">
                      {canChangeRole ? (
                        <select
                          value={a.role}
                          onChange={(e) => {
                            const next = e.target.value as UserRole;
                            if (next === a.role) return;
                            if (!confirm(`Ubah role ${a.email} dari ${a.role} ke ${next}?`)) return;
                            setAccountRole(a.id, next);
                          }}
                          className="bg-gray-50 border border-gray-200 rounded px-2 py-1 text-[10px] font-black focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        >
                          <option value="REGULAR">REGULAR</option>
                          <option value="APPROVAL">APPROVAL</option>
                          <option value="ADMIN">ADMIN</option>
                          <option value="APPROVAL_HR">APPROVAL_HR</option>
                          <option value="SUPERUSER">SUPERUSER</option>
                        </select>
                      ) : (
                        <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-[10px] font-black">{a.role}</span>
                      )}
                    </td>
                    <td className="px-6 py-3">{a.department || '—'}</td>
                    <td className="px-6 py-3">
                      {a.role === 'SUPERUSER' ? (
                        <span className="text-[10px] text-gray-300">—</span>
                      ) : (
                        <label className={`inline-flex items-center gap-2 ${canManageHr ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                          <input
                            type="checkbox"
                            disabled={!canManageHr}
                            checked={!!a.isHrApprover}
                            onChange={(e) => setHrApprover(a.id, e.target.checked)}
                            className="rounded"
                          />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                            {a.isHrApprover ? 'Aktif' : 'Nonaktif'}
                          </span>
                        </label>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => { setResetting(a.id); setPwd(''); setPwd2(''); setErr(''); }}
                          className="px-3 py-1.5 bg-blue-600 text-white text-[10px] font-bold rounded-lg hover:bg-blue-700 flex items-center gap-1">
                          <KeyRound size={11} /> Reset Password
                        </button>
                        <button onClick={() => handleDelete(a.id, a.email)} disabled={isSeed}
                          className="px-3 py-1.5 bg-red-50 text-red-600 text-[10px] font-bold rounded-lg hover:bg-red-100 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1">
                          <Trash2 size={11} /> Hapus
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="p-12 text-center text-gray-400 italic text-sm">Tidak ada akun.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {resetting && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center p-4 z-10">
            <form onSubmit={submitReset} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
              <h4 className="font-black text-xs uppercase tracking-widest text-gray-900 flex items-center gap-2">
                <KeyRound size={14} /> Reset Password
              </h4>
              <p className="text-[11px] text-gray-500">
                Untuk akun: <span className="font-mono text-blue-700">{accounts.find(a => a.id === resetting)?.email}</span>
              </p>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-gray-500 uppercase">Password baru</label>
                <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-gray-500 uppercase">Konfirmasi password</label>
                <input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              {err && <p className="text-red-600 text-[10px] font-bold">{err}</p>}
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setResetting(null)}
                  className="px-4 py-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest hover:text-gray-900">
                  Batal
                </button>
                <button type="submit"
                  className="bg-blue-600 text-white px-5 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-blue-700 flex items-center gap-1">
                  <Save size={12} /> Simpan
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
