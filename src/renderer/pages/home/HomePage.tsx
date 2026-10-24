// Sprint 1 placeholder: proves UI → embedded API → PostgreSQL end to end.
// Replaced by the real app shell in Sprint 2.
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Database, FolderOpen, Printer, Server, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet } from '@/lib/api-client';

interface Health {
  version: string;
  server_time: string;
  db: { ok: boolean; version?: string; latency_ms?: number; error?: string };
}

export function HomePage() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => apiGet<Health>('/health'), refetchInterval: 10_000 });
  const info = useQuery({ queryKey: ['app-info'], queryFn: () => window.pos!.appInfo(), enabled: Boolean(window.pos) });

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-tani-green-dark text-3xl font-bold">Mandiri Tani POS</h1>
      <p className="text-muted-foreground mt-2 text-lg">Fondasi aplikasi sudah berjalan. Layar kasir menyusul.</p>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-xl">Status sistem</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-lg">
          <StatusRow icon={<Server className="size-6" />} label="Server toko" ok={health.isSuccess} text={
            health.isSuccess ? `Berjalan (versi ${health.data.version})` : health.isError ? health.error.message : 'Memeriksa…'
          } />
          <StatusRow icon={<Database className="size-6" />} label="Database" ok={health.data?.db.ok ?? false} text={
            health.data?.db.ok
              ? `PostgreSQL ${health.data.db.version} — ${health.data.db.latency_ms} ms`
              : (health.data?.db.error ?? 'Memeriksa…')
          } />
          {info.data && (
            <p className="text-muted-foreground text-base">
              Data tersimpan di <span className="font-mono">{info.data.dataDir}</span>
            </p>
          )}
        </CardContent>
      </Card>

      {window.pos && (
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild size="lg" className="h-12 text-base">
            <Link to="/uji-cetak">
              <Printer /> Uji Cetak Printer
            </Link>
          </Button>
          <Button variant="outline" size="lg" className="h-12 text-base" onClick={() => void window.pos!.openLogFolder()}>
            <FolderOpen /> Buka folder log
          </Button>
        </div>
      )}
    </main>
  );
}

function StatusRow({ icon, label, ok, text }: { icon: ReactNode; label: string; ok: boolean; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground">{icon}</span>
      <span className="w-36 font-medium">{label}</span>
      {ok ? (
        <CheckCircle2 className="text-success-ink size-6" aria-label="baik" />
      ) : (
        <XCircle className="text-error-ink size-6" aria-label="bermasalah" />
      )}
      <span>{text}</span>
    </div>
  );
}
