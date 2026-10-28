import type { ReactNode } from 'react';

/** Full-screen canvas with one centred card — login, setup wizard, connection errors. */
export function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="bg-canvas flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-xl">{children}</div>
    </main>
  );
}
