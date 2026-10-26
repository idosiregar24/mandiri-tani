// "Impor iPOS" (Sprint 3 E8, FR-MIG-01…04/08): 1) pilih file → 2) pratinjau & masalah data →
// 3) impor → 4) rekonsiliasi. Reset data persiapan at the bottom. Owner only.
import { CheckCircle2, FileInput, FolderOpen, Loader2, RotateCcw, Upload, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { IMPORT_PURPOSES, type ImportBatch, type ImportPurpose, type IposInspectResult } from '@shared/schemas/imports';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCommitIpos, useImportBatches, useInspectIpos, useResetPreparation } from '@/features/imports/api';
import { desktopBridge } from '@/lib/desktop';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useCan } from '@/lib/session';
import { cn } from '@/lib/utils';

const PURPOSE_LABELS: Record<ImportPurpose, string> = {
  DEVELOPMENT: 'Uji coba (pengembangan)',
  REHEARSAL: 'Gladi sebelum go-live',
  GO_LIVE: 'Go-live (data resmi)',
};
const STATUS_LABELS: Record<ImportBatch['status'], string> = {
  RUNNING: 'Berjalan',
  COMMITTED: 'Berhasil',
  FAILED: 'Gagal',
  DISCARDED: 'Sudah direset',
};
const COUNT_LABELS: [keyof NonNullable<IposInspectResult['counts']>, string][] = [
  ['products', 'Barang'],
  ['multiUnitProducts', 'Barang dengan lebih dari satu satuan'],
  ['derivedUnits', 'Satuan turunan (mis. ZAK = 50 KG)'],
  ['pricedUnits', 'Harga jual per satuan'],
  ['categories', 'Kategori'],
  ['units', 'Satuan'],
  ['customerGroups', 'Grup pelanggan'],
  ['customers', 'Pelanggan'],
  ['suppliers', 'Supplier'],
  ['bankAccounts', 'Rekening bank'],
];

export function IposImportPage() {
  const bridge = desktopBridge();
  const canImport = useCan('imports.ipos');
  const canReset = useCan('system.reset_preparation');
  const inspect = useInspectIpos();
  const commit = useCommitIpos();
  const batches = useImportBatches();
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<{ message: string; detail?: string } | null>(null);
  const [purpose, setPurpose] = useState<ImportPurpose>('DEVELOPMENT');
  const [result, setResult] = useState<ImportBatch | null>(null);

  if (!canImport) return <Notice tone="warning">Hanya Owner yang boleh mengimpor data dari iPOS.</Notice>;

  const choose = async () => {
    if (!bridge) return;
    setPickError(null);
    setResult(null);
    commit.reset();
    inspect.reset();
    setPicking(true);
    try {
      const r = await bridge.chooseIposBackup();
      if (r.status === 'FAILED') setPickError({ message: r.message, detail: r.detail });
      if (r.status === 'RESTORED') inspect.mutate();
    } finally {
      setPicking(false);
    }
  };

  const runImport = () =>
    commit.mutate(
      { purpose },
      {
        onSuccess: (batch) => {
          setResult(batch);
          inspect.reset();
          // The temporary iPOS copy is no longer needed (FR-MIG-01).
          void bridge?.cleanupIposImport();
        },
      },
    );

  const preview = inspect.data;
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Impor dari iPOS"
        description="Pindahkan data master (barang, satuan, harga, pelanggan, supplier, rekening) dari backup iPOS 5."
        icon={FileInput}
      />

      {!bridge && <Notice tone="warning">Impor hanya bisa dijalankan dari aplikasi di komputer toko.</Notice>}

      <Step n={1} title="Pilih file backup iPOS" done={Boolean(preview) || Boolean(result)}>
        <p className="text-muted-foreground text-base">
          Buka iPOS → Backup Database, lalu pilih file <span className="font-mono">.i5bu</span> hasilnya. File hanya
          dibaca, tidak diubah dan tidak dikirim ke mana pun.
        </p>
        <Button
          size="lg"
          className="mt-3 h-12 text-base"
          onClick={() => void choose()}
          disabled={!bridge || picking || inspect.isPending || commit.isPending}
        >
          {picking || inspect.isPending ? <Loader2 className="animate-spin" /> : <FolderOpen />}
          {picking ? 'Membuka backup…' : inspect.isPending ? 'Memeriksa isi backup…' : 'Pilih File Backup'}
        </Button>
        {pickError && (
          <Notice tone="error" title={pickError.message} className="mt-3">
            {pickError.detail && <pre className="mt-2 text-sm whitespace-pre-wrap">{pickError.detail}</pre>}
          </Notice>
        )}
        {inspect.isError && (
          <Notice tone="error" className="mt-3">
            {inspect.error.message}
          </Notice>
        )}
      </Step>

      {preview && (
        <Preview
          preview={preview}
          purpose={purpose}
          onPurpose={setPurpose}
          onImport={runImport}
          importing={commit.isPending}
        />
      )}
      {commit.isError && <Notice tone="error">{commit.error.message}</Notice>}
      {result && <Reconciliation batch={result} />}

      <History batches={batches.data ?? []} />

      {canReset && <ResetCard />}
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-full text-base font-bold',
              done ? 'bg-primary text-primary-foreground' : 'bg-tani-green-light text-tani-green-dark',
            )}
          >
            {done ? <CheckCircle2 className="size-5" /> : n}
          </span>
          <CardTitle className="text-xl">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Preview({
  preview,
  purpose,
  onPurpose,
  onImport,
  importing,
}: {
  preview: IposInspectResult;
  purpose: ImportPurpose;
  onPurpose: (p: ImportPurpose) => void;
  onImport: () => void;
  importing: boolean;
}) {
  const s = preview.source;
  return (
    <>
      <Step n={2} title="Periksa isi backup">
        <dl className="grid grid-cols-[12rem_1fr] gap-x-4 gap-y-1 text-base">
          <dt className="text-muted-foreground">File</dt>
          <dd className="font-mono">{s.fileName}</dd>
          <dt className="text-muted-foreground">Dibuat iPOS</dt>
          <dd>{s.dumpCreatedAt ?? 'tidak diketahui'}</dd>
          <dt className="text-muted-foreground">Sidik file (SHA-256)</dt>
          <dd className="font-mono text-sm break-all">{s.sha256}</dd>
        </dl>

        {preview.fingerprint.length > 0 && (
          <Notice tone="error" title="Struktur backup tidak cocok — impor dihentikan" className="mt-4">
            <ul className="list-disc pl-5">
              {preview.fingerprint.map((f) => (
                <li key={f.table}>
                  <span className="font-mono">{f.table}</span>:{' '}
                  {f.missingColumns.length ? `kolom hilang ${f.missingColumns.join(', ')}` : 'tabel tidak ada'}
                </li>
              ))}
            </ul>
            <p className="mt-2">Kemungkinan backup dari versi iPOS lain. Hubungi pembuat aplikasi.</p>
          </Notice>
        )}

        {preview.counts && (
          <Table className="mt-4 text-base">
            <TableHeader>
              <TableRow className="bg-tani-green-light hover:bg-tani-green-light">
                <TableHead className="text-tani-green-dark text-base font-semibold">Data</TableHead>
                <TableHead className="text-tani-green-dark text-right text-base font-semibold">
                  Jumlah di iPOS
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {COUNT_LABELS.map(([key, label]) => (
                <TableRow key={key}>
                  <TableCell>{label}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(String(preview.counts![key]))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {preview.issues.length > 0 && (
          <div className="mt-5 space-y-2">
            <h3 className="text-lg font-semibold">Catatan kualitas data</h3>
            <p className="text-muted-foreground text-base">
              Tidak menghalangi impor. Periksa setelah impor bila perlu.
            </p>
            {preview.issues.map((i) => (
              <details key={i.code} className="rounded-lg border px-4 py-3">
                <summary className="cursor-pointer text-base">
                  <span className="font-semibold">{i.title}</span> — {formatNumber(String(i.count))} data
                  <span className="text-muted-foreground"> · {i.action}</span>
                </summary>
                {i.examples.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-base">
                    {i.examples.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                    {i.count > i.examples.length && (
                      <li className="text-muted-foreground">dan {i.count - i.examples.length} lainnya</li>
                    )}
                  </ul>
                )}
              </details>
            ))}
          </div>
        )}
      </Step>

      <Step n={3} title="Impor data master">
        {preview.blocker ? (
          <Notice tone="warning">{preview.blocker}</Notice>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-base">
              <span className="block font-medium">Tujuan impor</span>
              <Select value={purpose} onValueChange={(v) => onPurpose(v as ImportPurpose)}>
                <SelectTrigger className="h-12 w-72 text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPORT_PURPOSES.map((p) => (
                    <SelectItem key={p} value={p} className="text-base">
                      {PURPOSE_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <Button size="lg" className="h-12 text-base" onClick={onImport} disabled={importing}>
              {importing ? <Loader2 className="animate-spin" /> : <Upload />} Impor Data Master
            </Button>
          </div>
        )}
      </Step>
    </>
  );
}

function Reconciliation({ batch }: { batch: ImportBatch }) {
  const allMatch = batch.reconciliation.every((r) => r.ipos === r.imported);
  return (
    <Step n={4} title="Cocokkan hasil impor" done>
      <Notice
        tone={allMatch ? 'success' : 'warning'}
        title={
          allMatch
            ? 'Impor selesai — semua jumlah cocok dengan iPOS.'
            : 'Impor selesai, tetapi ada jumlah yang berbeda.'
        }
      >
        {!allMatch && 'Periksa baris yang ditandai merah. Bila salah, jalankan Reset data persiapan lalu impor ulang.'}
      </Notice>
      <Table className="mt-4 text-base">
        <TableHeader>
          <TableRow className="bg-tani-green-light hover:bg-tani-green-light">
            <TableHead className="text-tani-green-dark text-base font-semibold">Data</TableHead>
            <TableHead className="text-tani-green-dark text-right text-base font-semibold">iPOS</TableHead>
            <TableHead className="text-tani-green-dark text-right text-base font-semibold">Hasil impor</TableHead>
            <TableHead className="w-16" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {batch.reconciliation.map((r) => {
            const ok = r.ipos === r.imported;
            return (
              <TableRow key={r.label} className={cn(!ok && 'bg-error/10')}>
                <TableCell>{r.label}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(String(r.ipos))}</TableCell>
                <TableCell className={cn('text-right tabular-nums', !ok && 'text-error-ink font-semibold')}>
                  {formatNumber(String(r.imported))}
                </TableCell>
                <TableCell>
                  {ok ? (
                    <CheckCircle2 className="text-success-ink size-5" aria-label="cocok" />
                  ) : (
                    <XCircle className="text-error-ink size-5" aria-label="berbeda" />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Step>
  );
}

function History({ batches }: { batches: ImportBatch[] }) {
  if (batches.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Riwayat impor</CardTitle>
      </CardHeader>
      <CardContent>
        <Table className="text-base">
          <TableHeader>
            <TableRow className="bg-tani-green-light hover:bg-tani-green-light">
              <TableHead className="text-tani-green-dark text-base font-semibold">Waktu</TableHead>
              <TableHead className="text-tani-green-dark text-base font-semibold">File</TableHead>
              <TableHead className="text-tani-green-dark text-base font-semibold">Tujuan</TableHead>
              <TableHead className="text-tani-green-dark text-base font-semibold">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.map((b) => (
              <TableRow key={b.id}>
                <TableCell>{formatDateTime(b.startedAt)}</TableCell>
                <TableCell className="font-mono text-sm">{b.sourceFile}</TableCell>
                <TableCell>{PURPOSE_LABELS[b.purpose]}</TableCell>
                <TableCell>
                  <Badge variant={b.status === 'COMMITTED' ? 'default' : 'outline'} className="text-sm">
                    {STATUS_LABELS[b.status]}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** FR-MIG-08 — dangerous, so: typed confirmation + a second dialog + an automatic backup on the server side. */
function ResetCard() {
  const reset = useResetPreparation();
  const [typed, setTyped] = useState('');
  const [confirming, setConfirming] = useState(false);
  const ready = typed.trim().toUpperCase() === 'RESET';
  return (
    <Card className="border-error/40">
      <CardHeader>
        <CardTitle className="text-error-ink text-xl">Reset data persiapan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-base">
        <p>
          Menghapus semua barang, harga, pelanggan, supplier, rekening, dan riwayat impor, supaya bisa mengimpor ulang
          dari backup iPOS terbaru. Akun, perangkat, pengaturan printer, dan catatan audit <strong>tetap</strong>.
          Backup otomatis dibuat lebih dulu.
        </p>
        <p className="text-muted-foreground">Hanya bisa sebelum toko resmi go-live.</p>
        {reset.isSuccess && (
          <Notice tone="success" title="Data persiapan sudah direset.">
            Backup sebelum reset: <span className="font-mono">{reset.data.backupFile}</span>
          </Notice>
        )}
        {reset.isError && <Notice tone="error">{reset.error.message}</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Ketik RESET"
            aria-label="Ketik RESET untuk konfirmasi"
            className="h-11 w-48 font-mono text-base md:text-base"
          />
          <Button
            variant="destructive"
            className="h-11 text-base"
            disabled={!ready || reset.isPending}
            onClick={() => setConfirming(true)}
          >
            <RotateCcw /> Reset Data
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        tone="danger"
        title="Hapus semua data persiapan?"
        description="Data master hasil impor dan yang diketik manual akan dihapus. Backup otomatis dibuat dulu dan bisa dipulihkan."
        confirmLabel="Ya, reset sekarang"
        pending={reset.isPending}
        onConfirm={() =>
          reset.mutate(
            { confirm: typed },
            {
              onSettled: () => {
                setConfirming(false);
                setTyped('');
              },
            },
          )
        }
      />
    </Card>
  );
}
