// Append-only audit trail (security-standards §7). Always called with the transaction
// of the action itself, so the record and the change commit (or roll back) together.
import type { Queryable } from '../db/pool';

export interface AuditEntry {
  action: string; // 'price.update', 'product.deactivate', 'import.ipos.commit', ...
  entity?: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Who did it. A RequestCtx fits; a failed login passes the user it was aimed at (or null). */
export interface AuditActor {
  userId: string | null;
  deviceId: string | null;
  requestId: string;
  /** The Owner whose PIN authorized this action (FR-POS-20). */
  approvedBy?: string | null;
  ip?: string | null;
}

export async function recordAudit(tx: Queryable, actor: AuditActor, entry: AuditEntry): Promise<void> {
  await tx.query(
    `INSERT INTO audit_logs (actor_id, approved_by, device_id, action, entity, entity_id, before, after, ip, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      actor.userId,
      actor.approvedBy ?? null,
      actor.deviceId,
      entry.action,
      entry.entity ?? null,
      entry.entityId ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      actor.ip ?? null,
      actor.requestId,
    ],
  );
}
