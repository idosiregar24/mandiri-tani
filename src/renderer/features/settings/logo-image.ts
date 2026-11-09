// Browser-side picture handling for the store logo: shrink the upload, read its pixels for
// rasterizeLogo (@shared/logo). Canvas only — nothing leaves this machine except the PNG.
import type { RgbaImage } from '@shared/logo';

/** Longest side kept from an upload: plenty for a 30 mm logo, small enough for the settings row. */
const MAX_SIDE = 600;
/** Upload limit before shrinking. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Upload (PNG/JPG/WEBP/BMP) → PNG data URL at most MAX_SIDE px, transparency kept. */
export async function shrinkToPng(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas tidak tersedia.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL('image/png');
  } finally {
    bitmap.close();
  }
}

/** PNG data URL → RGBA pixels. */
export function readPixels(dataUrl: string): Promise<RgbaImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        reject(new Error('Canvas tidak tersedia.'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resolve({ width: data.width, height: data.height, data: data.data });
    };
    img.onerror = () => reject(new Error('Gambar logo tidak bisa dibaca.'));
    img.src = dataUrl;
  });
}
