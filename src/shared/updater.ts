// Shared types and schemas for the desktop updater (electron-updater + GitHub Releases).
import { z } from 'zod';

export type UpdaterState =
  | 'IDLE'
  | 'CHECKING'
  | 'AVAILABLE'
  | 'NOT_AVAILABLE'
  | 'DOWNLOADING'
  | 'DOWNLOADED'
  | 'ERROR';

export interface UpdateReleaseInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

export interface UpdateProgressInfo {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdaterStatus {
  state: UpdaterState;
  currentVersion: string;
  availableVersion?: string;
  releaseNotes?: string;
  releaseDate?: string;
  progress?: UpdateProgressInfo;
  error?: string;
  lastCheckedAt?: string;
}

export const CheckUpdateResultSchema = z.object({
  hasUpdate: z.boolean(),
  version: z.string().optional(),
  releaseNotes: z.string().optional(),
  error: z.string().optional(),
});
export type CheckUpdateResult = z.infer<typeof CheckUpdateResultSchema>;

