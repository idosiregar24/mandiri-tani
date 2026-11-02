export interface DeviceConfig {
  hubUrl: string;
  deviceId: string;
  deviceCode: string; // e.g. 'H01'
  deviceToken: string;
  storeName: string;
  pairedAt: string;
}

export interface ProductPriceTier {
  unitName: string;
  conversionQty: number;
  price: number;
}

export interface ProductItem {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  categoryName: string;
  baseUnit: string;
  sellPrice: number;
  prices: ProductPriceTier[];
  stockToko: number;
  stockGudang: number;
  totalStock: number;
  updatedAt: string;
}

export interface OpnameSession {
  id: string;
  opnameNumber: string;
  status: 'DRAFT' | 'COUNTING' | 'POSTED';
  notes: string;
  startedAt: string;
  counts: Record<string, { physicalQty: number; notes?: string; countedAt: string }>;
}

export interface OutboxItem {
  id: string; // client_op_id (UUIDv7)
  entity: 'opname_count' | 'stock_adjustment';
  payload: Record<string, unknown>;
  createdAt: string;
  status: 'PENDING' | 'SYNCED' | 'FAILED';
  error?: string;
}

export interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  pendingCount: number;
  lastError: string | null;
}

