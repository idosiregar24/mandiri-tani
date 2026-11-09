// Store logo on printed documents (FR-SYS-01): one uploaded picture → a 1-bit bitmap per printer
// role. Pure functions only — the renderer feeds canvas pixels in, main encodes the bitmap as
// ESC/P bit image (LX-310) or ESC/POS raster (thermal). No printer language knowledge here.
import { z } from 'zod';

/** 1 bit per dot, row-major, MSB = leftmost dot, rows padded to whole bytes; 1 = black. */
export interface MonoBitmap {
  width: number;
  height: number;
  /** base64 of ceil(width / 8) × height bytes. */
  data: string;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const rowBytes = (width: number) => Math.ceil(width / 8);

export const MonoBitmapSchema = z
  .object({
    width: z.number().int().min(1).max(576),
    height: z.number().int().min(1).max(255),
    data: z.string().max(30_000),
  })
  .refine(
    (b) => {
      try {
        return base64ToBytes(b.data).length === rowBytes(b.width) * b.height;
      } catch {
        return false;
      }
    },
    { message: 'Data gambar logo rusak.' },
  );

/** Unpacked view of a bitmap: `dot(x, y)` is true for black; outside the bitmap is white. */
export function readBitmap(b: MonoBitmap): (x: number, y: number) => boolean {
  const bytes = base64ToBytes(b.data);
  const stride = rowBytes(b.width);
  return (x, y) =>
    x >= 0 && y >= 0 && x < b.width && y < b.height && (bytes[y * stride + (x >> 3)]! & (0x80 >> (x & 7))) !== 0;
}

/**
 * Where a logo goes on a printer. Dots per inch differ per axis on the LX-310 (ESC * 1 = 120 dpi
 * across, 9-pin head = 72 dpi down), so the picture is fitted by physical size, not by pixels.
 */
export interface LogoTarget {
  boxWidth: number;
  boxHeight: number;
  dpiX: number;
  dpiY: number;
  /** true: output is exactly the box (picture centered in it); false: cropped to the picture. */
  fill: boolean;
}

/** Faktur header: the logo takes the first LOGO_COLUMNS characters of LOGO_LINES header lines. */
export const LOGO_COLUMNS = 10;
export const LOGO_LINES = 5;
/** 12 cpi → one character = 10 dots at 120 dpi; 6 lpi → one line = 12 dots at 72 dpi. */
export const FAKTUR_DOTS_PER_COLUMN = 10;
export const FAKTUR_DOTS_PER_LINE = 12;

export const FAKTUR_LOGO: LogoTarget = {
  boxWidth: LOGO_COLUMNS * FAKTUR_DOTS_PER_COLUMN,
  boxHeight: LOGO_LINES * FAKTUR_DOTS_PER_LINE,
  dpiX: 120,
  dpiY: 72,
  fill: true,
};

/** Thermal 203 dpi: at most 30 × 15 mm, centered above the store name (fits 58 and 80 mm paper). */
export const STRUK_LOGO: LogoTarget = { boxWidth: 240, boxHeight: 120, dpiX: 203, dpiY: 203, fill: false };

export interface RgbaImage {
  width: number;
  height: number;
  /** 4 bytes per pixel (canvas ImageData layout). */
  data: Uint8ClampedArray | Uint8Array;
}

/** Brightness 0 (black) … 255 (white) with transparency shown as white paper. */
function paperLuma(img: RgbaImage, x: number, y: number): number {
  const i = (y * img.width + x) * 4;
  const d = img.data;
  const luma = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
  const a = d[i + 3]! / 255;
  return 255 - a * (255 - luma);
}

/** Bounding box of everything that is not (almost) white paper; null for a blank picture. */
function inkBounds(img: RgbaImage): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (paperLuma(img, x, y) < 245) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * Picture → printer bitmap: trims the white margin, fits it in the target box keeping its
 * real proportions, averages the source pixels under each dot and turns them black when darker
 * than `threshold` (1–254, higher = more black). Returns null when the picture is blank.
 */
export function rasterizeLogo(img: RgbaImage, target: LogoTarget, threshold = 128): MonoBitmap | null {
  const ink = inkBounds(img);
  if (!ink) return null;
  const cw = ink.x1 - ink.x0;
  const ch = ink.y1 - ink.y0;
  // Inches per source pixel so the picture fits the box on paper.
  const s = Math.min(target.boxWidth / target.dpiX / cw, target.boxHeight / target.dpiY / ch);
  const dw = Math.max(1, Math.min(target.boxWidth, Math.round(cw * s * target.dpiX)));
  const dh = Math.max(1, Math.min(target.boxHeight, Math.round(ch * s * target.dpiY)));
  const outW = target.fill ? target.boxWidth : dw;
  const outH = target.fill ? target.boxHeight : dh;
  const ox = Math.floor((outW - dw) / 2);
  const oy = Math.floor((outH - dh) / 2);

  const stride = rowBytes(outW);
  const bytes = new Uint8Array(stride * outH);
  for (let y = 0; y < dh; y++) {
    const sy0 = ink.y0 + Math.floor((y * ch) / dh);
    const sy1 = Math.max(sy0 + 1, ink.y0 + Math.ceil(((y + 1) * ch) / dh));
    for (let x = 0; x < dw; x++) {
      const sx0 = ink.x0 + Math.floor((x * cw) / dw);
      const sx1 = Math.max(sx0 + 1, ink.x0 + Math.ceil(((x + 1) * cw) / dw));
      let sum = 0;
      for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) sum += paperLuma(img, xx, yy);
      if (sum / ((sy1 - sy0) * (sx1 - sx0)) < threshold) {
        const px = x + ox;
        const at = (y + oy) * stride + (px >> 3);
        bytes[at] = bytes[at]! | (0x80 >> (px & 7));
      }
    }
  }
  return { width: outW, height: outH, data: bytesToBase64(bytes) };
}

/** What the receipt builders get: only the bitmaps the Owner chose to print. */
export interface ReceiptLogo {
  faktur: MonoBitmap | null;
  struk: MonoBitmap | null;
}
