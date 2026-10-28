// Nothing of the app is shown without a session (sprint-2 D1): first run → setup wizard,
// otherwise the login screen. Logging in happens only from this PC's own window.
import { Loader2 } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Notice } from '@/components/shared/Notice';
import { useSetupStatus } from '@/features/auth/api';
import { isDesktop } from '@/lib/desktop';
import { useSessionStore } from '@/lib/session';
import { LoginScreen } from '@/pages/auth/LoginScreen';
import { SetupWizard } from '@/pages/auth/SetupWizard';
import { Centered } from './Centered';

export function AuthGate({ children }: { children: ReactNode }) {
  const loggedIn = useSessionStore((s) => s.session !== null);
  const status = useSetupStatus();
  const qc = useQueryClient();

  // A new user must never see the previous user's cached data.
  useEffect(() => {
    if (!loggedIn) qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'setup' && q.queryKey[0] !== 'auth' });
  }, [loggedIn, qc]);

  if (loggedIn) return <>{children}</>;
  if (!isDesktop()) {
    return (
      <Centered>
        <Notice tone="warning" title="Buka dari komputer kasir">
          Untuk masuk, buka aplikasi Mandiri Tani POS di komputer kasir toko.
        </Notice>
      </Centered>
    );
  }
  if (status.isPending) {
    return (
      <Centered>
        <Loader2 className="text-tani-green mx-auto size-10 animate-spin" aria-label="Memuat" />
      </Centered>
    );
  }
  if (status.isError) {
    return (
      <Centered>
        <Notice tone="error" title="Tidak bisa menghubungi server toko">
          {status.error.message} Tutup lalu buka lagi aplikasinya.
        </Notice>
      </Centered>
    );
  }
  return status.data.needsSetup ? <SetupWizard status={status.data} /> : <LoginScreen />;
}
