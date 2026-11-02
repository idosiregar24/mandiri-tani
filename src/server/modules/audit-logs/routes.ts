import { Router } from 'express';
import type { Pool } from '../../db/pool';
import { requirePermission } from '../../middleware/auth';

export interface AuditLogRow {
  seq: number;
  createdAt: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  actorUsername: string | null;
  actorFullName: string | null;
  approvedByUsername: string | null;
}

export function auditLogsRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();
  const guard = requirePermission('users.manage');

  router.get('/audit-logs', guard, async (req, res) => {
    const { action, userId, cursor, limit = '50' } = req.query;
    const max = Math.min(100, Math.max(1, Number(limit) || 50));

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (action && typeof action === 'string') {
      params.push(action);
      conditions.push(`a.action = $${params.length}`);
    }
    if (userId && typeof userId === 'string') {
      params.push(userId);
      conditions.push(`a.actor_id = $${params.length}::uuid`);
    }
    if (cursor && typeof cursor === 'string') {
      params.push(Number(cursor));
      conditions.push(`a.seq < $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(max);

    const r = await pool.query<AuditLogRow>(
      `SELECT a.seq,
              a.at AS "createdAt",
              a.action,
              a.entity,
              a.entity_id::text AS "entityId",
              a.before,
              a.after,
              a.ip,
              u.username AS "actorUsername",
              u.full_name AS "actorFullName",
              ap.username AS "approvedByUsername"
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_id
       LEFT JOIN users ap ON ap.id = a.approved_by
       ${where}
       ORDER BY a.seq DESC
       LIMIT $${params.length}`,
      params,
    );

    const nextCursor = r.rows.length === max ? r.rows[r.rows.length - 1]?.seq : null;

    res.json({
      data: r.rows,
      nextCursor,
    });
  });

  return router;
}
