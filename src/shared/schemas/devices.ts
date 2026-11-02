import { RequiredText, z } from './common';

export const DEVICE_KINDS = ['HUB', 'TERMINAL', 'MOBILE'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export interface DeviceItem {
  id: string;
  code: string;
  name: string;
  kind: DeviceKind;
  appVersion: string | null;
  pairedAt: string | null;
  lastSeenAt: string | null;
  lastClockSkewMs: number | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PairingCodeInput = z.object({
  kind: z.enum(['TERMINAL', 'MOBILE']).default('MOBILE'),
});
export type PairingCodeInput = z.infer<typeof PairingCodeInput>;

export interface PairingCodeResult {
  code: string;
  expiresAt: string;
  hubUrl: string;
  qrData: string;
}

export const PairDeviceInput = z.object({
  code: z.string().trim().length(6, 'Kode pairing harus 6 digit angka.'),
  deviceName: RequiredText('Nama perangkat', 100),
  kind: z.enum(['TERMINAL', 'MOBILE']),
  appVersion: z.string().trim().max(50).optional(),
  deviceTime: z.string().datetime().optional(),
});
export type PairDeviceInput = z.infer<typeof PairDeviceInput>;

export interface PairDeviceResult {
  deviceId: string;
  deviceCode: string;
  token: string;
  hubUrl: string;
  serverTime: string;
}

export interface NetworkInfo {
  serverTime: string;
  port: number;
  localIps: string[];
  primaryHubUrl: string;
}

