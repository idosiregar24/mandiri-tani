// Cash flow per account (FR-FIN-03, sprint-10 S10-8): opening balance, in & out per category,
// closing balance — straight from the append-only cash book.
import { dec, Decimal, toMoney } from '@shared/money';
import { CashflowQuery, type CashflowAccount, type CashflowReport } from '@shared/schemas/reports';
import type { Pool } from '../../db/pool';
import type { XlsxReport } from '../../lib/xlsx';
import { inPeriod, periodLabel, withReport } from './common';

export async function cashflow(pool: Pool, raw: unknown): Promise<CashflowReport> {
  const q = CashflowQuery.parse(raw);
  return withReport(pool, async (db) => {
    const accounts = await db.query<Omit<CashflowAccount, 'in' | 'out' | 'totalIn' | 'totalOut' | 'closing'>>(
      `SELECT a.id, a.code, a.name, a.kind,
              coalesce((SELECT sum(CASE t.direction WHEN 'IN' THEN t.amount ELSE -t.amount END)
                        FROM cash_transactions t
                        WHERE t.cash_account_id = a.id
                          AND t.trx_at < ($1::date::timestamp AT TIME ZONE 'Asia/Jakarta')), 0)::text AS opening
       FROM cash_accounts a
       WHERE ($3::uuid IS NULL OR a.id = $3)
         AND ((a.deleted_at IS NULL AND a.is_active)
              OR EXISTS (SELECT 1 FROM cash_transactions t WHERE t.cash_account_id = a.id
                         AND ${inPeriod('t.trx_at', '$1', '$2')}))
       ORDER BY CASE a.kind WHEN 'DRAWER' THEN 0 WHEN 'CASH' THEN 1 ELSE 2 END, a.code`,
      [q.from, q.to, q.accountId ?? null],
    );
    const lines = await db.query<{
      accountId: string;
      direction: 'IN' | 'OUT';
      code: string;
      name: string;
      amount: string;
    }>(
      `SELECT t.cash_account_id AS "accountId", t.direction, c.code, c.name, sum(t.amount)::text AS amount
       FROM cash_transactions t JOIN cash_categories c ON c.id = t.cash_category_id
       WHERE ${inPeriod('t.trx_at', '$1', '$2')} AND ($3::uuid IS NULL OR t.cash_account_id = $3)
       GROUP BY t.cash_account_id, t.direction, c.code, c.name
       ORDER BY sum(t.amount) DESC`,
      [q.from, q.to, q.accountId ?? null],
    );
    // iPOS expenses were imported, but no sale of this app exists before `from` (S10-8).
    const goLive = await db.query<{ beforeGoLive: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM legacy_refs WHERE entity = 'cash_transaction')
              AND coalesce($1::date < (SELECT min((trx_at AT TIME ZONE 'Asia/Jakarta')::date) FROM sales
                                       WHERE source IN ('APP','SYNC') AND status <> 'HELD'), true) AS "beforeGoLive"`,
      [q.from],
    );

    const zero = new Decimal(0);
    const result: CashflowAccount[] = accounts.rows.map((a) => {
      const mine = lines.rows.filter((l) => l.accountId === a.id);
      const pick = (d: 'IN' | 'OUT') =>
        mine.filter((l) => l.direction === d).map((l) => ({ code: l.code, name: l.name, amount: toMoney(l.amount) }));
      const totalIn = mine.filter((l) => l.direction === 'IN').reduce((s, l) => s.plus(l.amount), zero);
      const totalOut = mine.filter((l) => l.direction === 'OUT').reduce((s, l) => s.plus(l.amount), zero);
      return {
        ...a,
        opening: toMoney(a.opening),
        in: pick('IN'),
        out: pick('OUT'),
        totalIn: toMoney(totalIn),
        totalOut: toMoney(totalOut),
        closing: toMoney(dec(a.opening).plus(totalIn).minus(totalOut)),
      };
    });
    const sum = (k: 'opening' | 'totalIn' | 'totalOut' | 'closing') =>
      toMoney(result.reduce((s, a) => s.plus(a[k]), zero));
    return {
      period: { from: q.from, to: q.to },
      accounts: result,
      totals: { opening: sum('opening'), totalIn: sum('totalIn'), totalOut: sum('totalOut'), closing: sum('closing') },
      beforeGoLive: goLive.rows[0]!.beforeGoLive,
    };
  });
}

export function cashflowXlsx(r: CashflowReport): XlsxReport {
  const rows: Record<string, string | null>[] = [];
  for (const a of r.accounts) {
    rows.push({ label: a.name, amount: null });
    rows.push({ label: '  Saldo awal', amount: a.opening });
    for (const l of a.in) rows.push({ label: `  Masuk: ${l.name}`, amount: l.amount });
    for (const l of a.out) rows.push({ label: `  Keluar: ${l.name}`, amount: dec(l.amount).neg().toFixed(2) });
    rows.push({ label: '  Saldo akhir', amount: a.closing });
  }
  return {
    title: 'Arus Kas',
    subtitle: periodLabel(r.period),
    columns: [
      { key: 'label', header: 'Keterangan', width: 40 },
      { key: 'amount', header: 'Jumlah', type: 'money' },
    ],
    rows,
    totals: { label: 'Saldo akhir semua akun', amount: r.totals.closing },
    notes: r.beforeGoLive ? ['Sebelum go-live hanya kas keluar dari iPOS yang tercatat.'] : [],
  };
}
