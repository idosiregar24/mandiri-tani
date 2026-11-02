import type { DeviceConfig, ProductItem } from '../types';

export interface PairResponse {
  deviceId: string;
  deviceCode: string;
  token: string;
  hubUrl: string;
  serverTime: string;
}

export function cleanHubUrl(url: string): string {
  let cleaned = url.trim();
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    cleaned = 'http://' + cleaned;
  }
  // Remove trailing slashes
  return cleaned.replace(/\/+$/, '');
}

export async function pingHub(hubUrl: string): Promise<{ ok: boolean; status?: string; message?: string }> {
  const url = `${cleanHubUrl(hubUrl)}/api/v1/system/ping`;
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      return { ok: true };
    }
    return { ok: false, message: `Server merespon ${res.status}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Tidak dapat terhubung' };
  }
}

export async function pairDevice(
  hubUrl: string,
  code: string,
  deviceName: string,
): Promise<{ ok: boolean; data?: PairResponse; error?: string }> {
  const base = cleanHubUrl(hubUrl);
  const url = `${base}/api/v1/devices/pair`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code.trim(),
        deviceName: deviceName.trim() || 'HP Staf Android',
        kind: 'MOBILE',
        deviceTime: new Date().toISOString(),
        appVersion: '0.1.0',
      }),
      signal: AbortSignal.timeout(8000),
    });

    const json = await res.json();
    if (!res.ok) {
      return { ok: false, error: json.error?.message ?? json.message ?? 'Gagal melakukan pairing' };
    }
    return { ok: true, data: json.data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Koneksi ke Hub Kasir gagal. Pastikan satu jaringan Wi-Fi/LAN.',
    };
  }
}

export async function fetchProductsFromHub(config: DeviceConfig): Promise<{ ok: boolean; products?: ProductItem[]; error?: string }> {
  const base = cleanHubUrl(config.hubUrl);
  const url = `${base}/api/v1/products?limit=2000`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.deviceToken}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return { ok: false, error: `Gagal mengambil produk (${res.status})` };
    }

    const json = await res.json();
    const rawProducts = json.data ?? [];

    const products: ProductItem[] = rawProducts.map((p: any) => ({
      id: p.id,
      sku: p.sku ?? p.code ?? '',
      barcode: p.barcode ?? null,
      name: p.name,
      categoryName: p.categoryName ?? p.category?.name ?? 'Umum',
      baseUnit: p.baseUnitName ?? p.unit ?? 'Pcs',
      sellPrice: Number(p.sellPrice ?? p.price ?? 0),
      prices: (p.prices ?? []).map((pr: any) => ({
        unitName: pr.unitName ?? pr.unit,
        conversionQty: Number(pr.conversionQty ?? 1),
        price: Number(pr.price ?? 0),
      })),
      stockToko: Number(p.stockToko ?? p.stock ?? 0),
      stockGudang: Number(p.stockGudang ?? 0),
      totalStock: Number(p.totalStock ?? p.stock ?? 0),
      updatedAt: p.updatedAt ?? new Date().toISOString(),
    }));

    return { ok: true, products };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Gagal menghubungi Hub' };
  }
}

export async function pushSyncOutbox(
  config: DeviceConfig,
  items: Array<{ id: string; entity: string; payload: any }>,
): Promise<{ ok: boolean; processed?: number; error?: string }> {
  if (items.length === 0) return { ok: true, processed: 0 };
  const base = cleanHubUrl(config.hubUrl);
  const url = `${base}/api/v1/sync/push`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.deviceToken}`,
      },
      body: JSON.stringify({
        items: items.map((i) => ({
          client_op_id: i.id,
          entity: i.entity,
          payload: i.payload,
        })),
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return { ok: false, error: json.error?.message ?? `Push gagal (${res.status})` };
    }

    return { ok: true, processed: items.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Push gagal, Hub tidak terjangkau' };
  }
}

