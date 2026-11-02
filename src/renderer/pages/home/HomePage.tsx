import {
  Boxes,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  FileInput,
  FileText,
  ShoppingCart,
  Sparkles,
  Truck,
  Users,
} from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { useHealth, useMasterTotals } from '@/features/home/api';
import { Dashboard } from '@/features/reports/Dashboard';
import { desktopBridge } from '@/lib/desktop';
import { formatDate } from '@/lib/format';
import { ROLE_LABELS, useCan, useRole, useSessionUser } from '@/lib/session';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 4 && hour < 11) return 'Selamat Pagi';
  if (hour >= 11 && hour < 15) return 'Selamat Siang';
  if (hour >= 15 && hour < 18) return 'Selamat Sore';
  return 'Selamat Malam';
}

export function HomePage() {
  const user = useSessionUser();
  const role = useRole();
  const health = useHealth();
  const totals = useMasterTotals();
  const bridge = desktopBridge();
  const canImport = useCan('imports.ipos');
  const greeting = getGreeting();

  return (
    <div className="space-y-6">
      {/* 1. Hero Greeting & Operational Command Hub */}
      <div className="rounded-2xl border border-border bg-gradient-to-r from-card via-card to-surface-muted/50 p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {greeting}, {user?.fullName || 'Pengguna'}! 👋
              </h1>
              <span className="inline-flex items-center rounded-full border border-border bg-surface-muted px-2.5 py-0.5 text-xs font-semibold text-foreground/80">
                {ROLE_LABELS[role]}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Pusat kendali operasional Toko Pertanian Mandiri Tani — pantau penjualan harian, pergerakan stok, dan piutang petani.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-background">
              <CalendarDays className="size-3.5 text-primary" />
              {formatDate(new Date())}
            </span>
            {health.data?.db.ok && (
              <span className="text-xs font-medium text-emerald-800 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-emerald-50">
                <CheckCircle2 className="size-3.5 text-emerald-600" />
                Sistem Siap
              </span>
            )}
          </div>
        </div>

        {/* Quick Action Bar (Aksi Cepat Operasional) */}
        <div className="mt-6 pt-5 border-t border-border/60">
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-amber-500" /> Aksi Cepat Operasional
            </span>
            {canImport && totals.data?.products === 0 && (
              <Button asChild size="sm" variant="outline" className="h-8 text-xs text-primary">
                <Link to="/impor-ipos">
                  <FileInput className="size-3.5 mr-1.5" /> Impor Data dari iPOS
                </Link>
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <Button asChild size="lg" className="h-12 justify-start px-3 text-sm font-semibold shadow-xs">
              <Link to="/kasir" className="flex items-center justify-between w-full">
                <span className="flex items-center gap-2 truncate">
                  <ShoppingCart className="size-4 shrink-0" /> Kasir POS
                </span>
                <span className="text-[10px] font-mono opacity-80 border border-primary-foreground/30 px-1 rounded-sm">
                  F1
                </span>
              </Link>
            </Button>

            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-12 justify-start px-3 text-sm font-medium hover:border-foreground/30"
            >
              <Link to="/pembelian" className="flex items-center gap-2 truncate">
                <Truck className="size-4 shrink-0 text-muted-foreground" /> Masuk Barang
              </Link>
            </Button>

            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-12 justify-start px-3 text-sm font-medium hover:border-foreground/30"
            >
              <Link to="/stok" className="flex items-center gap-2 truncate">
                <Boxes className="size-4 shrink-0 text-muted-foreground" /> Cek Stok
              </Link>
            </Button>

            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-12 justify-start px-3 text-sm font-medium hover:border-foreground/30"
            >
              <Link to="/pelanggan" className="flex items-center gap-2 truncate">
                <Users className="size-4 shrink-0 text-muted-foreground" /> Pelanggan
              </Link>
            </Button>

            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-12 justify-start px-3 text-sm font-medium hover:border-foreground/30"
            >
              <Link to="/piutang" className="flex items-center gap-2 truncate">
                <CreditCard className="size-4 shrink-0 text-muted-foreground" /> Buku Piutang
              </Link>
            </Button>

            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-12 justify-start px-3 text-sm font-medium hover:border-foreground/30"
            >
              <Link to="/laporan/penjualan" className="flex items-center gap-2 truncate">
                <FileText className="size-4 shrink-0 text-muted-foreground" /> Laporan Toko
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* 2. Main Dashboard Content */}
      <Dashboard totals={totals.data} health={health.data} bridge={bridge} />
    </div>
  );
}
