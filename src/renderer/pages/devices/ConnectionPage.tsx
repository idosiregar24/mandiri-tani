  import { useState } from 'react';
import {
  AlertTriangle,
  HardDrive,
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

  const headerActions = (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void refetchDevices();
          void refetchNetwork();
        }}
        className="gap-1.5"
      >
        <RefreshCw className="size-4" />
        Segarkan
      </Button>
      <Button
        size="sm"
        onClick={() => setPairingOpen(true)}
        className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
      >
        <Plus className="size-4" />
        Pasangkan Perangkat
      </Button>
    </>
  );

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Koneksi & Sinkronisasi LAN"
        description="Kelola perangkat mobile staf, terminal kasir, dan pantau status sinkronisasi offline-first."
        actions={headerActions}
      />

      {/* Network & Hub Info Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          icon={Server}
          label="Alamat Hub LAN"
          value={network?.primaryHubUrl ?? 'Menghubungkan...'}
          hint={`Port ${network?.port ?? 3000} (Inbound Windows Firewall OK)`}
        />
        <StatCard
          icon={Wifi}
          label="IP Terdeteksi di LAN"
          value={network?.localIps.length ? network.localIps[0] : '127.0.0.1'}
          hint={
            network && network.localIps.length > 1
              ? `+ ${network.localIps.length - 1} subnet lainnya`
              : 'Subnet Wi-Fi Toko'
          }
        />
        <StatCard
          icon={Smartphone}
          label="HP Staf Terhubung"
          value={`${mobileCount} HP`}
          hint="Cek harga, stok & hitung opname"
        />
        <StatCard
          icon={Laptop}
          label="Terminal Kasir"
          value={`${terminalCount} PC`}
          hint="POS cabang/meja kasir kedua"
        />
      </div>

      {/* Devices List Card */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Perangkat Terdaftar</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Total {devices?.length ?? 0} perangkat ({activeCount} aktif)
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/60">
                <TableHead className="w-16">Kode</TableHead>
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
              {loadingDevices ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-slate-500">
                    Memuat daftar perangkat...
                  </TableCell>
                </TableRow>
              ) : !devices || devices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-slate-500">
                    Belum ada perangkat yang terdaftar.
                  </TableCell>
                </TableRow>
              ) : (
                devices.map((device) => {
                  const isHub = device.kind === 'HUB';
                  const isRevoked = !!device.revokedAt;
                  const hasSevereSkew =
                    device.lastClockSkewMs !== null && device.lastClockSkewMs > 300_000;

                  return (
                    <TableRow key={device.id} className={isRevoked ? 'opacity-60 bg-slate-50/50' : ''}>
                      <TableCell className="font-mono font-bold text-slate-800">
                        {device.code}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {device.kind === 'HUB' ? (
                            <HardDrive className="size-4 text-emerald-600 shrink-0" />
                          ) : device.kind === 'TERMINAL' ? (
                            <Monitor className="size-4 text-blue-600 shrink-0" />
                          ) : (
                            <Smartphone className="size-4 text-amber-600 shrink-0" />
                          )}
                          <span className="font-medium text-slate-900">{device.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            device.kind === 'HUB'
                              ? 'border-emerald-200 text-emerald-700 bg-emerald-50'
                              : device.kind === 'TERMINAL'
                                ? 'border-blue-200 text-blue-700 bg-blue-50'
                                : 'border-amber-200 text-amber-700 bg-amber-50'
                          }
                        >
                          {device.kind}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-600 text-xs font-mono">
                        {device.appVersion ? `v${device.appVersion}` : '-'}
                      </TableCell>
                      <TableCell className="text-slate-600 text-xs">
                        {isHub ? (
                          <span className="flex items-center gap-1.5 text-emerald-700 font-medium">
                            <span className="size-2 rounded-full bg-emerald-600 animate-pulse" />
                            Komputer Ini (Online)
                          </span>
                        ) : device.lastSeenAt ? (
                          new Date(device.lastSeenAt).toLocaleString('id-ID', {
                            dateStyle: 'short',
                            timeStyle: 'medium',
                          })
                        ) : (
                          <span className="text-slate-400">Belum pernah</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {isHub ? (
                          <span className="text-xs text-slate-400">Sumber Jam</span>
                        ) : device.lastClockSkewMs === null ? (
                          <span className="text-xs text-slate-400">-</span>
                        ) : hasSevereSkew ? (
                          <Badge variant="destructive" className="gap-1 font-mono text-[11px]">
                            <AlertTriangle className="size-3" />
                            &gt; 5 mnt ({(device.lastClockSkewMs / 60000).toFixed(1)}m)
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-slate-200 text-slate-600 text-[11px] font-mono">
                            {device.lastClockSkewMs < 1000
                              ? `${device.lastClockSkewMs} ms`
                              : `${(device.lastClockSkewMs / 1000).toFixed(1)} dtk`}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {isRevoked ? (
                          <Badge variant="destructive">Dicabut</Badge>
                        ) : (
                          <Badge className="bg-emerald-100 text-emerald-800 border-transparent">
                            Aktif
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isHub ? (
                          <span className="text-xs text-slate-400">Hub Utama</span>
                        ) : isRevoked ? (
                          <span className="text-xs text-slate-400">Dicabut</span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 h-8 px-2"
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
            <p>
              Perangkat <strong>{revokeTarget?.name} ({revokeTarget?.code})</strong> tidak akan dapat melakukan sinkronisasi pull ataupun push ke hub ini lagi.
            </p>
            <p className="mt-2 text-xs text-slate-500">
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
