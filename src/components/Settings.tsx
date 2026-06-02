import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { Trash2, Palette, Plus, Check, X } from 'lucide-react';
import { LEAVE_FUNCTIONS } from '../types';
import SkcBulkGenerator from './SkcBulkGenerator';

export default function Settings() {
  const {
    leaveTypes, setLeaveTypes, leavePreviewDays, setLeavePreviewDays,
    customSymbols, updateSymbols,
    exportMonthsBack, setExportMonthsBack,
    exportMonthsAhead, setExportMonthsAhead,
    payrollAnchorLokal, setPayrollAnchorLokal,
    payrollAnchorNonLokal, setPayrollAnchorNonLokal,
  } = useApp();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  // ---- Custom Symbol manager ----
  const [csForm, setCsForm] = useState<{ id?: string; code: string; label: string; color: string; textColor: string; rules: 'Replace' | 'Substitute'; description: string; function: string }>({
    code: '', label: '', color: '#3b82f6', textColor: '#ffffff', rules: 'Replace', description: '', function: '',
  });
  const [csEditing, setCsEditing] = useState<string | null>(null);
  const resetCsForm = () => { setCsForm({ code: '', label: '', color: '#3b82f6', textColor: '#ffffff', rules: 'Replace', description: '', function: '' }); setCsEditing(null); };
  const saveCustomSymbol = () => {
    const code = csForm.code.trim();
    const label = csForm.label.trim();
    if (!code || !label) { alert('Code dan Label wajib diisi.'); return; }
    if (csEditing) {
      updateSymbols(customSymbols.map(s => {
        if (s.id !== csEditing) return s;
        // Built-in: code dipertahankan (tidak boleh diubah).
        return { ...s, code: s.builtin ? s.code : code, label, color: csForm.color, textColor: csForm.textColor, rules: csForm.rules, description: csForm.description, function: csForm.function };
      }));
    } else {
      if (customSymbols.some(s => s.code.toUpperCase() === code.toUpperCase())) {
        alert(`Simbol "${code}" sudah ada.`); return;
      }
      updateSymbols([...customSymbols, { id: `cs-${Date.now()}`, code, label, color: csForm.color, textColor: csForm.textColor, rules: csForm.rules, description: csForm.description, function: csForm.function }]);
    }
    resetCsForm();
  };
  const editCustomSymbol = (id: string) => {
    const s = customSymbols.find(x => x.id === id); if (!s) return;
    setCsForm({ id: s.id, code: s.code, label: s.label, color: s.color, textColor: s.textColor || '#ffffff', rules: (s.rules === 'Substitute' ? 'Substitute' : 'Replace'), description: s.description || '', function: s.function || '' });
    setCsEditing(id);
  };
  const deleteCustomSymbol = (id: string) => {
    const s = customSymbols.find(x => x.id === id);
    if (s?.builtin) { alert('Simbol bawaan tidak dapat dihapus.'); return; }
    if (!confirm('Hapus simbol ini?')) return;
    updateSymbols(customSymbols.filter(s => s.id !== id));
    if (csEditing === id) resetCsForm();
  };

  const builtinList = customSymbols.filter(s => s.builtin);
  const customList = customSymbols.filter(s => !s.builtin);
  const editingItem = csEditing ? customSymbols.find(s => s.id === csEditing) : null;
  const editingBuiltin = !!editingItem?.builtin;

  const addCategory = () => {
    const name = newName.trim();
    if (!name) return;
    setLeaveTypes(prev => [...prev, { id: Date.now().toString(), name, description: newDesc.trim() }]);
    setNewName(''); setNewDesc(''); setAdding(false);
  };

  const removeCategory = (id: string) => {
    setLeaveTypes(prev => prev.filter(t => t.id !== id));
  };

  return (
    <div className="space-y-12 pb-24">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-5xl font-serif italic mb-2 tracking-tight">Configuration</h2>
          <p className="text-xs uppercase tracking-widest opacity-50">System-wide rules and data categories</p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        <SkcBulkGenerator />

        <section className="space-y-8 lg:col-span-2">
          <div className="flex justify-between items-center border-b-2 border-[var(--ink)] pb-4">
            <h3 className="text-xl font-serif italic">Custom Symbol</h3>
          </div>
          <div className="bg-white border border-[var(--ink)]/10 p-6 space-y-6">
            <p className="text-[10px] opacity-50 leading-relaxed">
              Simbol kustom otomatis ditambahkan ke <span className="font-bold">Legend</span> pada export PDF & Excel.
              Pilih rule: <span className="font-bold">Replace</span> (boleh menimpa simbol existing) atau
              <span className="font-bold"> Substitute</span> (menggeser simbol existing satu hari ke kanan, tidak menimpa).
            </p>

            {/* List */}
            {/* Built-in */}
            <div>
              <p className="text-[10px] uppercase tracking-widest opacity-50 font-bold mb-2">Built-in Symbols</p>
              <div className="border border-[var(--ink)]/10 rounded">
                {builtinList.map(s => (
                  <div key={s.id} className="flex items-center gap-3 p-3 border-b border-[var(--ink)]/5 last:border-b-0">
                    <div className="w-12 h-8 rounded flex items-center justify-center text-[10px] font-black border" style={{ backgroundColor: s.color, color: s.textColor || '#fff' }}>
                      {s.code}
                    </div>
                    <div className="flex-1">
                      <p className="text-xs font-bold flex items-center gap-2">
                        {s.label}
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-gray-200 text-gray-700">Built-in</span>
                        {s.function && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-800">fn: {s.function}</span>}
                      </p>
                      <p className="text-[10px] opacity-50">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase mr-2 ${s.rules === 'Substitute' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                          {s.rules || 'Replace'}
                        </span>
                        {s.description}
                      </p>
                    </div>
                    <button onClick={() => editCustomSymbol(s.id)} className="text-[10px] uppercase font-bold px-2 py-1 hover:bg-gray-100 rounded">Edit</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Custom */}
            <div>
              <p className="text-[10px] uppercase tracking-widest opacity-50 font-bold mb-2">Custom Symbols</p>
              <div className="border border-[var(--ink)]/10 rounded">
                {customList.length === 0 ? (
                  <div className="p-6 text-center text-[10px] uppercase opacity-50">Belum ada custom symbol.</div>
                ) : customList.map(s => (
                  <div key={s.id} className="flex items-center gap-3 p-3 border-b border-[var(--ink)]/5 last:border-b-0">
                    <div className="w-12 h-8 rounded flex items-center justify-center text-[10px] font-black border" style={{ backgroundColor: s.color, color: s.textColor || '#fff' }}>
                      {s.code}
                    </div>
                    <div className="flex-1">
                      <p className="text-xs font-bold flex items-center gap-2">
                        {s.label}
                        {s.function && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-800">fn: {s.function}</span>}
                      </p>
                      <p className="text-[10px] opacity-50">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase mr-2 ${s.rules === 'Substitute' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                          {s.rules || 'Replace'}
                        </span>
                        {s.description}
                      </p>
                    </div>
                    <button onClick={() => editCustomSymbol(s.id)} className="text-[10px] uppercase font-bold px-2 py-1 hover:bg-gray-100 rounded">Edit</button>
                    <button onClick={() => deleteCustomSymbol(s.id)} className="p-2 text-red-500 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </div>

            {/* Form */}
            <div className="border-t border-[var(--ink)]/10 pt-4 space-y-3">
              <p className="text-[10px] uppercase tracking-widest opacity-50 font-bold">
                {csEditing ? (editingBuiltin ? 'Edit Simbol Built-in (code tidak dapat diubah)' : 'Edit Simbol') : 'Tambah Simbol Baru'}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div>
                  <label className="block text-[9px] uppercase opacity-50 mb-1">Code</label>
                  <input value={csForm.code} onChange={e => setCsForm({ ...csForm, code: e.target.value })} placeholder="e.g. Sp" disabled={editingBuiltin} className="w-full border border-[var(--ink)]/20 rounded px-2 py-2 text-sm font-bold disabled:bg-gray-100 disabled:opacity-60" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[9px] uppercase opacity-50 mb-1">Label</label>
                  <input value={csForm.label} onChange={e => setCsForm({ ...csForm, label: e.target.value })} placeholder="e.g. Special Permit" className="w-full border border-[var(--ink)]/20 rounded px-2 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-[9px] uppercase opacity-50 mb-1">Background</label>
                  <input type="color" value={csForm.color} onChange={e => setCsForm({ ...csForm, color: e.target.value })} className="w-full h-10 border border-[var(--ink)]/20 rounded" />
                </div>
                <div>
                  <label className="block text-[9px] uppercase opacity-50 mb-1">Font Color</label>
                  <input type="color" value={csForm.textColor} onChange={e => setCsForm({ ...csForm, textColor: e.target.value })} className="w-full h-10 border border-[var(--ink)]/20 rounded" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] uppercase opacity-50 mb-1">Rule</label>
                  <div className="flex gap-2">
                    {(['Replace','Substitute'] as const).map(r => (
                      <button key={r} type="button" onClick={() => setCsForm({ ...csForm, rules: r })}
                        className={`flex-1 px-3 py-2 text-[10px] uppercase font-black rounded border-2 ${csForm.rules === r ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]' : 'border-[var(--ink)]/20 hover:bg-gray-50'}`}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[9px] uppercase opacity-50 mb-1">Description (opsional)</label>
                  <input value={csForm.description} onChange={e => setCsForm({ ...csForm, description: e.target.value })} className="w-full border border-[var(--ink)]/20 rounded px-2 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-[9px] uppercase opacity-50 mb-1">Function (mapping ke jenis Leave Request)</label>
                <select
                  value={csForm.function}
                  onChange={e => setCsForm({ ...csForm, function: e.target.value })}
                  className="w-full border border-[var(--ink)]/20 rounded px-2 py-2 text-sm font-bold"
                >
                  <option value="">— Tidak ada (pakai code) —</option>
                  {LEAVE_FUNCTIONS.map(fn => <option key={fn} value={fn}>{fn}</option>)}
                </select>
                <p className="text-[9px] opacity-50 mt-1 italic">
                  Saat Leave Request disetujui dengan fungsi yang sama, simbol & warna ini yang dipakai di Timesheet.
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                {csEditing && (
                  <button onClick={resetCsForm} className="px-3 py-2 text-[10px] uppercase font-bold text-gray-500 hover:text-gray-900">Batal</button>
                )}
                <button onClick={saveCustomSymbol} className="px-4 py-2 text-[10px] uppercase font-bold bg-[var(--ink)] text-[var(--bg)] flex items-center gap-1">
                  {csEditing ? <Check size={12} /> : <Plus size={12} />} {csEditing ? 'Update' : 'Tambah'}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-8">
          <div className="flex justify-between items-center border-b-2 border-[var(--ink)] pb-4">
            <h3 className="text-xl font-serif italic">Leave Categories</h3>
          </div>
          <div className="bg-white border border-[var(--ink)]/10">
            {leaveTypes.map((type) => (
              <div key={type.id} className="p-6 border-b border-[var(--ink)]/5 flex justify-between items-center group">
                <div>
                  <p className="text-sm font-bold">{type.name}</p>
                  <p className="text-[10px] opacity-40 font-mono italic">{type.description}</p>
                </div>
                <button
                  onClick={() => removeCategory(type.id)}
                  className="opacity-0 group-hover:opacity-100 p-2 text-red-500 hover:bg-red-50 rounded">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {adding ? (
              <div className="p-4 border-t border-[var(--ink)]/10 bg-gray-50/50 space-y-3">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nama kategori (mis. Cuti Khusus)"
                  className="w-full border-b border-[var(--ink)]/30 bg-transparent py-2 text-sm font-bold focus:outline-none"
                />
                <input
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Deskripsi (opsional)"
                  className="w-full border-b border-[var(--ink)]/20 bg-transparent py-2 text-xs italic focus:outline-none"
                />
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => { setAdding(false); setNewName(''); setNewDesc(''); }}
                    className="px-3 py-1.5 text-[10px] uppercase font-bold text-gray-500 hover:text-gray-900 flex items-center gap-1">
                    <X size={12} /> Batal
                  </button>
                  <button onClick={addCategory}
                    className="px-3 py-1.5 text-[10px] uppercase font-bold bg-[var(--ink)] text-[var(--bg)] flex items-center gap-1">
                    <Check size={12} /> Simpan
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="w-full p-4 text-[10px] uppercase font-bold opacity-50 hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                <Plus size={12} /> Add Category
              </button>
            )}
          </div>
        </section>

        <section className="space-y-8">
          <div className="flex justify-between items-center border-b-2 border-[var(--ink)] pb-4">
            <h3 className="text-xl font-serif italic">Dashboard Preview</h3>
          </div>
          <div className="bg-white border border-[var(--ink)]/10 p-6 space-y-4">
            <div>
              <p className="text-sm font-bold mb-1">Preview Cuti Mendatang</p>
              <p className="text-[10px] opacity-50 leading-relaxed">
                Saat kartu <span className="font-bold">On-Site Personnel</span> di Dashboard ditekan,
                tampilkan karyawan yang akan cuti dalam <span className="font-bold">N hari ke depan</span>
                (H-N hingga H-1 sebelum tanggal cuti).
              </p>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={60}
                value={leavePreviewDays}
                onChange={(e) => setLeavePreviewDays(Number(e.target.value))}
                className="w-24 border border-[var(--ink)]/20 rounded px-3 py-2 text-sm font-bold text-center"
              />
              <span className="text-[10px] uppercase tracking-widest opacity-50">hari ke depan</span>
            </div>
            <p className="text-[10px] italic opacity-40">
              Contoh: nilai 3 → tampilkan karyawan dengan cuti dimulai dalam 1–3 hari ke depan.
            </p>
          </div>
        </section>

        <section className="space-y-8">
          <div className="flex justify-between items-center border-b-2 border-[var(--ink)] pb-4">
            <h3 className="text-xl font-serif italic">Export Timesheet Range</h3>
          </div>
          <div className="bg-white border border-[var(--ink)]/10 p-6 space-y-4">
            <div>
              <p className="text-sm font-bold mb-1">Rentang Default Export PDF/XLSX</p>
              <p className="text-[10px] opacity-50 leading-relaxed">
                Berlaku untuk tombol <span className="font-bold">Export PDF</span> &amp; <span className="font-bold">Export XLSX</span> di menu Timesheet,
                serta <span className="font-bold">Bulk Download PDF Timesheet</span>. Tetap dipotong oleh Join Date karyawan.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] uppercase opacity-50 mb-1 font-bold">Bulan ke belakang</label>
                <input
                  type="number"
                  min={0}
                  max={36}
                  value={exportMonthsBack}
                  onChange={(e) => setExportMonthsBack(Number(e.target.value))}
                  className="w-full border border-[var(--ink)]/20 rounded px-3 py-2 text-sm font-bold text-center"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase opacity-50 mb-1 font-bold">Bulan ke depan</label>
                <input
                  type="number"
                  min={0}
                  max={12}
                  value={exportMonthsAhead}
                  onChange={(e) => setExportMonthsAhead(Number(e.target.value))}
                  className="w-full border border-[var(--ink)]/20 rounded px-3 py-2 text-sm font-bold text-center"
                />
              </div>
            </div>
            <p className="text-[10px] italic opacity-40">
              Default: 11 bulan ke belakang + 1 bulan ke depan dari hari ini.
            </p>
          </div>
        </section>

        <section className="space-y-8">
          <div className="flex justify-between items-center border-b-2 border-[var(--ink)] pb-4">
            <h3 className="text-xl font-serif italic">Anchor Penggajian (SKC Site)</h3>
          </div>
          <div className="bg-white border border-[var(--ink)]/10 p-6 space-y-4">
            <p className="text-[10px] opacity-50 leading-relaxed">
              Tanggal cut-off penggajian (1–31). Jika tanggal Cuti Site karyawan <span className="font-bold">lebih dari</span> anchor,
              maka <code>{'{{anchor_bln}}'}</code> pada SKC Site = bulan berikutnya. Anchor dipakai berdasarkan kolom <span className="font-bold">Lokasi Penggajian</span> karyawan.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] uppercase opacity-50 mb-1 font-bold">Lokal</label>
                <input type="number" min={1} max={31} value={payrollAnchorLokal}
                  onChange={(e) => setPayrollAnchorLokal(Number(e.target.value))}
                  className="w-full border border-[var(--ink)]/20 rounded px-3 py-2 text-sm font-bold text-center" />
              </div>
              <div>
                <label className="block text-[10px] uppercase opacity-50 mb-1 font-bold">Non Lokal</label>
                <input type="number" min={1} max={31} value={payrollAnchorNonLokal}
                  onChange={(e) => setPayrollAnchorNonLokal(Number(e.target.value))}
                  className="w-full border border-[var(--ink)]/20 rounded px-3 py-2 text-sm font-bold text-center" />
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-8">
          <div className="flex justify-between items-center border-b-2 border-[var(--ink)] pb-4">
            <h3 className="text-xl font-serif italic">Theme</h3>
          </div>
          <div className="bg-[var(--ink)] text-[var(--bg)] p-8">
            <h4 className="text-[10px] uppercase font-bold mb-4 flex items-center gap-2">
              <Palette size={14} />
              Interface Theme
            </h4>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-[10px] opacity-50 uppercase">Grid Line Visibility</span>
                <div className="w-8 h-4 bg-white/20 rounded-full relative">
                  <div className="w-3 h-3 bg-[var(--bg)] rounded-full absolute right-0.5 top-0.5"></div>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] opacity-50 uppercase">Developer Console</span>
                <div className="w-8 h-4 bg-white/10 rounded-full relative">
                  <div className="w-3 h-3 bg-[var(--bg)] rounded-full absolute left-0.5 top-0.5 opacity-50"></div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
