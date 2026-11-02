import { Preferences } from '@capacitor/preferences';
import type { DeviceConfig, OpnameSession, OutboxItem, ProductItem, SyncState } from '../types';

const KEYS = {
  CONFIG: 'mt_device_config',
  PRODUCTS: 'mt_products_cache',
  OPNAME: 'mt_opname_session',
  OUTBOX: 'mt_outbox_queue',
  SYNC_STATE: 'mt_sync_state',
};

export async function getConfig(): Promise<DeviceConfig | null> {
  const { value } = await Preferences.get({ key: KEYS.CONFIG });
  if (!value) return null;
  try {
    return JSON.parse(value) as DeviceConfig;
  } catch {
    return null;
  }
}

export async function saveConfig(config: DeviceConfig): Promise<void> {
  await Preferences.set({ key: KEYS.CONFIG, value: JSON.stringify(config) });
}

export async function clearConfig(): Promise<void> {
  await Preferences.remove({ key: KEYS.CONFIG });
}

export async function getProducts(): Promise<ProductItem[]> {
  const { value } = await Preferences.get({ key: KEYS.PRODUCTS });
  if (!value) return [];
  try {
    return JSON.parse(value) as ProductItem[];
  } catch {
    return [];
  }
}

export async function saveProducts(products: ProductItem[]): Promise<void> {
  await Preferences.set({ key: KEYS.PRODUCTS, value: JSON.stringify(products) });
}

export async function getOpnameSession(): Promise<OpnameSession | null> {
  const { value } = await Preferences.get({ key: KEYS.OPNAME });
  if (!value) return null;
  try {
    return JSON.parse(value) as OpnameSession;
  } catch {
    return null;
  }
}

export async function saveOpnameSession(session: OpnameSession | null): Promise<void> {
  if (!session) {
    await Preferences.remove({ key: KEYS.OPNAME });
  } else {
    await Preferences.set({ key: KEYS.OPNAME, value: JSON.stringify(session) });
  }
}

export async function getOutbox(): Promise<OutboxItem[]> {
  const { value } = await Preferences.get({ key: KEYS.OUTBOX });
  if (!value) return [];
  try {
    return JSON.parse(value) as OutboxItem[];
  } catch {
    return [];
  }
}

export async function addOutbox(item: OutboxItem): Promise<void> {
  const queue = await getOutbox();
  queue.push(item);
  await Preferences.set({ key: KEYS.OUTBOX, value: JSON.stringify(queue) });
}

export async function removeOutbox(id: string): Promise<void> {
  const queue = await getOutbox();
  const filtered = queue.filter((i) => i.id !== id);
  await Preferences.set({ key: KEYS.OUTBOX, value: JSON.stringify(filtered) });
}

export async function getSyncState(): Promise<SyncState> {
  const { value } = await Preferences.get({ key: KEYS.SYNC_STATE });
  if (!value) {
    return {
      isOnline: false,
      isSyncing: false,
      lastSyncedAt: null,
      pendingCount: 0,
      lastError: null,
    };
  }
  try {
    return JSON.parse(value) as SyncState;
  } catch {
    return {
      isOnline: false,
      isSyncing: false,
      lastSyncedAt: null,
      pendingCount: 0,
      lastError: null,
    };
  }
}

export async function updateSyncState(patch: Partial<SyncState>): Promise<void> {
  const current = await getSyncState();
  const updated = { ...current, ...patch };
  await Preferences.set({ key: KEYS.SYNC_STATE, value: JSON.stringify(updated) });
}

