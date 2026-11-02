import { useMemo, useState } from 'react';
import { Camera, Package, Search, Tag, X } from 'lucide-react';
import type { ProductItem } from '../types';
import { formatNumber, formatRupiah } from '../lib/format';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';

interface PriceCheckPageProps {
  products: ProductItem[];
  initialSearch?: string;
}

export function PriceCheckPage({ products, initialSearch = '' }: PriceCheckPageProps) {
  const [search, setSearch] = useState(initialSearch);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  // Extract categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.categoryName) set.add(p.categoryName);
    });
    return Array.from(set).sort();
  }, [products]);

  // Filtered products
  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchCat = selectedCategory === 'ALL' || p.categoryName === selectedCategory;
      if (!matchCat) return false;

      if (!q) return true;
      const matchName = p.name.toLowerCase().includes(q);
      const matchSku = p.sku.toLowerCase().includes(q);
      const matchBarcode = p.barcode ? p.barcode.toLowerCase().includes(q) : false;
      return matchName || matchSku || matchBarcode;
    });
  }, [products, search, selectedCategory]);

  return (
    <div className="p-4 space-y-3 pb-24">
      {/* Search Bar & Scan Button */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <input
            type="text"
            placeholder="Cari nama, SKU, atau barcode..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-9 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600 shadow-xs"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsScannerOpen(true)}
          className="size-11 rounded-xl bg-emerald-700 text-white flex items-center justify-center shadow-xs active:scale-95 shrink-0"
          title="Pindai barcode lewat kamera"
        >
          <Camera className="size-5" />
        </button>
      </div>

      {/* Category Pills */}
      {categories.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
          <button
            type="button"
            onClick={() => setSelectedCategory('ALL')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap font-medium transition-colors ${
              selectedCategory === 'ALL'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Semua ({products.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg whitespace-nowrap font-medium transition-colors ${
                selectedCategory === cat
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Results Header */}
      <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
        <span>Menampilkan {filteredProducts.length} barang</span>
        {products.length === 0 && (
          <span className="text-amber-600 font-medium">Katalog kosong, lakukan sinkronisasi</span>
        )}
      </div>

      {/* Product List Cards */}
      <div className="space-y-2.5">
        {filteredProducts.map((p) => (
          <div
            key={p.id}
            className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs space-y-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-0.5">
                <span className="inline-block text-[10px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  {p.categoryName}
                </span>
                <h3 className="text-sm font-bold text-slate-900 leading-snug">{p.name}</h3>
                <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                  <span>SKU: {p.sku}</span>
                  {p.barcode && <span>&bull; Barcode: {p.barcode}</span>}
                </div>
              </div>

              <div className="text-right shrink-0">
                <span className="text-[10px] text-slate-400 block">Harga Utama</span>
                <span className="text-base font-bold text-emerald-800">
                  {formatRupiah(p.sellPrice)}
                </span>
                <span className="text-[10px] text-slate-500 block">/{p.baseUnit}</span>
              </div>
            </div>

            {/* Multi-tier Prices if exists */}
            {p.prices && p.prices.length > 0 && (
              <div className="bg-slate-50 rounded-xl p-2 border border-slate-100 space-y-1">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                  Pilihan Satuan & Harga
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {p.prices.map((pr, idx) => (
                    <div
                      key={idx}
                      className="bg-white rounded-lg p-1.5 border border-slate-200/80 text-[11px] flex justify-between items-center"
                    >
                      <span className="font-medium text-slate-700">
                        {pr.unitName} ({pr.conversionQty} {p.baseUnit})
                      </span>
                      <span className="font-bold text-slate-900">{formatRupiah(pr.price)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Stock Levels */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-center">
              <div className="bg-slate-50 rounded-lg py-1.5">
                <span className="text-[10px] text-slate-500 block">Toko</span>
                <span className="text-xs font-semibold text-slate-800">
                  {formatNumber(p.stockToko)} {p.baseUnit}
                </span>
              </div>
              <div className="bg-slate-50 rounded-lg py-1.5">
                <span className="text-[10px] text-slate-500 block">Gudang</span>
                <span className="text-xs font-semibold text-slate-800">
                  {formatNumber(p.stockGudang)} {p.baseUnit}
                </span>
              </div>
              <div className="bg-emerald-50 rounded-lg py-1.5 border border-emerald-200/60">
                <span className="text-[10px] text-emerald-700 font-medium block">Total Stok</span>
                <span className="text-xs font-bold text-emerald-800">
                  {formatNumber(p.totalStock)} {p.baseUnit}
                </span>
              </div>
            </div>
          </div>
        ))}

        {filteredProducts.length === 0 && (
          <div className="text-center py-12 bg-white rounded-2xl border border-slate-200 p-6 space-y-2">
            <Package className="size-10 text-slate-300 mx-auto" />
            <p className="text-sm font-semibold text-slate-700">Barang tidak ditemukan</p>
            <p className="text-xs text-slate-500 max-w-xs mx-auto">
              Coba kata kunci pencarian lain atau sinkronkan data terbaru dari komputer kasir Hub.
            </p>
          </div>
        )}
      </div>

      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={(code) => setSearch(code)}
      />
    </div>
  );
}

