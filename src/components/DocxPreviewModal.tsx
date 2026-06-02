import React, { useEffect, useRef, useState } from 'react';
import { X, Download, Loader2 } from 'lucide-react';
import { renderAsync } from 'docx-preview';

interface Props {
  open: boolean;
  url?: string;
  title?: string;
  onClose: () => void;
}

export default function DocxPreviewModal({ open, url, title, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !url || !containerRef.current) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    containerRef.current.innerHTML = '';
    (async () => {
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled || !containerRef.current) return;
        await renderAsync(blob, containerRef.current, undefined, {
          className: 'docx-preview',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
        });
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, url]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-bold text-gray-900 truncate">{title || 'Preview Dokumen'}</h3>
          <div className="flex items-center gap-2">
            {url && (
              <a href={url} download
                className="text-[11px] font-bold inline-flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">
                <Download size={12} /> Download
              </a>
            )}
            <button onClick={onClose}
              className="text-gray-500 hover:text-gray-900 p-1.5 rounded-lg hover:bg-gray-200">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-gray-100 p-4">
          {loading && (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm gap-2">
              <Loader2 size={18} className="animate-spin" /> Memuat preview…
            </div>
          )}
          {err && !loading && (
            <div className="text-center text-red-600 text-sm font-bold p-8">
              Gagal memuat: {err}
            </div>
          )}
          <div ref={containerRef} className="docx-preview-container mx-auto" />
        </div>
      </div>
    </div>
  );
}
