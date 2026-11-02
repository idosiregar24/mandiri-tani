import { useState } from 'react';
import { Camera, Check, ClipboardCheck, Plus, Trash2 } from 'lucide-react';
import type { OutboxItem, ProductItem } from '../types';
import { addOutbox } from '../lib/storage';
import { formatNumber } from '../lib/format';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';

interface StockOpnamePageProps {
  products: ProductItem[];
  onOpnameSaved: () => void;
}

interface CountRecord {
  productId: string;
  productName: string;
  unit: string;
  location: 'TOKO' | 'GUDANG';
  physicalQty: number;
  countedAt: string;
}

export function StockOpnamePage({ products, onOpnameSaved }: StockOpnamePageProps) {
  const [selectedProductId, setSelectedProductId] = useState('');
  const [location, setLocation] = useState<'TOKO' | 'GUDANG'>('GUDANG');
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [recentCounts, setRecentCounts] = useState<CountRecord[]>([]);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  const handleScanBarcode = (code: string) => {
    const q = code.trim().toLowerCase();
    const match = products.find(
      (p) => (p.barcode && p.barcode.toLowerCase() === q) || p.sku.toLowerCase() === q,
    );
    if (match) {
      setSelectedProductId(match.id);
      setMessage({ text: `Barang terpilih: ${match.name}`, type: 'success' });
    } else {
      setMessage({ text: `Barcode "${code}" tidak ditemukan dalam katalog`, type: 'error' });
    }
  };

  const handleSaveCount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) {
      setMessage({ text: 'Pilih barang terlebih dahulu', type: 'error' });
      return;
    }
    const numQty = parseFloat(qty);
    if (isNaN(numQty) || numQty < 0) {
      setMessage({ text: 'Masukkan jumlah fisik yang valid (≥ 0)', type: 'error' });
      return;
    }

    const countItem: CountRecord = {
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      unit: selectedProduct.baseUnit,
      location,
      physicalQty: numQty,
      countedAt: new Date().toISOString(),
    };

    // Construct outbox item (offline-first sync)
    const outboxItem: OutboxItem = {
      id: crypto.randomUUID(),
      entity: 'opname_count',
      payload: {
        product_id: selectedProduct.id,
        location,
        physical_qty: numQty,
        notes: notes.trim() || undefined,
        counted_at: countItem.countedAt,
      },
      createdAt: new Date().toISOString(),
      status: 'PENDING',
    };

    await addOutbox(outboxItem);
    setRecentCounts([countItem, ...recentCounts]);
    setQty('');
    setNotes('');
    setMessage({
      text: `Hitungan fisik ${selectedProduct.name} (${numQty} ${selectedProduct.baseUnit}) tersimpan ke antrean outbox`,
      type: 'success',
    });
    onOpnameSaved();
  };

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* Header Info */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-800">
            <ClipboardCheck className="size-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Hitung Stok Fisik (Opname)</h2>
            <p className="text-xs text-slate-500">
              Input jumlah riil barang di rak toko atau tumpukan gudang.
            </p>
          </div>
        </div>
      </div>

      {/* Input Card Form */}
      <form onSubmit={handleSaveCount} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-3.5">
        {message && (
          <div
            className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
              message.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {message.type === 'success' && <Check className="size-4 shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}

        {/* Location Selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Lokasi Hitung</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setLocation('GUDANG')}
              className={`py-2 text-xs font-semibold rounded-xl border transition-colors ${
                location === 'GUDANG'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Gudang Utama
            </button>
            <button
              type="button"
              onClick={() => setLocation('TOKO')}
              className={`py-2 text-xs font-semibold rounded-xl border transition-colors ${
                location === 'TOKO'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Display Toko
            </button>
          </div>
        </div>

        {/* Product Picker & Scan */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-slate-700">Pilih Barang</label>
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              className="text-xs text-emerald-700 font-semibold flex items-center gap-1 active:scale-95"
            >
              <Camera className="size-3.5" /> Pindai Barcode
            </button>
          </div>

          <select
            value={selectedProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-emerald-600 shadow-xs"
          >
            <option value="">-- Cari atau pilih barang --</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku}) - Sistem: {p.totalStock} {p.baseUnit}
              </option>
            ))}
          </select>

          {selectedProduct && (
            <div className="mt-2 p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs flex justify-between items-center">
              <div>
                <span className="font-semibold text-slate-900">{selectedProduct.name}</span>
                <span className="text-slate-500 block text-[11px]">
                  Kategori: {selectedProduct.categoryName} &bull; SKU: {selectedProduct.sku}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 block">Stok Sistem</span>
                <span className="font-bold text-slate-800">
                  {formatNumber(location === 'TOKO' ? selectedProduct.stockToko : selectedProduct.stockGudang)}{' '}
                  {selectedProduct.baseUnit}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Physical Qty Input */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Jumlah Fisik Dihitung ({selectedProduct ? selectedProduct.baseUnit : 'Satuan'})
          </label>
          <input
            type="number"
            step="any"
            placeholder="Contoh: 50"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-base font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600 shadow-xs"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Catatan Tambahan (Opsional)
          </label>
          <input
            type="text"
            placeholder="Contoh: Sak rusak / bocor 1..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600 shadow-xs"
          />
        </div>

        <button
          type="submit"
          disabled={!selectedProductId || !qty}
          className="w-full py-3 bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 active:scale-98 shadow-sm transition-transform"
        >
          <Plus className="size-4" /> Simpan Hitungan Fisik
        </button>
      </form>

      {/* Recent Counts in this Session */}
      {recentCounts.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Tercatat Sesi Ini ({recentCounts.length})
            </h3>
            <button
              type="button"
              onClick={() => setRecentCounts([])}
              className="text-[11px] text-slate-400 hover:text-red-600 flex items-center gap-1"
            >
              <Trash2 className="size-3" /> Bersihkan
            </button>
          </div>

          <div className="space-y-2">
            {recentCounts.map((rc, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs"
              >
                <div>
                  <span className="font-semibold text-slate-900 block">{rc.productName}</span>
                  <span className="text-[11px] text-slate-500">
                    Lokasi: {rc.location} &bull; {new Date(rc.countedAt).toLocaleTimeString('id-ID')}
                  </span>
                </div>
                <div className="text-right">
                  <span className="font-bold text-emerald-800 text-sm">
                    {formatNumber(rc.physicalQty)} {rc.unit}
                  </span>
                  <span className="text-[10px] text-amber-600 block">Antrean Outbox</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleScanBarcode}
        title="Pindai Barcode Opname"
      />
    </div>
  );
}

