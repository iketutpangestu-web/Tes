import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { uploadDocxTemplate, uploadSignaturePng } from '../lib/serverStore';
import {
  Upload, FileText, Trash2, Plus, Save, X, Edit3, Download, Image as ImageIcon,
} from 'lucide-react';
import type {
  DocumentTemplate, DocumentTemplateField, DocumentFieldType, DocumentAutoSource, Signature,
} from '../types';
import { EMPLOYEE_IMPORT_COLMAP, EMPLOYEE_COLUMN_LABELS } from '../types';
import type { Employee } from '../types';

const FIELD_TYPES: { value: DocumentFieldType; label: string }[] = [
  { value: 'text',     label: 'Text Singkat' },
  { value: 'textarea', label: 'Text Panjang' },
  { value: 'date',     label: 'Tanggal' },
  { value: 'number',   label: 'Angka' },
  { value: 'select',   label: 'Pilihan (Dropdown)' },
  { value: 'auto',     label: 'Auto-Fill dari Profil' },
  { value: 'start_number', label: 'Start Number (auto-increment di Bulk)' },
  { value: 'employee_field', label: 'Dari Employees (pilih header)' },
  { value: 'timesheet_symbol', label: 'Dari Timesheet (pilih simbol → tgl terdekat)' },
  { value: 'jenis_ijin', label: 'Jenis Ijin (Form Izin Berbayar/Tidak)' },
  { value: 'approval_block', label: 'Blok Persetujuan (Nama + TTD Atasan/Dept Head)' },
];

const AUTO_SOURCES: { value: DocumentAutoSource; label: string }[] = [
  { value: 'employee_name',       label: 'Nama Karyawan' },
  { value: 'employee_nik',        label: 'NIK' },
  { value: 'employee_department', label: 'Departemen' },
  { value: 'employee_position',   label: 'Jabatan' },
  { value: 'employee_grade',      label: 'Golongan' },
  { value: 'employee_poh',        label: 'POH' },
  { value: 'employee_email',      label: 'Email' },
  { value: 'employee_phone',      label: 'No HP' },
  { value: 'today_date',          label: 'Tanggal Pengajuan (yyyy-MM-dd)' },
  { value: 'today_long',          label: 'Tanggal Pengajuan (long, mis. 16 Mei 2026)' },
  { value: 'employee_cs_date',    label: 'Tgl Cuti Site (Cs terdekat di Timesheet)' },
  // ---- Form (turunan dari Grading & bulan) ----
  { value: 'form_grade',          label: 'Form: Grade (2 karakter pertama Grading, mis. M2)' },
  { value: 'form_job_grade',      label: 'Form: Job Grade (4 karakter pertama Grading, mis. M2.7)' },
  { value: 'form_employee_level', label: 'Form: Employee Level (angka setelah titik ke-2 pada Grading)' },
  { value: 'form_month_long',     label: 'Form: Bulan (mmmm, mis. Januari, Februari)' },
  { value: 'form_atasan_langsung', label: 'Form: Nama Atasan Langsung (dari dropdown)' },
  { value: 'form_dept_head',       label: 'Form: Nama Dept Head (dari dropdown)' },
  // ---- SKC (khusus template SKC, diisi oleh Bulk Generator) ----
  { value: 'skc_tanggal_meninggalkan_site', label: 'SKC: Tanggal Meninggalkan Site' },
  { value: 'skc_tanggal_berangkat_ternate', label: 'SKC: Tanggal Berangkat dari Ternate' },
  { value: 'skc_tanggal_onsite',            label: 'SKC: Tanggal Onsite (H-1 X1)' },
  { value: 'skc_tanggal_x1',                label: 'SKC: Tanggal X1' },
  { value: 'skc_bulan_romawi',              label: 'SKC: Bulan (Romawi)' },
  { value: 'skc_tahun',                     label: 'SKC: Tahun (yyyy)' },
  { value: 'skc_cuti_summary',              label: 'SKC: Ringkasan Cuti (Tahunan & Extra & Istimewa & Potong Penyesuaian)' },
  { value: 'skc_jumlah_cuti_site',          label: 'SKC Site: Jumlah Cuti Site (Cs x Hari)' },
  { value: 'skc_x1_cuti_site',              label: 'SKC Site: Tanggal X1 setelah Cs' },
  { value: 'skc_cr_minus_cs',               label: 'SKC Site: Dibayarkan (= Jumlah Cs)' },
  { value: 'skc_tanggal_cuti_site',         label: 'SKC: Tanggal Cuti Site (Cs1 di cycle)' },
  { value: 'skc_tanda_tangan',              label: 'SKC: Tanda Tangan (PNG via {%nama_placeholder} atau nama)' },
];

function autoLabel(key: string): string {
  // tanggal_mulai → Tanggal Mulai
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function guessAutoSource(key: string): DocumentAutoSource | undefined {
  const k = key.toLowerCase();
  if (k === 'cr-cs' || k === 'cr_minus_cs' || k === 'crmincs') return 'skc_cr_minus_cs';
  if (/^(dibayarkan)$/.test(k)) return 'skc_cr_minus_cs';
  if (/(tanggal|tgl)[_\s-]*cuti[_\s-]*site|^cs[_\s-]*tanggal$|^tgl[_\s-]*cs$/.test(k)) return 'skc_tanggal_cuti_site';
  if (/^(jumlah[_\s-]*cs|cs[_\s-]*jumlah|jumlah[_\s-]*cuti[_\s-]*site|^cs$)/.test(k)) return 'skc_jumlah_cuti_site';
  if (/^nama|name/.test(k)) return 'employee_name';
  if (/^nik|nip/.test(k)) return 'employee_nik';
  if (/depart|divisi|dept/.test(k)) return 'employee_department';
  if (/jabatan|posisi|position/.test(k)) return 'employee_position';
  if (/golongan|grade/.test(k)) return 'employee_grade';
  if (/poh|lokasi/.test(k)) return 'employee_poh';
  if (/email/.test(k)) return 'employee_email';
  if (/phone|hp|telp/.test(k)) return 'employee_phone';
  if (/tanggal_pengajuan|tanggal_hari_ini|today/.test(k)) return 'today_date';
  return undefined;
}

export default function DocumentTemplates() {
  const {
    user, documentTemplates, addDocumentTemplate, updateDocumentTemplate, deleteDocumentTemplate,
    signatures, addSignature, updateSignature, deleteSignature,
    customSymbols,
  } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<DocumentTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentTemplate | null>(null);
  const [deleteSigTarget, setDeleteSigTarget] = useState<Signature | null>(null);
  const [sigBusy, setSigBusy] = useState(false);
  const [sigErr, setSigErr] = useState('');
  const [sigName, setSigName] = useState('');

  const canManage = user && (user.role === 'ADMIN' || user.role === 'APPROVAL_HR' || user.role === 'SUPERUSER');
  const canManageSkc = user && (user.role === 'APPROVAL_HR' || user.role === 'SUPERUSER');

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !user) return;
    setErr(''); setBusy(true);
    try {
      const up = await uploadDocxTemplate(f);
      if (!up.ok) {
        const raw = up.error || 'unknown';
        let hint = '';
        if (/forbidden/i.test(raw)) hint = ' — Akun Anda tidak punya hak kelola template. Login sebagai ADMIN / APPROVAL_HR / SUPERUSER.';
        else if (/hanya_docx/i.test(raw)) hint = ' — File harus berekstensi .docx (bukan .doc / .pdf).';
        else if (/template_invalid/i.test(raw)) hint = ' — Placeholder di dokumen tidak valid. Pastikan tiap {{nama}} diketik utuh tanpa auto-correct dan jumlah {{ sama dengan }}.';
        else if (/file_kosong/i.test(raw)) hint = ' — Tidak ada file terkirim. Coba pilih ulang.';
        else if (up.status === 401) hint = ' — Session habis. Login ulang.';
        else if (up.status === 413) hint = ' — File terlalu besar (maks 10MB).';
        else if (up.status === 0) hint = ' — Tidak bisa menghubungi server.';
        throw new Error(`Upload gagal (HTTP ${up.status}): ${raw}${hint}`);
      }
      const imagePhRaw = up.imagePlaceholders || [];
      const textPhRaw = (up.textPlaceholders && up.textPlaceholders.length)
        ? up.textPlaceholders
        : up.placeholders.filter(p => !imagePhRaw.includes(p));
      // Deteksi grup approval: {{atasan_langsung}} + {%ttd_atasan} → satu field 'approval_block'.
      const approvalFields: DocumentTemplateField[] = [];
      const hasAtasan = textPhRaw.includes('atasan_langsung') || imagePhRaw.includes('ttd_atasan');
      const hasDept   = textPhRaw.includes('dept_head')       || imagePhRaw.includes('ttd_dept_head');
      if (hasAtasan) approvalFields.push({
        key: 'atasan_langsung', label: 'Blok Atasan Langsung (Nama + TTD)',
        type: 'approval_block', approvalRole: 'atasan_langsung',
      });
      if (hasDept) approvalFields.push({
        key: 'dept_head', label: 'Blok Dept Head (Nama + TTD)',
        type: 'approval_block', approvalRole: 'dept_head',
      });
      const APPROVAL_KEYS = new Set(['atasan_langsung', 'dept_head']);
      const APPROVAL_IMG_KEYS = new Set(['ttd_atasan', 'ttd_dept_head']);
      const textPh = textPhRaw.filter(p => !APPROVAL_KEYS.has(p));
      const imagePh = imagePhRaw.filter(p => !APPROVAL_IMG_KEYS.has(p));
      const fields: DocumentTemplateField[] = [
        ...approvalFields,
        ...textPh.map(p => {
          const auto = guessAutoSource(p);
          return {
            key: p,
            label: autoLabel(p),
            type: auto ? 'auto' as DocumentFieldType : 'text' as DocumentFieldType,
            required: !auto,
            autoSource: auto,
          };
        }),
      ];
      const tpl: DocumentTemplate = {
        id: `tpl-${Date.now()}`,
        name: f.name.replace(/\.docx$/i, ''),
        description: '',
        category: '',
        docxUrl: up.url,
        originalFileName: up.fileName,
        fields,
        imagePlaceholders: imagePh,
        createdBy: user.id,
        createdByName: user.name,
        createdAt: new Date().toISOString(),
        needsApproval: true,
      };
      addDocumentTemplate(tpl);
      setEditing(tpl); // langsung buka editor field
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  const handleUploadSignature = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !user) return;
    if (!sigName.trim()) { setSigErr('Isi nama TTD dulu (mis. "Pak Budi - HRD") sebelum pilih file.'); return; }
    setSigErr(''); setSigBusy(true);
    try {
      const url = await uploadSignaturePng(f);
      if (!url) throw new Error('Upload gagal. Pastikan file PNG, max 2MB, dan Anda login sebagai ADMIN/HR/SUPERUSER.');
      addSignature({
        id: `sig-${Date.now()}`,
        name: sigName.trim(),
        url,
        uploadedBy: user.id,
        uploadedByName: user.name,
        createdAt: new Date().toISOString(),
      });
      setSigName('');
    } catch (e2) {
      setSigErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setSigBusy(false);
    }
  };

  if (!canManage) {
    return (
      <div className="text-center py-20 text-gray-500 text-sm">
        Anda tidak memiliki akses ke menu ini.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Document Templates</h2>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-widest mt-1">
            Upload template .docx — placeholder mustache <code className="bg-gray-100 px-1 rounded">{'{{nama}}'}</code> akan terdeteksi otomatis.
          </p>
        </div>
        <label className={`cursor-pointer inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold shadow-sm transition-all ${busy ? 'bg-gray-300 text-gray-500' : 'bg-[var(--sidebar)] text-white hover:opacity-90'}`}>
          <Upload size={14} />
          {busy ? 'Mengunggah…' : 'Upload Template .docx'}
          <input type="file" accept=".docx" className="hidden" onChange={handleUpload} disabled={busy} />
        </label>
      </header>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg px-4 py-3">{err}</div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-100">
        {documentTemplates.length === 0 ? (
          <div className="p-16 text-center text-gray-400 italic text-sm">
            Belum ada template. Klik <b>Upload Template .docx</b> untuk menambahkan.
          </div>
        ) : documentTemplates.map(tpl => (
          <div key={tpl.id} className="p-5 flex items-start gap-4 hover:bg-gray-50/50">
            <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
              <FileText size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-gray-900">
                {tpl.name}
                {tpl.isSkc && <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-purple-100 text-purple-700">SKC</span>}
              </p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {tpl.fields.length} field
                {tpl.category ? ` • ${tpl.category}` : ''}
                {tpl.description ? ` • ${tpl.description}` : ''}
              </p>
              <p className="text-[10px] text-gray-400 mt-1">
                Placeholder: {tpl.fields.map(f => `{{${f.key}}}`).join(', ') || '—'}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <a href={tpl.docxUrl} download
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">
                <Download size={12} /> .docx
              </a>
              <button onClick={() => setEditing(tpl)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-blue-100 text-blue-700 hover:bg-blue-200">
                <Edit3 size={12} /> Edit
              </button>
              <button
                onClick={() => setDeleteTarget(tpl)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-red-100 text-red-700 hover:bg-red-200">
                <Trash2 size={12} /> Hapus
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <TemplateFieldEditor
          tpl={editing}
          onClose={() => setEditing(null)}
          onSave={(t) => { updateDocumentTemplate(t); setEditing(null); }}
          symbolCodes={Array.from(new Set(customSymbols.map(s => s.code))).sort()}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Hapus Template"
          message={`Hapus template "${deleteTarget.name}"? Aksi ini tidak bisa dibatalkan.`}
          onConfirm={() => { deleteDocumentTemplate(deleteTarget.id); setDeleteTarget(null); }}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {/* ---- TTD PNG (untuk template SKC) ---- */}
      {canManageSkc && (
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm">
          <header className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">Tanda Tangan (PNG)</h3>
              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-0.5">Khusus template SKC — TTD PNG akan disisipkan pada placeholder image.</p>
            </div>
            <div className="flex items-center gap-2">
              <input value={sigName} onChange={(e) => setSigName(e.target.value)} placeholder="Nama TTD (mis. Pak Budi - HRD)"
                className="border border-gray-200 rounded-lg px-3 py-2 text-xs font-bold w-64" />
              <label className={`cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-bold ${sigBusy ? 'bg-gray-300 text-gray-500' : 'bg-[var(--sidebar)] text-white hover:opacity-90'}`}>
                <Upload size={12} /> {sigBusy ? 'Mengunggah…' : 'Upload PNG'}
                <input type="file" accept="image/png" className="hidden" onChange={handleUploadSignature} disabled={sigBusy} />
              </label>
            </div>
          </header>
          {sigErr && (
            <div className="m-4 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg px-4 py-3">{sigErr}</div>
          )}
          <div className="divide-y divide-gray-100">
            {signatures.length === 0 ? (
              <div className="p-10 text-center text-gray-400 italic text-sm">Belum ada TTD. Isi nama lalu klik <b>Upload PNG</b>.</div>
            ) : signatures.map(sig => (
              <div key={sig.id} className="p-4 flex items-center gap-4 hover:bg-gray-50/50 flex-wrap">
                <div className="w-24 h-12 bg-white border border-gray-200 rounded flex items-center justify-center overflow-hidden shrink-0">
                  <img src={sig.url} alt={sig.name} className="max-w-full max-h-full object-contain" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-gray-900 truncate">{sig.name}</p>
                  <p className="text-[10px] text-gray-400">{sig.uploadedByName ? `Oleh ${sig.uploadedByName} • ` : ''}{sig.createdAt?.slice(0, 10)}</p>
                </div>
                <div className="flex flex-col gap-1 text-[10px] font-bold text-gray-600 mr-2">
                  <span className="text-[9px] uppercase tracking-widest text-gray-400">Jadikan Default untuk (Bulk SKC Site):</span>
                  <div className="flex gap-3 flex-wrap">
                    {([
                      { v: 'verif' as const,   l: 'Diverifikasi Oleh' },
                      { v: 'know' as const,    l: 'Diketahui Oleh' },
                      { v: 'approve' as const, l: 'Disetujui Oleh' },
                    ]).map(opt => {
                      const checked = (sig.defaultRoles || []).includes(opt.v);
                      return (
                        <label key={opt.v} className="inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const cur = new Set(sig.defaultRoles || []);
                              if (e.target.checked) {
                                // Hanya satu TTD per role: copot role ini dari TTD lain.
                                for (const s of signatures) {
                                  if (s.id !== sig.id && (s.defaultRoles || []).includes(opt.v)) {
                                    updateSignature({ ...s, defaultRoles: (s.defaultRoles || []).filter(r => r !== opt.v) });
                                  }
                                }
                                cur.add(opt.v);
                              } else {
                                cur.delete(opt.v);
                              }
                              updateSignature({ ...sig, defaultRoles: Array.from(cur) });
                            }}
                          />
                          {opt.l}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <button onClick={() => setDeleteSigTarget(sig)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-red-100 text-red-700 hover:bg-red-200">
                  <Trash2 size={12} /> Hapus
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {deleteSigTarget && (
        <ConfirmModal
          title="Hapus Tanda Tangan"
          message={`Hapus TTD "${deleteSigTarget.name}"? File PNG di server tetap, hanya entry-nya yang dihapus.`}
          onConfirm={() => { deleteSignature(deleteSigTarget.id); setDeleteSigTarget(null); }}
          onClose={() => setDeleteSigTarget(null)}
        />
      )}

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-[11px] text-blue-800 leading-relaxed">
        <p className="font-black uppercase tracking-widest text-[10px] mb-1">Cara membuat template .docx</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Buat dokumen di Microsoft Word / LibreOffice.</li>
          <li>Di tempat data harus diisi, tulis placeholder <code className="bg-white px-1 rounded">{'{{nama}}'}</code>, <code className="bg-white px-1 rounded">{'{{tanggal_mulai}}'}</code>, dll.</li>
          <li>Gunakan huruf kecil + underscore (snake_case), tanpa spasi.</li>
          <li>Simpan sebagai <b>.docx</b>, lalu upload di sini. Sistem akan otomatis mendeteksi placeholder.</li>
          <li>Setelah upload, klik <b>Edit</b> untuk mengatur label tampilan, tipe input, dan auto-fill dari profil karyawan.</li>
          <li><b>Untuk template SKC</b>: centang "Template SKC" di Edit, lalu set field tanggal ke <i>auto</i> dengan sumber <i>SKC: …</i>. Untuk TTD gambar, pakai placeholder <code className="bg-white px-1 rounded">{'{%tanda_tangan}'}</code> (satu kurung-persen) di file .docx — sistem akan menyisipkan PNG TTD-nya.</li>
        </ol>
      </div>
    </div>
  );
}

function TemplateFieldEditor({ tpl, onClose, onSave, symbolCodes }: {
  tpl: DocumentTemplate;
  onClose: () => void;
  onSave: (t: DocumentTemplate) => void;
  symbolCodes: string[];
}) {
  const [draft, setDraft] = useState<DocumentTemplate>({ ...tpl, fields: tpl.fields.map(f => ({ ...f })) });

  const setField = (i: number, patch: Partial<DocumentTemplateField>) => {
    setDraft(d => ({ ...d, fields: d.fields.map((f, idx) => idx === i ? { ...f, ...patch } : f) }));
  };

  const addField = () => {
    const newKey = `field_${draft.fields.length + 1}`;
    setDraft(d => ({ ...d, fields: [...d.fields, { key: newKey, label: autoLabel(newKey), type: 'text', required: false }] }));
  };
  const addJenisIjinField = () => {
    const newKey = 'jenis_ijin';
    // Hindari duplikat key
    const exists = draft.fields.some(f => f.key === newKey);
    const key = exists ? `jenis_ijin_${draft.fields.length + 1}` : newKey;
    setDraft(d => ({ ...d, fields: [...d.fields, { key, label: 'Jenis Ijin', type: 'jenis_ijin', required: false }] }));
  };
  const addApprovalBlock = (role: 'atasan_langsung' | 'dept_head') => {
    if (draft.fields.some(f => f.type === 'approval_block' && f.approvalRole === role)) return;
    const label = role === 'atasan_langsung' ? 'Blok Atasan Langsung (Nama + TTD)' : 'Blok Dept Head (Nama + TTD)';
    setDraft(d => ({ ...d, fields: [...d.fields, { key: role, label, type: 'approval_block', approvalRole: role }] }));
  };
  const removeField = (i: number) => {
    setDraft(d => ({ ...d, fields: d.fields.filter((_, idx) => idx !== i) }));
  };

  return (
    <div className="fixed inset-0 z-[2000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">Edit Template</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase font-black text-gray-400 mb-1 tracking-widest">Nama Template</label>
              <input value={draft.name} onChange={(e) => setDraft(d => ({ ...d, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold" />
            </div>
            <div>
              <label className="block text-[10px] uppercase font-black text-gray-400 mb-1 tracking-widest">Kategori</label>
              <input value={draft.category || ''} onChange={(e) => setDraft(d => ({ ...d, category: e.target.value }))}
                placeholder="mis. Cuti, Surat"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold" />
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] uppercase font-black text-gray-400 mb-1 tracking-widest">Deskripsi</label>
              <input value={draft.description || ''} onChange={(e) => setDraft(d => ({ ...d, description: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="col-span-2 flex items-center gap-3 bg-purple-50 border border-purple-100 rounded-lg px-3 py-2">
              <input id="isSkc" type="checkbox" checked={!!draft.isSkc} onChange={(e) => setDraft(d => ({ ...d, isSkc: e.target.checked }))} />
              <label htmlFor="isSkc" className="text-[11px] font-bold text-purple-900">
                Template SKC — bulk-generated dari menu Settings (per cycle Cr), tanpa approval atasan/dept head.
              </label>
            </div>
            <div className="col-span-2 flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              <input id="isSkcSite" type="checkbox" checked={!!draft.isSkcSite} onChange={(e) => setDraft(d => ({ ...d, isSkcSite: e.target.checked, isSkc: e.target.checked ? true : d.isSkc }))} />
              <label htmlFor="isSkcSite" className="text-[11px] font-bold text-amber-900">
                Template SKC Site — sub-tipe SKC, hanya muncul saat toggle <b>Site</b> di Bulk Download.
              </label>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[11px] font-black uppercase tracking-widest text-gray-700">Field</h4>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => addApprovalBlock('atasan_langsung')} className="text-[10px] font-bold inline-flex items-center gap-1 bg-indigo-100 text-indigo-700 px-2 py-1 rounded">
                  <Plus size={11} /> Blok Atasan
                </button>
                <button onClick={() => addApprovalBlock('dept_head')} className="text-[10px] font-bold inline-flex items-center gap-1 bg-indigo-100 text-indigo-700 px-2 py-1 rounded">
                  <Plus size={11} /> Blok Dept Head
                </button>
                <button onClick={addJenisIjinField} className="text-[10px] font-bold inline-flex items-center gap-1 bg-emerald-100 text-emerald-700 px-2 py-1 rounded">
                  <Plus size={11} /> Tambah Jenis Ijin
                </button>
                <button onClick={addField} className="text-[10px] font-bold inline-flex items-center gap-1 bg-blue-100 text-blue-700 px-2 py-1 rounded">
                  <Plus size={11} /> Tambah Field Manual
                </button>
              </div>
            </div>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
              {draft.fields.map((f, i) => f.type === 'approval_block' ? (
                <div key={i} className="border border-indigo-200 rounded-lg p-3 bg-indigo-50/50 flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-indigo-700">Blok Persetujuan</span>
                      <select value={f.approvalRole || 'atasan_langsung'}
                        onChange={(e) => {
                          const role = e.target.value as 'atasan_langsung' | 'dept_head';
                          const label = role === 'atasan_langsung' ? 'Blok Atasan Langsung (Nama + TTD)' : 'Blok Dept Head (Nama + TTD)';
                          setField(i, { approvalRole: role, key: role, label });
                        }}
                        className="border border-indigo-200 rounded px-2 py-1 text-xs font-bold bg-white">
                        <option value="atasan_langsung">Atasan Langsung</option>
                        <option value="dept_head">Dept Head</option>
                      </select>
                    </div>
                    <p className="text-[10px] text-indigo-700/80 font-mono">
                      Mengisi: <b>{`{{${f.approvalRole || 'atasan_langsung'}}}`}</b> (nama) + <b>{f.approvalRole === 'dept_head' ? '{%ttd_dept_head}' : '{%ttd_atasan}'}</b> (TTD)
                    </p>
                    <p className="text-[10px] text-gray-500">Diisi otomatis saat submit dari pilihan dropdown Atasan/Dept Head di form pengajuan.</p>
                  </div>
                  <button onClick={() => removeField(i)} className="text-red-500 hover:text-red-700 p-1.5">
                    <Trash2 size={13} />
                  </button>
                </div>
              ) : (
                <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-4">
                      <label className="block text-[9px] uppercase font-black text-gray-400 mb-0.5">Placeholder</label>
                      <input value={f.key} readOnly
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs font-mono bg-white text-gray-500" />
                    </div>
                    <div className="col-span-4">
                      <label className="block text-[9px] uppercase font-black text-gray-400 mb-0.5">Label</label>
                      <input value={f.label} onChange={(e) => setField(i, { label: e.target.value })}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs font-bold bg-white" />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-[9px] uppercase font-black text-gray-400 mb-0.5">Tipe</label>
                      <select value={f.type} onChange={(e) => setField(i, { type: e.target.value as DocumentFieldType })}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs font-bold bg-white">
                        {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div className="col-span-1 flex items-end">
                      <button onClick={() => removeField(i)} className="text-red-500 hover:text-red-700 p-1.5">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  {f.type === 'auto' && (
                    <div>
                      <label className="block text-[9px] uppercase font-black text-gray-400 mb-0.5">Sumber</label>
                      <select value={f.autoSource || ''} onChange={(e) => setField(i, { autoSource: e.target.value as DocumentAutoSource })}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs font-bold bg-white">
                        <option value="">— Pilih sumber —</option>
                        {AUTO_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                  )}
                  {f.type === 'employee_field' && (
                    <div>
                      <label className="block text-[9px] uppercase font-black text-gray-400 mb-0.5">Header Employee</label>
                      <select value={f.employeeField || ''} onChange={(e) => setField(i, { employeeField: e.target.value as keyof Employee })}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs font-bold bg-white">
                        <option value="">— Pilih header —</option>
                        {Object.entries(EMPLOYEE_IMPORT_COLMAP)
                          .sort((a, b) => (EMPLOYEE_COLUMN_LABELS[a[0]] || a[1]).localeCompare(EMPLOYEE_COLUMN_LABELS[b[0]] || b[1]))
                          .map(([col, key]) => (
                            <option key={col} value={key as string}>{EMPLOYEE_COLUMN_LABELS[col] || String(key)}</option>
                          ))}
                      </select>
                    </div>
                  )}
                  {f.type === 'timesheet_symbol' && (
                    <div>
                      <label className="block text-[9px] uppercase font-black text-gray-400 mb-0.5">Simbol Timesheet (cari tgl terdekat)</label>
                      <select value={f.timesheetSymbol || ''} onChange={(e) => setField(i, { timesheetSymbol: e.target.value })}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs font-bold bg-white">
                        <option value="">— Pilih simbol —</option>
                        {symbolCodes.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <p className="text-[9px] text-gray-400 mt-1">Cocok dgn awalan kode (mis. "Cs" akan match Cs1, Cs2, …). Diisi tgl terdekat (≥ hari ini, fallback yg terakhir lewat).</p>
                    </div>
                  )}
                  {f.type === 'select' && (
                    <div>
                      <label className="block text-[9px] uppercase font-black text-gray-400 mb-0.5">Pilihan (pisah dengan koma)</label>
                      <SelectOptionsInput
                        options={f.options || []}
                        onChange={(opts) => setField(i, { options: opts })}
                      />
                    </div>
                  )}
                  {f.type !== 'auto' && f.type !== 'employee_field' && (
                    <div className="flex items-center gap-3">
                      <label className="inline-flex items-center gap-1.5 text-[10px] font-bold text-gray-600">
                        <input type="checkbox" checked={!!f.required} onChange={(e) => setField(i, { required: e.target.checked })} />
                        Wajib diisi
                      </label>
                      <input value={f.defaultValue || ''} onChange={(e) => setField(i, { defaultValue: e.target.value })}
                        placeholder="Nilai default (opsional)"
                        className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-xs bg-white" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-gray-100 flex justify-end gap-2 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900">Batal</button>
          <button onClick={() => onSave(draft)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-[var(--sidebar)] text-white hover:opacity-90">
            <Save size={13} /> Simpan
          </button>
        </div>
      </div>
    </div>
  );
}

function SelectOptionsInput({ options, onChange }: { options: string[]; onChange: (opts: string[]) => void }) {
  // Simpan raw string lokal supaya user bisa mengetik koma & spasi tanpa
  // langsung di-parse (split+filter sebelumnya menghapus koma trailing).
  const initial = (options || []).join(', ');
  const [raw, setRaw] = React.useState<string>(initial);
  // Sync dari luar (mis. saat field baru dipilih) — hanya kalau parse hasilnya beda.
  React.useEffect(() => {
    const parsed = raw.split(',').map(s => s.trim()).filter(Boolean);
    const same = parsed.length === (options || []).length && parsed.every((v, i) => v === options[i]);
    if (!same) setRaw((options || []).join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.join('|')]);
  return (
    <input
      value={raw}
      onChange={(e) => {
        const v = e.target.value;
        setRaw(v);
        onChange(v.split(',').map(s => s.trim()).filter(Boolean));
      }}
      placeholder="mis. Pria, Wanita"
      className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
    />
  );
}

function ConfirmModal({ title, message, onConfirm, onClose }: {
  title: string; message: string; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[2100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900"><X size={18} /></button>
        </div>
        <div className="p-5 text-sm text-gray-700">{message}</div>
        <div className="p-4 border-t border-gray-100 flex justify-end gap-2 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900">Batal</button>
          <button onClick={onConfirm} className="px-4 py-2 rounded-lg text-xs font-bold bg-red-600 text-white hover:bg-red-700">Hapus</button>
        </div>
      </div>
    </div>
  );
}