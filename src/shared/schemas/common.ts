// Building blocks shared by every Zod schema — the same schema validates the server
// request and the renderer form (frontend-standards §4).
import { z } from 'zod';
import { dec, isDecimalString } from '../money';

// Indonesian default messages; important fields still get their own wording.
z.config(z.locales.id());

export { z };

export const Uuid = z.uuid({ message: 'ID tidak valid.' });

/** Optional free text: trimmed, '' → null. */
export const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Maksimal ${max} huruf.`)
    .nullish()
    .transform((v) => (v ? v : null));

export const RequiredText = (label: string, max: number) =>
  z.string().trim().min(1, `${label} wajib diisi.`).max(max, `${label} maksimal ${max} huruf.`);

/** Short codes (UTM, ZAK, PL0001): upper-cased, no spaces at the ends. */
export const Code = (label: string, max = 30) =>
  z
    .string()
    .trim()
    .min(1, `${label} wajib diisi.`)
    .max(max, `${label} maksimal ${max} huruf.`)
    .transform((v) => v.toUpperCase());

/** Money as a decimal string ≥ 0 with at most 2 decimals ("150000", "150000.50"). */
export const Money = z
  .string()
  .trim()
  .refine((v) => isDecimalString(v) && !v.startsWith('-'), 'Isi angka rupiah yang benar (tanpa titik ribuan).')
  .refine((v) => (v.split('.')[1]?.length ?? 0) <= 2, 'Maksimal 2 angka di belakang koma.');

/** Quantity / conversion as a decimal string (up to 4 decimals). */
export const Qty = z
  .string()
  .trim()
  .refine((v) => isDecimalString(v), 'Isi angka yang benar.');

export const PositiveQty = Qty.refine((v) => isDecimalString(v) && dec(v).gt(0), 'Harus lebih dari 0.');
export const NonNegativeQty = Qty.refine((v) => isDecimalString(v) && dec(v).gte(0), 'Tidak boleh minus.');

export const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ListQuery = z.infer<typeof ListQuery>;

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}
