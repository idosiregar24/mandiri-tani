import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Archive,
  Building2,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  HardDrive,
  Loader2,
  Percent,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { useUpdater } from '@/hooks/useUpdater';
import type { BackupItem, BackupKind, SystemDiagnostics } from '@shared/schemas/backups';
import type { PosSettings, StoreSettings } from '@shared/schemas/settings';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusPill } from '@/components/shared/StatusPill';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiDownload, apiGet, apiPost, apiPut } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';

const KIND_LABELS: Record<BackupKind, { label: string; tone: 'info' | 'success' | 'warning' | 'neutral' }> = {
  daily: { label: 'Otomatis Harian', tone: 'info' },
  manual: { label: 'Manual', tone: 'success' },
  pre_reset: { label: 'Pra-Reset', tone: 'warning' },
  pre_migrate: { label: 'Pra-Migrasi', tone: 'neutral' },
  other: { label: 'Lainnya', tone: 'neutral' },
};

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds} detik`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours} jam ${remMinutes} menit`;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function StoreSettingsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'profile' | 'pos' | 'backups' | 'diagnostics' | 'export' | 'updater'>('profile');
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const updater = useUpdater();

  const storeQuery = useQuery({
    queryKey: ['settings', 'store'],
    queryFn: () => apiGet<StoreSettings>('/settings/store'),
  });

  const posQuery = useQuery({
    queryKey: ['settings', 'pos'],
    queryFn: () => apiGet<PosSettings>('/settings/pos'),
  });

  const backupsQuery = useQuery({
    queryKey: ['backups'],
    queryFn: () => apiGet<BackupItem[]>('/backups'),
    enabled: tab === 'backups',
  });

  const diagnosticsQuery = useQuery({
    queryKey: ['diagnostics'],
    queryFn: () => apiGet<SystemDiagnostics>('/health/diagnostics'),
    enabled: tab === 'diagnostics',
  });

  // Local form state
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [fax, setFax] = useState('');
  const [email, setEmail] = useState('');
  const [footer, setFooter] = useState('');
  const [discountLimit, setDiscountLimit] = useState(5);

  // Sync state once loaded
  const [initialized, setInitialized] = useState(false);
  if (!initialized && storeQuery.data && posQuery.data) {
    setName(storeQuery.data.name || '');
    setAddress(storeQuery.data.address || '');
    setPhone(storeQuery.data.phone || '');
    setFax(storeQuery.data.fax || '');
    setEmail(storeQuery.data.email || '');
    setFooter(storeQuery.data.receiptFooter || '');
    setDiscountLimit(posQuery.data.cashierDiscountLimitPercent ?? 5);
    setInitialized(true);
  }

  const saveStore = useMutation({
    mutationFn: () =>
      apiPut<StoreSettings>('/settings/store', {
        name,
        address: address || null,
        phone: phone || null,
        fax: fax || null,
        email: email || null,
        receiptFooter: footer || null,
      }),
    onSuccess: () => {
      setMsg({ tone: 'success', text: 'Profil toko dan format struk berhasil disimpan.' });
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => {
      setMsg({ tone: 'error', text: err.message });
    },
  });

  const savePos = useMutation({
    mutationFn: () =>
      apiPut<PosSettings>('/settings/pos', {
        cashierDiscountLimitPercent: Number(discountLimit),
      }),
    onSuccess: () => {
      setMsg({ tone: 'success', text: 'Batas diskon kasir berhasil disimpan.' });
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => {
      setMsg({ tone: 'error', text: err.message });
    },
  });

  const triggerBackup = useMutation({
    mutationFn: () => apiPost<{ filename: string; message: string }>('/backups', {}),
    onSuccess: (res) => {
      setMsg({ tone: 'success', text: `Pencadangan manual (${res.filename}) berhasil dibuat.` });
      void qc.invalidateQueries({ queryKey: ['backups'] });
    },
    onError: (err) => {
      setMsg({ tone: 'error', text: err.message });
    },
  });

  // Restore state
  const [restoreTarget, setRestoreTarget] = useState<BackupItem | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const restoreMutation = useMutation({
    mutationFn: (target: { filename: string; confirmStoreName: string }) =>
      apiPost<{ ok: boolean; message: string }>('/backups/restore', target),
    onSuccess: () => {
      setMsg({
        tone: 'success',
        text: 'Database berhasil dipulihkan dari cadangan. Seluruh data telah diperbarui.',
      });
      setRestoreTarget(null);
      setRestoreConfirmText('');
      void qc.invalidateQueries();
    },
    onError: (err) => {
      setMsg({ tone: 'error', text: err.message });
    },
  });

  const [exporting, setExporting] = useState(false);
  async function handleExport() {
    setExporting(true);
    setMsg(null);
    try {
      await apiDownload('/masters/export-xlsx', 'master-data-mandiri-tani.xlsx');
      setMsg({ tone: 'success', text: 'File Excel master data berhasil diunduh.' });
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : 'Gagal mengunduh Excel.' });
    } finally {
      setExporting(false);
    }
  }

  async function handleDownloadBackup(filename: string) {
    try {
      await apiDownload(`/backups/${filename}/download`, filename);
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : 'Gagal mengunduh cadangan.' });
    }
  }

  const currentStoreName = storeQuery.data?.name || 'MANDIRI TANI';
  const canConfirmRestore =
    restoreConfirmText.trim().toLowerCase() === currentStoreName.trim().toLowerCase();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pengaturan Toko & Keandalan Sistem"
        description="Kelola profil toko, format struk, batas diskon kasir, cadangan & pemulihan database, serta diagnostik."
      />

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <div className="flex flex-wrap gap-2 border-b pb-2">
        <Button
          variant={tab === 'profile' ? 'default' : 'ghost'}
          onClick={() => {
            setTab('profile');
            setMsg(null);
          }}
          className="gap-2"
        >
          <Building2 className="size-4" /> Profil & Struk
        </Button>
        <Button
          variant={tab === 'pos' ? 'default' : 'ghost'}
          onClick={() => {
            setTab('pos');
            setMsg(null);
          }}
          className="gap-2"
        >
          <Percent className="size-4" /> Batas Diskon Kasir
        </Button>
        <Button
          variant={tab === 'backups' ? 'default' : 'ghost'}
          onClick={() => {
            setTab('backups');
            setMsg(null);
          }}
          className="gap-2"
        >
          <Database className="size-4" /> Cadangan & Pemulihan
        </Button>
        <Button
          variant={tab === 'diagnostics' ? 'default' : 'ghost'}
          onClick={() => {
            setTab('diagnostics');
            setMsg(null);
          }}
          className="gap-2"
        >
          <Activity className="size-4" /> Diagnostik Sistem
        </Button>
        <Button
          variant={tab === 'export' ? 'default' : 'ghost'}
          onClick={() => {
            setTab('export');
            setMsg(null);
          }}
          className="gap-2"
        >
          <FileSpreadsheet className="size-4" /> Ekspor Master Data
        </Button>
        <Button
          variant={tab === 'updater' ? 'default' : 'ghost'}
          onClick={() => {
            setTab('updater');
            setMsg(null);
          }}
          className="gap-2 relative"
        >
          <Sparkles className="size-4" /> Pembaruan Aplikasi
          {updater.hasUpdate && (
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
          )}
        </Button>
      </div>

      {tab === 'profile' && (
        <form
          className="max-w-2xl space-y-4 rounded-xl border bg-card p-6"
          onSubmit={(e) => {
            e.preventDefault();
            saveStore.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="name">Nama Toko *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="MANDIRI TANI"
              required
            />
            <p className="text-muted-foreground text-xs">Dicetak di baris paling atas struk kasir dan faktur penjualan.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="address">Alamat Toko</Label>
            <Input
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Jl. Poros RAPP Km. 72, Pangkalan Kerinci"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Nomor Telepon Toko</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0812-3456-7890"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fax">Nomor Fax</Label>
              <Input
                id="fax"
                value={fax}
                onChange={(e) => setFax(e.target.value)}
                placeholder="0761-12345"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Alamat Email Toko</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="mandiritani@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="footer">Catatan Kaki Struk (Thermal)</Label>
            <Textarea
              id="footer"
              value={footer}
              onChange={(e) => setFooter(e.target.value)}
              placeholder="Barang yang telah dibeli tidak dapat ditukar/dikembalikan kecuali ada perjanjian"
              rows={2}
            />
          </div>

          <div className="pt-2">
            <Button type="submit" disabled={saveStore.isPending} className="gap-2">
              <Save className="size-4" /> Simpan Profil Toko
            </Button>
          </div>
        </form>
      )}

      {tab === 'pos' && (
        <form
          className="max-w-xl space-y-4 rounded-xl border bg-card p-6"
          onSubmit={(e) => {
            e.preventDefault();
            savePos.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="discountLimit">Batas Diskon Kasir (%)</Label>
            <Input
              id="discountLimit"
              type="number"
              min={0}
              max={100}
              value={discountLimit}
              onChange={(e) => setDiscountLimit(Number(e.target.value))}
              required
            />
            <p className="text-muted-foreground text-xs">
              Kasir dapat memberikan diskon hingga batas ini tanpa memerlukan otorisasi PIN Owner. Diskon di atas angka ini
              akan otomatis meminta PIN Owner.
            </p>
          </div>

          <div className="pt-2">
            <Button type="submit" disabled={savePos.isPending} className="gap-2">
              <Save className="size-4" /> Simpan Batas Diskon
            </Button>
          </div>
        </form>
      )}

      {tab === 'backups' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border bg-card p-5">
            <div>
              <h3 className="font-semibold text-base">Pencadangan Database Otomatis & Manual</h3>
              <p className="text-muted-foreground text-sm mt-0.5">
                Sistem mencadangkan database secara otomatis setiap hari (retensi 14 cadangan harian + 8 mingguan). Anda juga dapat membuat cadangan manual kapan saja.
              </p>
            </div>
            <Button
              onClick={() => triggerBackup.mutate()}
              disabled={triggerBackup.isPending}
              className="gap-2 whitespace-nowrap self-start sm:self-auto"
            >
              {triggerBackup.isPending ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-4" />}
              {triggerBackup.isPending ? 'Mencadangkan...' : 'Cadangkan Sekarang'}
            </Button>
          </div>

          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="border-b px-5 py-3 font-semibold text-sm">
              Daftar File Cadangan Tersimpan ({backupsQuery.data?.length ?? 0})
            </div>

            {backupsQuery.isLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
                <Loader2 className="size-4 animate-spin" /> Memuat daftar cadangan...
              </div>
            ) : !backupsQuery.data || backupsQuery.data.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                Belum ada file cadangan yang ditemukan. Klik tombol <strong>Cadangkan Sekarang</strong> untuk membuat cadangan pertama.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-muted text-muted-foreground text-xs uppercase border-b">
                    <tr>
                      <th className="px-5 py-3 text-left">Nama File</th>
                      <th className="px-5 py-3 text-left">Tanggal Pembuatan</th>
                      <th className="px-5 py-3 text-left">Ukuran</th>
                      <th className="px-5 py-3 text-left">Jenis Cadangan</th>
                      <th className="px-5 py-3 text-left">Integritas</th>
                      <th className="px-5 py-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {backupsQuery.data.map((b) => {
                      const kind = KIND_LABELS[b.kind] || KIND_LABELS.other;
                      return (
                        <tr key={b.filename} className="hover:bg-surface-muted/50 transition-colors">
                          <td className="px-5 py-3.5 font-mono text-xs font-medium text-foreground">
                            {b.filename}
                          </td>
                          <td className="px-5 py-3.5 text-muted-foreground whitespace-nowrap">
                            {formatDateTime(b.createdAt)}
                          </td>
                          <td className="px-5 py-3.5 text-muted-foreground whitespace-nowrap">
                            {b.sizeFormatted}
                          </td>
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            <StatusPill tone={kind.tone}>{kind.label}</StatusPill>
                          </td>
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            {b.verified ? (
                              <span className="inline-flex items-center gap-1.5 text-success-ink text-xs font-medium">
                                <CheckCircle2 className="size-4" /> Valid
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-warning-ink text-xs font-medium">
                                <ShieldAlert className="size-4" /> Belum terverifikasi
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-right whitespace-nowrap space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDownloadBackup(b.filename)}
                              className="gap-1.5 h-8"
                            >
                              <Download className="size-3.5" /> Unduh
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setRestoreTarget(b);
                                setRestoreConfirmText('');
                              }}
                              className="gap-1.5 h-8 text-error-ink hover:text-error-ink hover:bg-error-surface"
                            >
                              <RotateCcw className="size-3.5" /> Pulihkan
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'diagnostics' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Status Kesehatan Sistem & Database</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void diagnosticsQuery.refetch()}
              disabled={diagnosticsQuery.isFetching}
              className="gap-2"
            >
              <RefreshCw className={`size-3.5 ${diagnosticsQuery.isFetching ? 'animate-spin' : ''}`} /> Segarkan
            </Button>
          </div>

          {diagnosticsQuery.isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Memeriksa status sistem...
            </div>
          ) : diagnosticsQuery.data ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Card 1: Database PostgreSQL */}
              <div className="rounded-xl border bg-card p-5 space-y-3">
                <div className="flex items-center gap-2.5 text-muted-foreground">
                  <Database className="size-4 text-primary" />
                  <span className="text-xs uppercase font-medium">Database PostgreSQL</span>
                </div>
                <div>
                  <p className="text-2xl font-bold">{diagnosticsQuery.data.database.sizeFormatted}</p>
                  <p className="text-muted-foreground text-xs mt-1">
                    Database: <span className="font-mono">{diagnosticsQuery.data.database.name}</span>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Versi: {diagnosticsQuery.data.database.version}
                  </p>
                </div>
                <div className="border-t pt-2 text-xs text-muted-foreground">
                  Koneksi aktif: <strong className="text-foreground">{diagnosticsQuery.data.database.activeConnections}</strong>
                  {' · '}
                  Pool: {diagnosticsQuery.data.database.poolStats.idle} idle
                </div>
              </div>

              {/* Card 2: Kapasitas Cadangan */}
              <div className="rounded-xl border bg-card p-5 space-y-3">
                <div className="flex items-center gap-2.5 text-muted-foreground">
                  <HardDrive className="size-4 text-primary" />
                  <span className="text-xs uppercase font-medium">Penyimpanan Cadangan</span>
                </div>
                <div>
                  <p className="text-2xl font-bold">{diagnosticsQuery.data.storage.totalBackupSizeFormatted}</p>
                  <p className="text-muted-foreground text-xs mt-1">
                    Total {diagnosticsQuery.data.storage.backupCount} file cadangan (.dump)
                  </p>
                </div>
                <div className="border-t pt-2 text-xs text-success-ink font-medium">
                  Kebijakan retensi otomatis aktif
                </div>
              </div>

              {/* Card 3: Statistik Rekod */}
              <div className="rounded-xl border bg-card p-5 space-y-3">
                <div className="flex items-center gap-2.5 text-muted-foreground">
                  <FileSpreadsheet className="size-4 text-primary" />
                  <span className="text-xs uppercase font-medium">Data Transaksi & Master</span>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Produk / Barang:</span>
                    <strong className="text-foreground">{diagnosticsQuery.data.counts.products}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Transaksi Penjualan:</span>
                    <strong className="text-foreground">{diagnosticsQuery.data.counts.sales}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Pelanggan / Supplier:</span>
                    <strong className="text-foreground">
                      {diagnosticsQuery.data.counts.customers} / {diagnosticsQuery.data.counts.suppliers}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Mutasi Stok:</span>
                    <strong className="text-foreground">{diagnosticsQuery.data.counts.stockLedgerEntries}</strong>
                  </div>
                </div>
                <div className="border-t pt-2 text-xs text-muted-foreground">
                  Audit log: {diagnosticsQuery.data.counts.auditLogs} peristiwa tercatat
                </div>
              </div>

              {/* Card 4: Operasional & Uptime */}
              <div className="rounded-xl border bg-card p-5 space-y-3">
                <div className="flex items-center gap-2.5 text-muted-foreground">
                  <Activity className="size-4 text-primary" />
                  <span className="text-xs uppercase font-medium">Status Operasional</span>
                </div>
                <div>
                  <p className="text-lg font-bold">{formatUptime(diagnosticsQuery.data.uptimeSeconds)}</p>
                  <p className="text-muted-foreground text-xs mt-1">
                    Versi Aplikasi: {diagnosticsQuery.data.appVersion}
                  </p>
                </div>
                <div className="border-t pt-2">
                  <StatusPill tone={diagnosticsQuery.data.goLive.isLive ? 'success' : 'warning'}>
                    {diagnosticsQuery.data.goLive.isLive ? 'Mode Produksi (Go-Live)' : 'Mode Persiapan (Gladi)'}
                  </StatusPill>
                </div>
              </div>
            </div>
          ) : (
            <Notice tone="error">Gagal memuat status diagnostik sistem.</Notice>
          )}
        </div>
      )}

      {tab === 'export' && (
        <div className="max-w-2xl space-y-4 rounded-xl border bg-card p-6">
          <div>
            <h3 className="text-base font-semibold">Ekspor Master Data (Excel)</h3>
            <p className="text-muted-foreground text-sm mt-1">
              Unduh seluruh data barang (beserta harga dan satuan), daftar pelanggan (beserta plafon kredit), dan
              daftar supplier ke dalam satu file Excel (.xlsx).
            </p>
          </div>

          <div className="rounded-lg bg-surface-muted p-4 space-y-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Struktur lembar kerja (Sheets):</p>
            <ul className="list-disc pl-4 space-y-1">
              <li><strong>Item:</strong> Kode SKU, barcode, nama barang, satuan dasar, kategori, merek, harga jual, status.</li>
              <li><strong>Pelanggan:</strong> Kode, nama, grup, alamat, nomor telepon, limit kredit, status.</li>
              <li><strong>Supplier:</strong> Kode, nama, alamat, nomor telepon, kontak person, status.</li>
            </ul>
          </div>

          <Button onClick={handleExport} disabled={exporting} className="gap-2">
            <Download className="size-4" /> {exporting ? 'Mengunduh...' : 'Unduh Master Data Excel (.xlsx)'}
          </Button>
        </div>
      )}

      {tab === 'updater' && (
        <div className="max-w-3xl space-y-6">
          <div className="rounded-xl border bg-card p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold">Pembaruan Desktop via GitHub Releases</h3>
                <p className="text-muted-foreground text-sm mt-1">
                  Sistem mengecek ketersediaan rilis baru secara berkala di repository GitHub.
                </p>
              </div>
              <Button
                onClick={async () => {
                  const res = await updater.checkForUpdates();
                  if (res.hasUpdate) {
                    setMsg({ tone: 'success', text: `Pembaruan versi ${res.version} tersedia!` });
                  } else if (res.error) {
                    setMsg({ tone: 'error', text: res.error });
                  } else {
                    setMsg({ tone: 'success', text: 'Aplikasi Anda sudah menggunakan versi paling mutakhir.' });
                  }
                }}
                disabled={updater.isChecking || updater.isDownloading}
                className="gap-2 shrink-0"
              >
                {updater.isChecking ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                {updater.isChecking ? 'Memeriksa...' : 'Periksa Pembaruan Sekarang'}
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="rounded-lg border p-4 space-y-1">
                <span className="text-xs text-muted-foreground uppercase font-semibold">Versi Terpasang</span>
                <p className="text-lg font-mono font-bold text-foreground">
                  v{updater.status.currentVersion}
                </p>
                <p className="text-xs text-muted-foreground">Mandiri Tani POS (Desktop NSIS)</p>
              </div>

              <div className="rounded-lg border p-4 space-y-1">
                <span className="text-xs text-muted-foreground uppercase font-semibold">Status Pembaruan</span>
                <div className="flex items-center gap-2 pt-0.5">
                  {updater.status.state === 'AVAILABLE' ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
                      <Sparkles className="size-4" /> Tersedia v{updater.status.availableVersion}
                    </span>
                  ) : updater.status.state === 'DOWNLOADING' ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
                      <Loader2 className="size-4 animate-spin" /> Mengunduh ({updater.status.progress?.percent ?? 0}%)
                    </span>
                  ) : updater.status.state === 'DOWNLOADED' ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                      <CheckCircle2 className="size-4" /> Siap Dipasang (v{updater.status.availableVersion})
                    </span>
                  ) : updater.status.state === 'CHECKING' ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" /> Memeriksa rilis...
                    </span>
                  ) : updater.status.state === 'ERROR' ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-error-ink">
                      <ShieldAlert className="size-4" /> Gagal memeriksa
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                      <CheckCircle2 className="size-4" /> Versi Terbaru
                    </span>
                  )}
                </div>
                {updater.status.lastCheckedAt && (
                  <p className="text-xs text-muted-foreground">
                    Terakhir dicek: {formatDateTime(updater.status.lastCheckedAt)}
                  </p>
                )}
              </div>
            </div>

            {/* Action Card if Update Available */}
            {updater.status.state === 'AVAILABLE' && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-sm text-foreground">
                      Pembaruan v{updater.status.availableVersion} Siap Diunduh
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Proses pengunduhan berjalan di latar belakang tanpa mengganggu transaksi kasir.
                    </p>
                  </div>
                  <Button onClick={() => void updater.downloadUpdate()} className="gap-2">
                    <Download className="size-4" /> Unduh Sekarang
                  </Button>
                </div>

                {updater.status.releaseNotes && (
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-muted-foreground uppercase">Catatan Rilis:</span>
                    <div className="max-h-36 overflow-y-auto rounded border bg-background/80 p-2.5 font-mono text-xs whitespace-pre-wrap">
                      {updater.status.releaseNotes}
                    </div>
                  </div>
                )}
              </div>
            )}

            {updater.status.state === 'DOWNLOADING' && (
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex justify-between text-xs font-medium">
                  <span>Mengunduh installer dari GitHub Releases...</span>
                  <span>{updater.status.progress?.percent ?? 0}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className="bg-primary h-full transition-all duration-300"
                    style={{ width: `${updater.status.progress?.percent ?? 0}%` }}
                  />
                </div>
                <div className="flex justify-between text-muted-foreground text-xs">
                  <span>{formatBytes(updater.status.progress?.bytesPerSecond)}/dtk</span>
                  <span>
                    {formatBytes(updater.status.progress?.transferred)} / {formatBytes(updater.status.progress?.total)}
                  </span>
                </div>
              </div>
            )}

            {updater.status.state === 'DOWNLOADED' && (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50/50 p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="font-semibold text-sm text-emerald-950 flex items-center gap-1.5">
                      <CheckCircle2 className="size-4 text-emerald-600" /> Pembaruan Telah Selesai Diunduh
                    </h4>
                    <p className="text-xs text-emerald-800 mt-1">
                      Aplikasi siap diperbarui ke versi v{updater.status.availableVersion}. Database PostgreSQL akan dimatikan secara aman sebelum aplikasi mulai ulang.
                    </p>
                  </div>
                  <Button
                    onClick={() => void updater.installUpdate()}
                    className="gap-2 bg-emerald-600 hover:bg-emerald-700 shrink-0"
                  >
                    <RefreshCw className="size-4" /> Pasang &amp; Mulai Ulang
                  </Button>
                </div>
              </div>
            )}

            {/* Release Instructions for Owner/Developer */}
            <div className="rounded-lg bg-surface-muted/60 p-4 space-y-2 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">💡 Panduan Rilis Pembaruan (Untuk Developer / Owner):</p>
              <ol className="list-decimal pl-4 space-y-1">
                <li>Ubah nomor versi di file <code className="font-mono text-foreground">package.json</code> (misal dari 0.1.0 ke 0.2.0).</li>
                <li>Jalankan perintah build &amp; release: <code className="font-mono text-foreground">npm run dist -- --publish always</code> (dengan token GitHub).</li>
                <li>GitHub Releases otomatis mempublikasikan installer dan file manifest <code className="font-mono text-foreground">latest.yml</code>.</li>
                <li>PC kasir akan otomatis menerima notifikasi pembaruan saat terkoneksi ke internet.</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Restore Confirmation Dialog */}
      {restoreTarget && (
        <Dialog open={true} onOpenChange={(open) => !open && setRestoreTarget(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-error-ink">
                <ShieldAlert className="size-5" /> Pulihkan Database?
              </DialogTitle>
              <DialogDescription className="space-y-3 pt-2 text-foreground text-sm">
                <p>
                  Anda akan memulihkan data dari file cadangan:
                  <br />
                  <span className="font-mono font-semibold text-xs bg-surface-muted p-1 rounded inline-block mt-1">
                    {restoreTarget.filename}
                  </span>
                </p>
                <div className="rounded-lg bg-error-surface p-3 text-xs text-error-ink space-y-1">
                  <p className="font-semibold">PERINGATAN RISIKO DATA:</p>
                  <p>
                    Tindakan ini akan <strong>menimpa data aktif saat ini</strong> dengan data dari file cadangan. Database saat ini akan otomatis diarsipkan sebagai cadangan darurat.
                  </p>
                </div>
                <div className="space-y-1.5 pt-2">
                  <Label htmlFor="confirmStoreName" className="text-xs">
                    Ketik nama toko (<strong>{currentStoreName}</strong>) untuk mengonfirmasi:
                  </Label>
                  <Input
                    id="confirmStoreName"
                    value={restoreConfirmText}
                    onChange={(e) => setRestoreConfirmText(e.target.value)}
                    placeholder={currentStoreName}
                    autoComplete="off"
                  />
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setRestoreTarget(null)}
                disabled={restoreMutation.isPending}
              >
                Batal
              </Button>
              <Button
                variant="destructive"
                disabled={!canConfirmRestore || restoreMutation.isPending}
                onClick={() =>
                  restoreMutation.mutate({
                    filename: restoreTarget.filename,
                    confirmStoreName: restoreConfirmText,
                  })
                }
                className="gap-2"
              >
                {restoreMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                {restoreMutation.isPending ? 'Memulihkan...' : 'Pulihkan Database'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
