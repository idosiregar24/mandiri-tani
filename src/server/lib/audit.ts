// Append-only audit trail (security-standards §7). Always called with the transaction
// of the action itself, so the record and the change commit (or roll back) together.
import type { Queryable } from '../db/pool';
import type { RequestCtx } from '../middleware/auth';

export interface AuditEntry {
  action: string; // 'price.update', 'product.deactivate', 'import.ipos.commit', ...
  entity?: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

export async function recordAudit(
  tx: Queryable,
  ctx: Pick<RequestCtx, 'userId' | 'deviceId' | 'requestId'>,
  entry: AuditEntry,
): Promise<void> {
  await tx.query(
    `INSERT INTO audit_logs (actor_id, device_id, action, entity, entity_id, before, after, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      ctx.userId,
      ctx.deviceId,
      entry.action,
      entry.entity ?? null,
      entry.entityId ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      ctx.requestId,
    ],
  );
}
