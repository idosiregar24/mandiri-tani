import { describe, expect, it } from 'vitest';
import { CheckUpdateResultSchema, type UpdaterStatus } from './updater';

describe('updater schema & contracts', () => {
  it('validates check update result with update available', () => {
    const valid = {
      hasUpdate: true,
      version: '0.2.0',
      releaseNotes: 'Fitur baru auto-update',
    };
    const parsed = CheckUpdateResultSchema.parse(valid);
    expect(parsed.hasUpdate).toBe(true);
    expect(parsed.version).toBe('0.2.0');
    expect(parsed.releaseNotes).toBe('Fitur baru auto-update');
  });

  it('validates check update result when no update', () => {
    const valid = {
      hasUpdate: false,
    };
    const parsed = CheckUpdateResultSchema.parse(valid);
    expect(parsed.hasUpdate).toBe(false);
    expect(parsed.version).toBeUndefined();
  });

  it('supports updater status states', () => {
    const states: UpdaterStatus['state'][] = [
      'IDLE',
      'CHECKING',
      'AVAILABLE',
      'NOT_AVAILABLE',
      'DOWNLOADING',
      'DOWNLOADED',
      'ERROR',
    ];

    expect(states).toHaveLength(7);
  });
});

