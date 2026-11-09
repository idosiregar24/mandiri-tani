// Pengaturan › Profil Toko › Logo: upload the store logo, see exactly what each printer will
// print (1-bit preview), choose where it is printed. The bitmaps are made here and saved with
// the picture; printing later needs no image processing.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageUp, Loader2, Save, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { FAKTUR_LOGO, type MonoBitmap, rasterizeLogo, type RgbaImage, STRUK_LOGO } from '@shared/logo';
import type { LogoSettings } from '@shared/schemas/settings';
import { MonoBitmapCanvas } from '@/components/shared/MonoBitmapCanvas';
import { Notice } from '@/components/shared/Notice';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { apiGet, apiPut } from '@/lib/api-client';
import { MAX_UPLOAD_BYTES, readPixels, shrinkToPng } from './logo-image';

/** Preview scale: CSS pixels per printed inch. */
const PPI = 110;

interface StoreText {
  name: string;
  address: string;
  phone: string;
}

export function LogoSettingsCard({ store }: { store: StoreText }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const logoQuery = useQuery({
    queryKey: ['settings', 'logo'],
    queryFn: () => apiGet<LogoSettings>('/settings/logo'),
  });

  const [image, setImage] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(128);
  const [onFaktur, setOnFaktur] = useState(true);
  const [onStruk, setOnStruk] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pixels, setPixels] = useState<{ src: string; img: RgbaImage } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  if (!loaded && logoQuery.data) {
    setImage(logoQuery.data.image);
    setThreshold(logoQuery.data.threshold);
    setOnFaktur(logoQuery.data.printOnFaktur);
    setOnStruk(logoQuery.data.printOnStruk);
    setLoaded(true);
  }

  useEffect(() => {
    if (!image) return;
    let alive = true;
    readPixels(image)
      .then((img) => alive && setPixels({ src: image, img }))
      .catch((err: unknown) => alive && setMsg({ tone: 'error', text: String((err as Error).message ?? err) }));
    return () => {
      alive = false;
    };
  }, [image]);

  // Pixels of an earlier picture never count for the current one.
  const current = image && pixels?.src === image ? pixels.img : null;
  const bitmaps = useMemo(
    () =>
      current
        ? {
            faktur: rasterizeLogo(current, FAKTUR_LOGO, threshold),
            struk: rasterizeLogo(current, STRUK_LOGO, threshold),
          }
        : null,
    [current, threshold],
  );
  const blank = image !== null && bitmaps !== null && (!bitmaps.faktur || !bitmaps.struk);

  const change =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setDirty(true);
      setMsg(null);
    };

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMsg({ tone: 'error', text: 'File harus berupa gambar (PNG atau JPG).' });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setMsg({ tone: 'error', text: 'Gambar terlalu besar (maksimal 8 MB).' });
      return;
    }
    try {
      change(setImage)(await shrinkToPng(file));
    } catch {
      setMsg({ tone: 'error', text: 'Gambar tidak bisa dibaca. Coba simpan ulang sebagai PNG atau JPG.' });
    }
  }

  const save = useMutation({
    mutationFn: () =>
      apiPut<LogoSettings>('/settings/logo', {
        image,
        threshold,
        printOnFaktur: onFaktur,
        printOnStruk: onStruk,
        faktur: image ? (bitmaps?.faktur ?? null) : null,
        struk: image ? (bitmaps?.struk ?? null) : null,
      }),
    onSuccess: () => {
      setDirty(false);
      setMsg({
        tone: 'success',
        text: image ? 'Logo disimpan. Cetakan berikutnya memakai logo ini.' : 'Logo dihapus dari cetakan.',
      });
      void qc.invalidateQueries({ queryKey: ['settings', 'logo'] });
      void qc.invalidateQueries({ queryKey: ['pos', 'receipt-settings'] });
    },
    onError: (err) => setMsg({ tone: 'error', text: err.message }),
  });

  const busy = save.isPending || (image !== null && bitmaps === null);

  return (
    <section className="max-w-2xl space-y-4 rounded-xl border bg-card p-6">
      <div>
        <h3 className="text-base font-semibold">Logo di Faktur & Struk</h3>
        <p className="text-muted-foreground text-sm">
          Logo dicetak di kepala faktur (printer Epson LX-310) dan struk kasir (printer thermal). Hasil terbaik: gambar
          hitam-putih dengan latar putih atau transparan.
        </p>
      </div>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {blank && <Notice tone="error">Gambar ini kosong (seluruhnya putih). Pilih gambar lain.</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-24 items-center justify-center overflow-hidden rounded-lg border bg-surface-muted">
          {image ? (
            <img src={image} alt="Logo toko" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-muted-foreground px-2 text-center text-xs">Belum ada logo</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/bmp"
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Button type="button" variant="outline" className="gap-2" onClick={() => fileRef.current?.click()}>
            <ImageUp className="size-4" /> {image ? 'Ganti Gambar' : 'Pilih Gambar'}
          </Button>
          {image && (
            <Button
              type="button"
              variant="ghost"
              className="text-error-ink gap-2"
              onClick={() => change(setImage)(null)}
            >
              <Trash2 className="size-4" /> Hapus Logo
            </Button>
          )}
        </div>
      </div>

      {image && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="logo-threshold">Ketebalan logo</Label>
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground text-xs">Tipis</span>
              <input
                id="logo-threshold"
                type="range"
                min={40}
                max={230}
                step={2}
                value={threshold}
                onChange={(e) => change(setThreshold)(Number(e.target.value))}
                className="accent-primary h-11 flex-1"
              />
              <span className="text-muted-foreground text-xs">Tebal</span>
            </div>
            <p className="text-muted-foreground text-xs">
              Printer hanya bisa mencetak hitam atau putih. Geser sampai contoh di bawah terlihat jelas.
            </p>
          </div>

          <div className="flex flex-wrap gap-6">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <Checkbox checked={onFaktur} onCheckedChange={(v) => change(setOnFaktur)(v === true)} />
              Cetak di faktur (LX-310)
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <Checkbox checked={onStruk} onCheckedChange={(v) => change(setOnStruk)(v === true)} />
              Cetak di struk kasir (thermal)
            </label>
          </div>

          {bitmaps?.faktur && bitmaps.struk && (
            <div className="grid gap-4 sm:grid-cols-[3fr_2fr]">
              <Preview title="Contoh kepala faktur" muted={!onFaktur}>
                <div className="flex items-start gap-1">
                  <MonoCanvas bitmap={bitmaps.faktur} dpiX={FAKTUR_LOGO.dpiX} dpiY={FAKTUR_LOGO.dpiY} />
                  <div className="font-mono text-[13px] leading-[18px] whitespace-pre">
                    <div className="font-bold">FAKTUR PENJUALAN</div>
                    <div>{store.name.toUpperCase() || 'NAMA TOKO'}</div>
                    <div>{store.address.toUpperCase().slice(0, 24)}</div>
                    <div>{store.phone}</div>
                    <div>-</div>
                  </div>
                </div>
              </Preview>
              <Preview title="Contoh kepala struk" muted={!onStruk}>
                <div className="flex flex-col items-center gap-1">
                  <MonoCanvas bitmap={bitmaps.struk} dpiX={STRUK_LOGO.dpiX} dpiY={STRUK_LOGO.dpiY} />
                  <div className="font-mono text-sm font-bold">{store.name.toUpperCase() || 'NAMA TOKO'}</div>
                </div>
              </Preview>
            </div>
          )}
        </>
      )}

      <div className="pt-2">
        <Button type="button" className="gap-2" disabled={!dirty || busy || blank} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Simpan Logo
        </Button>
      </div>
    </section>
  );
}

function Preview({ title, muted, children }: { title: string; muted: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs font-medium">
        {title}
        {muted && ' — tidak dicetak'}
      </p>
      <div className={`overflow-hidden rounded-lg border bg-background p-3 ${muted ? 'opacity-40' : ''}`}>
        {children}
      </div>
    </div>
  );
}

/** The printer bitmap at its real printed size (dots are not square on the LX-310). */
function MonoCanvas({ bitmap, dpiX, dpiY }: { bitmap: MonoBitmap; dpiX: number; dpiY: number }) {
  return (
    <MonoBitmapCanvas
      bitmap={bitmap}
      style={{ width: (bitmap.width / dpiX) * PPI, height: (bitmap.height / dpiY) * PPI }}
    />
  );
}
