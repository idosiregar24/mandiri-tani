import { z } from './common';

export const SYNC_ENTITIES = [
  'units',
  'categories',
  'brands',
  'customer_groups',
  'customers',
  'suppliers',
  'warehouses',
  'payment_methods',
  'products',
  'product_units',
  'product_barcodes',
  'product_prices',
  'stock_balances',
] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

export const SyncPullQuery = z.object({
  entity: z.enum(SYNC_ENTITIES),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  cursor: z.string().optional(),
  device_time: z.string().datetime().optional(),
});
export type SyncPullQuery = z.infer<typeof SyncPullQuery>;

export interface SyncPullResult<T = unknown> {
  server_time: string;
  rows: T[];
  has_more: boolean;
  cursor?: string;
  next_since?: string;
}

export const SYNC_OP_TYPES = [
  'sale.create',
  'opname.count',
  'receivable_payment.create',
] as const;
export type SyncOpType = (typeof SYNC_OP_TYPES)[number];

export const OutboxOpSchema = z.object({
  op_id: z.string().uuid(),
  type: z.enum(SYNC_OP_TYPES),
  payload: z.unknown(),
  device_time: z.string().datetime(),
  attempts: z.number().int().nonnegative().optional(),
});
export type OutboxOp = z.infer<typeof OutboxOpSchema>;

export const SyncPushInput = z.object({
  ops: z.array(OutboxOpSchema).min(1).max(100),
});
export type SyncPushInput = z.infer<typeof SyncPushInput>;

export interface SyncOpResult {
  op_id: string;
  status: 'APPLIED' | 'DUPLICATE' | 'REJECTED' | 'RETRY';
  result?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface SyncPushResult {
  results: SyncOpResult[];
}

