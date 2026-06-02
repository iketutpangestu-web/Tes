import React, { useEffect, useState } from 'react';
import { X, Download, ZoomIn, ZoomOut } from 'lucide-react';

type Props = {
  src: string;
  alt?: string;
  filename?: string;
  onClose: () => void;
};

export default function ImageViewer({ src, alt = 'image', filename, onClose }: Props) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const handleDownload = async () => {
    try {
      let url = src;
      let revoke: string | null = null;
      if (!src.startsWith('blob:') && !src.startsWith('data:')) {
        const res = await fetch(src);
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        revoke = url;
      }
      const a = document.createElement('a');
      a.href = url;
      const ext = (() => {
        if (src.startsWith('data:')) {
          const m = src.match(/^data:image\/([a-zA-Z0-9]+)/);
          return m ? m[1] : 'png';
        }
        const m = src.split('?')[0].match(/\.([a-zA-Z0-9]+)$/);
        return m ? m[1] : 'png';
      })();
      a.download = filename || `lampiran-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (revoke) setTimeout(() => URL.revokeObjectURL(revoke!), 1000);
    } catch (e) {
      console.error('download failed', e);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/90 z-[100] flex flex-col"
      onClick={onClose}
    >
      <div
        className="flex justify-between items-center p-3 gap-2 bg-black/60 border-b border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-white/80 text-xs font-bold truncate">{filename || alt}</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white"
            title="Zoom out"
          >
            <ZoomOut size={16} />
          </button>
          <span className="text-white/70 text-xs font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(5, z + 0.25))}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white"
            title="Zoom in"
          >
            <ZoomIn size={16} />
          </button>
          <button
            onClick={handleDownload}
            className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1"
          >
            <Download size={14} /> Download
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white"
            title="Tutup"
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto flex items-center justify-center p-4" onClick={onClose}>
        <img
          src={src}
          alt={alt}
          onClick={(e) => e.stopPropagation()}
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
          className="max-w-full max-h-full object-contain rounded-lg shadow-2xl transition-transform cursor-zoom-in"
        />
      </div>
    </div>
  );
}
