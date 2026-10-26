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
import type { Database, PaymentRow } from '@grocery/database';
import { createPaymentReconciler } from '../dist/index.js';

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const PAYMENT_ID_1 = '55555555-5555-4555-8555-555555555555';
const ORDER_ID_1 = '77777777-7777-4777-8777-777777777777';

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

describe('PaymentReconciler - Stale Pending Payment Processing', () => {
  it('finds stale pending or processing payments beyond cutoff', async () => {
    const executedQueries: CompiledQuery[] = [];
    const mockPayment: PaymentRow = {
      id: PAYMENT_ID_1,
      store_id: STORE_ID,
      order_id: ORDER_ID_1,
      payment_method: 'UPI',
      provider: 'MOCK',
      provider_order_id: 'order_123',
      provider_payment_id: null,
      amount_cents: 15000n,
      currency: 'INR',
      status: 'PENDING',
      idempotency_key: 'key-1',
      created_at: new Date('2026-10-25T09:00:00Z'),
      updated_at: new Date('2026-10-25T09:00:00Z'),
    };

    const db = createMockKysely((query) => {
      executedQueries.push(query);
      if (query.sql.includes('select') && query.sql.includes('payments')) {
        return { rows: [mockPayment] };
      }
      return { rows: [] };
    });

    const reconciler = createPaymentReconciler(db);
    const results = await reconciler.findStalePayments({
      storeId: STORE_ID,
      olderThanMs: 30 * 60 * 1000,
      now: new Date('2026-10-25T10:00:00Z'),
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].id, PAYMENT_ID_1);

    const query = executedQueries[0];
    assert.ok(query.sql.includes('"status" in ($1, $2)'));
    assert.ok(query.sql.includes('"created_at" <= $3'));
    assert.ok(query.sql.includes('"store_id" = $4'));
  });

  it('transitions stale payment status to FAILED in transaction', async () => {
    const executedQueries: CompiledQuery[] = [];
    const mockPayment: PaymentRow = {
      id: PAYMENT_ID_1,
      store_id: STORE_ID,
      order_id: ORDER_ID_1,
      payment_method: 'UPI',
      provider: 'MOCK',
      provider_order_id: 'order_123',
      provider_payment_id: null,
      amount_cents: 15000n,
      currency: 'INR',
      status: 'PROCESSING',
      idempotency_key: 'key-1',
      created_at: new Date('2026-10-25T09:00:00Z'),
      updated_at: new Date('2026-10-25T09:00:00Z'),
    };

    const db = createMockKysely((query) => {
      executedQueries.push(query);
      if (query.sql.includes('update') && query.sql.includes('payments')) {
        return { rows: [{ ...mockPayment, status: 'FAILED' }] };
      }
      return { rows: [] };
    });

    const reconciler = createPaymentReconciler(db);
    const result = await reconciler.reconcilePayment(mockPayment);

    assert.equal(result.id, PAYMENT_ID_1);
    assert.equal(result.previousStatus, 'PROCESSING');

    const updateQuery = executedQueries.find(
      (q) => q.sql.includes('update') && q.sql.includes('payments'),
    );
    assert.ok(updateQuery);
    assert.ok(updateQuery.sql.includes('"status" = $'));
    assert.ok(updateQuery.parameters.includes('FAILED'));
  });

  it('runs reconcileStaleBatch and returns consolidated reconciliation statistics', async () => {
    const mockPayment: PaymentRow = {
      id: PAYMENT_ID_1,
      store_id: STORE_ID,
      order_id: ORDER_ID_1,
      payment_method: 'UPI',
      provider: 'MOCK',
      provider_order_id: 'order_123',
      provider_payment_id: null,
      amount_cents: 15000n,
      currency: 'INR',
      status: 'PENDING',
      idempotency_key: 'key-1',
      created_at: new Date('2026-10-25T09:00:00Z'),
      updated_at: new Date('2026-10-25T09:00:00Z'),
    };

    const db = createMockKysely((query) => {
      if (query.sql.includes('select') && query.sql.includes('payments')) {
        return { rows: [mockPayment] };
      }
      if (query.sql.includes('update') && query.sql.includes('payments')) {
        return { rows: [{ ...mockPayment, status: 'FAILED' }] };
      }
      return { rows: [] };
    });

    const reconciler = createPaymentReconciler(db);
    const result = await reconciler.reconcileStaleBatch({ storeId: STORE_ID });

    assert.equal(result.totalStaleFound, 1);
    assert.equal(result.reconciled.length, 1);
    assert.equal(result.reconciled[0].id, PAYMENT_ID_1);
    assert.equal(result.errors.length, 0);
  });
});
