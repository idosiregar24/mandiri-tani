---
name: pos-module
description: Use when building a new Mandiri Tani POS module or endpoint end-to-end (migration → shared Zod schema → repo → service → route → renderer page → tests) — e.g. products, customers, suppliers, purchase orders, shifts, receivables, reports — from a PRD §5 FR or a plan/sprint-N-<deskripsi>.md checklist item. Keeps every module shaped the same way.
---

# POS Module Skill

The repeatable recipe for turning one FR (PRD §5) / one plan checklist
item into working code. Follow the order — each step depends on the
previous one. The *why* lives in `.claude/rules/*`; this file is the
*in what order*. If the module moves stock, also follow the
`stock-movement` skill for the service step.

## 0. Read first

- The FR rows (PRD `File Skema/Mandiri Tani v1.0/PRD-Mandiri-Tani-POS.md` §5)
  and acceptance notes for the module.
- The tables in `mandiri_tani_schema.sql` (authoritative over PRD §6 prose).
- The permission rows in PRD §4.2 → `src/shared/permissions.ts`.
- If any entity is synced to devices: `rules/sync-standards.md` §1 to
  classify it (master / device document / online-only).
- Build only what the sprint item scopes — no speculative endpoints.

## 1. Migration

`db/migrations/NNNN_<module>.sql` — copy the table DDL from
`mandiri_tani_schema.sql` (same names, CHECKs, indexes, triggers). If you
must deviate, update the schema file in the same change.
Checklist: FK indexes · `updated_at` trigger · `deleted_at` + `updated_at`
index for synced masters · append-only trigger for ledgers.

## 2. Shared schema & constants

`src/shared/schemas/<module>.ts` — Zod input schemas (`ProductInput`,
`CompleteSaleInput`) used by **both** server validation and renderer
forms. Money/qty fields are decimal **strings** (`zMoney`, `zQty` helpers).
Status unions go in `src/shared/constants.ts`, identical to the SQL CHECK.

## 3. Repo

`src/server/modules/<module>/repo.ts` — parameterized SQL only, every
function takes `db: Queryable` as first arg (pool or tx). No business rules,
no calls to other modules. Map rows → domain objects explicitly (never
spread raw rows into responses).

## 4. Service

`src/server/modules/<module>/service.ts` — business rules from the FR:
state transitions, price resolution, validation that needs the DB.
- Writes: one `withTransaction(async (tx) => …)` per user action; pass `tx`
  to repos and to other services (`stockService.apply(tx, …)`,
  `numbering.next(tx, …)`, `auditService.record(tx, …)`).
- Throw `AppError(code, message_id, status)` with Indonesian messages.
- Accept `ctx` (user, device, requestId, `source: 'API' | 'SYNC'`).
- Document creators accept `clientOpId` (from `Idempotency-Key` / sync
  `op_id`) and return the existing document on duplicate.

## 5. Route

`src/server/modules/<module>/routes.ts` — `requirePermission(...)`, parse
with the shared Zod schema, call the service, respond `{ data }`. Register
in `src/server/app.ts` under `/api/v1`. Serializer whitelists fields; strip
cost fields for users without `cost.read`.

## 6. Renderer

- `src/renderer/features/<module>/api.ts` — TanStack Query hooks + query
  keys; mutations send `Idempotency-Key` for document creation.
- `src/renderer/pages/<module>/…tsx` — `PageHeader` + `DataTable` for lists,
  RHF + the shared Zod schema for forms, `MoneyInput`/`QtyInput`,
  `<FormLabel required>` for required fields. All text Bahasa Indonesia.
- Add the menu entry to the sidebar config, gated by permission — only
  once the list route works (otherwise it stays disabled "Segera").

## 7. Sync (only if the entity is synced)

- Master: add the entity to the pull whitelist + dependency order in
  `modules/sync` with its serializer (respecting role filtering).
- Device document: add the op type to `src/shared/schemas/sync.ts` and route
  it to the **same service function** as the online endpoint.
- Write the tests listed in `sync-standards.md` §7.

## 8. Tests (Vitest, real PostgreSQL)

- Unit: every pure rule function (pricing, totals, allocation).
- Integration: service happy path + each business-rule rejection.
- Route: 1 allowed role (2xx), 1 denied role (403); cost fields absent for
  non-`cost.read` roles; duplicate `Idempotency-Key` returns the same doc.
- `npm run typecheck && npm run lint && npm test` green.

## 9. Update the plan

Tick the item in `.claude/plan/sprint-N-<deskripsi>.md` with a one-line status note
(what was built, any deviation from PRD and why). Record PRD deviations in
`plan/README.md` "Penyimpangan dari PRD".
