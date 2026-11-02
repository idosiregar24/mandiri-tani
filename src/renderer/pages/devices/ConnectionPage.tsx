import { useState, useMemo } from 'react';
import {
  AlertTriangle,
  HardDrive,
  Info,
  Laptop,
  Monitor,
  Plus,
  RefreshCw,
  Server,
  Smartphone,
  Wifi,
} from 'lucide-react';
import type { DeviceItem } from '@shared/schemas/devices';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/shared/StatusPill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDevices, useNetworkInfo, useRevokeDevice } from '@/features/devices/api';
import { PairingDialog } from '@/features/devices/PairingDialog';

export function ConnectionPage() {
  const [pairingOpen, setPairingOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<DeviceItem | null>(null);
  const [filterKind, setFilterKind] = useState<'ALL' | 'ACTIVE' | 'REVOKED'>('ALL');

  const { data: devices, isLoading: loadingDevices, refetch: refetchDevices } = useDevices();
  const { data: network, refetch: refetchNetwork } = useNetworkInfo();
  const revoke = useRevokeDevice();

  const handleRevokeConfirm = () => {
    if (!revokeTarget) return;
    revoke.mutate(revokeTarget.id, {
      onSuccess: () => {
        setRevokeTarget(null);
      },
    });
  };

  const activeCount = devices?.filter((d) => !d.revokedAt).length ?? 0;
  const mobileCount = devices?.filter((d) => d.kind === 'MOBILE' && !d.revokedAt).length ?? 0;
  const terminalCount = devices?.filter((d) => d.kind === 'TERMINAL' && !d.revokedAt).length ?? 0;
  const hubCount = 1; // Komputer ini
  const totalRegistered = (devices?.length ?? 0) + 1;

  const filteredDevices = useMemo(() => {
    if (!devices) return [];
    if (filterKind === 'ACTIVE') return devices.filter((d) => !d.revokedAt);
    if (filterKind === 'REVOKED') return devices.filter((d) => !!d.revokedAt);
    return devices;
  }, [devices, filterKind]);

  // Donut chart segments for device distribution
  const segments = [
    { label: 'Hub Utama', count: hubCount, color: '#2e7d32', desc: 'Komputer server lokal ini' },
    { label: 'Terminal Kasir', count: terminalCount, color: '#1565c0', desc: 'PC meja kasir kedua / cabang' },
    { label: 'HP Staf Mobile', count: mobileCount, color: '#f9a825', desc: 'Android cek harga, stok & opname' },
  ];
  const totalPie = segments.reduce((sum, s) => sum + s.count, 0);

  const radius = 54;
  const strokeWidth = 14;
  const circumference = 2 * Math.PI * radius;

  const headerActions = (
    <div className="flex items-center gap-2.5">
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void refetchDevices();
          void refetchNetwork();
        }}
        className="gap-2"
      >
        <RefreshCw className="size-3.5" />
        Segarkan
      </Button>
      <Button
        size="sm"
        onClick={() => setPairingOpen(true)}
        className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs"
      >
        <Plus className="size-4" />
        Pasangkan Perangkat
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Koneksi & Sinkronisasi LAN"
        description={
          <span>
            Hub Utama · Port {network?.port ?? 3000} Inbound OK · Sinkronisasi offline-first otomatis tanpa internet
          </span>
        }
        actions={headerActions}
      />

      {/* Row 1: KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          icon={Server}
          label="Alamat Hub LAN"
          value={network?.primaryHubUrl ?? 'Menghubungkan...'}
          badge="Online"
          badgeTone="success"
          showInfo
          infoTooltip="Endpoint REST & WebSocket yang digunakan oleh perangkat lain di toko"
          hint={`Port ${network?.port ?? 3000} (Inbound Windows Firewall OK)`}
        />
        <StatCard
          icon={Wifi}
          label="IP Terdeteksi di LAN"
          value={network?.localIps.length ? network.localIps[0] : '127.0.0.1'}
          badge="Wi-Fi Toko"
          badgeTone="info"
          showInfo
          infoTooltip="Alamat IPv4 pada antarmuka jaringan lokal yang siap discovery UDP"
          hint={
            network && network.localIps.length > 1
              ? `+ ${network.localIps.length - 1} subnet lainnya terdeteksi`
              : 'Subnet Wi-Fi router toko'
          }
        />
        <StatCard
          icon={Smartphone}
          label="HP Staf Terhubung"
          value={`${mobileCount} HP`}
          badge={mobileCount > 0 ? `${mobileCount} Staf` : 'Siap'}
          badgeTone={mobileCount > 0 ? 'success' : 'neutral'}
          progress={activeCount > 0 ? Math.round((mobileCount / activeCount) * 100) : 0}
          showInfo
          infoTooltip="Aplikasi Mandiri Tani Mobile untuk staf lapangan dan gudang"
          hint="Cek harga, stok & hitung opname gudang"
        />
        <StatCard
          icon={Laptop}
          label="Terminal Kasir"
          value={`${terminalCount} PC`}
          badge={terminalCount > 0 ? 'Multi-Kasir' : 'Standar'}
          badgeTone={terminalCount > 0 ? 'info' : 'neutral'}
          progress={activeCount > 0 ? Math.round((terminalCount / activeCount) * 100) : 0}
          showInfo
          infoTooltip="Komputer kasir meja kedua atau cabang yang tersambung peer-to-hub"
          hint="POS cabang / meja kasir kedua"
        />
      </div>

      {/* Row 2: Status Jaringan & Distribusi Perangkat */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Status & Panduan Jaringan LAN Toko */}
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-foreground tracking-tight">
                Status & Panduan Jaringan LAN Toko
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Prinsip koneksi offline-first untuk operasional kasir dan staf gudang tanpa internet
              </p>
            </div>
            <span className="text-xs font-mono font-medium text-emerald-800 bg-emerald-50 border border-border/60 px-2.5 py-1 rounded-full">
              Hub Aktif
            </span>
          </div>

          <div className="space-y-3.5">
            <div className="flex items-start gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-foreground border border-border/80 text-xs font-bold">
                1
              </span>
              <p className="text-xs sm:text-sm text-foreground/80 leading-relaxed">
                <strong className="font-semibold text-foreground">Komputer Ini sebagai Hub Utama:</strong> Database
                PostgreSQL tersimpan aman di komputer ini. Semua nota transaksi kasir dan perubahan stok disinkronkan ke
                hub ini secara otomatis tanpa perlu koneksi internet eksternal.
              </p>
            </div>

            <div className="flex items-start gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-foreground border border-border/80 text-xs font-bold">
                2
              </span>
              <p className="text-xs sm:text-sm text-foreground/80 leading-relaxed">
                <strong className="font-semibold text-foreground">Jaringan Wi-Fi / Router Sama:</strong> Pastikan
                perangkat Android staf dan komputer terminal kasir terhubung ke SSID Wi-Fi toko yang sama agar discovery
                otomatis UDP dapat langsung mendeteksi alamat IP Hub.
              </p>
            </div>

            <div className="flex items-start gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-foreground border border-border/80 text-xs font-bold">
                3
              </span>
              <p className="text-xs sm:text-sm text-foreground/80 leading-relaxed">
                <strong className="font-semibold text-foreground">Pairing Cepat & Aman:</strong> Klik tombol{' '}
                <em>"Pasangkan Perangkat"</em> di atas untuk menampilkan kode QR dan PIN 6-digit. PIN berlaku selama 5
                menit untuk menjamin keamanan otentikasi perangkat baru.
              </p>
            </div>

            <div className="flex items-start gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-foreground border border-border/80 text-xs font-bold">
                4
              </span>
              <p className="text-xs sm:text-sm text-foreground/80 leading-relaxed">
                <strong className="font-semibold text-foreground">Toleransi Selisih Jam (Clock Skew):</strong> Transaksi
                tetap sinkron aman selama selisih jam perangkat &lt; 5 menit. Hub otomatis mencatat dan menandai bila ada
                jam HP staf yang tidak akurat.
              </p>
            </div>
          </div>
        </div>

        {/* Right: Distribusi Perangkat */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-foreground tracking-tight flex items-center gap-1.5">
              Distribusi Perangkat
              <Info className="size-3.5 text-muted-foreground/60" />
            </h2>
            <span className="text-xs font-mono font-medium text-muted-foreground">
              Total {totalRegistered}
            </span>
          </div>

          <div className="grid grid-cols-[130px_1fr] gap-4 items-center my-auto py-2">
            {/* SVG Donut */}
            <div className="relative flex justify-center items-center">
              <svg viewBox="0 0 140 140" className="size-32 -rotate-90 select-none">
                <circle
                  cx="70"
                  cy="70"
                  r={radius}
                  fill="none"
                  stroke="#f0f0ed"
                  strokeWidth={strokeWidth}
                />
                {segments.map((seg, idx) => {
                  const priorSum = segments.slice(0, idx).reduce((acc, curr) => acc + curr.count, 0);
                  const strokeDasharray = `${(seg.count / Math.max(1, totalPie)) * circumference} ${circumference}`;
                  const strokeDashoffset = -((priorSum / Math.max(1, totalPie)) * circumference);
                  return (
                    <circle
                      key={seg.label}
                      cx="70"
                      cy="70"
                      r={radius}
                      fill="none"
                      stroke={seg.color}
                      strokeWidth={strokeWidth}
                      strokeDasharray={strokeDasharray}
                      strokeDashoffset={strokeDashoffset}
                      strokeLinecap="round"
                      className="transition-all duration-500"
                    />
                  );
                })}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                <span className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                  {totalRegistered}
                </span>
                <span className="text-[11px] font-medium text-muted-foreground">Perangkat</span>
              </div>
            </div>

            {/* Legend */}
            <div className="space-y-3">
              {segments.map((s) => (
                <div key={s.label} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0 pr-2">
                    <span className="size-2.5 rounded-xs shrink-0" style={{ backgroundColor: s.color }} />
                    <div className="truncate">
                      <p className="font-semibold text-foreground truncate">{s.label}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{s.desc}</p>
                    </div>
                  </div>
                  <span className="font-bold text-foreground tabular-nums shrink-0">{s.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
            <span>Perangkat aktif beroperasi</span>
            <span className="font-semibold text-emerald-700">{activeCount + 1} unit</span>
          </div>
        </div>
      </div>

      {/* Row 3: Perangkat Terdaftar Table */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-border/70 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-foreground tracking-tight">Perangkat Terdaftar</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Daftar izin perangkat yang berhak berkomunikasi dengan Hub Mandiri Tani ({activeCount} aktif)
            </p>
          </div>

          {/* Quick Filter Segmented Buttons */}
          <div className="flex items-center rounded-xl border border-border bg-surface-muted p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setFilterKind('ALL')}
              className={`px-3 py-1 rounded-lg font-medium transition-all ${
                filterKind === 'ALL'
                  ? 'bg-background text-foreground font-semibold shadow-2xs border border-border/50'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Semua ({devices?.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setFilterKind('ACTIVE')}
              className={`px-3 py-1 rounded-lg font-medium transition-all ${
                filterKind === 'ACTIVE'
                  ? 'bg-background text-emerald-800 font-semibold shadow-2xs border border-border/50'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Aktif ({activeCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterKind('REVOKED')}
              className={`px-3 py-1 rounded-lg font-medium transition-all ${
                filterKind === 'REVOKED'
                  ? 'bg-background text-rose-800 font-semibold shadow-2xs border border-border/50'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Dicabut ({(devices?.length ?? 0) - activeCount})
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-surface-muted/60 border-b border-border">
                <TableHead className="w-20">Kode</TableHead>
                <TableHead>Nama Perangkat</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Versi App</TableHead>
                <TableHead>Terakhir Dilihat</TableHead>
                <TableHead>Selisih Jam</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Row for Hub Utama (Always online) */}
              <TableRow className="bg-surface-muted/30">
                <TableCell className="font-mono font-bold text-foreground">
                  HUB-01
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-lg bg-surface-muted text-foreground border border-border/60">
                      <HardDrive className="size-3.5" />
                    </span>
                    <div>
                      <span className="font-semibold text-foreground">Komputer Toko Ini (Hub)</span>
                      <p className="text-[11px] text-muted-foreground">Master database & gateway LAN</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="border-border text-foreground bg-surface-muted">
                    HUB
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-xs font-mono">
                  v0.1.0
                </TableCell>
                <TableCell className="text-xs font-semibold text-emerald-800">
                  Online (Komputer Ini)
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground font-medium">Sumber Jam</span>
                </TableCell>
                <TableCell>
                  <StatusPill tone="success">
                    Aktif
                  </StatusPill>
                </TableCell>
                <TableCell className="text-right">
                  <span className="text-xs text-muted-foreground font-medium">Hub Utama</span>
                </TableCell>
              </TableRow>

              {loadingDevices ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="size-5 animate-spin text-muted-foreground/60" />
                      <span>Memuat daftar perangkat terhubung...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredDevices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                    Belum ada perangkat terdaftar di kategori ini.
                  </TableCell>
                </TableRow>
              ) : (
                filteredDevices.map((device) => {
                  if (device.kind === 'HUB') return null;
                  const isRevoked = !!device.revokedAt;
                  const hasSevereSkew =
                    device.lastClockSkewMs !== null && device.lastClockSkewMs > 300_000;

                  return (
                    <TableRow key={device.id} className={isRevoked ? 'opacity-60 bg-surface-muted/30' : ''}>
                      <TableCell className="font-mono font-bold text-foreground">
                        {device.code}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          {device.kind === 'TERMINAL' ? (
                            <span className="flex size-7 items-center justify-center rounded-lg bg-surface-muted text-foreground border border-border/50">
                              <Monitor className="size-3.5" />
                            </span>
                          ) : (
                            <span className="flex size-7 items-center justify-center rounded-lg bg-surface-muted text-foreground border border-border/50">
                              <Smartphone className="size-3.5" />
                            </span>
                          )}
                          <span className="font-semibold text-foreground">{device.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="border-border text-foreground bg-surface-muted"
                        >
                          {device.kind}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs font-mono">
                        {device.appVersion ? `v${device.appVersion}` : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {device.lastSeenAt ? (
                          new Date(device.lastSeenAt).toLocaleString('id-ID', {
                            dateStyle: 'short',
                            timeStyle: 'medium',
                          })
                        ) : (
                          <span className="text-muted-foreground/60">Belum pernah</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {device.lastClockSkewMs === null ? (
                          <span className="text-xs text-muted-foreground">-</span>
                        ) : hasSevereSkew ? (
                          <Badge variant="destructive" className="gap-1 font-mono text-[11px]">
                            <AlertTriangle className="size-3" />
                            &gt; 5 mnt ({(device.lastClockSkewMs / 60000).toFixed(1)}m)
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-border text-muted-foreground text-[11px] font-mono">
                            {device.lastClockSkewMs < 1000
                              ? `${device.lastClockSkewMs} ms`
                              : `${(device.lastClockSkewMs / 1000).toFixed(1)} dtk`}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {isRevoked ? (
                          <StatusPill tone="error">Dicabut</StatusPill>
                        ) : (
                          <StatusPill tone="success">Aktif</StatusPill>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isRevoked ? (
                          <span className="text-xs text-muted-foreground">Dicabut</span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-rose-700 hover:text-rose-800 hover:bg-rose-50 h-8 px-2.5 rounded-lg text-xs"
                            onClick={() => setRevokeTarget(device)}
                          >
                            Cabut Izin
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pairing Dialog */}
      <PairingDialog open={pairingOpen} onOpenChange={setPairingOpen} />

      {/* Revoke Confirmation Dialog */}
      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Cabut Izin Perangkat?"
        description={
          <div>
            <p className="text-sm text-foreground">
              Perangkat <strong>{revokeTarget?.name} ({revokeTarget?.code})</strong> tidak akan dapat melakukan sinkronisasi pull ataupun push ke hub ini lagi.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Untuk menggunakannya kembali di kemudian hari, perangkat harus dipasangkan ulang lewat PIN pairing.
            </p>
          </div>
        }
        confirmLabel="Cabut Izin"
        tone="danger"
        pending={revoke.isPending}
        onConfirm={handleRevokeConfirm}
      />
    </div>
  );
}
