// Sidebar menu (design-standards §4): ≤ 7 groups, items the role may not use are hidden,
// modules not built yet are shown disabled as "Segera".
import {
  Boxes,
  ClipboardCheck,
  Building2,
  FileInput,
  Home,
  Landmark,
  type LucideIcon,
  Printer,
  Receipt,
  SlidersHorizontal,
  ShoppingCart,
  Tags,
  Truck,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react';
import { hasPermission, type Permission, type Role } from '@shared/permissions';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Hidden when the role lacks it. */
  permission?: Permission;
  soon?: boolean;
  /** Show the record count next to the label. */
  count?: 'products' | 'customers' | 'suppliers';
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { label: '', items: [{ label: 'Beranda', to: '/', icon: Home }] },
  {
    label: 'Penjualan',
    items: [
      { label: 'Kasir', to: '/kasir', icon: ShoppingCart, permission: 'sales.create' },
      { label: 'Pelanggan', to: '/pelanggan', icon: Users, permission: 'customers.read', count: 'customers' },
    ],
  },
  {
    label: 'Persediaan',
    items: [
      { label: 'Barang', to: '/barang', icon: Boxes, permission: 'products.read', count: 'products' },
      { label: 'Stok', to: '/stok', icon: Warehouse, permission: 'stock.read' },
      { label: 'Penyesuaian', to: '/penyesuaian', icon: SlidersHorizontal, permission: 'stock.adjust' },
      { label: 'Stok Opname', to: '/opname', icon: ClipboardCheck, permission: 'stock.opname' },
      { label: 'Data Lain', to: '/data-lain', icon: Tags, permission: 'masters.write' },
    ],
  },
  {
    label: 'Pembelian',
    items: [
      { label: 'Supplier', to: '/supplier', icon: Truck, permission: 'suppliers.read', count: 'suppliers' },
      { label: 'Pembelian', to: '/pembelian', icon: Receipt, permission: 'purchases.read', soon: true },
    ],
  },
  {
    label: 'Hutang/Piutang',
    items: [{ label: 'Piutang', to: '/piutang', icon: Wallet, permission: 'ar.payment', soon: true }],
  },
  {
    label: 'Keuangan & Laporan',
    items: [{ label: 'Laporan', to: '/laporan', icon: Landmark, permission: 'reports.sales', soon: true }],
  },
  {
    label: 'Pengaturan',
    items: [
      { label: 'Impor iPOS', to: '/impor-ipos', icon: FileInput, permission: 'imports.ipos' },
      { label: 'Uji Cetak', to: '/uji-cetak', icon: Printer, permission: 'settings.write' },
      { label: 'Profil Toko', to: '/pengaturan', icon: Building2, permission: 'settings.write', soon: true },
    ],
  },
];

export function navFor(role: Role): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.permission || hasPermission(role, i.permission)),
  })).filter((g) => g.items.length > 0);
}

/** The menu entry for a path ("/barang/123" → Persediaan › Barang), for the breadcrumb. */
export function findNav(pathname: string): { group: NavGroup; item: NavItem } | null {
  let best: { group: NavGroup; item: NavItem } | null = null;
  for (const group of NAV) {
    for (const item of group.items) {
      const match = item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`);
      if (match && (!best || item.to.length > best.item.to.length)) best = { group, item };
    }
  }
  return best;
}
