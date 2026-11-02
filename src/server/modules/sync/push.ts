import { ZodError, z } from 'zod';
import type { Pool } from '../../db/pool';
import { AppError } from '../../lib/errors';
import type { RequestCtx } from '../../middleware/auth';
import type { SyncPushInput, SyncPushResult, SyncOpResult, OutboxOp } from '@shared/schemas/sync';
import { CompleteSaleInput } from '@shared/schemas/sales';
import { ReceivablePaymentInput } from '@shared/schemas/ar-ap';
import { OpnameCountInput } from '@shared/schemas/stock';
import * as sales from '../sales/service';
import * as opnames from '../stock/opnames';
import * as arAp from '../ar-ap/service';

const OpnameCountPayload = OpnameCountInput.extend({
  opnameId: z.string().uuid(),
});

export async function push(
  pool: Pool,
  ctx: RequestCtx,
  input: SyncPushInput,
): Promise<SyncPushResult> {
  let effectiveDeviceId: string | undefined = ctx.deviceId;
  if (!effectiveDeviceId) {
    const hubRes = await pool.query<{ id: string }>("SELECT id FROM devices WHERE kind = 'HUB' LIMIT 1");
    effectiveDeviceId = hubRes.rows[0]?.id;
  }

  const results: SyncOpResult[] = [];

  for (const op of input.ops) {
    // 1. Check sync_ops for idempotency
    const existing = await pool.query<{ status: 'APPLIED' | 'REJECTED'; result: unknown }>(
      'SELECT status, result FROM sync_ops WHERE op_id = $1',
      [op.op_id],
    );

    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (row.status === 'APPLIED') {
        results.push({ op_id: op.op_id, status: 'DUPLICATE', result: row.result });
      } else {
        const err = (row.result as { error?: { code: string; message: string; details?: unknown } })?.error ?? {
          code: 'REJECTED',
          message: 'Operasi sebelumnya ditolak.',
        };
        results.push({ op_id: op.op_id, status: 'REJECTED', error: err });
      }
      continue;
    }

    // 2. Process op
    try {
      let opResult: unknown;

      if (op.type === 'sale.create') {
        const payload = CompleteSaleInput.parse(op.payload);
        const trxAt = new Date(op.device_time);
        opResult = await sales.complete(pool, ctx, payload, {
          idempotencyKey: op.op_id,
          grant: null,
          source: 'SYNC',
          trxAt: Number.isNaN(trxAt.getTime()) ? undefined : trxAt,
        });
      } else if (op.type === 'opname.count') {
        const payload = OpnameCountPayload.parse(op.payload);
        opResult = await opnames.count(pool, ctx, payload.opnameId, {
          productId: payload.productId,
          productUnitId: payload.productUnitId,
          countedQty: payload.countedQty,
        });
      } else if (op.type === 'receivable_payment.create') {
        const payload = ReceivablePaymentInput.parse(op.payload);
        opResult = await arAp.pay(pool, ctx, 'AR', payload, op.op_id);
      } else {
        throw new AppError('UNKNOWN_OP_TYPE', `Tipe operasi tidak dikenal: ${(op as OutboxOp).type}`, 422);
      }

      // Record APPLIED in sync_ops
      if (effectiveDeviceId) {
        await pool.query(
          `INSERT INTO sync_ops (op_id, device_id, op_type, status, result, device_time)
           VALUES ($1, $2, $3, 'APPLIED', $4, $5)
           ON CONFLICT (op_id) DO NOTHING`,
          [op.op_id, effectiveDeviceId, op.type, JSON.stringify(opResult), op.device_time],
        );
      }

      results.push({ op_id: op.op_id, status: 'APPLIED', result: opResult });
    } catch (err) {
      if (err instanceof ZodError) {
        const errorObj = {
          code: 'VALIDATION_ERROR',
          message: 'Data operasi tidak valid.',
          details: err.flatten(),
        };
        if (effectiveDeviceId) {
          await pool.query(
            `INSERT INTO sync_ops (op_id, device_id, op_type, status, result, device_time)
             VALUES ($1, $2, $3, 'REJECTED', $4, $5)
             ON CONFLICT (op_id) DO NOTHING`,
            [op.op_id, effectiveDeviceId, op.type, JSON.stringify({ error: errorObj }), op.device_time],
          );
        }
        results.push({ op_id: op.op_id, status: 'REJECTED', error: errorObj });
      } else if (err instanceof AppError) {
        const errorObj = {
          code: err.code,
          message: err.message,
          details: err.details,
        };
        if (effectiveDeviceId) {
          await pool.query(
            `INSERT INTO sync_ops (op_id, device_id, op_type, status, result, device_time)
             VALUES ($1, $2, $3, 'REJECTED', $4, $5)
             ON CONFLICT (op_id) DO NOTHING`,
            [op.op_id, effectiveDeviceId, op.type, JSON.stringify({ error: errorObj }), op.device_time],
          );
        }
        results.push({ op_id: op.op_id, status: 'REJECTED', error: errorObj });
      } else {
        // Transient error or unexpected internal error -> do not persist in sync_ops, return RETRY
        results.push({
          op_id: op.op_id,
          status: 'RETRY',
          error: {
            code: 'TRANSIENT_ERROR',
            message: (err as Error).message || 'Terjadi kesalahan sementara.',
          },
        });
      }
    }
  }

  return { results };
}
