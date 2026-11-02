import { fetchProductsFromHub, pingHub, pushSyncOutbox } from './api';
import {
  getConfig,
  getOutbox,
  getProducts,
  getSyncState,
  removeOutbox,
  saveProducts,
  updateSyncState,
} from './storage';
import type { SyncState } from '../types';

export async function runSync(): Promise<{ success: boolean; message: string; state: SyncState }> {
  const config = await getConfig();
  if (!config || !config.deviceToken) {
    const s = await getSyncState();
    return { success: false, message: 'Perangkat belum dipasangkan (paired) dengan Hub.', state: s };
  }

  await updateSyncState({ isSyncing: true, lastError: null });

  try {
    // 1. Check connectivity
    const ping = await pingHub(config.hubUrl);
    if (!ping.ok) {
      await updateSyncState({
        isOnline: false,
        isSyncing: false,
        lastError: 'Tidak dapat menjangkau Hub PC Kasir. Periksa koneksi Wi-Fi/LAN.',
      });
      const s = await getSyncState();
      return { success: false, message: 'Hub offline', state: s };
    }

    // 2. Push Outbox
    const outbox = await getOutbox();
    const pending = outbox.filter((o) => o.status === 'PENDING');
    if (pending.length > 0) {
      const pushRes = await pushSyncOutbox(
        config,
        pending.map((p) => ({ id: p.id, entity: p.entity, payload: p.payload })),
      );
      if (pushRes.ok) {
        for (const item of pending) {
          await removeOutbox(item.id);
        }
      }
    }

    // 3. Pull latest products & stock
    const pullRes = await fetchProductsFromHub(config);
    if (pullRes.ok && pullRes.products) {
      await saveProducts(pullRes.products);
    }

    const remainingOutbox = await getOutbox();
    const nowIso = new Date().toISOString();

    await updateSyncState({
      isOnline: true,
      isSyncing: false,
      lastSyncedAt: nowIso,
      pendingCount: remainingOutbox.length,
      lastError: null,
    });

    const finalState = await getSyncState();
    return {
      success: true,
      message: `Sinkronisasi berhasil (${pullRes.products?.length ?? 0} barang diperbarui)`,
      state: finalState,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Sinkronisasi gagal';
    await updateSyncState({
      isSyncing: false,
      lastError: errorMsg,
    });
    const finalState = await getSyncState();
    return { success: false, message: errorMsg, state: finalState };
  }
}

