// Sync layer: bridge antara state lokal dan server Express (offline LAN mode).
//
// Cara kerja:
//   1. App boot dari cache localStorage (cepat & tetap jalan kalau server mati).
//   2. initServer() dipanggil sekali: cek /api/health, kalau hidup -> tarik
//      semua key dari /api/data + user session, lalu callback pakai data server.
//   3. Setiap state berubah, AppContext memanggil serverStore.setItem(...) yang
//      menulis ke localStorage *dan* PUT ke /api/data/:key (debounced 300ms).
//   4. Auth (login/logout) wajib lewat server kalau serverMode aktif.
//
// Saat dipakai di Lovable preview (tanpa server Express), serverMode = false dan
// semuanya jatuh ke localStorage seperti aplikasi versi lama.

export const SYNC_KEYS = [
  'mineroster_employees',
  'mineroster_accounts',
  'mineroster_leaves',
  'mineroster_symbols',
  'mineroster_leavetypes',
  'mineroster_signups',
  'mineroster_boatoverrides',
  'mineroster_overrides',
  'mineroster_autocalc',
  'fluksite_doc_templates',
  'fluksite_doc_requests',
  'fluksite_signatures',
] as const;

export type SyncKey = typeof SYNC_KEYS[number];

let serverMode = false;
const pending: Record<string, unknown> = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;
// Cache value JSON terakhir per key — supaya kita tidak (a) menulis berulang
// hal yang sama ke server, dan (b) menerapkan ulang data dari server kalau
// belum berubah (mencegah re-render loop saat polling).
const lastSyncedJson: Record<string, string> = {};

export function isServerMode(): boolean {
  return serverMode;
}

/** Coba kontak server. Return data dari server kalau hidup, atau null kalau offline. */
export async function initServer(): Promise<{
  user: any | null;
  data: Record<string, any>;
} | null> {
  try {
    const health = await fetch('/api/health', { credentials: 'include' });
    if (!health.ok) return null;
    serverMode = true;

    const meReq = fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.json());
    const dataReq = fetch('/api/data?keys=' + SYNC_KEYS.join(','), {
      credentials: 'include',
    }).then((r) => r.json());

    const [me, data] = await Promise.all([meReq, dataReq]);
    const dataMap = data?.data ?? {};
    // Seed lastSyncedJson supaya useEffect tidak langsung re-PUT data yang baru saja di-fetch.
    for (const key of SYNC_KEYS) {
      if (key in dataMap) lastSyncedJson[key] = JSON.stringify(dataMap[key]);
    }
    return {
      user: me?.user ?? null,
      data: dataMap,
    };
  } catch {
    serverMode = false;
    return null;
  }
}

/** Set value: tulis ke localStorage, dan kalau serverMode aktif sync ke server. */
export function setItem(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* quota */ }
  if (!serverMode) return;
  if (lastSyncedJson[key] === value) return; // tidak ada perubahan
  lastSyncedJson[key] = value;
  let parsed: unknown = value;
  try { parsed = JSON.parse(value); } catch { /* string biasa, mis. '1' atau '0' */ }
  pending[key] = parsed;
  schedule();
}

/**
 * Polling: ambil semua key dari server. Untuk tiap key yang BERUBAH dari
 * snapshot lokal terakhir, panggil onChange(key, parsedValue). Dipakai
 * AppContext untuk menerapkan perubahan dari device lain near-realtime.
 */
export async function pollServer(
  onChange: (key: string, value: unknown) => void,
): Promise<void> {
  if (!serverMode) return;
  try {
    const r = await fetch('/api/data?keys=' + SYNC_KEYS.join(','), {
      credentials: 'include',
    });
    if (!r.ok) return;
    const { data } = await r.json();
    for (const key of SYNC_KEYS) {
      if (!(key in (data || {}))) continue;
      const v = data[key];
      const json = JSON.stringify(v);
      if (lastSyncedJson[key] === json) continue;
      lastSyncedJson[key] = json;
      try { localStorage.setItem(key, json); } catch { /* ignore */ }
      onChange(key, v);
    }
  } catch { /* offline blip */ }
}


/** Ambil satu key langsung dari server (bypass cache). Return null kalau offline / gagal. */
export async function fetchKey<T = unknown>(key: SyncKey): Promise<T | null> {
  if (!serverMode) return null;
  try {
    const r = await fetch('/api/data?keys=' + encodeURIComponent(key), {
      credentials: 'include',
    });
    if (!r.ok) return null;
    const { data } = await r.json();
    if (!data || !(key in data)) return null;
    const v = data[key];
    lastSyncedJson[key] = JSON.stringify(v);
    try { localStorage.setItem(key, lastSyncedJson[key]); } catch { /* ignore */ }
    return v as T;
  } catch {
    return null;
  }
}

/** Ambil daftar NIK+nama karyawan untuk form daftar (public, tanpa login). */
export async function fetchSignupEmployees<T = unknown>(): Promise<T[] | null> {
  try {
    const r = await fetch('/api/signup/employees');
    if (!r.ok) return null;
    const { employees } = await r.json();
    return Array.isArray(employees) ? employees as T[] : [];
  } catch {
    return null;
  }
}

export function getItem(key: string): string | null {
  return localStorage.getItem(key);
}

export function removeItem(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
  if (!serverMode) return;
  fetch(`/api/data/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    credentials: 'include',
  }).catch((e) => console.warn('[sync] delete gagal', key, e));
}

function schedule(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 300);
}

async function flush(): Promise<void> {
  flushTimer = null;
  const batch = { ...pending };
  for (const k of Object.keys(batch)) delete pending[k];
  await Promise.all(
    Object.entries(batch).map(([key, value]) =>
      fetch(`/api/data/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ value }),
      }).catch((e) => console.warn('[sync] PUT gagal', key, e)),
    ),
  );
}

/** Submit signup request via endpoint public (tidak butuh login). */
export async function submitSignupApi(payload: {
  name: string; nik: string; password: string; photo?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!serverMode) return { ok: false, error: 'offline' };
  try {
    const r = await fetch('/api/signups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (r.ok) return { ok: true };
    const j = await r.json().catch(() => ({}));
    return { ok: false, error: j.error || `http_${r.status}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ---------------- Uploads ----------------

/**
 * Upload file fisik ke server. Return URL relatif (mis. '/uploads/2026/05/abc.pdf')
 * untuk disimpan di JSON, atau null kalau gagal / offline.
 * `mode: 'public'` dipakai untuk foto signup (tanpa login), 'auth' untuk user yang sudah login.
 */
export async function uploadFile(
  file: File | Blob,
  opts: { mode?: 'auth' | 'public'; filename?: string } = {},
): Promise<string | null> {
  if (!serverMode) return null;
  try {
    const fd = new FormData();
    const name = opts.filename || (file as File).name || 'file';
    fd.append('file', file, name);
    const endpoint = opts.mode === 'public' ? '/api/uploads/public' : '/api/uploads';
    const r = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    if (!r.ok) return null;
    const { url } = await r.json();
    return typeof url === 'string' ? url : null;
  } catch {
    return null;
  }
}

// ---------------- Document templates ----------------

/** Upload template .docx. */
export type UploadDocxResult =
  | { ok: true; url: string; fileName: string; placeholders: string[]; textPlaceholders: string[]; imagePlaceholders: string[] }
  | { ok: false; status: number; error: string };

export async function uploadDocxTemplate(file: File): Promise<UploadDocxResult> {
  if (!serverMode) {
    return { ok: false, status: 0, error: 'Server offline (mode lokal). Hidupkan PC server.' };
  }
  try {
    const fd = new FormData();
    fd.append('file', file, file.name);
    const r = await fetch('/api/document-templates/upload', {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    if (!r.ok) {
      let msg = '';
      try {
        const j = await r.json();
        msg = String(j.error || j.message || JSON.stringify(j));
      } catch {
        try { msg = await r.text(); } catch { /* ignore */ }
      }
      return { ok: false, status: r.status, error: msg || `HTTP ${r.status}` };
    }
    const j = await r.json();
    return {
      ok: true,
      url: String(j.url),
      fileName: String(j.fileName || file.name),
      placeholders: Array.isArray(j.placeholders) ? j.placeholders : [],
      textPlaceholders: Array.isArray(j.textPlaceholders) ? j.textPlaceholders : (Array.isArray(j.placeholders) ? j.placeholders : []),
      imagePlaceholders: Array.isArray(j.imagePlaceholders) ? j.imagePlaceholders : [],
    };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<{ response: Response; json: Record<string, unknown> }> {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const json = await response.json().catch(() => ({}));
    return { response, json };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError' && !timedOut) {
      throw new Error('cancelled');
    }
    throw e;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Render template (default DOCX — cepat, tanpa LibreOffice).
 * Set opts.format='pdf' bila perlu PDF (LibreOffice di server harus ada).
 * opts.images: map placeholder gambar → URL PNG di /uploads/signatures/...
 */
export async function renderDocxTemplate(
  templateUrl: string,
  values: Record<string, string>,
  opts: { format?: 'pdf' | 'docx'; images?: Record<string, string> } = {},
): Promise<{ pdfUrl?: string; docxUrl?: string; error?: string; message?: string }> {
  if (!serverMode) return { error: 'offline' };
  try {
    const format = opts.format === 'pdf' ? 'pdf' : 'docx';
    const r = await fetch('/api/document-templates/render', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateUrl, values, images: opts.images || {}, format }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return {
        error: String(j.error || `http_${r.status}`),
        message: j.message ? String(j.message) : undefined,
        docxUrl: j.docxUrl ? String(j.docxUrl) : undefined,
      };
    }
    return {
      pdfUrl: j.pdfUrl ? String(j.pdfUrl) : undefined,
      docxUrl: j.docxUrl ? String(j.docxUrl) : undefined,
    };
  } catch (e) {
    return { error: 'network', message: String(e) };
  }
}

/** Render template SKC dengan PNG TTD disisipkan. */
export async function renderSkcDocxTemplate(
  templateUrl: string,
  values: Record<string, string>,
  images: Record<string, string>,
  opts: { signal?: AbortSignal; format?: 'pdf' | 'docx' } = {},
): Promise<{ pdfUrl?: string; docxUrl?: string; error?: string; message?: string }> {
  if (!serverMode) return { error: 'offline' };
  try {
    const format = opts.format === 'docx' ? 'docx' : 'pdf';
    const timeoutMs = format === 'docx' ? 60_000 : 300_000;
    const { response: r, json: j } = await fetchJsonWithTimeout('/api/document-templates/render-skc', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateUrl, values, images, format }),
    }, timeoutMs, opts.signal);
    if (!r.ok) {
      return {
        error: String(j.error || `http_${r.status}`),
        message: j.message ? String(j.message) : undefined,
        docxUrl: j.docxUrl ? String(j.docxUrl) : undefined,
      };
    }
    return { pdfUrl: j.pdfUrl ? String(j.pdfUrl) : undefined, docxUrl: j.docxUrl ? String(j.docxUrl) : undefined };
  } catch (e) {
    if (e instanceof Error && e.message === 'cancelled') {
      return { error: 'cancelled', message: 'Proses dihentikan oleh pengguna.' };
    }
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { error: 'timeout', message: 'Render SKC terlalu lama. Coba pakai format DOCX (cepat) atau cek server LibreOffice.' };
    }
    return { error: 'network', message: String(e) };
  }
}

/** Upload PNG TTD. Return URL relatif atau null. */
export async function uploadSignaturePng(file: File): Promise<string | null> {
  if (!serverMode) return null;
  try {
    const fd = new FormData();
    fd.append('file', file, file.name);
    const r = await fetch('/api/signatures', {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    if (!r.ok) return null;
    const { url } = await r.json();
    return typeof url === 'string' ? url : null;
  } catch {
    return null;
  }
}

// ---------------- Auth ----------------

export async function loginApi(email: string, password: string): Promise<any | null> {
  if (!serverMode) return null;
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) return null;
    const { user } = await r.json();
    return user;
  } catch {
    return null;
  }
}

export async function logoutApi(): Promise<void> {
  if (!serverMode) return;
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch { /* ignore */ }
}

/** Daftar user dari server (untuk SUPERUSER mengelola akun). */
export async function fetchUsersApi(): Promise<any[] | null> {
  if (!serverMode) return null;
  try {
    const r = await fetch('/api/users', { credentials: 'include' });
    if (!r.ok) return null;
    const { users } = await r.json();
    return users;
  } catch {
    return null;
  }
}

/** Upsert user (approve signup, ubah role, dll). */
export async function upsertUserApi(payload: {
  id: string;
  email: string;
  name: string;
  nik?: string;
  role?: string;
  password?: string;
  profile?: Record<string, unknown>;
}): Promise<boolean> {
  if (!serverMode) return false;
  try {
    const r = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function deleteUserApi(id: string): Promise<boolean> {
  if (!serverMode) return false;
  try {
    const r = await fetch(`/api/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function changePasswordApi(userId: string, newPassword: string): Promise<boolean> {
  if (!serverMode) return false;
  try {
    const r = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ userId, newPassword }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function verifySuperuserPasswordApi(password: string): Promise<boolean> {
  if (!serverMode) return false;
  try {
    const r = await fetch('/api/auth/verify-superuser', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password }),
    });
    if (!r.ok) return false;
    const { ok } = await r.json();
    return !!ok;
  } catch {
    return false;
  }
}
