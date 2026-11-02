// LOCAL ONLY: runs the iPOS importer (master → stock → history) and the reports against the store's
// real backup, then prints AGGREGATES only — counts, totals, reconciliation, timings. Never prints
// names, phones or document examples (CLAUDE.md #13). Skipped unless MTPOS_IPOS_BACKUP points to an
// .i5bu file, so CI and normal `npm test` never touch real data.
//
//   $env:MTPOS_IPOS_BACKUP = "C:\…\DB Mandiri Tani.i5bu"; npx vitest run test/real-backup.test.ts --silent=false
/* eslint-disable no-console -- this local tool's output IS its console report */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import type { ImportBatch } from '@shared/schemas/imports';
import { startTestApi, type Data, type ErrBody } from './api';
import { pgBinDir } from './paths';
import { createTestDatabase } from './pg';

const run = promisify(execFile);
const file = process.env.MTPOS_IPOS_BACKUP;

async function restore(
  file: string,
  db: { host: string; port: number; database: string; user: string; password: string },
) {
  const bin = (name: string) => join(pgBinDir(), `${name}${process.platform === 'win32' ? '.exe' : ''}`);
  const work = mkdtempSync(join(tmpdir(), 'mtpos-real-'));
  try {
    const toc = await run(bin('pg_restore'), ['-l', file], { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    const list = join(work, 'toc.list');
    writeFileSync(
      list,
      toc.stdout
        .split(/\r?\n/)
        .filter((l) => /^\d+; \d+ \d+ TABLE (DATA )?\S+ \S+/.test(l))
        .join('\n'),
    );
    await run(
      bin('pg_restore'),
      [
        '-h',
        db.host,
        '-p',
        String(db.port),
        '-U',
        db.user,
        '-d',
        db.database,
        '--no-owner',
        '--no-privileges',
        '-L',
        list,
        file,
      ],
      { env: { ...process.env, PGPASSWORD: db.password }, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
    ).catch((err: { stderr?: string }) => {
      // pg_restore exits 1 on the harmless "WITH OIDS is not supported" warnings.
      if (!/WITH OIDS/.test(err.stderr ?? '')) throw err;
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const client = new pg.Client(db);
  await client.connect();
  try {
    await client.query(`CREATE TABLE _mtpos_source (
      file_name text NOT NULL, sha256 text NOT NULL, size_bytes bigint NOT NULL, dump_created_at text,
      source_database text, source_version text, tables integer NOT NULL, restored_at timestamptz NOT NULL DEFAULT now())`);
    const buf = readFileSync(file);
    await client.query(`INSERT INTO _mtpos_source (file_name, sha256, size_bytes, tables) VALUES ($1, $2, $3, 0)`, [
      basename(file),
      createHash('sha256').update(buf).digest('hex'),
      buf.length,
    ]);
  } finally {
    await client.end();
  }
}

const show = (title: string, b: ImportBatch) => {
  console.info(`\n== ${title}: ${b.status}`);
  for (const r of b.reconciliation)
    console.info(`  ${r.ok ? 'OK ' : 'XX '} ${r.label}: iPOS ${r.ipos} | app ${r.imported}`);
  for (const i of b.issues) console.info(`  issue ${i.code}: ${i.count}`);
};

describe.skipIf(!file)('real iPOS backup (local only)', () => {
  it('imports master, stock and 2-year history 1:1 and runs the reports', async () => {
    const ipos = await createTestDatabase();
    const t0 = Date.now();
    await restore(file!, ipos.config);
    console.info(`restore ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const api = await startTestApi({ iposDb: ipos.config, hooks: { backup: async (l) => `${l}.dump` } });
    try {
      for (const [title, path] of [
        ['master', '/imports/ipos/commit'],
        ['stock', '/imports/ipos/stock/commit'],
        ['history', '/imports/ipos/history/commit'],
      ] as const) {
        const t = Date.now();
        const r = await api.call<Data<ImportBatch> & ErrBody>('POST', path, { purpose: 'DEVELOPMENT' });
        if (r.status !== 201) throw new Error(`${title}: ${r.status} ${r.body.error?.code} ${r.body.error?.message}`);
        show(`${title} (${((Date.now() - t) / 1000).toFixed(1)} s)`, r.body.data);
        expect(r.body.data.reconciliation.filter((x) => !x.ok).map((x) => x.label)).toEqual([]);
      }

      // Report timings on real volume (sprint-10 C9).
      for (const path of [
        '/reports/dashboard',
        '/reports/sales?from=2026-09-01&to=2026-09-30',
        '/reports/sales?from=2024-10-25&to=2026-10-24&groupBy=day',
        '/reports/profit-by-item?from=2024-10-25&to=2026-10-24',
        '/reports/profit-by-invoice?from=2026-01-01&to=2026-10-24',
        '/reports/profit-loss?from=2024-10-25&to=2026-10-24',
        '/reports/cashflow?from=2024-10-25&to=2026-10-24',
        '/reports/purchases?from=2024-10-25&to=2026-10-24',
        '/reports/daily-fertilizer?from=2026-10-01&to=2026-10-31',
        '/reports/stock',
        '/reports/profit-by-item?from=2024-10-25&to=2026-10-24&format=xlsx',
      ]) {
        const t = Date.now();
        const r = await fetch(`${api.base}${path}`, { headers: { authorization: `Bearer ${api.users.OWNER.token}` } });
        const size = (await r.arrayBuffer()).byteLength;
        console.info(`  ${r.status} ${String(Date.now() - t).padStart(5)} ms ${String(size).padStart(9)} B  ${path}`);
        expect(r.status).toBe(200);
      }
      const pl = await api.call<Data<Record<string, unknown>>>(
        'GET',
        '/reports/profit-loss?from=2025-10-01&to=2026-09-30',
      );
      const { netSales, unknownCostSales, hpp, grossProfit, otherCharges, opexTotal, operatingProfit } = pl.body.data;
      console.info('\nlaba rugi Okt 2025 – Sep 2026', {
        netSales,
        unknownCostSales,
        hpp,
        grossProfit,
        otherCharges,
        opexTotal,
        operatingProfit,
      });
    } finally {
      await api.close();
      await ipos.drop();
    }
  }, 900_000);
});
