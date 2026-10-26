// The ONLY role → permission map (PRD §4.2, golden rule 6). The server enforces it with
// requirePermission(); the UI reads the same map to hide menus — the UI is never the guard.
export const ROLES = ['OWNER', 'KASIR'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // Sales & cashier
  'sales.create',
  'sales.hold',
  'shift.open',
  'shift.close',
  'sales.discount',
  'sales.discount.unlimited',
  'sales.price_override',
  'sales.sell_below_cost',
  'sales.void',
  'sales.return',
  'sales.credit',
  'sales.credit.over_limit',
  'sales.pending_pickup',
  'cash.in',
  'cash.out',
  'pickups.create',
  'pickups.read',
  'pickups.cancel',
  'ar.payment',
  // Master & stock
  'products.read',
  'stock.read',
  'customers.read',
  'customers.create',
  'suppliers.read',
  'products.write',
  'prices.write',
  'customers.write',
  'suppliers.write',
  'masters.write',
  'cost.read',
  // Purchasing & stock control
  'purchases.read',
  'purchases.write',
  'ap.payment',
  'stock.opname',
  'stock.adjust',
  'stock.transfer',
  // Reports
  'reports.sales',
  'reports.profit',
  'reports.cashflow',
  'reports.all',
  // System
  'users.manage',
  'devices.manage',
  'settings.write',
  'backup.create',
  'backup.restore',
  'imports.ipos',
  'system.reset_preparation',
  'system.go_live',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Cashier actions marked "⛔ (otorisasi Owner)" in PRD §4.2: allowed only with a one-shot Owner grant. */
export const OWNER_AUTHORIZABLE: readonly Permission[] = [
  'sales.discount.unlimited',
  'sales.sell_below_cost',
  'sales.void',
  'sales.return',
  'sales.credit.over_limit',
  'pickups.cancel',
];

const KASIR: readonly Permission[] = [
  'sales.create',
  'sales.hold',
  'shift.open',
  'shift.close',
  'sales.discount',
  'sales.price_override',
  'sales.credit',
  'sales.pending_pickup',
  'cash.in',
  'cash.out',
  'pickups.create',
  'pickups.read',
  'ar.payment',
  'products.read',
  'stock.read',
  'customers.read',
  'customers.create',
  'suppliers.read',
  'reports.sales',
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(PERMISSIONS),
  KASIR: new Set(KASIR),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
