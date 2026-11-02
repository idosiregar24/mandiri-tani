import { RefreshCw, Wifi, WifiOff } from 'lucide-react';
import type { DeviceConfig, SyncState } from '../types';

interface SyncHeaderProps {
  config: DeviceConfig | null;
  syncState: SyncState;
  onTriggerSync: () => void;
}

export function SyncHeader({ config, syncState, onTriggerSync }: SyncHeaderProps) {
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-4 py-3 select-none">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-slate-900 tracking-tight">
              {config?.storeName || 'Mandiri Tani'}
            </h1>
            {config?.deviceCode && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                {config.deviceCode}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
            {syncState.isOnline ? (
              <span className="flex items-center gap-1 text-emerald-700">
                <Wifi className="size-3 text-emerald-600" />
                <span className="text-[11px] font-medium">Terhubung ke Hub</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-700">
                <WifiOff className="size-3 text-amber-600" />
                <span className="text-[11px] font-medium">Mode Offline</span>
              </span>
            )}
            {syncState.pendingCount > 0 && (
              <>
                <span>&bull;</span>
                <span className="text-[11px] text-amber-600 font-medium">
                  {syncState.pendingCount} antrean
                </span>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onTriggerSync}
          disabled={syncState.isSyncing}
          className="size-9 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-700 active:scale-95 transition-transform"
          title="Sinkronkan data dengan Hub"
        >
          <RefreshCw
            className={`size-4 text-slate-600 ${syncState.isSyncing ? 'animate-spin text-emerald-600' : ''}`}
          />
        </button>
      </div>
    </header>
  );
}

