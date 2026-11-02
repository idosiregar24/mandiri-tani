import { Router } from 'express';
import { SetPasswordInput, SetPinInput, UserCreateInput, UserUpdateInput } from '@shared/schemas/users';
import type { Pool } from '../../db/pool';
import { recordAudit } from '../../lib/audit';
import { hashSecret } from '../../lib/passwords';
import { requirePermission } from '../../middleware/auth';

export interface UserRow {
  id: string;
  username: string;
  fullName: string;
  role: 'OWNER' | 'KASIR';
  isActive: boolean;
  createdAt: string;
  hasPassword: boolean;
  hasPin: boolean;
}

export function usersRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();
  const guard = requirePermission('users.manage');

  router.get('/users', guard, async (_req, res) => {
    const r = await pool.query<UserRow>(
      `SELECT id, username, full_name AS "fullName", role, is_active AS "isActive",
              created_at AS "createdAt",
              (password_hash IS NOT NULL) AS "hasPassword",
              (pin_hash IS NOT NULL) AS "hasPin"
       FROM users
       ORDER BY role DESC, full_name ASC`,
    );
    res.json({ data: r.rows });
  });

  router.post('/users', guard, async (req, res) => {
    const parsed = UserCreateInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Data tidak valid.' } });
      return;
    }
    const input = parsed.data;

    const existing = await pool.query(`SELECT 1 FROM users WHERE lower(username) = lower($1)`, [input.username]);
    if (existing.rowCount && existing.rowCount > 0) {
      res.status(409).json({ error: { code: 'CONFLICT', message: `Username '${input.username}' sudah dipakai.` } });
      return;
    }

    const pinHash = await hashSecret(input.pin);
    const passwordHash = input.password ? await hashSecret(input.password) : null;

    const inserted = await pool.query<UserRow>(
      `INSERT INTO users (id, username, full_name, role, password_hash, pin_hash, is_active, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, true, now(), now())
       RETURNING id, username, full_name AS "fullName", role, is_active AS "isActive", created_at AS "createdAt",
                 ($4 IS NOT NULL) AS "hasPassword", ($5 IS NOT NULL) AS "hasPin"`,
      [input.username, input.fullName, input.role, passwordHash, pinHash],
    );

    const user = inserted.rows[0]!;
    await recordAudit(pool, req.ctx, {
      action: 'user.create',
      entity: 'users',
      entityId: user.id,
      after: { username: user.username, fullName: user.fullName, role: user.role },
    });

    res.status(201).json({ data: user });
  });

  router.put('/users/:id', guard, async (req, res) => {
    const id = req.params.id as string;
    const parsed = UserUpdateInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Data tidak valid.' } });
      return;
    }
    const input = parsed.data;

    const cur = await pool.query<{ role: string; fullName: string }>(
      `SELECT role, full_name AS "fullName" FROM users WHERE id = $1`,
      [id],
    );
    if (cur.rowCount === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pengguna tidak ditemukan.' } });
      return;
    }
    const current = cur.rows[0]!;

    if (current.role === 'OWNER' && input.role !== 'OWNER') {
      const ownerCount = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM users WHERE role = 'OWNER' AND is_active = true AND id != $1`,
        [id],
      );
      if (ownerCount.rows[0]!.count === 0) {
        res.status(400).json({ error: { code: 'LAST_OWNER', message: 'Tidak bisa menurunkan peran Owner aktif terakhir.' } });
        return;
      }
    }

    const updated = await pool.query<UserRow>(
      `UPDATE users SET full_name = $1, role = $2, updated_at = now()
       WHERE id = $3
       RETURNING id, username, full_name AS "fullName", role, is_active AS "isActive", created_at AS "createdAt",
                 (password_hash IS NOT NULL) AS "hasPassword", (pin_hash IS NOT NULL) AS "hasPin"`,
      [input.fullName, input.role, id],
    );

    const user = updated.rows[0]!;
    await recordAudit(pool, req.ctx, {
      action: 'user.update',
      entity: 'users',
      entityId: user.id,
      before: current,
      after: { fullName: user.fullName, role: user.role },
    });

    res.json({ data: user });
  });

  router.post('/users/:id/pin', guard, async (req, res) => {
    const id = req.params.id as string;
    const parsed = SetPinInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'PIN tidak valid.' } });
      return;
    }

    const pinHash = await hashSecret(parsed.data.pin);
    const r = await pool.query(`UPDATE users SET pin_hash = $1, updated_at = now() WHERE id = $2 RETURNING username`, [
      pinHash,
      id,
    ]);
    if (r.rowCount === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pengguna tidak ditemukan.' } });
      return;
    }

    await recordAudit(pool, req.ctx, {
      action: 'user.pin_reset',
      entity: 'users',
      entityId: id,
      after: { username: r.rows[0]?.username },
    });

    res.json({ data: { ok: true } });
  });

  router.post('/users/:id/password', guard, async (req, res) => {
    const id = req.params.id as string;
    const parsed = SetPasswordInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Password tidak valid.' } });
      return;
    }

    const passwordHash = await hashSecret(parsed.data.password);
    const r = await pool.query(`UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2 RETURNING username`, [
      passwordHash,
      id,
    ]);
    if (r.rowCount === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pengguna tidak ditemukan.' } });
      return;
    }

    await recordAudit(pool, req.ctx, {
      action: 'user.password_reset',
      entity: 'users',
      entityId: id,
      after: { username: r.rows[0]?.username },
    });

    res.json({ data: { ok: true } });
  });

  router.post('/users/:id/toggle-active', guard, async (req, res) => {
    const id = req.params.id as string;
    const userRes = await pool.query<{ role: string; isActive: boolean; username: string }>(
      `SELECT role, is_active AS "isActive", username FROM users WHERE id = $1`,
      [id],
    );
    if (userRes.rowCount === 0) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pengguna tidak ditemukan.' } });
      return;
    }
    const target = userRes.rows[0]!;

    if (target.isActive) {
      if (req.ctx.userId === id) {
        res.status(400).json({ error: { code: 'SELF_DEACTIVATE', message: 'Tidak bisa menonaktifkan akun sendiri.' } });
        return;
      }
      if (target.role === 'OWNER') {
        const owners = await pool.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM users WHERE role = 'OWNER' AND is_active = true AND id != $1`,
          [id],
        );
        if (owners.rows[0]!.count === 0) {
          res.status(400).json({ error: { code: 'LAST_OWNER', message: 'Tidak bisa menonaktifkan Owner aktif terakhir.' } });
          return;
        }
      }
      // Revoke all sessions
      await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [id]);
    }

    const updated = await pool.query<{ isActive: boolean }>(
      `UPDATE users SET is_active = NOT is_active, updated_at = now() WHERE id = $1 RETURNING is_active AS "isActive"`,
      [id],
    );

    const nowActive = updated.rows[0]!.isActive;
    await recordAudit(pool, req.ctx, {
      action: nowActive ? 'user.activate' : 'user.deactivate',
      entity: 'users',
      entityId: id,
      after: { username: target.username, role: target.role },
    });

    res.json({ data: { isActive: nowActive } });
  });

  return router;
}

