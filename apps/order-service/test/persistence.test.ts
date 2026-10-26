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
import type { Database, OrderRow, OrderItemRow, OrderStatusHistoryRow } from '@grocery/database';
import {
  createOrderRepository,
  DuplicateOrderNumberError,
  DuplicateIdempotencyKeyError,
  OrderPersistenceNotFoundError,
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
      createIntrospector: (instance) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

  return { db, queries };
}

const STORE_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_STORE_ID = '00000000-0000-4000-8000-000000000002';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID_1 = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID_2 = '33333333-3333-4333-8333-333333333333';
const ITEM_ID_1 = '44444444-4444-4444-8444-444444444444';
const ITEM_ID_2 = '55555555-5555-4555-8555-555555555555';
const CUSTOMER_ID = '66666666-6666-4666-8666-666666666666';

describe('Order Persistence: KyselyOrderRepository', () => {
  it('creates an order with items, calculated total, and initial status history', async () => {
    const mockOrderRow: OrderRow = {
      id: ORDER_ID,
      store_id: STORE_ID,
      customer_id: CUSTOMER_ID,
      order_number: 'ORD-2026-0001',
      status: 'AWAITING_SHOPKEEPER_REVIEW',
      fulfillment_type: 'PICKUP',
      delivery_address: null,
      customer_phone: '+919876543210',
      customer_name: 'Priya Sharma',
      total_amount_cents: 35000,
      currency: 'INR',
      notes: 'Please pack in eco bag',
      idempotency_key: 'idemp-1',
      created_at: new Date('2026-10-25T10:00:00Z'),
      updated_at: new Date('2026-10-25T10:00:00Z'),
    };

    const mockItemRow1: OrderItemRow = {
      id: ITEM_ID_1,
      order_id: ORDER_ID,
      store_id: STORE_ID,
      product_id: PRODUCT_ID_1,
      product_name_snapshot: 'Organic Basmati Rice 5kg',
      sku_snapshot: 'RICE-BAS-5K',
      unit_snapshot: 'BAG',
      unit_price_cents: 35000,
      quantity: 1,
      total_price_cents: 35000,
      status: 'PENDING',
      substituted_product_id: null,
      substitution_notes: null,
      created_at: new Date('2026-10-25T10:00:00Z'),
      updated_at: new Date('2026-10-25T10:00:00Z'),
    };

    const { db, queries } = createMockKysely({
      onExecuteQuery: (sql) => {
        if (sql.includes('insert into "order"."orders"')) {
          return { rows: [mockOrderRow] };
        }
        if (sql.includes('insert into "order"."order_items"')) {
          return { rows: [mockItemRow1] };
        }
        if (sql.includes('insert into "order"."order_status_history"')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    });

    const repo = createOrderRepository(db);

    const result = await repo.createOrder(
      {
        storeId: STORE_ID,
        customerId: CUSTOMER_ID,
        orderNumber: 'ORD-2026-0001',
        fulfillmentType: 'PICKUP',
        customerPhone: '+919876543210',
        customerName: 'Priya Sharma',
        notes: 'Please pack in eco bag',
        idempotencyKey: 'idemp-1',
      },
      [
        {
          productId: PRODUCT_ID_1,
          productNameSnapshot: 'Organic Basmati Rice 5kg',
          skuSnapshot: 'RICE-BAS-5K',
          unitSnapshot: 'BAG',
          unitPriceCents: 35000,
          quantity: 1,
        },
      ],
    );

    assert.equal(result.id, ORDER_ID);
    assert.equal(result.status, 'AWAITING_SHOPKEEPER_REVIEW');
    assert.equal(result.total_amount_cents, 35000);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]!.product_name_snapshot, 'Organic Basmati Rice 5kg');

    // Verify all queries targeted order schema with store_id
    assert.ok(queries.length >= 3);
    assert.ok(queries.some((q) => q.sql.includes('insert into "order"."orders"')));
    assert.ok(queries.some((q) => q.sql.includes('insert into "order"."order_items"')));
    assert.ok(queries.some((q) => q.sql.includes('insert into "order"."order_status_history"')));
  });

  it('retrieves an order by id with items scoped to store_id', async () => {
    const mockOrderRow: OrderRow = {
      id: ORDER_ID,
      store_id: STORE_ID,
      customer_id: CUSTOMER_ID,
      order_number: 'ORD-2026-0001',
      status: 'CONFIRMED',
      fulfillment_type: 'PICKUP',
      delivery_address: null,
      customer_phone: '+919876543210',
      customer_name: 'Priya Sharma',
      total_amount_cents: 35000,
      currency: 'INR',
      notes: null,
      idempotency_key: null,
      created_at: new Date('2026-10-25T10:00:00Z'),
      updated_at: new Date('2026-10-25T10:00:00Z'),
    };

    const mockItemRow: OrderItemRow = {
      id: ITEM_ID_1,
      order_id: ORDER_ID,
      store_id: STORE_ID,
      product_id: PRODUCT_ID_1,
      product_name_snapshot: 'Organic Basmati Rice 5kg',
      sku_snapshot: 'RICE-BAS-5K',
      unit_snapshot: 'BAG',
      unit_price_cents: 35000,
      quantity: 1,
      total_price_cents: 35000,
      status: 'CONFIRMED',
      substituted_product_id: null,
      substitution_notes: null,
      created_at: new Date('2026-10-25T10:00:00Z'),
      updated_at: new Date('2026-10-25T10:00:00Z'),
    };

    const { db, queries } = createMockKysely({
      onExecuteQuery: (sql, params) => {
        if (sql.includes('from "order"."orders"')) {
          if (params.includes(STORE_ID) && params.includes(ORDER_ID)) {
            return { rows: [mockOrderRow] };
          }
          return { rows: [] };
        }
        if (sql.includes('from "order"."order_items"')) {
          return { rows: [mockItemRow] };
        }
        return { rows: [] };
      },
    });

    const repo = createOrderRepository(db);

    const found = await repo.findById(STORE_ID, ORDER_ID);
    assert.ok(found);
    assert.equal(found.id, ORDER_ID);
    assert.equal(found.items.length, 1);

    // Verify isolation: querying under a different store returns null
    const notFound = await repo.findById(OTHER_STORE_ID, ORDER_ID);
    assert.equal(notFound, null);
  });

  it('retrieves an order by order_number scoped to store_id', async () => {
    const mockOrderRow: OrderRow = {
      id: ORDER_ID,
      store_id: STORE_ID,
      customer_id: null,
      order_number: 'ORD-2026-0001',
      status: 'CONFIRMED',
      fulfillment_type: 'PICKUP',
      delivery_address: null,
      customer_phone: null,
      customer_name: null,
      total_amount_cents: 1000,
      currency: 'INR',
      notes: null,
      idempotency_key: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const { db } = createMockKysely({
      onExecuteQuery: (sql, params) => {
        if (
          sql.includes('from "order"."orders"') &&
          params.includes(STORE_ID) &&
          params.includes('ORD-2026-0001')
        ) {
          return { rows: [mockOrderRow] };
        }
        return { rows: [] };
      },
    });

    const repo = createOrderRepository(db);
    const order = await repo.findByOrderNumber(STORE_ID, 'ORD-2026-0001');
    assert.ok(order);
    assert.equal(order.order_number, 'ORD-2026-0001');

    const notFound = await repo.findByOrderNumber(OTHER_STORE_ID, 'ORD-2026-0001');
    assert.equal(notFound, null);
  });

  it('retrieves an order by idempotency_key', async () => {
    const mockOrderRow: OrderRow = {
      id: ORDER_ID,
      store_id: STORE_ID,
      customer_id: null,
      order_number: 'ORD-2026-0001',
      status: 'AWAITING_SHOPKEEPER_REVIEW',
      fulfillment_type: 'PICKUP',
      delivery_address: null,
      customer_phone: null,
      customer_name: null,
      total_amount_cents: 1000,
      currency: 'INR',
      notes: null,
      idempotency_key: 'idem-test-123',
      created_at: new Date(),
      updated_at: new Date(),
    };

    const { db } = createMockKysely({
      onExecuteQuery: (sql, params) => {
        if (sql.includes('from "order"."orders"') && params.includes('idem-test-123')) {
          return { rows: [mockOrderRow] };
        }
        return { rows: [] };
      },
    });

    const repo = createOrderRepository(db);
    const order = await repo.findByIdempotencyKey(STORE_ID, 'idem-test-123');
    assert.ok(order);
    assert.equal(order.idempotency_key, 'idem-test-123');
  });

  it('lists orders with pagination and total count', async () => {
    const mockOrderRow: OrderRow = {
      id: ORDER_ID,
      store_id: STORE_ID,
      customer_id: CUSTOMER_ID,
      order_number: 'ORD-2026-0001',
      status: 'CONFIRMED',
      fulfillment_type: 'PICKUP',
      delivery_address: null,
      customer_phone: null,
      customer_name: null,
      total_amount_cents: 1000,
      currency: 'INR',
      notes: null,
      idempotency_key: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const mockItemRow: OrderItemRow = {
      id: ITEM_ID_1,
      order_id: ORDER_ID,
      store_id: STORE_ID,
      product_id: PRODUCT_ID_1,
      product_name_snapshot: 'Test Product',
      sku_snapshot: null,
      unit_snapshot: 'PIECE',
      unit_price_cents: 1000,
      quantity: 1,
      total_price_cents: 1000,
      status: 'CONFIRMED',
      substituted_product_id: null,
      substitution_notes: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const { db } = createMockKysely({
      onExecuteQuery: (sql) => {
        if (sql.includes('count(')) {
          return { rows: [{ count: '1' }] };
        }
        if (sql.includes('from "order"."orders"')) {
          return { rows: [mockOrderRow] };
        }
        if (sql.includes('from "order"."order_items"')) {
          return { rows: [mockItemRow] };
        }
        return { rows: [] };
      },
    });

    const repo = createOrderRepository(db);
    const result = await repo.listByStore(STORE_ID, {
      status: 'CONFIRMED',
      limit: 10,
      offset: 0,
    });

    assert.equal(result.totalCount, 1);
    assert.equal(result.orders.length, 1);
    assert.equal(result.orders[0]!.items.length, 1);
  });

  it('updates order status and appends status history audit record', async () => {
    const existingOrder: OrderRow = {
      id: ORDER_ID,
      store_id: STORE_ID,
      customer_id: CUSTOMER_ID,
      order_number: 'ORD-2026-0001',
      status: 'AWAITING_SHOPKEEPER_REVIEW',
      fulfillment_type: 'PICKUP',
      delivery_address: null,
      customer_phone: null,
      customer_name: null,
      total_amount_cents: 1000,
      currency: 'INR',
      notes: null,
      idempotency_key: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const updatedOrder: OrderRow = {
      ...existingOrder,
      status: 'CONFIRMED',
    };

    const { db, queries } = createMockKysely({
      onExecuteQuery: (sql) => {
        if (sql.includes('select') && sql.includes('from "order"."orders"')) {
          return { rows: [existingOrder] };
        }
        if (sql.includes('update "order"."orders"')) {
          return { rows: [updatedOrder] };
        }
        if (sql.includes('insert into "order"."order_status_history"')) {
          return { rows: [] };
        }
        if (sql.includes('from "order"."order_items"')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    });

    const repo = createOrderRepository(db);
    const result = await repo.updateStatus(
      STORE_ID,
      ORDER_ID,
      'CONFIRMED',
      CUSTOMER_ID,
      'Shopkeeper verified stock',
    );

    assert.ok(result);
    assert.equal(result.status, 'CONFIRMED');

    const historyQuery = queries.find((q) =>
      q.sql.includes('insert into "order"."order_status_history"'),
    );
    assert.ok(historyQuery);
    assert.ok(historyQuery.parameters.includes('AWAITING_SHOPKEEPER_REVIEW'));
    assert.ok(historyQuery.parameters.includes('CONFIRMED'));
    assert.ok(historyQuery.parameters.includes('Shopkeeper verified stock'));
  });

  it('substitutes an item, recalculates order total, and updates status', async () => {
    const originalItem: OrderItemRow = {
      id: ITEM_ID_1,
      order_id: ORDER_ID,
      store_id: STORE_ID,
      product_id: PRODUCT_ID_1,
      product_name_snapshot: 'Original Rice 5kg',
      sku_snapshot: null,
      unit_snapshot: 'BAG',
      unit_price_cents: 35000,
      quantity: 1,
      total_price_cents: 35000,
      status: 'PENDING',
      substituted_product_id: null,
      substitution_notes: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const substitutedItem: OrderItemRow = {
      ...originalItem,
      status: 'SUBSTITUTED',
      substituted_product_id: PRODUCT_ID_2,
      substitution_notes: 'Replaced with Premium Basmati as original out of stock',
      quantity: 2,
      total_price_cents: 70000,
    };

    const updatedOrder: OrderRow = {
      id: ORDER_ID,
      store_id: STORE_ID,
      customer_id: CUSTOMER_ID,
      order_number: 'ORD-2026-0001',
      status: 'AWAITING_SHOPKEEPER_REVIEW',
      fulfillment_type: 'PICKUP',
      delivery_address: null,
      customer_phone: null,
      customer_name: null,
      total_amount_cents: 70000,
      currency: 'INR',
      notes: null,
      idempotency_key: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const { db, queries } = createMockKysely({
      onExecuteQuery: (sql) => {
        if (
          sql.includes('select') &&
          sql.includes('from "order"."order_items"') &&
          sql.includes('"id" = $3')
        ) {
          return { rows: [originalItem] };
        }
        if (sql.includes('update "order"."order_items"')) {
          return { rows: [] };
        }
        if (sql.includes('select') && sql.includes('from "order"."order_items"')) {
          return { rows: [substitutedItem] };
        }
        if (sql.includes('update "order"."orders"')) {
          return { rows: [updatedOrder] };
        }
        return { rows: [] };
      },
    });

    const repo = createOrderRepository(db);
    const result = await repo.substituteItem(
      STORE_ID,
      ORDER_ID,
      ITEM_ID_1,
      PRODUCT_ID_2,
      'Replaced with Premium Basmati as original out of stock',
      2,
    );

    assert.ok(result);
    assert.equal(result.total_amount_cents, 70000);
    assert.equal(result.items[0]!.status, 'SUBSTITUTED');
    assert.equal(result.items[0]!.substituted_product_id, PRODUCT_ID_2);
  });

  it('maps unique constraint violations to typed domain errors', async () => {
    const { db: dbOrderNum } = createMockKysely({
      onExecuteQuery: () => {
        const error = new Error('duplicate key value violates unique constraint') as Error & {
          code: string;
          constraint: string;
        };
        error.code = '23505';
        error.constraint = 'uq_orders_store_order_number';
        throw error;
      },
    });

    const repo1 = createOrderRepository(dbOrderNum);
    await assert.rejects(
      async () =>
        repo1.createOrder(
          {
            storeId: STORE_ID,
            orderNumber: 'ORD-DUP',
            fulfillmentType: 'PICKUP',
          },
          [
            {
              productId: PRODUCT_ID_1,
              productNameSnapshot: 'Item',
              unitPriceCents: 100,
              quantity: 1,
            },
          ],
        ),
      (err: unknown) => err instanceof DuplicateOrderNumberError,
    );

    const { db: dbIdemp } = createMockKysely({
      onExecuteQuery: () => {
        const error = new Error('duplicate key value violates unique constraint') as Error & {
          code: string;
          constraint: string;
        };
        error.code = '23505';
        error.constraint = 'uq_orders_store_idempotency_key';
        throw error;
      },
    });

    const repo2 = createOrderRepository(dbIdemp);
    await assert.rejects(
      async () =>
        repo2.createOrder(
          {
            storeId: STORE_ID,
            orderNumber: 'ORD-NEW',
            idempotencyKey: 'dup-key',
            fulfillmentType: 'PICKUP',
          },
          [
            {
              productId: PRODUCT_ID_1,
              productNameSnapshot: 'Item',
              unitPriceCents: 100,
              quantity: 1,
            },
          ],
        ),
      (err: unknown) => err instanceof DuplicateIdempotencyKeyError,
    );
  });

  it('retrieves chronological status history', async () => {
    const mockHistory: OrderStatusHistoryRow = {
      id: '77777777-7777-4777-8777-777777777777',
      order_id: ORDER_ID,
      store_id: STORE_ID,
      from_status: 'AWAITING_SHOPKEEPER_REVIEW',
      to_status: 'CONFIRMED',
      changed_by_user_id: CUSTOMER_ID,
      reason: 'Confirmed by shopkeeper',
      created_at: new Date('2026-10-25T11:00:00Z'),
    };

    const { db } = createMockKysely({
      onExecuteQuery: (sql) => {
        if (sql.includes('from "order"."order_status_history"')) {
          return { rows: [mockHistory] };
        }
        return { rows: [] };
      },
    });

    const repo = createOrderRepository(db);
    const history = await repo.getStatusHistory(STORE_ID, ORDER_ID);
    assert.equal(history.length, 1);
    assert.equal(history[0]!.from_status, 'AWAITING_SHOPKEEPER_REVIEW');
    assert.equal(history[0]!.to_status, 'CONFIRMED');
  });
});
