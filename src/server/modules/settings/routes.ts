import { Router } from 'express';
import type { ReceiptLogo } from '@shared/logo';
import { LogoSettings, PosSettings, SETTINGS_SCHEMAS, type SettingsKey, StoreSettings } from '@shared/schemas/settings';
import type { Pool } from '../../db/pool';
import { recordAudit } from '../../lib/audit';
import { requirePermission } from '../../middleware/auth';

/** Settings the cashier screen needs to print (receipt header) and to warn early (limits). */
export function settingsRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();

  router.get('/settings/receipt', requirePermission('sales.create'), async (_req, res) => {
    const r = await pool.query<{ key: string; value: unknown }>(
      `SELECT key, value FROM settings WHERE key IN ('store','pos','logo')`,
    );
    const byKey = new Map(r.rows.map((x) => [x.key, x.value]));
    const store = StoreSettings.safeParse(byKey.get('store'));
    res.json({
      data: {
        store: {
          ...(store.success
            ? store.data
            : { name: 'Toko', address: null, phone: null, fax: null, email: null, receiptFooter: null }),
          logo: receiptLogo(byKey.get('logo')),
        },
        pos: PosSettings.parse(byKey.get('pos') ?? {}),
      },
    });
  });

  // The logo has its own routes (before /settings/:key): the picture is large and must not be
  // copied into audit_logs on every change — the audit gets a short summary instead.
  router.get('/settings/logo', requirePermission('settings.write'), async (_req, res) => {
    const r = await pool.query<{ value: unknown }>(`SELECT value FROM settings WHERE key = 'logo'`);
    const parsed = LogoSettings.safeParse(r.rows[0]?.value ?? {});
    res.json({ data: parsed.success ? parsed.data : LogoSettings.parse({}) });
  });

  router.put('/settings/logo', requirePermission('settings.write'), async (req, res) => {
    const parsed = LogoSettings.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Data tidak valid.' } });
      return;
    }
    const before = await pool.query<{ value: unknown }>(`SELECT value FROM settings WHERE key = 'logo'`);
    const old = LogoSettings.safeParse(before.rows[0]?.value ?? {});
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('logo', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(parsed.data)],
    );
    await recordAudit(pool, req.ctx, {
      action: 'settings.update',
      entity: 'settings',
      entityId: null,
      before: old.success ? logoSummary(old.data) : null,
      after: logoSummary(parsed.data),
    });
    res.json({ data: parsed.data });
  });

  router.get('/settings/:key', async (req, res) => {
    const key = req.params.key as SettingsKey;
    const schema = SETTINGS_SCHEMAS[key];
    if (!schema) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: `Pengaturan '${key}' tidak ditemukan.` } });
      return;
    }
    const r = await pool.query<{ value: unknown }>(`SELECT value FROM settings WHERE key = $1`, [key]);
    if (r.rows[0]?.value) {
      const parsed = schema.safeParse(r.rows[0].value);
      if (parsed.success) {
        res.json({ data: parsed.data });
        return;
      }
    }

    // Default fallbacks if not yet initialized in db
    if (key === 'store') {
      res.json({
        data: {
          name: 'Mandiri Tani',
          address: 'Jl. Poros RAPP Km. 72',
          phone: '0813-6144-1706',
          fax: '-',
          email: null,
          receiptFooter: 'Barang yang telah dibeli tidak dapat dikembalikan kecuali ada perjanjian.',
        },
      });
      return;
    }
    res.json({ data: schema.parse({}) });
  });

  router.put('/settings/:key', requirePermission('settings.write'), async (req, res) => {
    const key = req.params.key as SettingsKey;
    const schema = SETTINGS_SCHEMAS[key];
    if (!schema) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: `Pengaturan '${key}' tidak ditemukan.` } });
      return;
    }
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Data tidak valid.' } });
      return;
    }

    const before = await pool.query<{ value: unknown }>(`SELECT value FROM settings WHERE key = $1`, [key]);
    const oldValue = before.rows[0]?.value ?? null;

    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(parsed.data)],
    );

    await recordAudit(pool, req.ctx, {
      action: 'settings.update',
      entity: 'settings',
      entityId: null,
      before: oldValue,
      after: parsed.data,
    });

    res.json({ data: parsed.data });
  });

  return router;
}

/** Only the bitmaps the Owner chose to print; null when there is no logo. */
function receiptLogo(value: unknown): ReceiptLogo | null {
  const logo = LogoSettings.safeParse(value ?? {});
  if (!logo.success || !logo.data.image) return null;
  return {
    faktur: logo.data.printOnFaktur ? logo.data.faktur : null,
    struk: logo.data.printOnStruk ? logo.data.struk : null,
  };
}

function logoSummary(v: LogoSettings) {
  return {
    key: 'logo',
    hasImage: v.image !== null,
    imageChars: v.image?.length ?? 0,
    threshold: v.threshold,
    printOnFaktur: v.printOnFaktur,
    printOnStruk: v.printOnStruk,
  };
}
