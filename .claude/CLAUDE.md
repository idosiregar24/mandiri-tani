# Mandiri Tani POS & Backoffice Desktop

Offline-first **Point of Sale + backoffice** for an agricultural supply
store (pupuk, pestisida, benih, alat tani), iPOS-class features, shipped as
one Windows installer. Full specification:
[`File Skema/Mandiri Tani v1.0/PRD-Mandiri-Tani-POS.md`](File%20Skema/Mandiri%20Tani%20v1.0/PRD-Mandiri-Tani-POS.md)
— **read the relevant PRD section before building any module**; this file
is orientation, not a replacement for it.

- Authoritative DDL: [`File Skema/Mandiri Tani v1.0/mandiri_tani_schema.sql`](File%20Skema/Mandiri%20Tani%20v1.0/mandiri_tani_schema.sql)
  (wins over PRD §6 prose when they disagree — then fix the PRD).
- How the store actually works today (from its iPOS 5 backup + Excel
  sheets) and the design decisions D-1…D-11 that follow:
  [`File Skema/Mandiri Tani v1.0/Analisis-Sumber-Data-iPOS.md`](File%20Skema/Mandiri%20Tani%20v1.0/Analisis-Sumber-Data-iPOS.md).
- Sprint plan & build status: [`plan/README.md`](plan/README.md), checklists in `plan/sprint-N-<deskripsi>.md`.
- Next phase (not started): [`File Skema/Mandiri Tani v2.0/`](File%20Skema/Mandiri%20Tani%20v2.0/PRD-v2.0-Remote-Tailscale.md) — remote access via **Tailscale**.

## Product goal, in order

1. **v1.0 — offline-first POS that can sync.** Everything runs on the
   store PC with no internet; phones on the store Wi-Fi sync with it.
2. **v2.0 — Tailscale** remote access (owner outside the store). No v1
   code may depend on Tailscale, but nothing may block it either (bind
   `0.0.0.0`, never trust localhost, token auth everywhere).

## Stack (target — record actual versions in `plan/README.md` once installed)

- **Shell:** Electron (`electron-vite` for main/preload/renderer),
  **Electron Builder → NSIS** `.exe`.
- **Embedded DB:** **PostgreSQL portable** binaries bundled in
  `resources/postgres/`, data in `%APPDATA%/pos-desktop/pgdata`, port
  **5433**, `127.0.0.1` only; started/stopped by the Electron main process
  with `initdb`/`pg_ctl`.
- **Embedded API:** Node.js **Express 5** inside the Electron main process,
  **`0.0.0.0:3000`**, `pg` Pool, raw parameterized SQL (no ORM), Zod.
- **UI:** React + Vite + TypeScript strict, **Tailwind v4** (CSS-first),
  shadcn/ui (Radix), lucide-react, **Zustand** (client state) +
  **TanStack Query** (server state), React Hook Form + Zod, TanStack Table.
- **Mobile:** React + Capacitor (Android) — sync client (Sprint 12).
- **Tests:** Vitest against a **real** throwaway PostgreSQL cluster.

## Coding standards (read before writing code)

@rules/backend-standards.md
@rules/database-standards.md
@rules/desktop-runtime-standards.md
@rules/sync-standards.md
@rules/frontend-standards.md
@rules/design-standards.md
@rules/security-standards.md

## Project skills

- `pos-module` (`skills/pos-module/SKILL.md`) — end-to-end recipe for a
  module/endpoint: migration → shared Zod → repo → service → route → page → tests.
- `stock-movement` (`skills/stock-movement/SKILL.md`) — any code that
  changes stock or HPP. Mandatory for sales, returns, receipts, opname,
  adjustments, transfers, assembly, bundles, synced documents.
- `react-component` (`skills/react-component/SKILL.md`) — new reusable
  component under `src/renderer/components` or a feature folder.

## Golden rules

1. **One document = one DB transaction.** Sale + items + payments + stock +
   receivable + cash rows commit together via `withTransaction()`. Printing,
   drawer kick and anything outside the DB happen **after** commit; a print
   failure never rolls back or voids a sale.
2. **Stock has one door: `stockService.apply(tx, movements)`.** Never
   `UPDATE stock_balances` or `products.avg_cost` elsewhere; collect all
   movements of a document and call it once (sorted lock order → no
   deadlocks). HPP = moving average (PRD §6.6).
3. **No floats for money or quantity.** DB `NUMERIC`; `pg` returns strings;
   compute with `@shared/money` / `@shared/qty` (decimal.js); API sends
   decimal strings. Stock is stored in the product's **base unit**.
4. **Sync-ready from day one.** UUIDv7 ids created by the app; `updated_at`
   set by trigger (`clock_timestamp()`); synced masters soft-delete via
   `deleted_at` (never hard delete); device-created documents carry
   `client_op_id` UNIQUE and are idempotent. Posted documents are never
   edited — corrections are new documents (void/return/adjustment).
5. **Ledgers are append-only:** `stock_movements`, `cash_transactions`,
   `audit_logs` (DB triggers reject UPDATE/DELETE). No delete endpoint for
   anyone, including OWNER. Users are deactivated, never deleted.
6. **Permissions come from `src/shared/permissions.ts` only** (PRD §4.2).
   Every route has `requirePermission`; cost/profit fields are stripped
   server-side for roles without `cost.read`; supervisor overrides use
   one-shot `authorization_grants` (HTTP 423 → PIN dialog → retry).
7. **No auth bypass for localhost/LAN IPs.** The server is reachable from
   the whole store network (and later the tailnet via a local proxy).
8. **The main process owns PostgreSQL.** Only `PgManager` calls
   `initdb`/`pg_ctl`/`pg_dump`/`pg_restore` (also for the iPOS import), always via `execFile` with argument arrays
   (paths contain spaces). `fsync`/`synchronous_commit`/`full_page_writes`
   stay **on**. Shutdown order: HTTP close → `pool.end()` → `pg_ctl stop -m fast`.
9. **`src/server` never imports `electron`** (`createServer(config)`), so it
   runs in Vitest and can move to a `utilityProcess` later. Business data
   flows renderer → REST API, never through IPC; IPC is only for
   hardware/lifecycle via the narrow `window.pos` bridge.
10. **Keyboard-first cashier.** Shortcuts defined once in `lib/hotkeys.ts`,
    scanner via `useScanner`, focus returns to the scan box after every
    action, no `window.confirm`.
11. **Schema changes:** new forward-only `db/migrations/NNNN_*.sql`; never
    edit an applied migration; keep `mandiri_tani_schema.sql` in sync in the
    same change.
12. **Design for how the store really sells** (Analisis D-1…D-11): two sale
    channels (KASIR = KSR quick sale, FAKTUR = JL invoice with credit,
    shipping fee); editing a line price is the normal flow, not an
    exception; units are iPOS codes (ZAK = 50 KG); document type codes
    KSR/JL/BL/BP/AB. Features the store never used in iPOS (split bill,
    bundles, assembly, PPN, warehouse transfer) stay low priority.
14. **Sold-but-not-picked-up** (`plan/sprint-7-pengambilan-barang.md`):
    `stock_balances.qty` is **physical** stock and only drops when goods
    leave the warehouse (`SALE` at checkout or `SALE_PICKUP` at a pickup
    note `AB`); unpicked goods are `reserved_qty`. Sales validate against
    **available = qty − reserved_qty**; opname counts physical. Reserve/
    release only through `stockService`, same lock order as `apply`.
15. **iPOS import is repeatable until go-live** (`plan/sprint-14-go-live-migrasi.md`):
    development uses the backup in `.claude/file/`; go-live imports the
    newest backup. Never hard-code anything from the current dump — the
    importer checks the iPOS table/column fingerprint instead.
13. **`.claude/file/` is real store data** — 1,238 customers' names, phones
    and addresses plus the full iPOS database backup. Never commit it
    (gitignored), never copy personal data into docs, fixtures, tests,
    commits or any external service; docs quote aggregates only. Test
    fixtures are synthetic; the real backup is used only for local
    importer runs.

## Local environment

- Windows 11, Node.js 24.12.0, npm 11.8.0, Git 2.51 (checked 2026-10-24).
  No PostgreSQL installed system-wide — the project uses its own portable
  binaries (`npm run fetch:postgres` once Sprint 1 C2 exists).
- Project root is `Mandiri Tani/` (parent of `.claude/`); the path contains
  spaces and a comma — quote paths in shell commands.
- Not yet a git repository (Sprint 1 A1).

## Language

Code, identifiers and code comments in **English**. Everything
**user-facing** — UI text, error `message`, receipts, reports, PDF/Excel
exports — in **Bahasa Indonesia** (`id-ID` formats, `Asia/Jakarta`).
Planning docs (`plan/`, PRD, rules) are in Bahasa Indonesia.
