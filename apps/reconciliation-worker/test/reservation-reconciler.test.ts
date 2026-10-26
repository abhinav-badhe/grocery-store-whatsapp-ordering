import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
  type CompiledQuery,
} from 'kysely';
import type { Database, StockReservationRow, StockReservationItemRow } from '@grocery/database';
import { createReservationReconciler } from '../dist/index.js';

const STORE_ID_A = '11111111-1111-4111-8111-111111111111';
const STORE_ID_B = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID_1 = '44444444-4444-4444-8444-444444444444';
const ORDER_ID_1 = '77777777-7777-4777-8777-777777777777';
const RESERVATION_ID_1 = '88888888-8888-4888-8888-888888888888';

function createMockKysely(
  queryHandler: (query: CompiledQuery) => { rows: any[] },
): Kysely<Database> {
  const connection: DatabaseConnection = {
    executeQuery: async <R>(compiledQuery: CompiledQuery) => {
      const result = queryHandler(compiledQuery);
      return { rows: (result.rows ?? []) as R[] };
    },
    streamQuery: () => {
      throw new Error('Streaming not implemented in mock');
    },
  };

  const driver: Driver = {
    init: async () => {},
    acquireConnection: async () => connection,
    beginTransaction: async () => {},
    commitTransaction: async () => {},
    rollbackTransaction: async () => {},
    releaseConnection: async () => {},
    destroy: async () => {},
  };

  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (dbInstance) => new PostgresIntrospector(dbInstance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

  Object.defineProperty(db, 'transaction', {
    value: () => ({
      execute: async <T>(callback: (trx: Kysely<Database>) => Promise<T>): Promise<T> => {
        return callback(db);
      },
    }),
  });

  return db;
}

describe('ReservationReconciler - Expired Stock Reservation Processing', () => {
  it('finds expired active reservations scoped to store when storeId is provided', async () => {
    const executedQueries: CompiledQuery[] = [];
    const mockReservation: StockReservationRow = {
      id: RESERVATION_ID_1,
      store_id: STORE_ID_A,
      order_id: ORDER_ID_1,
      status: 'ACTIVE',
      expires_at: new Date('2026-10-25T10:00:00Z'),
      created_at: new Date('2026-10-25T09:45:00Z'),
      updated_at: new Date('2026-10-25T09:45:00Z'),
    };

    const db = createMockKysely((query) => {
      executedQueries.push(query);
      if (query.sql.includes('select') && query.sql.includes('stock_reservations')) {
        return { rows: [mockReservation] };
      }
      return { rows: [] };
    });

    const reconciler = createReservationReconciler(db);
    const results = await reconciler.findExpiredReservations({
      storeId: STORE_ID_A,
      now: new Date('2026-10-25T10:05:00Z'),
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].id, RESERVATION_ID_1);
    assert.equal(results[0].store_id, STORE_ID_A);

    const selectQuery = executedQueries[0];
    assert.ok(selectQuery.sql.includes('"status" = $'));
    assert.ok(selectQuery.sql.includes('"expires_at" <= $'));
    assert.ok(selectQuery.sql.includes('"store_id" = $'));
    assert.ok(selectQuery.parameters.includes(STORE_ID_A));
  });

  it('reconciles an expired reservation by updating status, releasing stock balance, and logging movement', async () => {
    const executedQueries: CompiledQuery[] = [];

    const mockReservation: StockReservationRow = {
      id: RESERVATION_ID_1,
      store_id: STORE_ID_A,
      order_id: ORDER_ID_1,
      status: 'ACTIVE',
      expires_at: new Date('2026-10-25T10:00:00Z'),
      created_at: new Date('2026-10-25T09:45:00Z'),
      updated_at: new Date('2026-10-25T09:45:00Z'),
    };

    const mockItems: StockReservationItemRow[] = [
      {
        id: '99999999-9999-4999-8999-999999999999',
        reservation_id: RESERVATION_ID_1,
        store_id: STORE_ID_A,
        product_id: PRODUCT_ID_1,
        quantity: '3.000',
        created_at: new Date(),
      },
    ];

    const db = createMockKysely((query) => {
      executedQueries.push(query);
      if (query.sql.includes('stock_reservation_items')) {
        return { rows: mockItems };
      }
      if (query.sql.includes('update') && query.sql.includes('stock_reservations')) {
        return { rows: [{ ...mockReservation, status: 'EXPIRED' }] };
      }
      return { rows: [] };
    });

    const reconciler = createReservationReconciler(db);
    const result = await reconciler.reconcileReservation(mockReservation);

    assert.equal(result.id, RESERVATION_ID_1);
    assert.equal(result.storeId, STORE_ID_A);
    assert.equal(result.orderId, ORDER_ID_1);
    assert.equal(result.releasedItemsCount, 1);

    // Verify SQL commands:
    // 1. SELECT from stock_reservation_items
    const itemsQuery = executedQueries.find((q) => q.sql.includes('stock_reservation_items'));
    assert.ok(itemsQuery);

    // 2. UPDATE stock_reservations to EXPIRED
    const updateResQuery = executedQueries.find(
      (q) => q.sql.includes('update') && q.sql.includes('stock_reservations'),
    );
    assert.ok(updateResQuery);
    assert.ok(updateResQuery.sql.includes('"status" = $'));

    // 3. UPDATE stock_balances (release held quantities)
    const updateBalQuery = executedQueries.find(
      (q) => q.sql.includes('update') && q.sql.includes('stock_balances'),
    );
    assert.ok(updateBalQuery);

    // 4. INSERT into stock_movements
    const insertMovQuery = executedQueries.find(
      (q) => q.sql.includes('insert into') && q.sql.includes('stock_movements'),
    );
    assert.ok(insertMovQuery);
    assert.ok(insertMovQuery.parameters.includes('RESERVATION_RELEASE'));
  });

  it('runs reconcileExpiredBatch and collates successes and errors', async () => {
    const mockReservation1: StockReservationRow = {
      id: RESERVATION_ID_1,
      store_id: STORE_ID_A,
      order_id: ORDER_ID_1,
      status: 'ACTIVE',
      expires_at: new Date('2026-10-25T10:00:00Z'),
      created_at: new Date('2026-10-25T09:45:00Z'),
      updated_at: new Date('2026-10-25T09:45:00Z'),
    };

    const db = createMockKysely((query) => {
      if (query.sql.includes('select') && query.sql.includes('stock_reservations')) {
        return { rows: [mockReservation1] };
      }
      if (query.sql.includes('stock_reservation_items')) {
        return {
          rows: [
            {
              id: '99999999-9999-4999-8999-999999999999',
              reservation_id: RESERVATION_ID_1,
              store_id: STORE_ID_A,
              product_id: PRODUCT_ID_1,
              quantity: '2.000',
              created_at: new Date(),
            },
          ],
        };
      }
      if (query.sql.includes('update') && query.sql.includes('stock_reservations')) {
        return { rows: [{ ...mockReservation1, status: 'EXPIRED' }] };
      }
      return { rows: [] };
    });

    const reconciler = createReservationReconciler(db);
    const result = await reconciler.reconcileExpiredBatch({ storeId: STORE_ID_A });

    assert.equal(result.totalExpiredFound, 1);
    assert.equal(result.reconciled.length, 1);
    assert.equal(result.reconciled[0].releasedItemsCount, 1);
    assert.equal(result.errors.length, 0);
  });
});
