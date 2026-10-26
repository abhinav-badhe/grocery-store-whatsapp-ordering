import type { Kysely, Transaction } from 'kysely';
import type {
  Database,
  StockBalanceRow,
  NewStockBalance,
  StockReservationRow,
  NewStockReservation,
  StockReservationItemRow,
  NewStockReservationItem,
  StockReservationStatus,
  StockMovementRow,
  NewStockMovement,
} from '@grocery/database';

export type DatabaseConnection = Kysely<Database> | Transaction<Database>;

export interface ListStockOptions {
  readonly lowStockOnly?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

export interface StockReservationWithItems extends StockReservationRow {
  readonly items: readonly StockReservationItemRow[];
}

export interface StockBalanceRepository {
  findByProductId(
    storeId: string,
    productId: string,
    trx?: DatabaseConnection,
  ): Promise<StockBalanceRow | null>;

  listByStore(
    storeId: string,
    options?: ListStockOptions,
    trx?: DatabaseConnection,
  ): Promise<StockBalanceRow[]>;

  upsertBalance(balance: NewStockBalance, trx?: DatabaseConnection): Promise<StockBalanceRow>;

  updateQuantities(
    storeId: string,
    productId: string,
    onHand: number,
    reorderPoint?: number | null,
    trx?: DatabaseConnection,
  ): Promise<StockBalanceRow | null>;

  /**
   * Locks multiple stock balance rows deterministically in ascending product_id order
   * to eliminate database deadlocks per ADR-007 §4.
   */
  findAndLockForUpdate(
    storeId: string,
    productIds: readonly string[],
    trx: DatabaseConnection,
  ): Promise<StockBalanceRow[]>;

  applyReservationHold(
    storeId: string,
    productId: string,
    quantity: number,
    trx: DatabaseConnection,
  ): Promise<StockBalanceRow>;

  applyReservationRelease(
    storeId: string,
    productId: string,
    quantity: number,
    trx: DatabaseConnection,
  ): Promise<StockBalanceRow>;

  applyFulfillmentOutflow(
    storeId: string,
    productId: string,
    quantity: number,
    trx: DatabaseConnection,
  ): Promise<StockBalanceRow>;
}

export interface StockReservationRepository {
  findById(
    storeId: string,
    id: string,
    trx?: DatabaseConnection,
  ): Promise<StockReservationWithItems | null>;

  findByOrderId(
    storeId: string,
    orderId: string,
    trx?: DatabaseConnection,
  ): Promise<StockReservationWithItems | null>;

  createReservation(
    reservation: NewStockReservation,
    items: readonly Omit<NewStockReservationItem, 'reservation_id'>[],
    trx: DatabaseConnection,
  ): Promise<StockReservationWithItems>;

  updateStatus(
    storeId: string,
    id: string,
    status: StockReservationStatus,
    trx?: DatabaseConnection,
  ): Promise<StockReservationRow | null>;

  listExpiredActive(
    now: Date,
    limit?: number,
    trx?: DatabaseConnection,
  ): Promise<StockReservationRow[]>;
}

export interface StockMovementRepository {
  recordMovement(movement: NewStockMovement, trx?: DatabaseConnection): Promise<StockMovementRow>;

  listByProduct(
    storeId: string,
    productId: string,
    limit?: number,
    trx?: DatabaseConnection,
  ): Promise<StockMovementRow[]>;
}
