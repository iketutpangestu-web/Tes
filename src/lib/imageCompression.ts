export async function compressImageToDataUrl(
  file: File,
  options: { maxWidth?: number; maxHeight?: number; quality?: number } = {},
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('File harus berupa gambar.');
  }

  const maxWidth = options.maxWidth ?? 1280;
  const maxHeight = options.maxHeight ?? 1280;
  const quality = options.quality ?? 0.72;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Browser tidak bisa memproses gambar.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  return canvas.toDataURL('image/jpeg', quality);
}