/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = 'REGULAR' | 'APPROVAL' | 'ADMIN' | 'APPROVAL_HR' | 'SUPERUSER';

export interface Employee {
  id: string;
  nik: string;
  name: string;
  position: string;
  department: string;
  grade: string;
  joinDate: string;
  poh: string;
  nextLeaveDate: string;
  role: UserRole;
  email: string;
  /** mock password (demo/local only) */
  password?: string;
  /** base64 selfie+id photo dari signup */
  photo?: string;
  /** @deprecated kept for migration only */
  rosterAnchors?: string[];
  /** @deprecated kept for migration only */
  rosterWorkAnchors?: string[];
  /** @deprecated kept for migration only */
  clearBeforeDate?: string;
  /** marker bahwa employee sudah dimigrasi ke sistem materialized */
  migratedToMaterialized?: boolean;
  annualLeaveBalance?: number;
  extraLeaveBalance?: number;
  rosterType?: string;
  gender?: string;
  status?: string;
  grading?: string;
  mess?: string;
  birthDate?: string;
  phone?: string;
  lastLeaveDate?: string;
  // Extended fields per import rule
  joinDateLatest?: string;
  payrollLocation?: string;
  bankAccount?: string;
  bank?: string;
  terminationDate?: string;
  resignReason?: string;
  birthPlace?: string;
  age?: string;
  religion?: string;
  ktp?: string;
  kk?: string;
  address?: string;
  province?: string;
  city?: string;
  emergencyPhone?: string;
  emergencyName?: string;
  emergencyRelation?: string;
  education?: string;
  major?: string;
  npwp?: string;
  bpjsTk?: string;
  bpjsKes?: string;
  maritalStatus?: string;
  marriageStatus?: string;
  fatherName?: string;
  motherName?: string;
  /** Diaktifkan manual oleh superuser. Karyawan yang ditandai jadi role APPROVAL_HR. */
  isHrApprover?: boolean;
}

/**
 * Mapping nomor kolom (1-indexed) di file XLSX import → field Employee.
 * Berdasarkan iMPORT_RULE.xlsx (kolom dengan "Perlu" = YA).
 */
export const EMPLOYEE_IMPORT_COLMAP: Record<string, keyof Employee> = {
  '5': 'nik',
  '6': 'name',
  '7': 'position',
  '8': 'gender',
  '11': 'status',
  '12': 'department',
  '15': 'grade',
  '18': 'grading',
  '23': 'poh',
  '25': 'mess',
  '28': 'joinDate',
  '29': 'joinDateLatest',
  '32': 'payrollLocation',
  '34': 'bankAccount',
  '35': 'bank',
  '36': 'terminationDate',
  '37': 'resignReason',
  '38': 'birthPlace',
  '39': 'birthDate',
  '40': 'age',
  '42': 'religion',
  '43': 'ktp',
  '44': 'kk',
  '45': 'address',
  '46': 'province',
  '49': 'city',
  '51': 'email',
  '52': 'phone',
  '53': 'emergencyPhone',
  '54': 'emergencyName',
  '55': 'emergencyRelation',
  '56': 'education',
  '57': 'major',
  '58': 'npwp',
  '59': 'bpjsTk',
  '60': 'bpjsKes',
  '61': 'maritalStatus',
  '62': 'marriageStatus',
  '63': 'fatherName',
  '64': 'motherName',
};

/** Field tanggal yang harus dinormalisasi ke yyyy-MM-dd saat import. */
export const EMPLOYEE_DATE_FIELDS: ReadonlyArray<keyof Employee> = [
  'joinDate', 'joinDateLatest', 'birthDate', 'terminationDate', 'lastLeaveDate',
];

/** Label kolom untuk tampilan tabel (key = nomor kolom XLSX). */
export const EMPLOYEE_COLUMN_LABELS: Record<string, string> = {
  '5': 'NIK', '6': 'Nama', '7': 'Jabatan', '8': 'L/P', '11': 'Status',
  '12': 'Departemen', '15': 'Golongan', '18': 'Grading', '23': 'POH', '25': 'Mess',
  '28': 'Join Date', '29': 'Join Date Terbaru', '32': 'Lokasi Penggajian',
  '34': 'No Rekening', '35': 'Bank', '36': 'Tgl Berhenti', '37': 'Alasan Resign',
  '38': 'Tempat Lahir', '39': 'Tgl Lahir', '40': 'Usia', '42': 'Agama',
  '43': 'No KTP', '44': 'No KK', '45': 'Alamat', '46': 'Provinsi', '49': 'Kota',
  '51': 'Email', '52': 'No HP', '53': 'Telp Darurat', '54': 'Emergency Contact',
  '55': 'Hubungan', '56': 'Pendidikan', '57': 'Jurusan', '58': 'NPWP',
  '59': 'BPJS TK', '60': 'BPJS Kes', '61': 'Status Pernikahan',
  '62': 'Status Perkawinan', '63': 'Nama Ayah', '64': 'Nama Ibu',
};

/**
 * Kolom-kolom yang ditampilkan di mode kompak (tombol "Lihat Semua" OFF).
 * Catatan: kolom 22 di permintaan user = "Perubahan POH" (tidak diimport),
 * dipetakan ke POH (kolom 23) sebagai field terdekat yang relevan.
 */
export const EMPLOYEE_COMPACT_COLUMNS: string[] =
  ['5', '6', '7', '8', '12', '15', '18', '23', '28', '32', '36', '39', '52'];

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface LeaveRequest {
  id: string;
  employeeId: string;
  type: string;
  startDate: string;
  endDate: string;
  status: LeaveStatus;
  reason: string;
  submittedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  /**
   * Nama function (lihat LEAVE_FUNCTIONS). Jika diisi, roster akan mencari
   * customSymbol berdasarkan field `function`. Fallback ke `type` (code).
   */
  function?: string;
  /** Diisi jika diajukan oleh admin/superuser atas nama karyawan lain */
  submittedByName?: string;
  submittedByPosition?: string;
  submittedById?: string;
  /** Atasan Langsung (employee id) */
  directSupervisorId?: string;
  directSupervisorName?: string;
  /** Atasan dari Atasan Langsung (employee id atau '' jika "Tidak Ada") */
  indirectSupervisorId?: string;
  indirectSupervisorName?: string;
  directApprovedBy?: string;
  directApprovedAt?: string;
  indirectApprovedBy?: string;
  indirectApprovedAt?: string;
  /** HR final approver (employee id) & timestamp. */
  hrApprovedBy?: string;
  hrApprovedAt?: string;
  /** Lampiran gambar (base64) */
  attachmentImage?: string;
  /** Penolakan */
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
}

export interface CustomSymbol {
  id: string;
  code: string;
  label: string;
  color: string;
  rules?: string;
  description?: string;
  /** True jika simbol ini adalah simbol bawaan sistem (tidak boleh dihapus, code tidak boleh diubah). */
  builtin?: boolean;
  /** Warna teks (hex). Jika kosong, dihitung otomatis dari kontras background. */
  textColor?: string;
  /**
   * Fungsi/peran simbol di sistem. Saat Leave Request disetujui dengan
   * `function = X`, timesheet akan mencari customSymbol yang `function`-nya
   * sama. Fallback: cocokkan berdasarkan `code` (perilaku lama).
   */
  function?: string;
}

/**
 * Daftar fungsi yang tersedia untuk Custom Symbol & Leave Request.
 * Sumber kebenaran tunggal — dipakai oleh Settings (dropdown function),
 * LeaveForm (sub-tipe), dan roster.ts (mapping LR → simbol).
 */
export const LEAVE_FUNCTIONS: string[] = [
  'Penyesuaian di POH',
  'Cuti Roster',
  'Cuti Roster On Site',
  'Cuti Tahunan',
  'Cuti Tahunan on Site',
  'Ijin on Site',
  'Ijin Khusus on site',
  'Karantina Labuha',
  'Travel Perjalanan Ke Site',
  'Cuti Istimewa',
  'Cuti istimewa on site',
  'Cuti Extra',
  'Kelebihan Hari Kerja',
  'Ekstra Karantina',
  'Ijin',
  'Karantina Site',
  'Sakit on site',
  'Kerja Lapangan',
  'Cuti Istimewa (Hari Libur)',
  'Alpa',
  'Dinas Antar Site',
  'Dinas Luar',
  'Dinas Jabodetabek Bandara / Pelabuhan',
  'Ijin Khusus',
  'Tdk ada Transportasi',
  'Travel Perjalanan Dari Site',
  'Sakit',
  'Sisa Cuti Sebelumnya',
];

export interface LeaveType {
  id: string;
  name: string;
  description?: string;
}

export interface ManualOverride {
  employeeId: string;
  date: string;
  symbol: string;
  color?: string;
}

export interface SignupRequest {
  id: string;
  name: string;
  nik: string;
  password: string;
  photo: string; // base64
  submittedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface BoatTimeOverride {
  date: string; // yyyy-MM-dd
  time: string; // HH:mm
}

export interface CellNote {
  employeeId: string;
  date: string; // yyyy-MM-dd
  text: string;
  updatedAt: string;
}

export type BoatDay = 1 | 3 | 4 | 6; // Mon, Wed, Thu, Sat (0 is Sunday)

// ============================================================
// Document Templates & Requests (fitur "Ajukan Dokumen")
// ============================================================

export type DocumentFieldType =
  | 'text' | 'textarea' | 'date' | 'number' | 'select' | 'auto' | 'start_number' | 'employee_field' | 'timesheet_symbol' | 'jenis_ijin' | 'approval_block';

/** Role yang dibungkus oleh field bertipe 'approval_block'. */
export type ApprovalBlockRole = 'atasan_langsung' | 'dept_head';

/** Sumber auto-fill yang didukung untuk field bertipe 'auto'. */
export type DocumentAutoSource =
  | 'employee_name'
  | 'employee_nik'
  | 'employee_department'
  | 'employee_position'
  | 'employee_grade'
  | 'employee_poh'
  | 'employee_email'
  | 'employee_phone'
  | 'today_date'
  | 'today_long'
  | 'employee_cs_date'
  // ---- Form helpers (turunan dari Grading & tanggal hari ini) ----
  | 'form_grade'
  | 'form_job_grade'
  | 'form_employee_level'
  | 'form_month_long'
  // ---- Form approval (diisi otomatis dari pilihan dropdown di form) ----
  | 'form_atasan_langsung'
  | 'form_dept_head'
  // ---- Khusus SKC (di-resolve oleh SKC Bulk Generator dari Timesheet) ----
  | 'skc_tanggal_meninggalkan_site'
  | 'skc_tanggal_berangkat_ternate'
  | 'skc_tanggal_onsite'
  | 'skc_tanggal_x1'
  | 'skc_bulan_romawi'
  | 'skc_tahun'
  | 'skc_cuti_tahunan'
  | 'skc_cuti_extra'
  | 'skc_cuti_summary'
  | 'skc_jumlah_cuti_site'
  | 'skc_x1_cuti_site'
  | 'skc_cr_minus_cs'
  | 'skc_tanggal_cuti_site'
  | 'skc_tanda_tangan';

export interface DocumentTemplateField {
  /** Nama placeholder mustache di .docx (mis. "nama") */
  key: string;
  /** Label tampilan di form (mis. "Nama Karyawan") */
  label: string;
  type: DocumentFieldType;
  required?: boolean;
  defaultValue?: string;
  /** Untuk type=select */
  options?: string[];
  /** Untuk type=auto */
  autoSource?: DocumentAutoSource;
  /** Untuk type=employee_field — key field di Employee yang akan dibaca. */
  employeeField?: keyof Employee;
  /** Untuk type=timesheet_symbol — kode simbol Timesheet (mis. "Cs", "Cr", "X1") yang dicari tgl terdekatnya. */
  timesheetSymbol?: string;
  /**
   * Untuk type=approval_block — role yang dibungkus.
   * - 'atasan_langsung' → otomatis mengisi placeholder {{atasan_langsung}} (nama)
   *   dan {%ttd_atasan} (TTD PNG) dari Atasan Langsung yang dipilih di form.
   * - 'dept_head' → otomatis mengisi placeholder {{dept_head}} (nama)
   *   dan {%ttd_dept_head} (TTD PNG) dari Dept Head yang dipilih.
   */
  approvalRole?: ApprovalBlockRole;
}

export interface DocumentTemplate {
  id: string;
  name: string;
  description?: string;
  category?: string;
  /** URL relatif file .docx asli (mis. /uploads/templates/xxx.docx) */
  docxUrl: string;
  /** Nama file asli saat diupload (untuk tampilan) */
  originalFileName?: string;
  fields: DocumentTemplateField[];
  createdBy: string;       // user id
  createdByName?: string;
  createdAt: string;       // ISO
  /** Optional: butuh approval atau langsung jadi. Default true. */
  needsApproval?: boolean;
  /** True = template SKC: bulk-generated dari Settings, tanpa approval atasan. */
  isSkc?: boolean;
  /** True = template SKC Site (sub-tipe dari SKC, dibedakan untuk Bulk Download Site). */
  isSkcSite?: boolean;
  /** Daftar placeholder image ({%name}) yang terdeteksi saat upload. */
  imagePlaceholders?: string[];
}

/** Tanda tangan (PNG) yang dipakai untuk template SKC & template biasa. */
export interface Signature {
  id: string;
  /** Label / nama pemilik TTD (mis. "Pak Budi - HRD") */
  name: string;
  /** URL relatif PNG (mis. /uploads/signatures/xxx.png) */
  url: string;
  uploadedBy?: string;
  uploadedByName?: string;
  createdAt: string;
  /** Default role untuk Bulk SKC Site (penandatangan halaman belakang). */
  defaultRoles?: Array<'verif' | 'know' | 'approve'>;
  /**
   * Employee id pemilik TTD. Dipakai untuk fitur "Tanda Tangan Saya":
   *  - REGULAR/APPROVAL: hanya bisa lihat/edit TTD dengan ownerId = dirinya.
   *  - ADMIN: bisa kelola TTD karyawan di departemennya.
   *  - APPROVAL_HR/SUPERUSER: bisa kelola semua.
   * Bila kosong: TTD lama (global, dipakai untuk Bulk SKC).
   */
  ownerId?: string;
}

export type DocumentRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface DocumentRequest {
  id: string;
  templateId: string;
  templateName: string;
  employeeId: string;
  /** Snapshot nilai field saat submit */
  values: Record<string, string>;
  /** URL PDF hasil generate */
  pdfUrl?: string;
  /** URL .docx hasil isian (arsip) */
  docxUrl?: string;
  submittedAt: string;
  submittedById?: string;
  submittedByName?: string;
  status: DocumentRequestStatus;
  // ---- Approval flow (sama pola dengan LeaveRequest) ----
  directSupervisorId?: string;
  directSupervisorName?: string;
  indirectSupervisorId?: string;
  indirectSupervisorName?: string;
  directApprovedBy?: string;
  directApprovedAt?: string;
  indirectApprovedBy?: string;
  indirectApprovedAt?: string;
  hrApprovedBy?: string;
  hrApprovedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
}

export const ROSTER_CONFIG: Record<string, { work: number; leave: number }> = {
  '1': { work: 70, leave: 14 },
  'I': { work: 70, leave: 14 },
  'Golongan 1': { work: 70, leave: 14 },
  'Golongan I': { work: 70, leave: 14 },
  'Admin': { work: 70, leave: 14 },
  '2': { work: 56, leave: 14 },
  'II': { work: 56, leave: 14 },
  'Golongan 2': { work: 56, leave: 14 },
  'Golongan II': { work: 56, leave: 14 },
  '3': { work: 56, leave: 14 },
  'III': { work: 56, leave: 14 },
  'Golongan 3': { work: 56, leave: 14 },
  'Golongan III': { work: 56, leave: 14 },
  '4': { work: 49, leave: 14 },
  'IV': { work: 49, leave: 14 },
  'Golongan 4': { work: 49, leave: 14 },
  'Golongan IV': { work: 49, leave: 14 },
  '5': { work: 42, leave: 14 },
  'V': { work: 42, leave: 14 },
  'Golongan 5': { work: 42, leave: 14 },
  'Golongan V': { work: 42, leave: 14 },
  '6': { work: 42, leave: 14 },
  'VI': { work: 42, leave: 14 },
  'Golongan 6': { work: 42, leave: 14 },
  'Golongan VI': { work: 42, leave: 14 },
  '42': { work: 42, leave: 14 },
  '49': { work: 49, leave: 14 },
  '56': { work: 56, leave: 14 },
  '63': { work: 63, leave: 14 },
  '70': { work: 70, leave: 14 },
  '84': { work: 84, leave: 14 },
};

export const BOAT_SCHEDULE: BoatDay[] = [1, 3, 4, 6];

/** Default boat departure time per weekday (0=Sun..6=Sat) */
export const DEFAULT_BOAT_TIMES: Record<number, string> = {
  1: '08:00',
  3: '08:00',
  4: '08:00',
  6: '08:00',
};
