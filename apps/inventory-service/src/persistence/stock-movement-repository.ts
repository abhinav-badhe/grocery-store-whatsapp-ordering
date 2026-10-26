import type { StockMovementRow, NewStockMovement } from '@grocery/database';
import type { DatabaseConnection, StockMovementRepository } from './types.js';
import { mapInventoryDatabaseError } from './errors.js';

export class KyselyStockMovementRepository implements StockMovementRepository {
  constructor(private readonly defaultDb: DatabaseConnection) {}

  private getExecutor(trx?: DatabaseConnection): DatabaseConnection {
    return trx ?? this.defaultDb;
  }

  async recordMovement(
    movement: NewStockMovement,
    trx?: DatabaseConnection,
  ): Promise<StockMovementRow> {
    try {
      const created = await this.getExecutor(trx)
        .insertInto('inventory.stock_movements')
        .values({
          ...movement,
          delta_quantity: String(movement.delta_quantity),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return created;
    } catch (err) {
      throw mapInventoryDatabaseError(err, 'Failed to record stock movement');
    }
  }

  async listByProduct(
    storeId: string,
    productId: string,
    limit = 50,
    trx?: DatabaseConnection,
  ): Promise<StockMovementRow[]> {
    try {
      return await this.getExecutor(trx)
        .selectFrom('inventory.stock_movements')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('product_id', '=', productId)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .execute();
    } catch (err) {
      throw mapInventoryDatabaseError(
        err,
        `Failed to list stock movements for product '${productId}'`,
      );
    }
  }
}

export function createStockMovementRepository(db: DatabaseConnection): StockMovementRepository {
  return new KyselyStockMovementRepository(db);
}
