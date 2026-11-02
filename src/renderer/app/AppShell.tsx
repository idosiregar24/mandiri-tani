// Backoffice layout: sidebar on clean canvas, content on white panel with breadcrumbs.
import { CalendarDays, ChevronDown, ChevronRight, Leaf, LogOut, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { PreparationBanner } from '@/features/system/PreparationBanner';
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

  // Collapsible sidebar menu sections
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem('mandiri-tani.sidebar-collapsed-groups');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const toggleGroup = (groupLabel: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [groupLabel]: !prev[groupLabel] };
      try {
        localStorage.setItem('mandiri-tani.sidebar-collapsed-groups', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // If navigating to a page in a group, automatically expand it so active link is visible
  useEffect(() => {
    if (here?.group.label && collapsedGroups[here.group.label]) {
      setCollapsedGroups((prev) => {
        const next = { ...prev, [here.group.label]: false };
        try {
          localStorage.setItem('mandiri-tani.sidebar-collapsed-groups', JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    }
  }, [here?.group.label]);

  return (
    <div className="bg-canvas flex h-screen overflow-hidden print:block print:h-auto print:overflow-visible print:bg-background">
      <aside className="flex w-64 shrink-0 flex-col print:hidden">
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-xl shadow-2xs">
            <Leaf className="size-5" aria-hidden />
          </span>
          <div className="leading-tight">
            <p className="text-base font-bold tracking-tight text-foreground">Mandiri Tani</p>
            <p className="text-xs text-muted-foreground font-normal">Toko Pertanian</p>
          </div>
        </div>

        {/* Main Navigation with Collapsible Sections */}
        <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Menu utama">
          {groups.map((g) => {
            const hasLabel = Boolean(g.label);
            const isCollapsed = hasLabel && Boolean(collapsedGroups[g.label]);

            return (
              <div key={g.label || 'home'} className="mt-3 first:mt-0">
                {hasLabel ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.label)}
                    aria-expanded={!isCollapsed}
                    className="group/btn flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 hover:text-foreground transition-colors rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
                  >
                    <span>{g.label}</span>
                    <ChevronDown
                      className={cn(
                        'size-3.5 text-muted-foreground/60 transition-transform duration-200 group-hover/btn:text-foreground',
                        isCollapsed && '-rotate-90',
                      )}
                      aria-hidden
                    />
                  </button>
                ) : null}

                {!isCollapsed && (
                  <ul className="space-y-0.5 mt-0.5">
                    {g.items.map((item) => (
                      <li key={item.to}>
                        {item.soon ? (
                          <span
                            className="text-muted-foreground/60 flex h-10 cursor-not-allowed items-center gap-3 rounded-xl px-3 text-sm"
                            aria-disabled="true"
                          >
                            <item.icon className="size-4 shrink-0" aria-hidden />
                            <span className="flex-1 truncate">{item.label}</span>
                            <span className="text-muted-foreground rounded-full border border-border px-2 py-0.5 text-[10px]">
                              Segera
                            </span>
                          </span>
                        ) : (
                          <NavLink
                            to={item.to}
                            end={item.to === '/'}
                            className={({ isActive }) =>
                              cn(
                                'flex h-10 items-center gap-3 rounded-xl border px-3 text-sm transition-all duration-150',
                                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                                isActive
                                  ? 'bg-nav-active border-border text-foreground font-semibold shadow-xs'
                                  : 'text-foreground/80 hover:text-foreground border-transparent hover:bg-black/[0.04]',
                              )
                            }
                          >
                            <item.icon className="size-4 shrink-0" aria-hidden />
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.count && totals.data && (
                              <span className="text-muted-foreground bg-surface-muted border border-border rounded-full px-2 py-0.5 text-xs font-mono font-medium tabular-nums">
                                {formatNumber(String(totals.data[item.count]))}
                              </span>
                            )}
                          </NavLink>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        <UserCard />
        <SystemStatus />
      </aside>

      {/* Main Content Area */}
      <div className="bg-background my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border shadow-xs print:m-0 print:block print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
        <PreparationBanner />
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/70 px-6 print:hidden">
          <nav aria-label="Lokasi" className="text-muted-foreground flex items-center gap-1.5 text-xs sm:text-sm font-medium">
            {here?.group.label && (
              <>
                <span className="text-muted-foreground">{here.group.label}</span>
                <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden />
              </>
            )}
            {here ? (
              <Link to={here.item.to} className="text-foreground font-semibold hover:underline">
                {here.item.label}
              </Link>
            ) : (
              <span className="text-foreground font-semibold">Beranda</span>
            )}
          </nav>
          <span className="text-muted-foreground flex items-center gap-2 rounded-full border border-border bg-surface-muted px-3 py-1 text-xs font-medium">
            <CalendarDays className="size-3.5 text-muted-foreground" aria-hidden />
            {formatDate(new Date())}
          </span>
        </div>
        <main className="flex-1 overflow-y-auto px-8 py-7 print:overflow-visible print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Who is logged in + Keluar */
function UserCard() {
  const user = useSessionUser();
  const logout = useLogout();
  if (!user) return null;
  return (
    <div className="mx-3.5 mb-2 flex items-center gap-3 rounded-xl border border-border bg-background p-3 shadow-2xs">
      <div className="bg-surface-muted text-foreground/80 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60">
        <UserRound className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-xs font-semibold text-foreground">{user.fullName}</p>
        <p className="text-muted-foreground text-[11px]">{ROLE_LABELS[user.role]}</p>
      </div>
      <Button
        variant="outline"
        size="xs"
        className="h-8 px-2.5 text-xs text-foreground/80 hover:text-rose-700 hover:border-border"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
      >
        <LogOut className="size-3" /> Keluar
      </Button>
    </div>
  );
}

/** Bottom of the sidebar: system status (dots removed per user request) */
function SystemStatus() {
  const health = useHealth();
  const ok = health.data?.db.ok === true;
  return (
    <div className="mx-3.5 mb-3 rounded-xl border border-border bg-background p-3 text-xs shadow-2xs">
      <p className="font-semibold text-foreground">
        {ok ? 'Server & DB Berjalan' : health.isPending ? 'Memeriksa server…' : 'Server terputus'}
      </p>
      {health.data && (
        <p className="text-muted-foreground text-[11px] mt-0.5">
          v{health.data.version} · {health.data.db.latency_ms ? `${health.data.db.latency_ms}ms` : 'Lokal'}
        </p>
      )}
    </div>
  );
}
