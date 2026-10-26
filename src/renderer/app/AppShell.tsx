// Backoffice layout (design-standards §4): sidebar on the cream canvas, content on a white panel.
import { Leaf } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { navFor } from '@/lib/navigation';
import { useRole } from '@/lib/session';
import { cn } from '@/lib/utils';

export function AppShell() {
  const groups = navFor(useRole());
  return (
    <div className="bg-tani-cream flex h-screen overflow-hidden">
      <nav className="flex w-60 shrink-0 flex-col overflow-y-auto px-3 py-4" aria-label="Menu utama">
        <div className="text-tani-green-dark mb-4 flex items-center gap-2 px-3 text-lg font-bold">
          <Leaf className="size-6" aria-hidden /> Mandiri Tani
        </div>
        {groups.map((g) => (
          <div key={g.label || 'home'} className="mb-3">
            {g.label && <p className="text-muted-foreground px-3 pb-1 text-sm font-semibold uppercase">{g.label}</p>}
            <ul className="space-y-0.5">
              {g.items.map((item) => (
                <li key={item.to}>
                  {item.soon ? (
                    <span
                      className="text-muted-foreground flex h-11 cursor-not-allowed items-center gap-3 rounded-lg px-3 text-base opacity-70"
                      aria-disabled="true"
                    >
                      <item.icon className="size-5" aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      <span className="bg-muted rounded px-1.5 text-xs">Segera</span>
                    </span>
                  ) : (
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      className={({ isActive }) =>
                        cn(
                          'flex h-11 items-center gap-3 rounded-lg px-3 text-base transition-colors',
                          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                          isActive ? 'bg-primary text-primary-foreground font-semibold' : 'hover:bg-tani-green-light',
                        )
                      }
                    >
                      <item.icon className="size-5" aria-hidden />
                      {item.label}
                    </NavLink>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <main className="bg-background my-3 mr-3 min-w-0 flex-1 overflow-y-auto rounded-xl border p-6">
        <Outlet />
      </main>
    </div>
  );
}
