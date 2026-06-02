// Recover dari "Importing a module script failed" / "Failed to fetch
// dynamically imported module". Penyebab umum: build baru dideploy, browser
// di device lain masih pegang HTML lama yang merefer ke hash chunk lama.
// Solusi: retry sekali, lalu hard-reload halaman (sekali saja, dijaga
// sessionStorage supaya tidak loop).
import { lazy, type ComponentType } from 'react';

const RELOAD_FLAG = '__chunk_reload_attempted__';

function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return (
    /Importing a module script failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Loading chunk [\w-]+ failed/i.test(msg) ||
    /ChunkLoadError/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  );
}

function triggerReload(): void {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return; // sudah pernah, jangan loop
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch { /* ignore */ }
  // Bust cache: tambah query param random agar HTML & chunk di-fetch ulang.
  const u = new URL(window.location.href);
  u.searchParams.set('_r', Date.now().toString(36));
  window.location.replace(u.toString());
}

/** Wrap React.lazy: retry sekali sebelum reload. */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): ReturnType<typeof lazy<T>> {
  return lazy(async () => {
    try {
      return await factory();
    } catch (e) {
      if (!isChunkLoadError(e)) throw e;
      try {
        // Beri sedikit waktu (jaringan blip) lalu coba lagi.
        await new Promise((r) => setTimeout(r, 400));
        return await factory();
      } catch (e2) {
        if (isChunkLoadError(e2)) triggerReload();
        throw e2;
      }
    }
  });
}

/** Pasang global listener: tangkap dynamic import yang fail di luar React.lazy
 *  (mis. jspdf, pdf-lib, jszip yang di-load on-demand dari skcGenerator). */
let installed = false;
export function installChunkReloadHandler(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // Reset flag setelah halaman berhasil load penuh selama 10 detik,
  // supaya kalau nanti chunk lain fail, masih bisa reload sekali lagi.
  setTimeout(() => {
    try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* ignore */ }
  }, 10_000);

  window.addEventListener('error', (ev) => {
    if (isChunkLoadError(ev.error || ev.message)) {
      ev.preventDefault();
      triggerReload();
    }
  });
  window.addEventListener('unhandledrejection', (ev) => {
    if (isChunkLoadError(ev.reason)) {
      ev.preventDefault();
      triggerReload();
    }
  });
}