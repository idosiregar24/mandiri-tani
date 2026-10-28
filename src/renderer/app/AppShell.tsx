// Backoffice layout (design-standards §4): sidebar on the neutral canvas, content on a white
// panel with a breadcrumb bar. "Modern simple" per the owner's reference designs (2026-10-26).
import { CalendarDays, ChevronRight, Leaf, LogOut, UserRound } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { useLogout } from '@/features/auth/api';
import { useHealth, useMasterTotals } from '@/features/home/api';
import { formatDate, formatNumber } from '@/lib/format';
import { findNav, navFor } from '@/lib/navigation';
import { ROLE_LABELS, useRole, useSessionUser } from '@/lib/session';
import { cn } from '@/lib/utils';

export function AppShell() {
  const groups = navFor(useRole());
  const totals = useMasterTotals();
  const { pathname } = useLocation();
  const here = findNav(pathname);

  return (
    <div className="bg-canvas flex h-screen overflow-hidden">
      <aside className="flex w-64 shrink-0 flex-col">
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg">
            <Leaf className="size-5" aria-hidden />
          </span>
          <div className="leading-tight">
            <p className="text-base font-semibold">Mandiri Tani</p>
            <p className="text-muted-foreground text-sm">Toko pertanian</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Menu utama">
          {groups.map((g) => (
            <div key={g.label || 'home'} className="mt-3 first:mt-0">
              {g.label && <p className="text-muted-foreground px-3 pb-1 text-sm">{g.label}</p>}
              <ul className="space-y-0.5">
                {g.items.map((item) => (
                  <li key={item.to}>
                    {item.soon ? (
                      <span
                        className="text-muted-foreground/70 flex h-11 cursor-not-allowed items-center gap-3 rounded-lg px-3 text-base"
                        aria-disabled="true"
                      >
                        <item.icon className="size-5" aria-hidden />
                        <span className="flex-1">{item.label}</span>
                        <span className="text-muted-foreground rounded-full border px-2 text-xs">Segera</span>
                      </span>
                    ) : (
                      <NavLink
                        to={item.to}
                        end={item.to === '/'}
                        className={({ isActive }) =>
                          cn(
                            'flex h-11 items-center gap-3 rounded-lg border px-3 text-base transition-colors',
                            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                            isActive
                              ? 'bg-nav-active border-border text-foreground font-medium shadow-xs'
                              : 'text-foreground/80 hover:text-foreground border-transparent hover:bg-black/[0.04]',
                          )
                        }
                      >
                        <item.icon className="size-5" aria-hidden />
                        <span className="flex-1">{item.label}</span>
                        {item.count && totals.data && (
                          <span className="text-muted-foreground bg-surface-muted rounded-full border px-2 text-xs tabular-nums">
                            {formatNumber(String(totals.data[item.count]))}
                          </span>
                        )}
                      </NavLink>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <UserCard />
        <SystemStatus />
      </aside>

      <div className="bg-background my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border shadow-xs">
        <div className="flex h-14 shrink-0 items-center justify-between border-b px-6">
          <nav aria-label="Lokasi" className="text-muted-foreground flex items-center gap-1.5 text-base">
            {here?.group.label && (
              <>
                <span>{here.group.label}</span>
                <ChevronRight className="size-4" aria-hidden />
              </>
            )}
            {here ? (
              <Link to={here.item.to} className="text-foreground hover:underline">
                {here.item.label}
              </Link>
            ) : (
              <span className="text-foreground">Beranda</span>
            )}
          </nav>
          <span className="text-muted-foreground flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
            <CalendarDays className="size-4" aria-hidden />
            {formatDate(new Date())}
          </span>
        </div>
        <main className="flex-1 overflow-y-auto px-8 py-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Who is logged in + Keluar (sprint-2 D4). Switching user = Keluar, then Masuk. */
function UserCard() {
  const user = useSessionUser();
  const logout = useLogout();
  if (!user) return null;
  return (
    <div className="mx-3 flex items-center gap-3 rounded-xl border bg-background p-3">
      <UserRound className="text-tani-green-dark size-6 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate font-medium">{user.fullName}</p>
        <p className="text-muted-foreground text-sm">{ROLE_LABELS[user.role]}</p>
      </div>
      <Button variant="outline" className="h-11" onClick={() => logout.mutate()} disabled={logout.isPending}>
        <LogOut /> Keluar
      </Button>
    </div>
  );
}

/** Bottom of the sidebar: is the store server & database up (design-standards §3 status bar). */
function SystemStatus() {
  const health = useHealth();
  const ok = health.data?.db.ok === true;
  return (
    <div className="m-3 rounded-xl border bg-background p-3 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <span
          className={cn('size-2 rounded-full', ok ? 'bg-success' : health.isPending ? 'bg-warning' : 'bg-error')}
          aria-hidden
        />
        {ok ? 'Server & database berjalan' : health.isPending ? 'Memeriksa server…' : 'Server tidak terhubung'}
      </p>
      {health.data && <p className="text-muted-foreground mt-0.5 pl-4">Versi {health.data.version}</p>}
    </div>
  );
}
