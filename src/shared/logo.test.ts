import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  FAKTUR_LOGO,
  MonoBitmapSchema,
  rasterizeLogo,
  readBitmap,
  type RgbaImage,
  STRUK_LOGO,
} from './logo';

/** White canvas with a black filled rectangle [x0,x1)×[y0,y1). */
function picture(w: number, h: number, rect: [number, number, number, number], alpha = 255): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = rect[1]; y < rect[3]; y++)
    for (let x = rect[0]; x < rect[2]; x++) {
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
      data[i + 3] = alpha;
    }
  return { width: w, height: h, data };
}

const count = (b: NonNullable<ReturnType<typeof rasterizeLogo>>) => {
  const dot = readBitmap(b);
  let n = 0;
  for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) if (dot(x, y)) n++;
  return n;
};

describe('logo bitmaps', () => {
  it('round-trips base64', () => {
    const bytes = Uint8Array.from([0, 1, 127, 128, 255]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it('returns null for a blank picture (also fully transparent)', () => {
    expect(rasterizeLogo(picture(20, 20, [0, 0, 0, 0]), STRUK_LOGO)).toBeNull();
    expect(rasterizeLogo(picture(20, 20, [0, 0, 20, 20], 0), STRUK_LOGO)).toBeNull();
  });

  it('faktur: always the full 10-column × 5-line box, square picture stays square on paper', () => {
    // Square ink with a wide white margin: the margin is trimmed, the square fills the box height.
    const b = rasterizeLogo(picture(300, 200, [100, 50, 200, 150]), FAKTUR_LOGO)!;
    expect(b.width).toBe(100);
    expect(b.height).toBe(60);
    expect(MonoBitmapSchema.safeParse(b).success).toBe(true);
    // 0.833" square: 100 dots across at 120 dpi × 60 dots down at 72 dpi → everything black.
    expect(count(b)).toBe(100 * 60);
  });

  it('faktur: a wide picture is centered vertically with white above and below', () => {
    const b = rasterizeLogo(picture(400, 100, [0, 0, 400, 100]), FAKTUR_LOGO)!;
    const dot = readBitmap(b);
    expect(dot(50, 0)).toBe(false);
    expect(dot(50, 30)).toBe(true);
    expect(dot(50, 59)).toBe(false);
  });

  it('struk: cropped to the picture, inside 240 × 120 dots, square dots', () => {
    const b = rasterizeLogo(picture(500, 500, [0, 0, 500, 500]), STRUK_LOGO)!;
    expect(b.height).toBe(120);
    expect(b.width).toBe(120);
    expect(count(b)).toBe(120 * 120);
  });

  it('threshold decides how dark grey must be to print', () => {
    const grey = picture(10, 10, [0, 0, 10, 10]);
    for (let i = 0; i < grey.data.length; i += 4) grey.data[i] = grey.data[i + 1] = grey.data[i + 2] = 150;
    expect(count(rasterizeLogo(grey, STRUK_LOGO, 128)!)).toBe(0);
    expect(count(rasterizeLogo(grey, STRUK_LOGO, 200)!)).toBeGreaterThan(0);
  });

  it('rejects a bitmap whose data does not match its size', () => {
    expect(MonoBitmapSchema.safeParse({ width: 16, height: 2, data: bytesToBase64(new Uint8Array(3)) }).success).toBe(
      false,
    );
  });
});
