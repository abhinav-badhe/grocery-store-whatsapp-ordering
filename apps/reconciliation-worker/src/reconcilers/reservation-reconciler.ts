import { sql, type Kysely } from 'kysely';
import type { Database, StockReservationRow } from '@grocery/database';
import type {
  DatabaseConnection,
  ReconciledReservation,
  ReservationReconciliationResult,
  ReservationReconcilerOptions,
} from '../types.js';

export class ReservationReconciler {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Queries expired active stock reservations.
   * Scoped to storeId when provided for fail-closed tenant boundary.
   */
  async findExpiredReservations(
    options?: ReservationReconcilerOptions,
  ): Promise<StockReservationRow[]> {
    const now = options?.now ?? new Date();
    const limit = options?.limit ?? 50;

    let query = this.db
      .selectFrom('inventory.stock_reservations')
      .selectAll()
      .where('status', '=', 'ACTIVE')
      .where('expires_at', '<=', now)
      .orderBy('expires_at', 'asc')
      .limit(limit);

    if (options?.storeId) {
      query = query.where('store_id', '=', options.storeId);
    }

    return query.execute();
  }

  /**
   * Reconciles a single expired stock reservation inside a transactional boundary.
   * Releases stock holds and appends immutable audit movement logs.
   */
  async reconcileReservation(
    reservation: StockReservationRow,
    trxConnection?: DatabaseConnection,
  ): Promise<ReconciledReservation> {
    const executeInTransaction = async (
      trx: DatabaseConnection,
    ): Promise<ReconciledReservation> => {
      // 1. Fetch itemized reservation lines
      const items = await trx
        .selectFrom('inventory.stock_reservation_items')
        .selectAll()
        .where('store_id', '=', reservation.store_id)
        .where('reservation_id', '=', reservation.id)
        .execute();

      // 2. Transition reservation status to EXPIRED
      const updatedReservation = await trx
        .updateTable('inventory.stock_reservations')
        .set({
          status: 'EXPIRED',
          updated_at: new Date(),
        })
        .where('store_id', '=', reservation.store_id)
        .where('id', '=', reservation.id)
        .where('status', '=', 'ACTIVE')
        .returningAll()
        .executeTakeFirst();

      // If already transitioned concurrently, return early
      if (!updatedReservation) {
        return {
          id: reservation.id,
          storeId: reservation.store_id,
          orderId: reservation.order_id,
          releasedItemsCount: 0,
        };
      }

      // 3. Release reserved stock hold and record audit trail for each item
      for (const item of items) {
        const qtyNum = Number(item.quantity);

        await trx
          .updateTable('inventory.stock_balances')
          .set({
            reserved_quantity: sql`reserved_quantity - ${String(qtyNum)}`,
            available_quantity: sql`available_quantity + ${String(qtyNum)}`,
            updated_at: new Date(),
          })
          .where('store_id', '=', reservation.store_id)
          .where('product_id', '=', item.product_id)
          .execute();

        await trx
          .insertInto('inventory.stock_movements')
          .values({
            store_id: reservation.store_id,
            product_id: item.product_id,
            delta_quantity: String(qtyNum),
            reason: 'RESERVATION_RELEASE',
            reference_id: reservation.order_id,
            created_at: new Date(),
          })
          .execute();
      }

      return {
        id: reservation.id,
        storeId: reservation.store_id,
        orderId: reservation.order_id,
        releasedItemsCount: items.length,
      };
    };

    if (trxConnection) {
      return executeInTransaction(trxConnection);
    }

    return this.db.transaction().execute(executeInTransaction);
  }

  /**
   * Finds and reconciles a batch of expired stock reservations.
   */
  async reconcileExpiredBatch(
    options?: ReservationReconcilerOptions,
  ): Promise<ReservationReconciliationResult> {
    const expiredReservations = await this.findExpiredReservations(options);
    const reconciled: ReconciledReservation[] = [];
    const errors: { reservationId: string; error: string }[] = [];

    for (const reservation of expiredReservations) {
      try {
        const result = await this.reconcileReservation(reservation);
        reconciled.push(result);
      } catch (err) {
        errors.push({
          reservationId: reservation.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      totalExpiredFound: expiredReservations.length,
      reconciled,
      errors,
    };
  }
}

export function createReservationReconciler(db: Kysely<Database>): ReservationReconciler {
  return new ReservationReconciler(db);
}
