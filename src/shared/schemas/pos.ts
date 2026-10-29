// Cashier screen lookups (sprint-5 S5-2). No cost/HPP field ever appears here (S5-4).
import type { PriceRow } from '../pricing';
import { Uuid, z } from './common';

export const PosSearchQuery = z.object({ q: z.string().trim().min(1).max(100) });
export const PosLookupQuery = z.object({ code: z.string().trim().min(1).max(100) });
export const LastPriceQuery = z.object({ customerId: Uuid, productUnitId: Uuid });

export interface PosUnit {
  /** product_units.id */
  id: string;
  unitCode: string;
  conversionQty: string;
  isBase: boolean;
  isDefaultSale: boolean;
  barcodes: string[];
  /** Every general + group price row and tier of this unit — resolved with resolvePrice(). */
  prices: PriceRow[];
}

export interface PosProduct {
  id: string;
  sku: string;
  name: string;
  baseUnitCode: string;
  trackStock: boolean;
  allowDecimalQty: boolean;
  /** Physical − reserved in the default warehouse, base units (decimal string). */
  availableQty: string;
  units: PosUnit[];
}

/** GET /pos/lookup: the product plus the unit the scanned code points to. */
export interface PosLookupResult {
  product: PosProduct;
  unitId: string;
}
