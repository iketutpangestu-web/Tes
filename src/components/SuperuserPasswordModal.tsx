import React, { useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';

interface Props {
  open: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  verify: (password: string) => boolean | Promise<boolean>;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export default function SuperuserPasswordModal({ open, title, description, confirmLabel, verify, onConfirm, onClose }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    let ok = false;
    try {
      ok = await Promise.resolve(verify(password));
    } catch {
      ok = false;
    }
    if (!ok) {
      setBusy(false);
      setError('Password Superuser salah.');
      return;
    }
    try {
      await onConfirm();
      setPassword('');
      setError('');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <form onSubmit={submit}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-red-50">
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} className="text-red-600" />
            <h4 className="text-sm font-black uppercase tracking-wider text-red-700">{title || 'Konfirmasi Superuser'}</h4>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-red-100 text-gray-500">
            <X size={14} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {description && <p className="text-xs text-gray-600">{description}</p>}
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
            placeholder="Password Superuser"
            maxLength={200}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30"
          />
          {error && <p className="text-[11px] text-red-600 font-bold">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 bg-gray-100 text-gray-700 text-xs font-bold py-2 rounded-lg hover:bg-gray-200">
              Batal
            </button>
            <button type="submit" disabled={busy || !password}
              className="flex-1 bg-red-600 text-white text-xs font-bold py-2 rounded-lg hover:bg-red-700 disabled:opacity-50">
              {busy ? 'Memproses...' : (confirmLabel || 'Konfirmasi')}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}