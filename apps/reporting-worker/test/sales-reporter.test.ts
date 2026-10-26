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
import type { Database, OrderRow } from '@grocery/database';
import { createSalesReporter } from '../dist/index.js';

const STORE_ID = '11111111-1111-4111-8111-111111111111';

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

  return new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (dbInstance) => new PostgresIntrospector(dbInstance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
}

describe('SalesReporter - Sales Metrics Aggregation', () => {
  it('aggregates completed orders, revenues, and fulfillment breakdown for a store', async () => {
    const executedQueries: CompiledQuery[] = [];

    const mockOrders: OrderRow[] = [
      {
        id: 'order-1',
        store_id: STORE_ID,
        customer_id: 'cust-1',
        order_number: 'ORD-001',
        status: 'COMPLETED',
        fulfillment_type: 'PICKUP',
        delivery_address: null,
        customer_phone: '+919876543210',
        customer_name: 'Customer 1',
        total_amount_cents: 25000n,
        currency: 'INR',
        notes: null,
        idempotency_key: null,
        created_at: new Date('2026-10-25T10:00:00Z'),
        updated_at: new Date('2026-10-25T11:00:00Z'),
      },
      {
        id: 'order-2',
        store_id: STORE_ID,
        customer_id: 'cust-2',
        order_number: 'ORD-002',
        status: 'COMPLETED',
        fulfillment_type: 'DELIVERY',
        delivery_address: '123 Market St',
        customer_phone: '+919876543211',
        customer_name: 'Customer 2',
        total_amount_cents: 75000n,
        currency: 'INR',
        notes: null,
        idempotency_key: null,
        created_at: new Date('2026-10-25T12:00:00Z'),
        updated_at: new Date('2026-10-25T13:00:00Z'),
      },
      {
        id: 'order-3',
        store_id: STORE_ID,
        customer_id: 'cust-3',
        order_number: 'ORD-003',
        status: 'CANCELLED',
        fulfillment_type: 'DELIVERY',
        delivery_address: '456 Main St',
        customer_phone: '+919876543212',
        customer_name: 'Customer 3',
        total_amount_cents: 30000n,
        currency: 'INR',
        notes: null,
        idempotency_key: null,
        created_at: new Date('2026-10-25T14:00:00Z'),
        updated_at: new Date('2026-10-25T14:30:00Z'),
      },
    ];

    const db = createMockKysely((query) => {
      executedQueries.push(query);
      if (query.sql.includes('orders')) {
        return { rows: mockOrders };
      }
      return { rows: [] };
    });

    const reporter = createSalesReporter(db);
    const report = await reporter.generateSalesReport({
      storeId: STORE_ID,
      startDate: new Date('2026-10-25T00:00:00Z'),
      endDate: new Date('2026-10-25T23:59:59Z'),
    });

    assert.equal(report.storeId, STORE_ID);
    assert.equal(report.totalOrders, 3);
    assert.equal(report.completedOrders, 2);
    assert.equal(report.cancelledOrders, 1);
    assert.equal(report.totalRevenueCents, 100000n); // 25000 + 75000
    assert.equal(report.averageOrderValueCents, 50000n); // 100000 / 2
    assert.equal(report.fulfillmentBreakdown.pickup, 1);
    assert.equal(report.fulfillmentBreakdown.delivery, 2);

    const selectQuery = executedQueries[0];
    assert.ok(selectQuery.sql.includes('"store_id" = $'));
    assert.ok(selectQuery.sql.includes('"created_at" >= $'));
    assert.ok(selectQuery.sql.includes('"created_at" <= $'));
    assert.ok(selectQuery.parameters.includes(STORE_ID));
  });

  it('handles zero orders safely with zeroed metrics', async () => {
    const db = createMockKysely(() => ({ rows: [] }));

    const reporter = createSalesReporter(db);
    const report = await reporter.generateSalesReport({
      storeId: STORE_ID,
      startDate: new Date('2026-10-25T00:00:00Z'),
      endDate: new Date('2026-10-25T23:59:59Z'),
    });

    assert.equal(report.totalOrders, 0);
    assert.equal(report.completedOrders, 0);
    assert.equal(report.totalRevenueCents, 0n);
    assert.equal(report.averageOrderValueCents, 0n);
  });
});
