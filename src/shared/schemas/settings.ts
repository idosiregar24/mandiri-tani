// Store-wide settings, one Zod schema per settings.key (sprint-2 S2-8).
import { MonoBitmapSchema } from '../logo';
import { OptionalText, RequiredText, z } from './common';
import { OwnerAccountInput } from './users';

/** settings.store — printed on every receipt/faktur header (FR-SYS-01). */
export const StoreSettings = z.object({
  name: RequiredText('Nama toko', 100),
  address: OptionalText(300),
  phone: OptionalText(50),
  fax: OptionalText(50).default(null),
  email: OptionalText(100).default(null),
  receiptFooter: OptionalText(500).default(null),
});
export type StoreSettings = z.infer<typeof StoreSettings>;

/** settings.pos — cashier limits (PRD §4.2: discount up to the limit without Owner PIN). */
export const PosSettings = z.object({
  cashierDiscountLimitPercent: z.coerce
    .number({ message: 'Isi angka persen.' })
    .min(0, 'Minimal 0%.')
    .max(100, 'Maksimal 100%.')
    .default(5),
});
export type PosSettings = z.infer<typeof PosSettings>;

/**
 * settings.logo — store logo on the faktur (LX-310) and struk (thermal) header. Kept out of
 * SETTINGS_SCHEMAS: it has its own routes so the picture is not copied into audit_logs.
 * The renderer turns the picture into the two printer bitmaps when the Owner saves it.
 */
export const LogoSettings = z
  .object({
    /** The uploaded picture, already shrunk by the renderer (PNG data URL). */
    image: z
      .string()
      .max(1_400_000, 'Ukuran logo terlalu besar. Pakai gambar yang lebih kecil.')
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'Logo harus berupa gambar PNG.')
      .nullable()
      .default(null),
    /** 1–254: darker than this becomes a printed dot. */
    threshold: z.number().int().min(1).max(254).default(128),
    printOnFaktur: z.boolean().default(true),
    printOnStruk: z.boolean().default(true),
    faktur: MonoBitmapSchema.nullable().default(null),
    struk: MonoBitmapSchema.nullable().default(null),
  })
  .refine((v) => v.image !== null || (v.faktur === null && v.struk === null), {
    message: 'Logo dihapus, tapi data cetaknya masih ada.',
  })
  .refine((v) => v.image === null || (v.faktur !== null && v.struk !== null), {
    message: 'Logo kosong (seluruhnya putih). Pilih gambar lain.',
  });
export type LogoSettings = z.infer<typeof LogoSettings>;

export const SETTINGS_SCHEMAS = { store: StoreSettings, pos: PosSettings } as const;
export type SettingsKey = keyof typeof SETTINGS_SCHEMAS;
export const SETTINGS_KEYS = Object.keys(SETTINGS_SCHEMAS) as SettingsKey[];

/** POST /setup — the first-run wizard in one request (FR-SYS-01). */
export const SetupInput = z.object({
  store: StoreSettings,
  owner: OwnerAccountInput,
  warehouseName: RequiredText('Nama gudang', 100),
});
export type SetupInput = z.infer<typeof SetupInput>;

export interface SetupStatus {
  needsSetup: boolean;
  /** The default warehouse the wizard names (UTM is created by migration 0002). */
  warehouse: { code: string; name: string } | null;
}
