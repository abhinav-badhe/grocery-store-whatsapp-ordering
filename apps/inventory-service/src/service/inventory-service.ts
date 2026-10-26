import type { Kysely } from 'kysely';
import type { Database, StockBalanceRow, StockMovementRow } from '@grocery/database';
import type {
  StockBalanceRepository,
  StockReservationRepository,
  StockMovementRepository,
  StockReservationWithItems,
  ListStockOptions,
} from '../persistence/types.js';
import type { InventoryService, ReserveStockRequest, AdjustStockRequest } from './types.js';
import {
  StockBalanceNotFoundError,
  InsufficientStockDomainError,
  InvalidReservationStateError,
  DuplicateReservationConflictError,
  InventoryDomainError,
} from './errors.js';

export class DefaultInventoryService implements InventoryService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly stockRepo: StockBalanceRepository,
    private readonly reservationRepo: StockReservationRepository,
    private readonly movementRepo: StockMovementRepository,
  ) {}

  async getStockBalance(storeId: string, productId: string): Promise<StockBalanceRow | null> {
    return this.stockRepo.findByProductId(storeId, productId);
  }

  async listStockBalances(storeId: string, options?: ListStockOptions): Promise<StockBalanceRow[]> {
    return this.stockRepo.listByStore(storeId, options);
  }

  async updateStockBalance(
    storeId: string,
    productId: string,
    onHand: number,
    reorderPoint?: number | null,
  ): Promise<StockBalanceRow> {
    const existing = await this.stockRepo.findByProductId(storeId, productId);
    if (!existing) {
      // Upsert new balance
      return this.stockRepo.upsertBalance({
        store_id: storeId,
        product_id: productId,
        on_hand_quantity: String(onHand),
        reserved_quantity: '0',
        available_quantity: String(onHand),
        reorder_point:
          reorderPoint !== undefined && reorderPoint !== null ? String(reorderPoint) : null,
      });
    }

    if (onHand < Number(existing.reserved_quantity)) {
      throw new InventoryDomainError(
        `On-hand quantity (${onHand}) cannot be less than active reserved quantity (${existing.reserved_quantity})`,
        400,
        'INSUFFICIENT_STOCK_INVARIANT',
      );
    }

    const updated = await this.stockRepo.updateQuantities(storeId, productId, onHand, reorderPoint);
    if (!updated) {
      throw new StockBalanceNotFoundError(productId);
    }
    return updated;
  }

  async adjustStock(
    storeId: string,
    productId: string,
    request: AdjustStockRequest,
  ): Promise<StockBalanceRow> {
    return this.db.transaction().execute(async (trx) => {
      const existing = await this.stockRepo.findByProductId(storeId, productId, trx);
      if (!existing) {
        throw new StockBalanceNotFoundError(productId);
      }

      const currentOnHand = Number(existing.on_hand_quantity);
      const newOnHand = currentOnHand + request.deltaQuantity;

      if (newOnHand < 0) {
        throw new InventoryDomainError(
          `Stock adjustment would result in negative on-hand quantity (${newOnHand})`,
          400,
          'NEGATIVE_STOCK_NOT_ALLOWED',
        );
      }

      if (newOnHand < Number(existing.reserved_quantity)) {
        throw new InventoryDomainError(
          `Stock adjustment would reduce on-hand quantity (${newOnHand}) below active reservations (${existing.reserved_quantity})`,
          400,
          'INSUFFICIENT_STOCK_INVARIANT',
        );
      }

      const updated = await this.stockRepo.updateQuantities(
        storeId,
        productId,
        newOnHand,
        existing.reorder_point !== null ? Number(existing.reorder_point) : null,
        trx,
      );

      if (!updated) {
        throw new StockBalanceNotFoundError(productId);
      }

      await this.movementRepo.recordMovement(
        {
          store_id: storeId,
          product_id: productId,
          delta_quantity: String(request.deltaQuantity),
          reason: request.reason,
          reference_id: request.referenceId ?? null,
        },
        trx,
      );

      return updated;
    });
  }

  async reserveStock(
    storeId: string,
    request: ReserveStockRequest,
  ): Promise<StockReservationWithItems> {
    return this.db.transaction().execute(async (trx) => {
      // 1. Check existing reservation for order idempotency
      const existing = await this.reservationRepo.findByOrderId(storeId, request.orderId, trx);
      if (existing) {
        if (existing.status === 'ACTIVE') {
          return existing; // idempotent return
        }
        throw new DuplicateReservationConflictError(request.orderId);
      }

      // 2. Deterministic ascending product_id locking to eliminate deadlocks (ADR-007 §4)
      const productIds = request.items.map((i) => i.productId);
      const lockedBalances = await this.stockRepo.findAndLockForUpdate(storeId, productIds, trx);
      const balanceMap = new Map(lockedBalances.map((b) => [b.product_id, b]));

      // 3. Verify: FOR ALL requested items, available_quantity >= requested_quantity
      for (const item of request.items) {
        const balance = balanceMap.get(item.productId);
        if (!balance) {
          throw new StockBalanceNotFoundError(item.productId);
        }
        const available = Number(balance.available_quantity);
        if (available < item.quantity) {
          throw new InsufficientStockDomainError(item.productId, item.quantity, available);
        }
      }

      // 4. If all sufficient: apply reservation hold and write append-only movement ledger
      for (const item of request.items) {
        await this.stockRepo.applyReservationHold(storeId, item.productId, item.quantity, trx);
        await this.movementRepo.recordMovement(
          {
            store_id: storeId,
            product_id: item.productId,
            delta_quantity: String(-item.quantity),
            reason: 'RESERVATION_HOLD',
            reference_id: request.orderId,
          },
          trx,
        );
      }

      // 5. Insert reservation and item records
      const expiresIn = request.expiresInSeconds ?? 14400; // 4 hours per ADR-007 §112
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      const reservation = await this.reservationRepo.createReservation(
        {
          store_id: storeId,
          order_id: request.orderId,
          status: 'ACTIVE',
          expires_at: expiresAt,
        },
        request.items.map((i) => ({
          store_id: storeId,
          product_id: i.productId,
          quantity: String(i.quantity),
        })),
        trx,
      );

      return reservation;
    });
  }

  async getReservationByOrderId(
    storeId: string,
    orderId: string,
  ): Promise<StockReservationWithItems | null> {
    return this.reservationRepo.findByOrderId(storeId, orderId);
  }

  async releaseReservation(
    storeId: string,
    orderId: string,
  ): Promise<StockReservationWithItems | null> {
    return this.db.transaction().execute(async (trx) => {
      const reservation = await this.reservationRepo.findByOrderId(storeId, orderId, trx);
      if (!reservation) {
        return null;
      }

      // Idempotent: already released or expired
      if (reservation.status === 'RELEASED' || reservation.status === 'EXPIRED') {
        return reservation;
      }

      if (reservation.status !== 'ACTIVE') {
        throw new InvalidReservationStateError(orderId, reservation.status, 'release');
      }

      // Release stock holds
      for (const item of reservation.items) {
        await this.stockRepo.applyReservationRelease(
          storeId,
          item.product_id,
          Number(item.quantity),
          trx,
        );
        await this.movementRepo.recordMovement(
          {
            store_id: storeId,
            product_id: item.product_id,
            delta_quantity: String(item.quantity),
            reason: 'RESERVATION_RELEASE',
            reference_id: orderId,
          },
          trx,
        );
      }

      const updated = await this.reservationRepo.updateStatus(
        storeId,
        reservation.id,
        'RELEASED',
        trx,
      );

      return {
        ...reservation,
        status: 'RELEASED',
        updated_at: updated?.updated_at ?? new Date(),
      };
    });
  }

  async fulfillReservation(
    storeId: string,
    orderId: string,
  ): Promise<StockReservationWithItems | null> {
    return this.db.transaction().execute(async (trx) => {
      const reservation = await this.reservationRepo.findByOrderId(storeId, orderId, trx);
      if (!reservation) {
        return null;
      }

      // Idempotent: already fulfilled
      if (reservation.status === 'FULFILLED') {
        return reservation;
      }

      if (reservation.status !== 'ACTIVE') {
        throw new InvalidReservationStateError(orderId, reservation.status, 'fulfill');
      }

      // Deduct both on-hand and reserved quantity
      for (const item of reservation.items) {
        await this.stockRepo.applyFulfillmentOutflow(
          storeId,
          item.product_id,
          Number(item.quantity),
          trx,
        );
        await this.movementRepo.recordMovement(
          {
            store_id: storeId,
            product_id: item.product_id,
            delta_quantity: String(-Number(item.quantity)),
            reason: 'FULFILLMENT_OUTFLOW',
            reference_id: orderId,
          },
          trx,
        );
      }

      const updated = await this.reservationRepo.updateStatus(
        storeId,
        reservation.id,
        'FULFILLED',
        trx,
      );

      return {
        ...reservation,
        status: 'FULFILLED',
        updated_at: updated?.updated_at ?? new Date(),
      };
    });
  }

  async listMovements(
    storeId: string,
    productId: string,
    limit?: number,
  ): Promise<StockMovementRow[]> {
    return this.movementRepo.listByProduct(storeId, productId, limit);
  }
}

export function createInventoryServiceInstance(
  db: Kysely<Database>,
  stockRepo: StockBalanceRepository,
  reservationRepo: StockReservationRepository,
  movementRepo: StockMovementRepository,
): InventoryService {
  return new DefaultInventoryService(db, stockRepo, reservationRepo, movementRepo);
}
