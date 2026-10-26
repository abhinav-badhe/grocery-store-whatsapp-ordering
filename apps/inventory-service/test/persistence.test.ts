import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
} from 'kysely';
import type {
  Database,
  StockBalanceRow,
  StockReservationRow,
  StockReservationItemRow,
  StockMovementRow,
} from '@grocery/database';
import {
  createStockBalanceRepository,
  createStockReservationRepository,
  createStockMovementRepository,
  DuplicateReservationError,
} from '../dist/index.js';

interface QueryRecord {
  sql: string;
  parameters: readonly unknown[];
}

interface MockKyselyOptions {
  onExecuteQuery?: (
    sql: string,
    parameters: readonly unknown[],
  ) =>
    | { rows: unknown[]; numAffectedRows?: bigint }
    | Promise<{ rows: unknown[]; numAffectedRows?: bigint }>;
}

function createMockKysely(options: MockKyselyOptions = {}): {
  db: Kysely<Database>;
  queries: QueryRecord[];
} {
  const queries: QueryRecord[] = [];
  const connection: DatabaseConnection = {
    executeQuery: async <R>(compiledQuery: { sql: string; parameters: readonly unknown[] }) => {
      queries.push({
        sql: compiledQuery.sql,
        parameters: compiledQuery.parameters,
      });
      if (options.onExecuteQuery) {
        const result = await options.onExecuteQuery(compiledQuery.sql, compiledQuery.parameters);
        return {
          rows: (result.rows ?? []) as R[],
          numAffectedRows: result.numAffectedRows,
        };
      }
      return { rows: [] as R[] };
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

  return { db, queries };
}

const STORE_ID_A = '11111111-1111-4111-8111-111111111111';
const STORE_ID_B = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID_1 = '44444444-4444-4444-8444-444444444444';
const PRODUCT_ID_2 = '55555555-5555-4555-8555-555555555555';
const ORDER_ID_1 = '77777777-7777-4777-8777-777777777777';
const RESERVATION_ID_1 = '88888888-8888-4888-8888-888888888888';

describe('Inventory Persistence Repositories & Concurrency Controls', () => {
  describe('StockBalanceRepository', () => {
    it('findByProductId queries with mandatory store_id and product_id scoping', async () => {
      const { db, queries } = createMockKysely({
        onExecuteQuery: async () => ({ rows: [] }),
      });

      const repo = createStockBalanceRepository(db);
      const balance = await repo.findByProductId(STORE_ID_A, PRODUCT_ID_1);

      assert.equal(balance, null);
      assert.equal(queries.length, 1);
      assert.match(queries[0].sql, /where "store_id" = \$1 and "product_id" = \$2/i);
      assert.equal(queries[0].parameters[0], STORE_ID_A);
      assert.equal(queries[0].parameters[1], PRODUCT_ID_1);
    });

    it('findAndLockForUpdate strictly sorts product IDs ascending to eliminate deadlocks (ADR-007 §4)', async () => {
      const { db, queries } = createMockKysely({
        onExecuteQuery: async () => ({ rows: [] }),
      });

      const repo = createStockBalanceRepository(db);

      // Pass IDs in descending / arbitrary order
      const unsortedIds = [PRODUCT_ID_2, PRODUCT_ID_1];
      await repo.findAndLockForUpdate(STORE_ID_A, unsortedIds, db);

      assert.equal(queries.length, 1);
      assert.match(queries[0].sql, /order by "product_id" asc/i);
      assert.match(queries[0].sql, /for update/i);

      // Verify parameters were sorted strictly ascending
      const expectedSorted = [...unsortedIds].sort();
      assert.equal(queries[0].parameters[0], STORE_ID_A);
      assert.equal(queries[0].parameters[1], expectedSorted[0]);
      assert.equal(queries[0].parameters[2], expectedSorted[1]);
    });

    it('upserts stock balance with onConflict update and recalculated available quantity', async () => {
      const mockRow: StockBalanceRow = {
        id: '99999999-9999-4999-8999-999999999999',
        store_id: STORE_ID_A,
        product_id: PRODUCT_ID_1,
        sku: 'SKU-001',
        on_hand_quantity: '50.000',
        reserved_quantity: '0.000',
        available_quantity: '50.000',
        reorder_point: '10.000',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const { db, queries } = createMockKysely({
        onExecuteQuery: async () => ({ rows: [mockRow] }),
      });

      const repo = createStockBalanceRepository(db);
      const result = await repo.upsertBalance({
        store_id: STORE_ID_A,
        product_id: PRODUCT_ID_1,
        sku: 'SKU-001',
        on_hand_quantity: '50.000',
        reserved_quantity: '0.000',
        reorder_point: '10.000',
      });

      assert.deepEqual(result, mockRow);
      assert.match(queries[0].sql, /insert into "inventory"\."stock_balances"/i);
      assert.match(queries[0].sql, /on conflict \("store_id", "product_id"\) do update/i);
    });

    it('applies reservation hold: increments reserved_quantity and decrements available_quantity', async () => {
      const mockUpdated: StockBalanceRow = {
        id: '99999999-9999-4999-8999-999999999999',
        store_id: STORE_ID_A,
        product_id: PRODUCT_ID_1,
        sku: 'SKU-001',
        on_hand_quantity: '50.000',
        reserved_quantity: '5.000',
        available_quantity: '45.000',
        reorder_point: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const { db, queries } = createMockKysely({
        onExecuteQuery: async () => ({ rows: [mockUpdated] }),
      });

      const repo = createStockBalanceRepository(db);
      const updated = await repo.applyReservationHold(STORE_ID_A, PRODUCT_ID_1, 5, db);

      assert.deepEqual(updated, mockUpdated);
      assert.match(queries[0].sql, /update "inventory"\."stock_balances"/i);
      assert.match(queries[0].sql, /reserved_quantity \+ \$1/i);
      assert.match(queries[0].sql, /available_quantity - \$2/i);
    });

    it('applies reservation release: decrements reserved_quantity and increments available_quantity', async () => {
      const mockUpdated: StockBalanceRow = {
        id: '99999999-9999-4999-8999-999999999999',
        store_id: STORE_ID_A,
        product_id: PRODUCT_ID_1,
        sku: 'SKU-001',
        on_hand_quantity: '50.000',
        reserved_quantity: '0.000',
        available_quantity: '50.000',
        reorder_point: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const { db, queries } = createMockKysely({
        onExecuteQuery: async () => ({ rows: [mockUpdated] }),
      });

      const repo = createStockBalanceRepository(db);
      const updated = await repo.applyReservationRelease(STORE_ID_A, PRODUCT_ID_1, 5, db);

      assert.deepEqual(updated, mockUpdated);
      assert.match(queries[0].sql, /reserved_quantity - \$1/i);
      assert.match(queries[0].sql, /available_quantity \+ \$2/i);
    });

    it('applies fulfillment outflow: decrements on_hand_quantity and reserved_quantity', async () => {
      const mockUpdated: StockBalanceRow = {
        id: '99999999-9999-4999-8999-999999999999',
        store_id: STORE_ID_A,
        product_id: PRODUCT_ID_1,
        sku: 'SKU-001',
        on_hand_quantity: '45.000',
        reserved_quantity: '0.000',
        available_quantity: '45.000',
        reorder_point: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const { db, queries } = createMockKysely({
        onExecuteQuery: async () => ({ rows: [mockUpdated] }),
      });

      const repo = createStockBalanceRepository(db);
      const updated = await repo.applyFulfillmentOutflow(STORE_ID_A, PRODUCT_ID_1, 5, db);

      assert.deepEqual(updated, mockUpdated);
      assert.match(queries[0].sql, /on_hand_quantity - \$1/i);
      assert.match(queries[0].sql, /reserved_quantity - \$2/i);
    });
  });

  describe('StockReservationRepository', () => {
    it('creates reservation and itemized lines within a single transaction', async () => {
      const mockReservation: StockReservationRow = {
        id: RESERVATION_ID_1,
        store_id: STORE_ID_A,
        order_id: ORDER_ID_1,
        status: 'ACTIVE',
        expires_at: new Date(Date.now() + 14400000),
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockItems: StockReservationItemRow[] = [
        {
          id: '11111111-2222-3333-4444-555555555555',
          reservation_id: RESERVATION_ID_1,
          store_id: STORE_ID_A,
          product_id: PRODUCT_ID_1,
          quantity: '3.000',
          created_at: new Date(),
        },
      ];

      const { db, queries } = createMockKysely({
        onExecuteQuery: async (sql) => {
          if (sql.includes('stock_reservations')) {
            return { rows: [mockReservation] };
          }
          return { rows: mockItems };
        },
      });

      const repo = createStockReservationRepository(db);
      const created = await repo.createReservation(
        {
          store_id: STORE_ID_A,
          order_id: ORDER_ID_1,
          status: 'ACTIVE',
          expires_at: mockReservation.expires_at,
        },
        [
          {
            store_id: STORE_ID_A,
            product_id: PRODUCT_ID_1,
            quantity: '3.000',
          },
        ],
        db,
      );

      assert.equal(created.id, RESERVATION_ID_1);
      assert.equal(created.items.length, 1);
      assert.equal(created.items[0].product_id, PRODUCT_ID_1);

      assert.equal(queries.length, 2);
      assert.match(queries[0].sql, /insert into "inventory"\."stock_reservations"/i);
      assert.match(queries[1].sql, /insert into "inventory"\."stock_reservation_items"/i);
    });

    it('findByOrderId queries reservation and child items strictly within store boundary', async () => {
      const mockReservation: StockReservationRow = {
        id: RESERVATION_ID_1,
        store_id: STORE_ID_A,
        order_id: ORDER_ID_1,
        status: 'ACTIVE',
        expires_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockItem: StockReservationItemRow = {
        id: 'item-1',
        reservation_id: RESERVATION_ID_1,
        store_id: STORE_ID_A,
        product_id: PRODUCT_ID_1,
        quantity: '2.000',
        created_at: new Date(),
      };

      const { db, queries } = createMockKysely({
        onExecuteQuery: async (sql) => {
          if (sql.includes('stock_reservations')) {
            return { rows: [mockReservation] };
          }
          return { rows: [mockItem] };
        },
      });

      const repo = createStockReservationRepository(db);
      const result = await repo.findByOrderId(STORE_ID_A, ORDER_ID_1);

      assert.ok(result);
      assert.equal(result.order_id, ORDER_ID_1);
      assert.equal(result.items.length, 1);

      assert.equal(queries.length, 2);
      assert.match(queries[0].sql, /where "store_id" = \$1 and "order_id" = \$2/i);
      assert.match(queries[1].sql, /where "reservation_id" = \$1 and "store_id" = \$2/i);
      assert.equal(queries[0].parameters[0], STORE_ID_A);
      assert.equal(queries[1].parameters[1], STORE_ID_A);
    });

    it('maps unique constraint violation on order reservation to DuplicateReservationError', async () => {
      const { db } = createMockKysely({
        onExecuteQuery: async () => {
          const pgError = new Error('duplicate key') as Error & {
            code?: string;
            constraint?: string;
          };
          pgError.code = '23505';
          pgError.constraint = 'stock_reservations_store_order_unique';
          throw pgError;
        },
      });

      const repo = createStockReservationRepository(db);
      await assert.rejects(
        () =>
          repo.createReservation(
            {
              store_id: STORE_ID_A,
              order_id: ORDER_ID_1,
              status: 'ACTIVE',
              expires_at: new Date(),
            },
            [],
            db,
          ),
        (err: unknown) => {
          assert.ok(err instanceof DuplicateReservationError);
          assert.equal(err.code, 'DUPLICATE_RESERVATION');
          return true;
        },
      );
    });
  });

  describe('StockMovementRepository', () => {
    it('records append-only stock movement row and returns created record', async () => {
      const mockMovement: StockMovementRow = {
        id: 'mov-1',
        store_id: STORE_ID_A,
        product_id: PRODUCT_ID_1,
        delta_quantity: '-2.000',
        reason: 'RESERVATION_HOLD',
        reference_id: ORDER_ID_1,
        created_at: new Date(),
      };

      const { db, queries } = createMockKysely({
        onExecuteQuery: async () => ({ rows: [mockMovement] }),
      });

      const repo = createStockMovementRepository(db);
      const recorded = await repo.recordMovement({
        store_id: STORE_ID_A,
        product_id: PRODUCT_ID_1,
        delta_quantity: '-2.000',
        reason: 'RESERVATION_HOLD',
        reference_id: ORDER_ID_1,
      });

      assert.deepEqual(recorded, mockMovement);
      assert.match(queries[0].sql, /insert into "inventory"\."stock_movements"/i);
      assert.match(queries[0].sql, /returning \*/i);
    });

    it('lists stock movements ordered reverse chronologically', async () => {
      const { db, queries } = createMockKysely({
        onExecuteQuery: async () => ({ rows: [] }),
      });

      const repo = createStockMovementRepository(db);
      await repo.listByProduct(STORE_ID_A, PRODUCT_ID_1, 25);

      assert.match(queries[0].sql, /where "store_id" = \$1 and "product_id" = \$2/i);
      assert.match(queries[0].sql, /order by "created_at" desc/i);
      assert.match(queries[0].sql, /limit \$3/i);
      assert.equal(queries[0].parameters[2], 25);
    });
  });
});
