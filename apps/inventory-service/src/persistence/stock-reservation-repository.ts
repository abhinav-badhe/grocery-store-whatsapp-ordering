import type {
  StockReservationRow,
  NewStockReservation,
  StockReservationItemRow,
  NewStockReservationItem,
  StockReservationStatus,
} from '@grocery/database';
import type {
  DatabaseConnection,
  StockReservationRepository,
  StockReservationWithItems,
} from './types.js';
import { mapInventoryDatabaseError } from './errors.js';

export class KyselyStockReservationRepository implements StockReservationRepository {
  constructor(private readonly defaultDb: DatabaseConnection) {}

  private getExecutor(trx?: DatabaseConnection): DatabaseConnection {
    return trx ?? this.defaultDb;
  }

  async findById(
    storeId: string,
    id: string,
    trx?: DatabaseConnection,
  ): Promise<StockReservationWithItems | null> {
    try {
      const executor = this.getExecutor(trx);
      const reservation = await executor
        .selectFrom('inventory.stock_reservations')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('id', '=', id)
        .executeTakeFirst();

      if (!reservation) {
        return null;
      }

      const items = await executor
        .selectFrom('inventory.stock_reservation_items')
        .selectAll()
        .where('reservation_id', '=', id)
        .where('store_id', '=', storeId)
        .execute();

      return {
        ...reservation,
        items,
      };
    } catch (err) {
      throw mapInventoryDatabaseError(err, `Failed to find reservation '${id}'`);
    }
  }

  async findByOrderId(
    storeId: string,
    orderId: string,
    trx?: DatabaseConnection,
  ): Promise<StockReservationWithItems | null> {
    try {
      const executor = this.getExecutor(trx);
      const reservation = await executor
        .selectFrom('inventory.stock_reservations')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('order_id', '=', orderId)
        .executeTakeFirst();

      if (!reservation) {
        return null;
      }

      const items = await executor
        .selectFrom('inventory.stock_reservation_items')
        .selectAll()
        .where('reservation_id', '=', reservation.id)
        .where('store_id', '=', storeId)
        .execute();

      return {
        ...reservation,
        items,
      };
    } catch (err) {
      throw mapInventoryDatabaseError(err, `Failed to find reservation for order '${orderId}'`);
    }
  }

  async createReservation(
    reservation: NewStockReservation,
    items: readonly Omit<NewStockReservationItem, 'reservation_id'>[],
    trx: DatabaseConnection,
  ): Promise<StockReservationWithItems> {
    try {
      const createdReservation = await trx
        .insertInto('inventory.stock_reservations')
        .values(reservation)
        .returningAll()
        .executeTakeFirstOrThrow();

      const itemsToInsert: NewStockReservationItem[] = items.map((item) => ({
        ...item,
        reservation_id: createdReservation.id,
        store_id: reservation.store_id,
        quantity: String(item.quantity),
      }));

      const createdItems = await trx
        .insertInto('inventory.stock_reservation_items')
        .values(itemsToInsert)
        .returningAll()
        .execute();

      return {
        ...createdReservation,
        items: createdItems,
      };
    } catch (err) {
      throw mapInventoryDatabaseError(err, 'Failed to create stock reservation');
    }
  }

  async updateStatus(
    storeId: string,
    id: string,
    status: StockReservationStatus,
    trx?: DatabaseConnection,
  ): Promise<StockReservationRow | null> {
    try {
      const updated = await this.getExecutor(trx)
        .updateTable('inventory.stock_reservations')
        .set({
          status,
          updated_at: new Date(),
        })
        .where('store_id', '=', storeId)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();

      return updated ?? null;
    } catch (err) {
      throw mapInventoryDatabaseError(err, `Failed to update status for reservation '${id}'`);
    }
  }

  async listExpiredActive(
    now: Date,
    limit = 50,
    trx?: DatabaseConnection,
  ): Promise<StockReservationRow[]> {
    try {
      return await this.getExecutor(trx)
        .selectFrom('inventory.stock_reservations')
        .selectAll()
        .where('status', '=', 'ACTIVE')
        .where('expires_at', '<=', now)
        .limit(limit)
        .execute();
    } catch (err) {
      throw mapInventoryDatabaseError(err, 'Failed to list expired active reservations');
    }
  }
}

export function createStockReservationRepository(
  db: DatabaseConnection,
): StockReservationRepository {
  return new KyselyStockReservationRepository(db);
}
