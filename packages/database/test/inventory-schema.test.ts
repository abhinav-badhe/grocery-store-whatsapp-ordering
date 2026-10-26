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
import type {
  Database,
  StockBalanceRow,
  StockReservationRow,
  StockReservationItemRow,
  StockMovementRow,
} from '../dist/index.js';
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

describe('Inventory Schema & Multi-Tenant Migrations', () => {
  const migrationsDir = getDefaultMigrationsDir();

  it('discovers 0006_inventory_schema.sql in migrations directory with deterministic checksum', () => {
    const files = loadMigrationFiles(migrationsDir);
    const inventoryMigration = files.find((f) => f.version === '0006');

    assert.ok(inventoryMigration, '0006_inventory_schema.sql must be discovered');
    assert.equal(inventoryMigration.name, 'inventory_schema');
    assert.equal(inventoryMigration.isTransactional, true);

    const diskContent = fs.readFileSync(
      path.join(migrationsDir, '0006_inventory_schema.sql'),
      'utf8',
    );
    assert.equal(inventoryMigration.checksum, computeMigrationChecksum(diskContent));
  });

  it('enforces mandatory tenant boundaries with store_id foreign key references on all tables', () => {
    const diskContent = fs.readFileSync(
      path.join(migrationsDir, '0006_inventory_schema.sql'),
      'utf8',
    );

    // Schema existence
    assert.ok(diskContent.includes('CREATE SCHEMA IF NOT EXISTS inventory;'));

    // inventory.stock_balances tenant isolation
    assert.ok(
      diskContent.includes(
        'store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT',
      ),
      'tables must reference identity.stores with ON DELETE RESTRICT',
    );
    assert.ok(
      diskContent.includes(
        'product_id UUID NOT NULL REFERENCES catalog.products(id) ON DELETE RESTRICT',
      ),
      'balances must reference catalog.products with ON DELETE RESTRICT',
    );
    assert.ok(
      diskContent.includes(
        'CONSTRAINT stock_balances_zero_oversell_check CHECK (on_hand_quantity >= reserved_quantity)',
      ),
      'must enforce zero overselling invariant',
    );
    assert.ok(
      diskContent.includes(
        'CONSTRAINT stock_balances_store_product_unique UNIQUE (store_id, product_id)',
      ),
      'balances must be uniquely scoped per store and product',
    );

    // inventory.stock_reservations
    assert.ok(
      diskContent.includes(
        'CONSTRAINT stock_reservations_store_order_unique UNIQUE (store_id, order_id)',
      ),
      'reservations must be uniquely scoped per store and order',
    );
    assert.ok(
      diskContent.includes(
        "CONSTRAINT stock_reservations_status_check CHECK (status IN ('ACTIVE', 'FULFILLED', 'RELEASED', 'EXPIRED'))",
      ),
      'reservations must follow explicit status lifecycle',
    );

    // inventory.stock_reservation_items
    assert.ok(
      diskContent.includes(
        'CONSTRAINT stock_reservation_items_unique_item UNIQUE (reservation_id, product_id)',
      ),
      'reservation items must be uniquely scoped per reservation and product',
    );
    assert.ok(
      diskContent.includes(
        'CONSTRAINT stock_reservation_items_quantity_positive CHECK (quantity > 0)',
      ),
      'reservation item quantities must be strictly positive',
    );

    // inventory.stock_movements append-only ledger
    assert.ok(
      diskContent.includes('CREATE TABLE IF NOT EXISTS inventory.stock_movements'),
      'stock_movements table must exist',
    );
    assert.ok(
      diskContent.includes(
        'reason IN (\n' +
          "      'INFLOW_PURCHASE',\n" +
          "      'RESERVATION_HOLD',\n" +
          "      'RESERVATION_RELEASE',\n" +
          "      'FULFILLMENT_OUTFLOW',\n" +
          "      'MANUAL_CORRECTION',\n" +
          "      'SHRINKAGE_DAMAGE'\n" +
          '    )',
      ),
      'movements must follow strict audit reasons',
    );

    // Runtime least privilege DML role
    assert.ok(
      diskContent.includes(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA inventory TO grocery_inventory_user;',
      ),
      'must grant DML privileges to grocery_inventory_user',
    );
  });

  it('compiles type-safe Kysely queries for inventory.stock_balances with sorted row lock', () => {
    const db = createMockKysely();

    const mockBalance: StockBalanceRow = {
      id: '50000000-0000-4000-8000-000000000001',
      store_id: '20000000-0000-4000-8000-000000000001',
      product_id: '40000000-0000-4000-8000-000000000001',
      sku: 'MILK-001',
      on_hand_quantity: '100.000',
      reserved_quantity: '10.000',
      available_quantity: '90.000',
      reorder_point: '20.000',
      created_at: new Date(),
      updated_at: new Date(),
    };

    assert.equal(mockBalance.sku, 'MILK-001');

    // Test query compilation per ADR-007 deterministic SKU lock:
    // SELECT ... FROM stock_balances WHERE store_id = $1 AND product_id = ANY($2) ORDER BY product_id ASC FOR UPDATE
    const query = db
      .selectFrom('inventory.stock_balances')
      .selectAll()
      .where('store_id', '=', '20000000-0000-4000-8000-000000000001')
      .where('product_id', 'in', [
        '40000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000002',
      ])
      .orderBy('product_id', 'asc')
      .forUpdate()
      .compile();

    assert.ok(query.sql.includes('from "inventory"."stock_balances"'));
    assert.ok(query.sql.includes('"store_id" = $1'));
    assert.ok(query.sql.includes('order by "product_id" asc'));
    assert.ok(query.sql.includes('for update'));
    assert.equal(query.parameters[0], '20000000-0000-4000-8000-000000000001');
  });

  it('compiles type-safe Kysely queries for inventory reservations and append-only ledger', () => {
    const db = createMockKysely();

    const mockReservation: StockReservationRow = {
      id: '60000000-0000-4000-8000-000000000001',
      store_id: '20000000-0000-4000-8000-000000000001',
      order_id: '70000000-0000-4000-8000-000000000001',
      status: 'ACTIVE',
      expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000),
      created_at: new Date(),
      updated_at: new Date(),
    };

    assert.equal(mockReservation.status, 'ACTIVE');

    // Test query compilation for reservation lookup
    const reservationQuery = db
      .selectFrom('inventory.stock_reservations')
      .innerJoin(
        'inventory.stock_reservation_items',
        'inventory.stock_reservation_items.reservation_id',
        'inventory.stock_reservations.id',
      )
      .selectAll('inventory.stock_reservations')
      .select([
        'inventory.stock_reservation_items.product_id',
        'inventory.stock_reservation_items.quantity',
      ])
      .where('inventory.stock_reservations.store_id', '=', '20000000-0000-4000-8000-000000000001')
      .where('inventory.stock_reservations.order_id', '=', '70000000-0000-4000-8000-000000000001')
      .compile();

    assert.ok(reservationQuery.sql.includes('from "inventory"."stock_reservations"'));
    assert.ok(reservationQuery.sql.includes('inner join "inventory"."stock_reservation_items"'));

    // Test append-only ledger insert
    const ledgerQuery = db
      .insertInto('inventory.stock_movements')
      .values({
        store_id: '20000000-0000-4000-8000-000000000001',
        product_id: '40000000-0000-4000-8000-000000000001',
        delta_quantity: '-5.000',
        reason: 'RESERVATION_HOLD',
        reference_id: '70000000-0000-4000-8000-000000000001',
      })
      .returningAll()
      .compile();

    assert.ok(ledgerQuery.sql.includes('insert into "inventory"."stock_movements"'));
    assert.ok(ledgerQuery.sql.includes('returning *'));
  });
});
