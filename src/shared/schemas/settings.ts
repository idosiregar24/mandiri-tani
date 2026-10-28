// Store-wide settings, one Zod schema per settings.key (sprint-2 S2-8).
import { OptionalText, RequiredText, z } from './common';
import { OwnerAccountInput } from './users';

/** settings.store — printed on every receipt/faktur header (FR-SYS-01). */
export const StoreSettings = z.object({
  name: RequiredText('Nama toko', 100),
  address: OptionalText(300),
  phone: OptionalText(50),
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
