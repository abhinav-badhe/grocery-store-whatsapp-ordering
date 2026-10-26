import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
} from 'kysely';
import type { Database, OrderRow, OrderItemRow, OrderStatusHistoryRow } from '../dist/index.js';
import {
  loadMigrationFiles,
  computeMigrationChecksum,
  getDefaultMigrationsDir,
} from '../dist/index.js';

function createMockKysely(): Kysely<Database> {
  const connection: DatabaseConnection = {
    executeQuery: async <R>() => ({ rows: [] as R[] }),
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
      createDriver: () => driver,
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createAdapter: () => new PostgresAdapter(),
      createIntrospector: (db) => new PostgresIntrospector(db),
    },
  });
}

describe('Order Schema & Multi-Tenant Migrations', () => {
  const migrationsDir = getDefaultMigrationsDir();

  it('discovers 0007_order_schema.sql in migrations directory with deterministic checksum', () => {
    const files = loadMigrationFiles(migrationsDir);
    const orderMigration = files.find((f) => f.version === '0007');

    assert.ok(orderMigration, '0007_order_schema.sql must be discovered');
    assert.equal(orderMigration.name, 'order_schema');
    assert.equal(orderMigration.isTransactional, true);

    const diskContent = fs.readFileSync(path.join(migrationsDir, '0007_order_schema.sql'), 'utf8');
    assert.equal(orderMigration.checksum, computeMigrationChecksum(diskContent));
  });

  it('enforces mandatory tenant boundaries with store_id foreign key references on all tables', () => {
    const diskContent = fs.readFileSync(path.join(migrationsDir, '0007_order_schema.sql'), 'utf8');

    // Schema existence
    assert.ok(diskContent.includes('CREATE SCHEMA IF NOT EXISTS "order";'));

    // order.orders tenant isolation
    assert.ok(
      diskContent.includes(
        'store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT',
      ),
      'tables must reference identity.stores with ON DELETE RESTRICT',
    );
    assert.ok(
      diskContent.includes(
        'CONSTRAINT orders_store_order_number_unique UNIQUE (store_id, order_number)',
      ),
      'order numbers must be uniquely scoped per store tenant',
    );
    assert.ok(
      diskContent.includes(
        'CREATE UNIQUE INDEX IF NOT EXISTS orders_store_idempotency_key_idx ON "order".orders (store_id, idempotency_key) WHERE idempotency_key IS NOT NULL;',
      ),
      'idempotency keys must be unique per store tenant',
    );

    // order.order_items
    assert.ok(
      diskContent.includes('CONSTRAINT order_items_quantity_positive CHECK (quantity > 0)'),
      'order item quantities must be positive',
    );
    assert.ok(
      diskContent.includes(
        'CONSTRAINT order_items_unit_price_nonnegative CHECK (unit_price_cents >= 0)',
      ),
      'unit price snapshots must be non-negative',
    );

    // Runtime least privilege DML role
    assert.ok(
      diskContent.includes(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "order" TO grocery_order_user;',
      ),
      'must grant DML privileges to grocery_order_user',
    );
  });

  it('compiles type-safe Kysely queries for order.orders and order_items with tenant joins', () => {
    const db = createMockKysely();

    const mockOrder: OrderRow = {
      id: '70000000-0000-4000-8000-000000000001',
      store_id: '20000000-0000-4000-8000-000000000001',
      customer_id: '10000000-0000-4000-8000-000000000001',
      order_number: 'ORD-20261025-0001',
      status: 'AWAITING_SHOPKEEPER_REVIEW',
      fulfillment_type: 'PICKUP',
      delivery_address: null,
      customer_phone: '+919876543210',
      customer_name: 'Priya Sharma',
      total_amount_cents: 12500n as unknown as number,
      currency: 'INR',
      notes: 'Pack green vegetables fresh',
      idempotency_key: 'idemp-12345',
      created_at: new Date(),
      updated_at: new Date(),
    };

    assert.equal(mockOrder.order_number, 'ORD-20261025-0001');

    // Test query compilation with order items join
    const query = db
      .selectFrom('order.orders')
      .innerJoin('order.order_items', 'order.order_items.order_id', 'order.orders.id')
      .selectAll('order.orders')
      .select([
        'order.order_items.product_name_snapshot',
        'order.order_items.quantity',
        'order.order_items.unit_price_cents',
        'order.order_items.total_price_cents',
      ])
      .where('order.orders.store_id', '=', '20000000-0000-4000-8000-000000000001')
      .where('order.orders.id', '=', '70000000-0000-4000-8000-000000000001')
      .compile();

    assert.ok(query.sql.includes('from "order"."orders"'));
    assert.ok(query.sql.includes('inner join "order"."order_items"'));
    assert.ok(query.sql.includes('"order"."orders"."store_id" = $1'));
    assert.equal(query.parameters[0], '20000000-0000-4000-8000-000000000001');
  });
});
