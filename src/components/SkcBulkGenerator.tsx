import React, { useMemo, useRef, useState } from 'react';
import { useApp } from '../AppContext';
import { Download, Loader2, FileText, AlertTriangle, Square } from 'lucide-react';
import { format } from 'date-fns';
import { computeCrMinusCs, generateSkcZip, detectSkcCycleByLeaveDate } from '../lib/skcGenerator';
import { buildTimesheetPdfBuffer, type SiteBlockData } from '../lib/timesheetExport';
import { calculateTimesheet } from '../lib/roster';
import { id as idLocale } from 'date-fns/locale';
import { parseISO } from 'date-fns';

export default function SkcBulkGenerator() {
  const {
    user, employees, leaveRequests, customSymbols, overrides,
    documentTemplates, signatures,
    exportMonthsBack, exportMonthsAhead,
    payrollAnchorLokal, payrollAnchorNonLokal,
  } = useApp();

  const skcTemplates = useMemo(
    () => documentTemplates.filter(t => t.isSkc),
    [documentTemplates],
  );

  const today = new Date();
  // Default rentang: H+2 s/d H+5 dari hari ini.
  const defaultFrom = format(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2), 'yyyy-MM-dd');
  const defaultTo   = format(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 5), 'yyyy-MM-dd');

  const [mode, setMode] = useState<'both' | 'skc' | 'timesheet'>('both');
  const [skcKind, setSkcKind] = useState<'roster' | 'site'>('roster');
  const [templateId, setTemplateId] = useState('');
  const [signatureId, setSignatureId] = useState('');
  const [berangkatMode, setBerangkatMode] = useState<'kosong' | 'isi'>('isi');
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);
  const [startNumbers, setStartNumbers] = useState<Record<string, string>>({});
  const [outputFormat, setOutputFormat] = useState<'pdf' | 'docx'>('docx');
  const [mergeMode, setMergeMode] = useState<'gabung' | 'pisah'>('gabung');
  const [concurrency, setConcurrency] = useState(4);
  // Site Block (Halaman Belakang SKC Site): 3 penandatangan opsional.
  const [siteVerifId, setSiteVerifId] = useState('');
  const [siteKnowId, setSiteKnowId] = useState('');
  const [siteApproveId, setSiteApproveId] = useState('');
  const [siteVerifTitle, setSiteVerifTitle] = useState('HR Operation');
  const [siteKnowTitle, setSiteKnowTitle] = useState('HR Superintendent');
  const [siteApproveTitle, setSiteApproveTitle] = useState('Head Of Site');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' });
  const [result, setResult] = useState<{ ok: number; failed: Array<{ name: string; err: string }> } | null>(null);
  const [err, setErr] = useState('');
  const cancelRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-pilih TTD default sesuai role yang ditandai di menu Template Dokumen.
  // Hanya isi saat user belum memilih manual (state masih kosong).
  React.useEffect(() => {
    const findDefault = (role: 'verif' | 'know' | 'approve') =>
      signatures.find(s => (s.defaultRoles || []).includes(role))?.id || '';
    setSiteVerifId(prev => prev || findDefault('verif'));
    setSiteKnowId(prev => prev || findDefault('know'));
    setSiteApproveId(prev => prev || findDefault('approve'));
  }, [signatures]);

  const filteredTemplates = useMemo(
    () => skcTemplates.filter(t => skcKind === 'site' ? !!t.isSkcSite : !t.isSkcSite),
    [skcTemplates, skcKind],
  );
  const tpl = filteredTemplates.find(t => t.id === templateId) || null;
  const sig = signatures.find(s => s.id === signatureId) || null;
  const siteVerifSig = signatures.find(s => s.id === siteVerifId) || null;
  const siteKnowSig  = signatures.find(s => s.id === siteKnowId)  || null;
  const siteApproveSig = signatures.find(s => s.id === siteApproveId) || null;
  const isSite = skcKind === 'site';
  const startNumberFields = useMemo(
    () => (tpl?.fields || []).filter(f => f.type === 'start_number'),
    [tpl],
  );
  const needTemplate = mode !== 'timesheet';

  const candidateEmployees = useMemo(() => {
    if (!fromDate || !toDate) return [];
    return employees.filter(emp => {
      try {
        if (mode === 'timesheet') {
          // Sama dengan Bulk Download Timesheet lama: filter Cr di range.
          const data = calculateTimesheet(emp, fromDate, toDate, leaveRequests, customSymbols, overrides);
          return data.some(d => /^Cr\d*$/i.test(d.symbol || ''));
        }
        const c = detectSkcCycleByLeaveDate(emp, fromDate, toDate, leaveRequests, customSymbols, overrides, skcKind);
        if (!c) return false;
        // Untuk SKC Site, pastikan ada hari Cs (cycle terdeteksi tapi tanpa Cs tidak valid).
        if (skcKind === 'site' && c.csDays <= 0) return false;
        return true;
      } catch { return false; }
    });
  }, [employees, fromDate, toDate, leaveRequests, customSymbols, overrides, mode, skcKind]);

  const handleGenerate = async () => {
    setErr(''); setResult(null);
    if (needTemplate && !tpl) { setErr('Pilih template SKC dahulu.'); return; }
    if (!fromDate || !toDate || fromDate > toDate) { setErr('Rentang tanggal tidak valid.'); return; }
    if (candidateEmployees.length === 0) {
      setErr(skcKind === 'site'
        ? 'Tidak ada karyawan dengan Cs1 (Cuti Site) di rentang ini.'
        : 'Tidak ada karyawan yang jatuh cycle Cr di rentang ini.');
      return;
    }

    const baseMap: Record<string, number> = {};
    if (needTemplate) for (const f of startNumberFields) {
      const raw = startNumbers[f.key] ?? f.defaultValue ?? '';
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n)) { setErr(`Isi nilai awal untuk field "${f.label}".`); return; }
      baseMap[f.key] = n;
    }

    cancelRef.current = false;
    abortRef.current = new AbortController();
    setBusy(true);
    setProgress({ done: 0, total: candidateEmployees.length, label: '' });
    try {
      const ctx = {
        employees, leaveRequests, customSymbols, overrides,
        year: new Date(fromDate).getFullYear(),
        monthsBack: exportMonthsBack,
        monthsAhead: exportMonthsAhead,
      };
      const res = await generateSkcZip(
        {
          mode,
          template: tpl,
          signature: sig,
          berangkatTernateMode: berangkatMode,
          startNumberBase: baseMap,
          fromDate, toDate,
          employees: candidateEmployees,
          leaveRequests, customSymbols, overrides,
          abortSignal: abortRef.current.signal,
          shouldCancel: () => cancelRef.current,
          outputFormat,
          concurrency,
          mergeMode,
          payrollAnchorLokal,
          payrollAnchorNonLokal,
          skcKind,
        },
        async (emp) => {
          let siteBlock: SiteBlockData | undefined;
          if (isSite) {
            try {
              const cycle = detectSkcCycleByLeaveDate(
                emp, fromDate, toDate, leaveRequests, customSymbols, overrides, 'site',
              );
              if (cycle && cycle.csDays > 0) {
                // Anchor bulan: sama dgn logika skcGenerator.buildSkcValues.
                const lokasi = String(emp.payrollLocation || '').toLowerCase();
                const isLokal = lokasi.includes('lokal') && !lokasi.includes('non');
                const anchor = (isLokal ? payrollAnchorLokal : payrollAnchorNonLokal) ?? 15;
                const d = parseISO(cycle.leaveSiteDate);
                const base = d.getDate() > anchor
                  ? new Date(d.getFullYear(), d.getMonth() + 1, 1)
                  : d;
                const periodLabel = format(base, 'MMMM yyyy', { locale: idLocale });
                const jumlah = computeCrMinusCs(cycle);
                siteBlock = {
                  periodLabel,
                  jumlah,
                  dibayarkan: jumlah,
                  keterangan: `Dibayarkan Penggajian ${periodLabel}`,
                  employeeName: emp.name || '-',
                  diverifikasiName: siteVerifSig?.name || '',
                  diverifikasiTitle: siteVerifTitle,
                  diketahuiName: siteKnowSig?.name || '',
                  diketahuiTitle: siteKnowTitle,
                  disetujuiName: siteApproveSig?.name || '',
                  disetujuiTitle: siteApproveTitle,
                };
              }
            } catch { /* ignore — fallback ke PDF biasa */ }
          }
          return buildTimesheetPdfBuffer(ctx, emp, siteBlock);
        },
        (done, total, label) => setProgress({ done, total, label }),
      );
      // Trigger download
      const url = URL.createObjectURL(res.zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      setResult({
        ok: res.successCount,
        failed: res.failed.map(f => ({ name: f.employee.name || f.employee.nik, err: f.error })),
      });
      if (cancelRef.current) setErr('Proses dihentikan oleh pengguna. ZIP berisi hasil parsial.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      cancelRef.current = false;
      abortRef.current = null;
    }
  };

  const activeDone = progress.done;
  const canUse = user && (user.role === 'SUPERUSER' || user.role === 'APPROVAL_HR');
  if (!canUse) return null;

  return (
    <section className="space-y-8 lg:col-span-2">
      <div className="flex justify-between items-center border-b-2 border-[var(--ink)] pb-4">
        <h3 className="text-xl font-serif italic">Bulk Download (SKC & Timesheet)</h3>
        <span className="text-[10px] uppercase tracking-widest opacity-50">Khusus Superuser & Approval HR</span>
      </div>
      <div className="bg-white border border-[var(--ink)]/10 p-6 space-y-4">
        {needTemplate && skcTemplates.length === 0 ? (
          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-3 flex gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>Belum ada template SKC. Buka <b>Template Dokumen</b>, upload .docx, lalu centang <b>"Template SKC"</b> di Edit. Atau pilih mode <b>Timesheet saja</b> di bawah.</span>
          </div>
        ) : null}
          <>
            <div>
              <label className="block text-[10px] uppercase tracking-widest opacity-50 mb-1">Mode Output</label>
              <div className="flex gap-2 flex-wrap">
                {([
                  { v: 'both', l: 'SKC + Timesheet' },
                  { v: 'skc', l: 'SKC saja' },
                  { v: 'timesheet', l: 'Timesheet saja' },
                ] as const).map(o => (
                  <button key={o.v} type="button" onClick={() => setMode(o.v)} disabled={busy}
                    className={`px-3 py-2 text-[10px] uppercase font-black rounded border-2 ${mode === o.v ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]' : 'border-[var(--ink)]/20 hover:bg-gray-50'}`}>
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
            {needTemplate && (
              <div>
                <label className="block text-[10px] uppercase tracking-widest opacity-50 mb-1">Jenis SKC</label>
                <div className="flex gap-2 flex-wrap">
                  {([
                    { v: 'roster', l: 'Roster' },
                    { v: 'site', l: 'Site' },
                  ] as const).map(o => (
                    <button key={o.v} type="button" onClick={() => { setSkcKind(o.v); setTemplateId(''); }} disabled={busy}
                      className={`px-3 py-2 text-[10px] uppercase font-black rounded border-2 ${skcKind === o.v ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]' : 'border-[var(--ink)]/20 hover:bg-gray-50'}`}>
                      {o.l}
                    </button>
                  ))}
                </div>
                <p className="text-[9px] opacity-50 mt-1">
                  <b>Roster</b>: bulk SKC standar (cycle Cr). <b>Site</b>: SKC karyawan yang jual cuti (Cs) — pakai template bertanda <b>SKC Site</b>.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {needTemplate && <div>
                <label className="block text-[10px] uppercase tracking-widest opacity-50 mb-1">Template SKC</label>
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}
                  className="w-full border border-[var(--ink)]/20 rounded px-3 py-2 text-sm font-bold">
                  <option value="">— Pilih Template —</option>
                  {filteredTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>}
              {needTemplate && <div>
                <label className="block text-[10px] uppercase tracking-widest opacity-50 mb-1">Tanda Tangan (PNG)</label>
                <select value={signatureId} onChange={(e) => setSignatureId(e.target.value)}
                  className="w-full border border-[var(--ink)]/20 rounded px-3 py-2 text-sm font-bold">
                  <option value="">— Tanpa TTD —</option>
                  {signatures.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>}
              <div>
                <label className="block text-[10px] uppercase tracking-widest opacity-50 mb-1">Dari Tanggal</label>
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                  className="w-full border border-[var(--ink)]/20 rounded px-3 py-2 text-sm font-bold" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest opacity-50 mb-1">Sampai Tanggal</label>
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                  className="w-full border border-[var(--ink)]/20 rounded px-3 py-2 text-sm font-bold" />
              </div>
              {needTemplate && <div>
                <label className="block text-[10px] uppercase tracking-widest opacity-50 mb-1">Tanggal Berangkat dari Ternate</label>
                <select value={berangkatMode} onChange={(e) => setBerangkatMode(e.target.value as 'kosong' | 'isi')}
                  className="w-full border border-[var(--ink)]/20 rounded px-3 py-2 text-sm font-bold">
                  <option value="kosong">Kosong</option>
                  <option value="isi">Isi (H-2 dari X1)</option>
                </select>
              </div>}
            </div>

            {needTemplate && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-[var(--ink)]/10 pt-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest opacity-50 mb-1">Format Halaman Depan</label>
                  <div className="flex gap-2">
                    {([
                      { v: 'docx', l: 'DOCX (cepat)' },
                      { v: 'pdf', l: 'PDF' },
                    ] as const).map(o => (
                      <button key={o.v} type="button" onClick={() => setOutputFormat(o.v)} disabled={busy}
                        className={`px-3 py-2 text-[10px] uppercase font-black rounded border-2 ${outputFormat === o.v ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]' : 'border-[var(--ink)]/20 hover:bg-gray-50'}`}>
                        {o.l}
                      </button>
                    ))}
                  </div>
                  <p className="text-[9px] opacity-50 mt-1">DOCX 10–20× lebih cepat (lewati konversi LibreOffice). Default.</p>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest opacity-50 mb-1">Penggabungan Hasil</label>
                  <div className="flex gap-2">
                    {([
                      { v: 'gabung', l: 'Gabung Hasil' },
                      { v: 'pisah', l: 'Pisah Hasil' },
                    ] as const).map(o => (
                      <button key={o.v} type="button" onClick={() => setMergeMode(o.v)} disabled={busy}
                        className={`px-3 py-2 text-[10px] uppercase font-black rounded border-2 ${mergeMode === o.v ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]' : 'border-[var(--ink)]/20 hover:bg-gray-50'}`}>
                        {o.l}
                      </button>
                    ))}
                  </div>
                  <p className="text-[9px] opacity-50 mt-1">Gabung untuk DOCX/PDF = satu file gabungan. DOCX paling aman dibuka di Microsoft Word.</p>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest opacity-50 mb-1">Konkurensi (paralel)</label>
                  <div className="flex items-center gap-3">
                    <input type="range" min={1} max={6} step={1} value={concurrency}
                      onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
                      disabled={busy} className="flex-1" />
                    <span className="text-sm font-bold w-6 text-center">{concurrency}</span>
                  </div>
                  <p className="text-[9px] opacity-50 mt-1">Jumlah dokumen diproses bersamaan. Default 4. Turunkan bila server lemah.</p>
                </div>
              </div>
            )}

            {needTemplate && startNumberFields.length > 0 && (
              <div className="border-t border-[var(--ink)]/10 pt-4">
                <p className="text-[10px] uppercase tracking-widest opacity-50 font-bold mb-2">Start Number (auto-increment per dokumen)</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {startNumberFields.map(f => (
                    <div key={f.key}>
                      <label className="block text-[10px] uppercase opacity-50 mb-1">{f.label}</label>
                      <input
                        type="number"
                        value={startNumbers[f.key] ?? f.defaultValue ?? ''}
                        onChange={(e) => setStartNumbers(p => ({ ...p, [f.key]: e.target.value }))}
                        placeholder="mis. 121"
                        className="w-full border border-[var(--ink)]/20 rounded px-3 py-2 text-sm font-bold"
                      />
                      <p className="text-[9px] opacity-50 mt-1">Dokumen ke-1 = nilai ini, ke-2 = +1, dst.</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isSite && (
              <div className="border-t border-[var(--ink)]/10 pt-4">
                <p className="text-[10px] uppercase tracking-widest opacity-50 font-bold mb-2">
                  Penandatangan Halaman Belakang (SKC Site)
                </p>
                <p className="text-[9px] opacity-50 mb-3">
                  Tabel "Cuti Site Periode …" + 4 kolom tanda tangan akan muncul di atas legend di Halaman Belakang.
                  Kolom "Karyawan ybs," otomatis pakai nama karyawan.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {([
                    { label: 'Diverifikasi Oleh', sigVal: siteVerifId,   setSig: setSiteVerifId,   titleVal: siteVerifTitle,   setTitle: setSiteVerifTitle },
                    { label: 'Diketahui Oleh',    sigVal: siteKnowId,    setSig: setSiteKnowId,    titleVal: siteKnowTitle,    setTitle: setSiteKnowTitle },
                    { label: 'Disetujui Oleh',    sigVal: siteApproveId, setSig: setSiteApproveId, titleVal: siteApproveTitle, setTitle: setSiteApproveTitle },
                  ] as const).map((s) => (
                    <div key={s.label} className="space-y-2">
                      <label className="block text-[10px] uppercase opacity-50">{s.label}</label>
                      <select value={s.sigVal} onChange={(e) => s.setSig(e.target.value)}
                        className="w-full border border-[var(--ink)]/20 rounded px-3 py-2 text-sm font-bold">
                        <option value="">— Pilih Nama —</option>
                        {signatures.map(sg => <option key={sg.id} value={sg.id}>{sg.name}</option>)}
                      </select>
                      <input type="text" value={s.titleVal} onChange={(e) => s.setTitle(e.target.value)}
                        placeholder="Jabatan"
                        className="w-full border border-[var(--ink)]/20 rounded px-3 py-2 text-xs" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="text-[11px] opacity-70 bg-gray-50 border border-gray-200 rounded p-3 flex items-center gap-2">
              <FileText size={14} />
              {candidateEmployees.length === 0
                ? <span>Belum ada karyawan dengan cycle Cr di rentang ini.</span>
                : <span><b>{candidateEmployees.length}</b> karyawan akan diproses (jatuh cycle Cr di rentang).</span>}
            </div>

            {err && <div className="text-[11px] bg-red-50 border border-red-200 text-red-700 rounded p-3 font-bold">{err}</div>}

            <div className="flex items-center gap-4 pt-2">
              <button onClick={handleGenerate} disabled={busy || (needTemplate && !tpl)}
                className="px-4 py-2 text-[10px] uppercase font-bold bg-[var(--ink)] text-[var(--bg)] flex items-center gap-2 disabled:opacity-50">
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                {busy
                  ? `Memproses ${activeDone}/${progress.total}${progress.label ? ` — ${progress.label}` : ''}…`
                  : 'Generate ZIP'}
              </button>
              {busy && (
                <button onClick={() => { cancelRef.current = true; abortRef.current?.abort(); }}
                  className="px-3 py-2 text-[10px] uppercase font-bold border-2 border-red-600 text-red-600 hover:bg-red-50 flex items-center gap-1">
                  <Square size={12} /> Hentikan
                </button>
              )}
              {busy && progress.total > 0 && (
                <div className="flex-1 max-w-xs h-2 bg-[var(--ink)]/10 rounded overflow-hidden">
                  <div className="h-full bg-[var(--ink)] transition-all"
                    style={{ width: `${(activeDone / progress.total) * 100}%` }} />
                </div>
              )}
            </div>

            {result && (
              <div className="text-[11px] mt-2 space-y-1">
                <p className="font-bold text-green-700">Selesai. Berhasil: {result.ok} dokumen.</p>
                {result.failed.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded p-3">
                    <p className="font-bold text-amber-800 mb-1">{result.failed.length} gagal:</p>
                    <ul className="list-disc list-inside space-y-0.5 text-amber-900">
                      {result.failed.map((f, i) => <li key={i}>{f.name} — {f.err}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <p className="text-[10px] italic opacity-40">
              Mode <b>SKC + Timesheet</b> → ZIP berisi 2 folder (<b>Halaman_Depan/</b> + <b>Halaman_Belakang/</b>) dengan nama file sama per karyawan.
              Mode <b>SKC saja</b> / <b>Timesheet saja</b> → file PDF flat di root ZIP. Format tanggal: dd-MMM-yyyy (ID).
            </p>
          </>
      </div>
    </section>
  );
}
