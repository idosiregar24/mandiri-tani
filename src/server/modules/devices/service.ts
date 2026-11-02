import { createHash, randomBytes, randomInt } from 'node:crypto';
import type {
  DeviceItem,
  NetworkInfo,
  PairDeviceInput,
  PairDeviceResult,
  PairingCodeInput,
  PairingCodeResult,
} from '@shared/schemas/devices';
import { uuidv7 } from '@shared/uuid';
import type { Pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { AppError, notFoundError } from '../../lib/errors';
import { getLocalIps, getPrimaryHubUrl } from '../../lib/network';
import type { RequestCtx } from '../../middleware/auth';
import * as repo from './repo';

const sha256 = (val: string) => createHash('sha256').update(val).digest('hex');

export async function list(pool: Pool): Promise<DeviceItem[]> {
  return repo.list(pool);
}

export async function createPairingCode(
  pool: Pool,
  ctx: RequestCtx,
  input: PairingCodeInput,
): Promise<PairingCodeResult> {
  const code = String(randomInt(100000, 1000000));
  const codeHash = sha256(code);
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  const id = uuidv7();

  await withTransaction(pool, async (tx) => {
    await repo.createPairingCode(tx, {
      id,
      codeHash,
      kind: input.kind,
      expiresAt,
      createdBy: ctx.userId,
    });
    await recordAudit(tx, ctx, {
      action: 'device.pairing_code_create',
      entity: 'device_pairing_code',
      entityId: id,
      after: { kind: input.kind, expiresAt: expiresAt.toISOString() },
    });
  });

  const hubUrl = getPrimaryHubUrl();
  const qrData = JSON.stringify({
    hub: hubUrl,
    code,
    expiresAt: expiresAt.toISOString(),
    kind: input.kind,
  });

  return {
    code,
    expiresAt: expiresAt.toISOString(),
    hubUrl,
    qrData,
  };
}

export async function pair(pool: Pool, input: PairDeviceInput): Promise<PairDeviceResult> {
  const codeHash = sha256(input.code);

  return withTransaction(pool, async (tx) => {
    const valid = await repo.findValidPairingCode(tx, codeHash);
    if (!valid) {
      throw new AppError(
        'INVALID_PAIRING_CODE',
        'Kode pairing tidak valid atau sudah kedaluwarsa. Buat kode baru dari komputer kasir.',
        400,
      );
    }

    const deviceId = uuidv7();
    const deviceCode = await repo.nextDeviceCode(tx, valid.kind);
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);

    let skewMs: number | null = null;
    if (input.deviceTime) {
      const parsed = Date.parse(input.deviceTime);
      if (!Number.isNaN(parsed)) {
        skewMs = Math.abs(parsed - Date.now());
      }
    }

    const pairedAt = new Date();
    await repo.insertDevice(tx, {
      id: deviceId,
      code: deviceCode,
      name: input.deviceName,
      kind: valid.kind,
      tokenHash,
      appVersion: input.appVersion ?? null,
      pairedAt,
      skewMs,
    });

    await repo.markPairingCodeUsed(tx, valid.id, deviceId);

    // Audit the device pairing under the user who issued the pairing code
    await recordAudit(
      tx,
      {
        userId: valid.createdBy,
        deviceId,
        requestId: `pair-${deviceId}`,
      },
      {
        action: 'device.pair',
        entity: 'device',
        entityId: deviceId,
        after: {
          code: deviceCode,
          name: input.deviceName,
          kind: valid.kind,
          pairedAt: pairedAt.toISOString(),
        },
      },
    );

    const hubUrl = getPrimaryHubUrl();
    return {
      deviceId,
      deviceCode,
      token: rawToken,
      hubUrl,
      serverTime: new Date().toISOString(),
    };
  });
}

export async function revoke(pool: Pool, ctx: RequestCtx, id: string): Promise<void> {
  const device = await repo.get(pool, id);
  if (!device) throw notFoundError('Perangkat');
  if (device.code === 'K01') {
    throw new AppError('DEVICE_NOT_ALLOWED', 'Komputer Hub kasir utama tidak bisa dicabut aksesnya.', 400);
  }

  await withTransaction(pool, async (tx) => {
    await repo.revokeDevice(tx, id);
    await recordAudit(tx, ctx, {
      action: 'device.revoke',
      entity: 'device',
      entityId: id,
      before: { code: device.code, name: device.name, revokedAt: null },
      after: { code: device.code, name: device.name, revokedAt: new Date().toISOString() },
    });
  });
}

export function getNetworkInfo(): NetworkInfo {
  return {
    serverTime: new Date().toISOString(),
    port: 3000,
    localIps: getLocalIps(),
    primaryHubUrl: getPrimaryHubUrl(),
  };
}

