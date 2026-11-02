import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Download, FileSpreadsheet, Percent, Save } from 'lucide-react';
import { useState } from 'react';
import type { PosSettings, StoreSettings } from '@shared/schemas/settings';
import { Notice } from '@/components/shared/Notice';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiDownload, apiGet, apiPut } from '@/lib/api-client';

export function StoreSettingsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'profile' | 'pos' | 'export'>('profile');
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const storeQuery = useQuery({
    queryKey: ['settings', 'store'],
    queryFn: () => apiGet<StoreSettings>('/settings/store'),
  });

  const posQuery = useQuery({
    queryKey: ['settings', 'pos'],
    queryFn: () => apiGet<PosSettings>('/settings/pos'),
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profil & Pengaturan Toko"
        description="Kelola identitas toko pada struk/faktur, batas diskon, dan ekspor data."
      />

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <div className="flex gap-2 border-b pb-2">
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
          variant={tab === 'export' ? 'default' : 'ghost'}
          onClick={() => {
            setTab('export');
            setMsg(null);
          }}
          className="gap-2"
        >
          <FileSpreadsheet className="size-4" /> Ekspor Master Data
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
            <Textarea
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="JL. POROS RAPP km. 72&#10;BUKIT KESUMA, PELALAWAN"
              rows={3}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Telepon / WhatsApp</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0813-6144-1706"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fax">Fax</Label>
              <Input
                id="fax"
                value={fax}
                onChange={(e) => setFax(e.target.value)}
                placeholder="-"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
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
              placeholder="Barang yang telah dibeli tidak dapat dikembalikan kecuali ada perjanjian"
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
    </div>
  );
}

