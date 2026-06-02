import { CustomSymbol } from '../types';

/**
 * Daftar legenda bawaan sistem. Sumber kebenaran tunggal untuk:
 * - Legenda PDF & Excel (di-merge dengan custom symbols).
 * - Seed `customSymbols` di AppContext (sehingga tampil & dapat di-edit di Settings).
 *
 * Catatan: Ce1 sengaja punya 2 varian (hijau & oranye) yang keduanya dipertahankan;
 * deteksi varian oranye di raw export memakai pencocokan warna (#f97316).
 */
export const LEGEND: Array<{ code: string; bg: string; fg: string; label: string; function?: string }> = [
  { code: 'XP',  bg: '#15803d', fg: '#ffffff', label: 'Penyesuaian',           function: 'Penyesuaian di POH' },
  { code: 'Cr1', bg: '#bbf7d0', fg: '#111111', label: 'Cuti Roster',           function: 'Cuti Roster' },
  { code: 'Cs1', bg: '#fa8072', fg: '#111111', label: 'Cuti Roster On Site',   function: 'Cuti Roster On Site' },
  { code: 'Ct1', bg: '#000000', fg: '#ffffff', label: 'Cuti Tahunan',          function: 'Cuti Tahunan' },
  { code: 'TS',  bg: '#ec4899', fg: '#ffffff', label: 'Cuti Tahunan on Site',  function: 'Cuti Tahunan on Site' },
  { code: 'UIs1',bg: '#ec4899', fg: '#ffffff', label: 'Ijin on Site',          function: 'Ijin on Site' },
  { code: 'II',  bg: '#ec4899', fg: '#ffffff', label: 'Ijin Khusus on site',   function: 'Ijin Khusus on site' },
  { code: 'KL',  bg: '#ec4899', fg: '#ffffff', label: 'Karantina Labuha',      function: 'Karantina Labuha' },
  { code: 'TV',  bg: '#dc2626', fg: '#ffffff', label: 'Travel Dari Site',      function: 'Travel Perjalanan Dari Site' },
  { code: 'CI1', bg: '#93c5fd', fg: '#111111', label: 'Cuti Istimewa',         function: 'Cuti Istimewa' },
  { code: 'IS1', bg: '#93c5fd', fg: '#111111', label: 'Cuti Istimewa on site', function: 'Cuti istimewa on site' },
  { code: 'Ce1', bg: '#15803d', fg: '#ffffff', label: 'Sisa Cuti Sebelumnya',  function: 'Sisa Cuti Sebelumnya' },
  { code: 'Ce1', bg: '#f97316', fg: '#000000', label: 'Cuti Extra',            function: 'Cuti Extra' },
  { code: 'Xk',  bg: '#ffffff', fg: '#111111', label: 'Hari Kerja',            function: 'Kerja Lapangan' },
  { code: 'X1',  bg: '#000000', fg: '#ffffff', label: 'Kelebihan Hari Kerja',  function: 'Kelebihan Hari Kerja' },
  { code: 'Cx',  bg: '#93c5fd', fg: '#111111', label: 'Ekstra Karantina',      function: 'Ekstra Karantina' },
  { code: 'UI1', bg: '#93c5fd', fg: '#111111', label: 'Ijin',                  function: 'Ijin' },
  { code: 'KS',  bg: '#93c5fd', fg: '#111111', label: 'Karantina Site',        function: 'Karantina Site' },
  { code: 'SS',  bg: '#93c5fd', fg: '#111111', label: 'Sakit on site',         function: 'Sakit on site' },
  { code: 'XS',  bg: '#000000', fg: '#ffffff', label: 'Cuti Istimewa (Hari Libur)', function: 'Cuti Istimewa (Hari Libur)' },
  { code: 'A1',  bg: '#ef4444', fg: '#ffffff', label: 'Alpa',                  function: 'Alpa' },
  { code: 'DD1', bg: '#1e3a8a', fg: '#ffffff', label: 'Dinas Antar Site',      function: 'Dinas Antar Site' },
  { code: 'DI1', bg: '#1e3a8a', fg: '#ffffff', label: 'Dinas Luar',            function: 'Dinas Luar' },
  { code: 'BP',  bg: '#1e3a8a', fg: '#ffffff', label: 'Dinas Jabodetabek',     function: 'Dinas Jabodetabek Bandara / Pelabuhan' },
  { code: 'IK1', bg: '#1e3a8a', fg: '#ffffff', label: 'Ijin Khusus',           function: 'Ijin Khusus' },
  { code: 'TT',  bg: '#1e3a8a', fg: '#ffffff', label: 'Tdk ada Transportasi',  function: 'Tdk ada Transportasi' },
  { code: 'TV',  bg: '#1e3a8a', fg: '#ffffff', label: 'Travel Ke Site',        function: 'Travel Perjalanan Ke Site' },
  { code: 'SI',  bg: '#1e3a8a', fg: '#ffffff', label: 'Sakit',                 function: 'Sakit' },
];

/** ID stabil untuk entri built-in (dipakai untuk merge override user). */
export function builtinSymbolId(code: string, idx: number): string {
  return `builtin-${code}-${idx}`;
}

/** BUILTIN_SYMBOLS: representasi LEGEND sebagai CustomSymbol[] yang dapat di-edit user. */
export const BUILTIN_SYMBOLS: CustomSymbol[] = LEGEND.map((l, idx) => ({
  id: builtinSymbolId(l.code, idx),
  code: l.code,
  label: l.label,
  color: l.bg,
  textColor: l.fg,
  rules: 'Replace',
  description: '',
  builtin: true,
  function: l.function,
}));

/**
 * Merge built-in dengan symbols tersimpan dari user.
 * - Untuk tiap built-in id, kalau user pernah simpan override, pakai versi user (paksa builtin: true & code asli).
 * - Custom user (non-builtin) dipertahankan apa adanya.
 * - Built-in selalu hadir, urutannya selalu di atas.
 */
export function mergeBuiltinSymbols(saved: CustomSymbol[]): CustomSymbol[] {
  const savedById = new Map(saved.map(s => [s.id, s] as const));
  const merged: CustomSymbol[] = BUILTIN_SYMBOLS.map(b => {
    const u = savedById.get(b.id);
    if (!u) return { ...b };
    return {
      ...b,
      label: u.label ?? b.label,
      color: u.color ?? b.color,
      textColor: u.textColor ?? b.textColor,
      rules: u.rules ?? b.rules,
      description: u.description ?? b.description,
      function: u.function ?? b.function,
      // code & builtin & id dipaksa sesuai built-in
    };
  });
  const customs = saved.filter(s => !s.builtin && !savedById.has(s.id) ? true : !s.builtin);
  // dedupe oleh id
  const seen = new Set(merged.map(m => m.id));
  for (const c of customs) {
    if (!seen.has(c.id)) merged.push(c);
  }
  return merged;
}
