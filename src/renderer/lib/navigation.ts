// Sidebar menu (design-standards §4): ≤ 7 groups, items the role may not use are hidden,
// modules not built yet are shown disabled as "Segera".
import {
  Boxes,
  Building2,
  FileInput,
  Home,
  Landmark,
  type LucideIcon,
  Printer,
  Receipt,
  ShoppingCart,
  Tags,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import { hasPermission, type Permission, type Role } from '@shared/permissions';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Hidden when the role lacks it. */
  permission?: Permission;
  soon?: boolean;
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
      { label: 'Kasir', to: '/kasir', icon: ShoppingCart, permission: 'sales.create', soon: true },
      { label: 'Pelanggan', to: '/pelanggan', icon: Users, permission: 'customers.read' },
    ],
  },
  {
    label: 'Persediaan',
    items: [
      { label: 'Barang', to: '/barang', icon: Boxes, permission: 'products.read' },
      { label: 'Data Lain', to: '/data-lain', icon: Tags, permission: 'masters.write' },
    ],
  },
  {
    label: 'Pembelian',
    items: [
      { label: 'Supplier', to: '/supplier', icon: Truck, permission: 'suppliers.read' },
      { label: 'Faktur Pembelian', to: '/pembelian', icon: Receipt, permission: 'purchases.read', soon: true },
    ],
  },
  {
    label: 'Hutang/Piutang',
    items: [{ label: 'Piutang & Hutang', to: '/piutang', icon: Wallet, permission: 'ar.payment', soon: true }],
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
