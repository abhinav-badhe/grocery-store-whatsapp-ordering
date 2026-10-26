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
import type { Database, StockBalanceRow, ProductRow } from '@grocery/database';
import { createInventoryReporter } from '../dist/index.js';

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_1 = 'prod-1111-1111';
const PRODUCT_2 = 'prod-2222-2222';
const PRODUCT_3 = 'prod-3333-3333';

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

describe('InventoryReporter - Low Stock & Health Reporting', () => {
  it('identifies low stock and out-of-stock items, computes shortfall, and enriches metadata', async () => {
    const executedQueries: CompiledQuery[] = [];

    const mockBalances: StockBalanceRow[] = [
      {
        id: 'bal-1',
        store_id: STORE_ID,
        product_id: PRODUCT_1,
        sku: 'SKU-APPLES-01',
        on_hand_quantity: '5.000',
        reserved_quantity: '2.000',
        available_quantity: '3.000', // <= reorder_point 10.000 -> shortfall 7
        reorder_point: '10.000',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: 'bal-2',
        store_id: STORE_ID,
        product_id: PRODUCT_2,
        sku: 'SKU-MILK-02',
        on_hand_quantity: '0.000',
        reserved_quantity: '0.000',
        available_quantity: '0.000', // out of stock and <= reorder_point 5.000
        reorder_point: '5.000',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: 'bal-3',
        store_id: STORE_ID,
        product_id: PRODUCT_3,
        sku: 'SKU-BREAD-03',
        on_hand_quantity: '50.000',
        reserved_quantity: '5.000',
        available_quantity: '45.000', // > reorder_point 20.000 -> healthy
        reorder_point: '20.000',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    const mockProducts: ProductRow[] = [
      {
        id: PRODUCT_1,
        store_id: STORE_ID,
        category_id: null,
        name: 'Fresh Red Apples',
        slug: 'fresh-red-apples',
        sku: 'SKU-APPLES-01',
        barcode: null,
        description: null,
        price_cents: 12000n,
        currency: 'INR',
        unit: 'KG',
        is_weight_based: true,
        status: 'ACTIVE',
        image_url: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: PRODUCT_2,
        store_id: STORE_ID,
        category_id: null,
        name: 'Whole Milk 1L',
        slug: 'whole-milk-1l',
        sku: 'SKU-MILK-02',
        barcode: null,
        description: null,
        price_cents: 6000n,
        currency: 'INR',
        unit: 'LITRE',
        is_weight_based: false,
        status: 'ACTIVE',
        image_url: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    const db = createMockKysely((query) => {
      executedQueries.push(query);
      if (query.sql.includes('stock_balances')) {
        return { rows: mockBalances };
      }
      if (query.sql.includes('products')) {
        return { rows: mockProducts };
      }
      return { rows: [] };
    });

    const reporter = createInventoryReporter(db);
    const report = await reporter.generateInventoryHealthReport(STORE_ID);

    assert.equal(report.storeId, STORE_ID);
    assert.equal(report.totalProductsMonitored, 3);
    assert.equal(report.lowStockCount, 2);
    assert.equal(report.outOfStockCount, 1);
    assert.equal(report.alerts.length, 2);

    const appleAlert = report.alerts.find((a) => a.productId === PRODUCT_1);
    assert.ok(appleAlert);
    assert.equal(appleAlert.productName, 'Fresh Red Apples');
    assert.equal(appleAlert.unit, 'KG');
    assert.equal(appleAlert.availableQuantity, 3);
    assert.equal(appleAlert.reorderPoint, 10);
    assert.equal(appleAlert.shortfall, 7);
    assert.equal(appleAlert.isOutOfStock, false);

    const milkAlert = report.alerts.find((a) => a.productId === PRODUCT_2);
    assert.ok(milkAlert);
    assert.equal(milkAlert.productName, 'Whole Milk 1L');
    assert.equal(milkAlert.unit, 'LITRE');
    assert.equal(milkAlert.availableQuantity, 0);
    assert.equal(milkAlert.reorderPoint, 5);
    assert.equal(milkAlert.shortfall, 5);
    assert.equal(milkAlert.isOutOfStock, true);
  });
});
