// A printer bitmap (1 bit per dot, @shared/logo) drawn on a canvas. The caller sets the
// on-screen size, so non-square printer dots (LX-310) still look like the printout.
import { type CSSProperties, useEffect, useRef } from 'react';
import { type MonoBitmap, readBitmap } from '@shared/logo';
import { cn } from '@/lib/utils';

interface MonoBitmapCanvasProps {
  bitmap: MonoBitmap;
  /** CSS width/height of the printed area, e.g. { width: '10ch', height: '10ch' }. */
  style: Pick<CSSProperties, 'width' | 'height'> & CSSProperties;
  className?: string;
}

export function MonoBitmapCanvas({ bitmap, style, className }: MonoBitmapCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(bitmap.width, bitmap.height);
    const dot = readBitmap(bitmap);
    for (let y = 0; y < bitmap.height; y++) {
      for (let x = 0; x < bitmap.width; x++) {
        if (!dot(x, y)) continue;
        const i = (y * bitmap.width + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 24; // printer ink; white stays transparent
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [bitmap]);
  return (
    <canvas
      ref={ref}
      width={bitmap.width}
      height={bitmap.height}
      aria-hidden
      className={cn('block', className)}
      style={{ imageRendering: 'pixelated', ...style }}
    />
  );
}
