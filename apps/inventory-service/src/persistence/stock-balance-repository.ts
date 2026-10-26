import { sql } from 'kysely';
import type { StockBalanceRow, NewStockBalance } from '@grocery/database';
import type { DatabaseConnection, StockBalanceRepository, ListStockOptions } from './types.js';
import { mapInventoryDatabaseError, StockBalancePersistenceNotFoundError } from './errors.js';

export class KyselyStockBalanceRepository implements StockBalanceRepository {
  constructor(private readonly defaultDb: DatabaseConnection) {}

  private getExecutor(trx?: DatabaseConnection): DatabaseConnection {
    return trx ?? this.defaultDb;
  }

  async findByProductId(
    storeId: string,
    productId: string,
    trx?: DatabaseConnection,
  ): Promise<StockBalanceRow | null> {
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('inventory.stock_balances')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('product_id', '=', productId)
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapInventoryDatabaseError(
        err,
        `Failed to find stock balance for product '${productId}'`,
      );
    }
  }

  async listByStore(
    storeId: string,
    options?: ListStockOptions,
    trx?: DatabaseConnection,
  ): Promise<StockBalanceRow[]> {
    try {
      let query = this.getExecutor(trx)
        .selectFrom('inventory.stock_balances')
        .selectAll()
        .where('store_id', '=', storeId);

      if (options?.lowStockOnly) {
        // available_quantity <= reorder_point AND reorder_point IS NOT NULL
        query = query
          .where('reorder_point', 'is not', null)
          .where(sql<boolean>`"available_quantity" <= "reorder_point"`);
      }

      if (options?.limit) {
        query = query.limit(options.limit);
      }

      if (options?.offset) {
        query = query.offset(options.offset);
      }

      return await query.orderBy('product_id', 'asc').execute();
    } catch (err) {
      throw mapInventoryDatabaseError(err, 'Failed to list stock balances for store');
    }
  }

  async upsertBalance(
    balance: NewStockBalance,
    trx?: DatabaseConnection,
  ): Promise<StockBalanceRow> {
    try {
      const onHand = Number(balance.on_hand_quantity ?? 0);
      const reserved = Number(balance.reserved_quantity ?? 0);
      const available = onHand - reserved;

      const created = await this.getExecutor(trx)
        .insertInto('inventory.stock_balances')
        .values({
          ...balance,
          available_quantity: String(available),
        })
        .onConflict((oc) =>
          oc.columns(['store_id', 'product_id']).doUpdateSet({
            on_hand_quantity: (eb) => eb.ref('excluded.on_hand_quantity'),
            reorder_point: (eb) => eb.ref('excluded.reorder_point'),
            sku: (eb) => eb.ref('excluded.sku'),
            available_quantity: sql`excluded.on_hand_quantity - "inventory"."stock_balances"."reserved_quantity"`,
            updated_at: new Date(),
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();
      return created;
    } catch (err) {
      throw mapInventoryDatabaseError(err, 'Failed to upsert stock balance');
    }
  }

  async updateQuantities(
    storeId: string,
    productId: string,
    onHand: number,
    reorderPoint?: number | null,
    trx?: DatabaseConnection,
  ): Promise<StockBalanceRow | null> {
    try {
      const updated = await this.getExecutor(trx)
        .updateTable('inventory.stock_balances')
        .set({
          on_hand_quantity: String(onHand),
          available_quantity: sql`${String(onHand)} - reserved_quantity`,
          ...(reorderPoint !== undefined
            ? { reorder_point: reorderPoint !== null ? String(reorderPoint) : null }
            : {}),
          updated_at: new Date(),
        })
        .where('store_id', '=', storeId)
        .where('product_id', '=', productId)
        .returningAll()
        .executeTakeFirst();
      return updated ?? null;
    } catch (err) {
      throw mapInventoryDatabaseError(
        err,
        `Failed to update stock quantities for product '${productId}'`,
      );
    }
  }

  async findAndLockForUpdate(
    storeId: string,
    productIds: readonly string[],
    trx: DatabaseConnection,
  ): Promise<StockBalanceRow[]> {
    if (productIds.length === 0) {
      return [];
    }

    // CRITICAL: Sort product IDs strictly ascending to avoid deadlocks (ADR-007 §4)
    const sortedProductIds = [...productIds].sort();

    try {
      const rows = await trx
        .selectFrom('inventory.stock_balances')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('product_id', 'in', sortedProductIds)
        .orderBy('product_id', 'asc')
        .forUpdate()
        .execute();

      return rows;
    } catch (err) {
      throw mapInventoryDatabaseError(err, 'Failed to acquire row locks for stock balances');
    }
  }

  async applyReservationHold(
    storeId: string,
    productId: string,
    quantity: number,
    trx: DatabaseConnection,
  ): Promise<StockBalanceRow> {
    try {
      const updated = await trx
        .updateTable('inventory.stock_balances')
        .set({
          reserved_quantity: sql`reserved_quantity + ${String(quantity)}`,
          available_quantity: sql`available_quantity - ${String(quantity)}`,
          updated_at: new Date(),
        })
        .where('store_id', '=', storeId)
        .where('product_id', '=', productId)
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        throw new StockBalancePersistenceNotFoundError(productId);
      }
      return updated;
    } catch (err) {
      throw mapInventoryDatabaseError(
        err,
        `Failed to apply reservation hold on product '${productId}'`,
      );
    }
  }

  async applyReservationRelease(
    storeId: string,
    productId: string,
    quantity: number,
    trx: DatabaseConnection,
  ): Promise<StockBalanceRow> {
    try {
      const updated = await trx
        .updateTable('inventory.stock_balances')
        .set({
          reserved_quantity: sql`reserved_quantity - ${String(quantity)}`,
          available_quantity: sql`available_quantity + ${String(quantity)}`,
          updated_at: new Date(),
        })
        .where('store_id', '=', storeId)
        .where('product_id', '=', productId)
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        throw new StockBalancePersistenceNotFoundError(productId);
      }
      return updated;
    } catch (err) {
      throw mapInventoryDatabaseError(
        err,
        `Failed to apply reservation release on product '${productId}'`,
      );
    }
  }

  async applyFulfillmentOutflow(
    storeId: string,
    productId: string,
    quantity: number,
    trx: DatabaseConnection,
  ): Promise<StockBalanceRow> {
    try {
      const updated = await trx
        .updateTable('inventory.stock_balances')
        .set({
          on_hand_quantity: sql`on_hand_quantity - ${String(quantity)}`,
          reserved_quantity: sql`reserved_quantity - ${String(quantity)}`,
          updated_at: new Date(),
        })
        .where('store_id', '=', storeId)
        .where('product_id', '=', productId)
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        throw new StockBalancePersistenceNotFoundError(productId);
      }
      return updated;
    } catch (err) {
      throw mapInventoryDatabaseError(
        err,
        `Failed to apply fulfillment outflow on product '${productId}'`,
      );
    }
  }
}

export function createStockBalanceRepository(db: DatabaseConnection): StockBalanceRepository {
  return new KyselyStockBalanceRepository(db);
}
