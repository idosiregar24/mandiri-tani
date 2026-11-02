import { useState } from 'react';
import {
  CheckCircle2,
  HardDrive,
  Link,
  QrCode,
  RefreshCw,
  Server,
  Trash2,
  Unlink,
} from 'lucide-react';
import type { DeviceConfig, SyncState } from '../types';
import { cleanHubUrl, pairDevice, pingHub } from '../lib/api';
import { clearConfig, saveConfig, saveProducts, updateSyncState } from '../lib/storage';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';

interface SettingsPageProps {
  config: DeviceConfig | null;
  syncState: SyncState;
  onConfigChange: (cfg: DeviceConfig | null) => void;
  onTriggerSync: () => void;
}

export function SettingsPage({
  config,
  syncState,
  onConfigChange,
  onTriggerSync,
}: SettingsPageProps) {
  const [hubUrl, setHubUrl] = useState(config?.hubUrl || 'http://192.168.1.');
  const [pairingCode, setPairingCode] = useState('');
  const [deviceName, setDeviceName] = useState('HP Staf Android');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handleScanQr = (qrData: string) => {
    try {
      const parsed = JSON.parse(qrData);
      if (parsed.hub && parsed.code) {
        setHubUrl(parsed.hub);
        setPairingCode(parsed.code);
        setMessage({
          text: `QR terbaca! Hub: ${parsed.hub}, Kode: ${parsed.code}. Tekan 'Pasangkan Perangkat'.`,
          type: 'success',
        });
      } else {
        setMessage({ text: 'Format QR tidak sesuai.', type: 'error' });
      }
    } catch {
      setMessage({ text: 'Data QR bukan format pairing Mandiri Tani.', type: 'error' });
    }
  };

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hubUrl.trim() || !pairingCode.trim()) {
      setMessage({ text: 'Alamat Hub dan 6-angka PIN pairing wajib diisi.', type: 'error' });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    const formattedHub = cleanHubUrl(hubUrl);
    const res = await pairDevice(formattedHub, pairingCode, deviceName);

    if (res.ok && res.data) {
      const newConfig: DeviceConfig = {
        hubUrl: formattedHub,
        deviceId: res.data.deviceId,
        deviceCode: res.data.deviceCode,
        deviceToken: res.data.token,
        storeName: 'Mandiri Tani',
        pairedAt: new Date().toISOString(),
      };
      await saveConfig(newConfig);
      onConfigChange(newConfig);
      setMessage({
        text: `Berhasil terhubung! Perangkat terdaftar sebagai kode ${res.data.deviceCode}`,
        type: 'success',
      });
      setPairingCode('');
      // Trigger initial sync
      setTimeout(() => onTriggerSync(), 500);
    } else {
      setMessage({ text: res.error || 'Gagal pairing dengan Hub kasir.', type: 'error' });
    }
    setIsSubmitting(false);
  };

  const handleTestConnection = async () => {
    setMessage(null);
    const targetUrl = config?.hubUrl || hubUrl;
    const ping = await pingHub(targetUrl);
    if (ping.ok) {
      setMessage({ text: 'Koneksi ke Hub LAN berhasil terhubung!', type: 'success' });
      await updateSyncState({ isOnline: true });
    } else {
      setMessage({ text: `Gagal terhubung: ${ping.message}`, type: 'error' });
      await updateSyncState({ isOnline: false });
    }
  };

  const handleUnpair = async () => {
    if (confirm('Yakin ingin memutuskan sambungan dari Hub Kasir?')) {
      await clearConfig();
      onConfigChange(null);
      setMessage({ text: 'Perangkat berhasil diputuskan.', type: 'success' });
    }
  };

  const handleClearCache = async () => {
    if (confirm('Bersihkan katalog dan cache data di HP?')) {
      await saveProducts([]);
      setMessage({ text: 'Cache lokal dibersihkan.', type: 'success' });
      onTriggerSync();
    }
  };

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* Paired Device Status Card */}
      {config ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-emerald-600" />
              <h2 className="text-base font-bold text-slate-900">Perangkat Terhubung</h2>
            </div>
            <span className="px-2 py-0.5 rounded font-mono text-xs font-bold bg-emerald-100 text-emerald-800">
              {config.deviceCode}
            </span>
          </div>

          <div className="bg-slate-50 rounded-xl p-3 text-xs space-y-1.5 font-mono">
            <div className="flex justify-between">
              <span className="text-slate-500">Hub Server:</span>
              <span className="font-semibold text-slate-800 truncate max-w-[180px]">
                {config.hubUrl}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Device ID:</span>
              <span className="text-slate-700 truncate max-w-[180px]">
                {config.deviceId.slice(0, 18)}...
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Terdaftar Sejak:</span>
              <span className="text-slate-700">
                {new Date(config.pairedAt).toLocaleDateString('id-ID')}
              </span>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleTestConnection}
              className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5"
            >
              <Server className="size-3.5" /> Uji Koneksi
            </button>
            <button
              type="button"
              onClick={handleUnpair}
              className="px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold flex items-center justify-center gap-1.5"
            >
              <Unlink className="size-3.5" /> Putus Hubungan
            </button>
          </div>
        </div>
      ) : (
        /* Pairing Form Card */
        <form onSubmit={handlePair} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Link className="size-5 text-emerald-700" />
              <h2 className="text-base font-bold text-slate-900">Sambungkan ke Hub Kasir</h2>
            </div>
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              className="text-xs text-emerald-700 font-semibold flex items-center gap-1 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200"
            >
              <QrCode className="size-3.5" /> Scan QR
            </button>
          </div>

          <p className="text-xs text-slate-500">
            Buka menu <strong>Koneksi</strong> di komputer kasir, buat kode pairing, lalu masukkan atau pindai QR di sini.
          </p>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Alamat IP Hub Kasir
            </label>
            <input
              type="text"
              placeholder="http://192.168.1.10:3000"
              value={hubUrl}
              onChange={(e) => setHubUrl(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 font-mono placeholder:text-slate-400 focus:outline-none focus:border-emerald-600 shadow-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Kode Pairing (6 Angka)
            </label>
            <input
              type="text"
              maxLength={6}
              placeholder="Contoh: 849201"
              value={pairingCode}
              onChange={(e) => setPairingCode(e.target.value.replace(/\D/g, ''))}
              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-center text-xl font-bold tracking-widest text-slate-900 font-mono placeholder:text-slate-300 focus:outline-none focus:border-emerald-600 shadow-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Nama Perangkat Ini
            </label>
            <input
              type="text"
              placeholder="HP Staf Lapangan / Gudang"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600 shadow-xs"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !hubUrl || !pairingCode}
            className="w-full py-2.5 bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 active:scale-98 shadow-sm transition-transform"
          >
            {isSubmitting ? 'Menghubungkan...' : 'Pasangkan Perangkat'}
          </button>
        </form>
      )}

      {/* Messages */}
      {message && (
        <div
          className={`p-3 rounded-xl text-xs ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Data & Storage Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Pengelolaan Sinkronisasi & Cache
        </h3>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onTriggerSync}
            disabled={syncState.isSyncing}
            className="flex-1 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center justify-center gap-2 active:scale-95"
          >
            <RefreshCw className={`size-3.5 ${syncState.isSyncing ? 'animate-spin' : ''}`} />
            {syncState.isSyncing ? 'Menyinkronkan...' : 'Sinkronkan Sekarang'}
          </button>

          <button
            type="button"
            onClick={handleClearCache}
            className="px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5"
            title="Bersihkan data katalog di HP"
          >
            <HardDrive className="size-3.5" /> Hapus Cache
          </button>
        </div>
      </div>

      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleScanQr}
        title="Pindai QR Pairing Hub"
      />
    </div>
  );
}

