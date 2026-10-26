import type {
  StockBalanceRow,
  StockReservationRow,
  StockMovementRow,
  StockMovementReason,
} from '@grocery/database';
import type { StockReservationWithItems, ListStockOptions } from '../persistence/types.js';

export interface ReserveStockItemInput {
  readonly productId: string;
  readonly quantity: number;
}

export interface ReserveStockRequest {
  readonly orderId: string;
  readonly items: readonly ReserveStockItemInput[];
  readonly expiresInSeconds?: number;
}

export interface AdjustStockRequest {
  readonly deltaQuantity: number;
  readonly reason: 'INFLOW_PURCHASE' | 'MANUAL_CORRECTION' | 'SHRINKAGE_DAMAGE';
  readonly referenceId?: string;
}

export interface InventoryService {
  getStockBalance(storeId: string, productId: string): Promise<StockBalanceRow | null>;
  listStockBalances(storeId: string, options?: ListStockOptions): Promise<StockBalanceRow[]>;
  updateStockBalance(
    storeId: string,
    productId: string,
    onHand: number,
    reorderPoint?: number | null,
  ): Promise<StockBalanceRow>;
  adjustStock(
    storeId: string,
    productId: string,
    request: AdjustStockRequest,
  ): Promise<StockBalanceRow>;
  reserveStock(storeId: string, request: ReserveStockRequest): Promise<StockReservationWithItems>;
  getReservationByOrderId(
    storeId: string,
    orderId: string,
  ): Promise<StockReservationWithItems | null>;
  releaseReservation(storeId: string, orderId: string): Promise<StockReservationWithItems | null>;
  fulfillReservation(storeId: string, orderId: string): Promise<StockReservationWithItems | null>;
  listMovements(storeId: string, productId: string, limit?: number): Promise<StockMovementRow[]>;
}
