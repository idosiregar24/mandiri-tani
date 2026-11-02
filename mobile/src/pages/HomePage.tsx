import { useState } from 'react';
import {
  Boxes,
  CheckCircle2,
  ClipboardList,
  Layers,
  Phone,
  Mail,
  RefreshCw,
  ScanLine,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { DeviceConfig, ProductItem, SyncState } from '../types';
import { formatDateTime } from '../lib/format';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';

interface HomePageProps {
  config: DeviceConfig | null;
  products: ProductItem[];
  syncState: SyncState;
  onTriggerSync: () => void;
  onNavigateTab: (tab: 'home' | 'price' | 'opname' | 'settings') => void;
  onSelectScannedBarcode?: (code: string) => void;
}

export function HomePage({
  config,
  products,
  syncState,
  onTriggerSync,
  onNavigateTab,
  onSelectScannedBarcode,
}: HomePageProps) {
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  const handleScan = (code: string) => {
    if (onSelectScannedBarcode) {
      onSelectScannedBarcode(code);
    }
    onNavigateTab('price');
  };

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* Device Info & Connection Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-slate-400 tracking-wider uppercase">
              Perangkat Terdaftar
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <h2 className="text-xl font-bold text-slate-900">
                {config ? `Staf ${config.deviceCode}` : 'Belum Terhubung'}
              </h2>
              {config && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="size-3" /> Siap
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1 font-mono">
              Hub: {config ? config.hubUrl : 'Atur di tab Pengaturan'}
            </p>
          </div>

          <div
            className={`size-12 rounded-xl flex items-center justify-center ${
              syncState.isOnline ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
            }`}
          >
            {syncState.isOnline ? <Wifi className="size-6" /> : <WifiOff className="size-6" />}
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>Terakhir Sinkron:</span>
          <span className="font-medium text-slate-700">
            {formatDateTime(syncState.lastSyncedAt)}
          </span>
        </div>
      </div>

      {/* Quick Action Grid */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setIsScannerOpen(true)}
          className="flex flex-col items-center justify-center p-4 rounded-2xl bg-emerald-700 text-white font-medium shadow-sm active:scale-98 transition-transform"
        >
          <ScanLine className="size-7 mb-2" />
          <span className="text-sm font-semibold">Pindai Barcode</span>
          <span className="text-[11px] text-emerald-200 mt-0.5">Cek harga & stok</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('opname')}
          className="flex flex-col items-center justify-center p-4 rounded-2xl bg-white border border-slate-200 text-slate-800 font-medium shadow-xs active:scale-98 transition-transform"
        >
          <ClipboardList className="size-7 mb-2 text-emerald-700" />
          <span className="text-sm font-semibold">Stok Opname</span>
          <span className="text-[11px] text-slate-500 mt-0.5">Hitung fisik gudang</span>
        </button>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs">
          <div className="flex items-center gap-2 text-slate-500 mb-1">
            <Boxes className="size-4 text-emerald-600" />
            <span className="text-xs font-medium">Katalog Produk</span>
          </div>
          <p className="text-xl font-bold text-slate-900">{products.length}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Tersimpan di HP (offline)</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs">
          <div className="flex items-center gap-2 text-slate-500 mb-1">
            <Layers className="size-4 text-amber-600" />
            <span className="text-xs font-medium">Antrean Sync</span>
          </div>
          <p className="text-xl font-bold text-slate-900">{syncState.pendingCount}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Operasi belum terkirim</p>
        </div>
      </div>

      {/* Sync Banner */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Sinkronisasi Hub LAN</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Tarik data harga terbaru dan kirim hasil opname ke PC kasir.
            </p>
          </div>
          <button
            type="button"
            onClick={onTriggerSync}
            disabled={syncState.isSyncing}
            className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 shadow-xs flex items-center gap-1.5 active:scale-95"
          >
            <RefreshCw className={`size-3.5 ${syncState.isSyncing ? 'animate-spin' : ''}`} />
            {syncState.isSyncing ? 'Menyinkronkan...' : 'Sinkron'}
          </button>
        </div>
      </div>

      {/* Developer Credit Footer */}
      <div className="pt-4 border-t border-slate-200/80 text-center select-none">
        <p className="text-xs font-medium text-slate-600">
          Dikembangkan oleh <span className="font-semibold text-slate-900">Ido Refael Siregar</span>
        </p>
        <div className="flex items-center justify-center gap-3 text-[11px] text-slate-500 font-mono mt-1">
          <span className="flex items-center gap-1">
            <Phone className="size-3 text-slate-400" /> 081363554262
          </span>
          <span>&bull;</span>
          <span className="flex items-center gap-1">
            <Mail className="size-3 text-slate-400" /> idosiregar2006@gmail.com
          </span>
        </div>
      </div>

      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleScan}
      />
    </div>
  );
}

