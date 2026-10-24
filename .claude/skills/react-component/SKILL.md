---
name: react-component
description: Use when creating a new reusable React/TypeScript component under src/renderer/components (shared) or src/renderer/features/<module> — e.g. MoneyInput, QtyInput, ProductPicker, StatusChip, DataTable, PosCart, AuthorizeDialog, a report chart. Keeps components consistent with the Tailwind v4 + shadcn conventions and the keyboard-first POS rules.
---

# React Component Skill

For shadcn primitives (`components/ui/`) use the CLI
(`npx shadcn@latest add <name>`), not this skill. This skill is for the
project components built **on top of** them. Rules:
`rules/frontend-standards.md`, `rules/design-standards.md`.

## 1. Where it lives

- `src/renderer/components/shared/` — used by 2+ modules (MoneyInput,
  QtyInput, ProductPicker, StatusChip, DataTable, PageHeader, ConfirmDialog,
  AuthorizeDialog).
- `src/renderer/features/<module>/components/` — one module only (PosCart,
  PaymentDialog, ShiftCloseForm). Promote to `shared/` the second time
  another module needs it — not before.
- If the mobile app needs it too, keep it free of `window.pos` and desktop-
  only hooks so `mobile/` can import it.

## 2. File & API

- One component per file, `PascalCase.tsx`, named export.
- Props interface when > 2 props; reuse types from `@shared/constants` /
  `@shared/schemas` — never re-declare a status union or `string` where a
  union exists.
- Accept `className` and merge last with `cn()` from `@/lib/utils`.
- Money/qty props are decimal **strings**; format with `@/lib/format`,
  compute with `@shared/money` / `@shared/qty`.

```tsx
interface StatusChipProps {
  domain: StatusDomain;   // 'sale' | 'purchase-order' | ...
  status: string;         // validated against the domain map
  className?: string;
}

export function StatusChip({ domain, status, className }: StatusChipProps) {
  const s = STATUS[domain][status];          // single map in lib/status.ts
  return <Badge className={cn(s.className, className)}>{s.label}</Badge>;
}
```

## 3. Styling

- Compose shadcn primitives + tokens (`bg-primary`, `bg-tani-green-light`,
  `text-success-ink`). No hex, no default palette (`text-green-600`).
- Numbers: `tabular-nums`, right-aligned.

## 4. Data & side effects

- Presentational by default: data in via props. Data-fetching belongs in
  `features/<module>/api.ts` hooks used by the page.
- Exception: pickers (`ProductPicker`, `CustomerPicker`) may call their own
  search hook — keep debounce (≤ 150 ms) and keyboard navigation inside.
- Hardware only through `window.pos` guarded by `isDesktop()`.

## 5. Forms

Field components wrap `FormField`/`FormItem`/`FormControl` so they plug into
a parent React Hook Form; never keep their own `useState` for a value the
form owns. Required fields → `<FormLabel required>`.

## 6. Keyboard & POS checklist

- [ ] Fully operable by keyboard; visible focus ring; `Esc` closes, `Enter`
      confirms the primary action.
- [ ] Returns focus to the POS scan input after closing (when used on `/pos`).
- [ ] Does not swallow scanner input (`useScanner`) unless it is the target.
- [ ] Touch target ≥ 44 px where it can be tapped.

## 7. Done when

- [ ] No hardcoded colors; Bahasa Indonesia text; types reused from `@shared`.
- [ ] Works at 1366×768 and inside a dialog/sheet.
- [ ] A Vitest + Testing Library test for any logic (formatting, parsing,
      keyboard handling) — e.g. MoneyInput parses `1.500.000` → `"1500000.00"`.
- [ ] `npm run typecheck && npm run lint` pass.
