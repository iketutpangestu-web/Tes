# Rencana: Field "Blok Persetujuan" di Template Dokumen

## Masalah
Saat ini 4 placeholder approval di template muncul terpisah:
- `{{atasan_langsung}}` → text field di form editor
- `{%ttd_atasan}` → entri image placeholder
- `{{dept_head}}` → text field di form editor
- `{%ttd_dept_head}` → entri image placeholder

Sulit dihapus/dipantau karena tersebar. Auto-fill sebetulnya sudah jalan
(nama di `DocumentForm.tsx` baris 381–382, TTD di `AppContext.rerenderDocumentWithSignatures`).

## Goal
Satu tipe field baru "Blok Persetujuan" yang membungkus pasangan **Nama + TTD**
untuk Atasan Langsung dan Dept Head. Bisa ditambah/dihapus sebagai satu kesatuan
di editor template, dan tetap auto-fill saat submit & setelah approval.

## Perubahan

### 1. `src/types.ts`
- Tambah `DocumentFieldType`: `'approval_block'`.
- Tambah optional di `DocumentTemplateField`:
  - `approvalRole?: 'atasan_langsung' | 'dept_head'`
- Satu field approval_block mewakili **nama + ttd** dari role yang dipilih.

### 2. `src/components/DocumentTemplates.tsx`
- Saat upload .docx, deteksi placeholder approval:
  - Jika ada `atasan_langsung` (text) atau `ttd_atasan` (image) → buat 1 field `approval_block` dengan `approvalRole='atasan_langsung'`. Buang `atasan_langsung` dari `fields` dan `ttd_atasan` dari `imagePlaceholders` (dipindah ke metadata field).
  - Sama untuk pasangan `dept_head` / `ttd_dept_head`.
- Di FIELD_TYPES dropdown, tambah `{ value: 'approval_block', label: 'Blok Persetujuan (Nama + TTD)' }`.
- UI editor field bertipe `approval_block`:
  - Tampil sebagai card ringkas: label otomatis "Blok Atasan Langsung" / "Blok Dept Head", dengan dropdown role.
  - Info kecil: "Placeholder yang diisi: `{{atasan_langsung}}` + `{%ttd_atasan}`" (sesuai role).
  - Tombol hapus seperti field lain — menghapus blok = menghapus keempat slot sekaligus dari template metadata.
- Saat user "Tambah Field" manual: izinkan pilih `approval_block`, default role `atasan_langsung`.

### 3. `src/components/DocumentForm.tsx`
- Field `approval_block` **tidak ditampilkan** sebagai input (data datang dari dropdown approval atasan yang sudah ada di form).
- Sebelum render, expand:
  - role=atasan_langsung → set `values['atasan_langsung']` = nama direct supervisor, dan tandai TTD `ttd_atasan` perlu disisipkan dari signature ownerId=direct supervisor (logika existing di `AppContext.rerenderDocumentWithSignatures` setelah approve).
  - role=dept_head → set `values['dept_head']` = nama indirect supervisor, TTD `ttd_dept_head` dari signature ownerId=indirect supervisor.
- Validasi submit: jika ada `approval_block` role X tapi supervisor X belum dipilih → blokir submit dengan pesan jelas.

### 4. `src/AppContext.tsx`
- Tidak berubah. Re-render setelah approve sudah meng-handle `ttd_atasan` / `ttd_dept_head` dari `directApprovedBy` / `indirectApprovedBy`.

## Catatan migrasi
Template lama yang sudah punya field `atasan_langsung`/`dept_head` text + image placeholders terpisah tetap jalan (auto-fill existing tidak diubah). Untuk menikmati grouping baru: edit template → hapus field text lama → tambah field "Blok Persetujuan" → simpan. Atau re-upload .docx (deteksi otomatis akan menggrupkannya).

## Tidak diubah
- Logika approval flow, signature ownership, dan rerender PDF setelah approve.
- Behavior placeholder `{%ttd_hr}` dan `{%ttd_sendiri}`.
