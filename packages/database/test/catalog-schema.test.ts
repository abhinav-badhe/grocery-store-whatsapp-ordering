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
import type { Database, CategoryRow, NewCategory, ProductRow, NewProduct } from '../dist/index.js';
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

describe('Catalog Schema & Multi-Tenant Migrations', () => {
  const migrationsDir = getDefaultMigrationsDir();

  it('discovers 0005_catalog_schema.sql in migrations directory with deterministic checksum', () => {
    const files = loadMigrationFiles(migrationsDir);
    const catalogMigration = files.find((f) => f.version === '0005');

    assert.ok(catalogMigration, '0005_catalog_schema.sql must be discovered');
    assert.equal(catalogMigration.name, 'catalog_schema');
    assert.equal(catalogMigration.isTransactional, true);

    const diskContent = fs.readFileSync(
      path.join(migrationsDir, '0005_catalog_schema.sql'),
      'utf8',
    );
    assert.equal(catalogMigration.checksum, computeMigrationChecksum(diskContent));
  });

  it('enforces mandatory tenant boundaries with store_id foreign key references', () => {
    const diskContent = fs.readFileSync(
      path.join(migrationsDir, '0005_catalog_schema.sql'),
      'utf8',
    );

    // Schema existence
    assert.ok(diskContent.includes('CREATE SCHEMA IF NOT EXISTS catalog;'));

    // catalog.categories tenant isolation
    assert.ok(
      diskContent.includes(
        'store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT',
      ),
      'categories must reference identity.stores with ON DELETE RESTRICT',
    );
    assert.ok(
      diskContent.includes('CONSTRAINT categories_store_slug_unique UNIQUE (store_id, slug)'),
      'category slugs must be unique per store tenant',
    );

    // catalog.products tenant isolation
    assert.ok(
      diskContent.includes('CONSTRAINT products_store_slug_unique UNIQUE (store_id, slug)'),
      'product slugs must be unique per store tenant',
    );
    assert.ok(
      diskContent.includes(
        'CREATE UNIQUE INDEX IF NOT EXISTS products_store_sku_unique_idx ON catalog.products (store_id, sku) WHERE sku IS NOT NULL;',
      ),
      'product SKUs must be unique per store tenant when present',
    );
  });

  it('compiles type-safe Kysely queries for catalog.categories', () => {
    const db = createMockKysely();

    const mockCategory: CategoryRow = {
      id: '30000000-0000-4000-8000-000000000001',
      store_id: '20000000-0000-4000-8000-000000000001',
      name: 'Dairy & Eggs',
      slug: 'dairy-eggs',
      description: 'Fresh milk, cheese, and farm eggs',
      parent_id: null,
      sort_order: 1,
      status: 'ACTIVE',
      created_at: new Date(),
      updated_at: new Date(),
    };

    assert.ok(mockCategory.name);

    // Test query compilation
    const query = db
      .selectFrom('catalog.categories')
      .selectAll()
      .where('store_id', '=', '20000000-0000-4000-8000-000000000001')
      .where('status', '=', 'ACTIVE')
      .orderBy('sort_order', 'asc')
      .compile();

    assert.ok(query.sql.includes('from "catalog"."categories"'));
    assert.ok(query.sql.includes('"store_id" = $1'));
    assert.equal(query.parameters[0], '20000000-0000-4000-8000-000000000001');
  });

  it('compiles type-safe Kysely queries for catalog.products with tenant and category joins', () => {
    const db = createMockKysely();

    const mockProduct: ProductRow = {
      id: '40000000-0000-4000-8000-000000000001',
      store_id: '20000000-0000-4000-8000-000000000001',
      category_id: '30000000-0000-4000-8000-000000000001',
      name: 'Whole Milk 1L',
      slug: 'whole-milk-1l',
      sku: 'MILK-001',
      barcode: '8901234567890',
      description: 'Pasteurized whole cow milk',
      price_cents: 6500, // 65.00 INR
      currency: 'INR',
      unit: 'LITRE',
      is_weight_based: false,
      status: 'ACTIVE',
      image_url: 'https://cdn.grocerystore.local/products/milk.jpg',
      created_at: new Date(),
      updated_at: new Date(),
    };

    assert.equal(mockProduct.price_cents, 6500);

    // Test query compilation with tenant scoping
    const query = db
      .selectFrom('catalog.products')
      .innerJoin('identity.stores', 'identity.stores.id', 'catalog.products.store_id')
      .leftJoin('catalog.categories', 'catalog.categories.id', 'catalog.products.category_id')
      .select([
        'catalog.products.id',
        'catalog.products.name as productName',
        'catalog.products.price_cents',
        'catalog.categories.name as categoryName',
        'identity.stores.name as storeName',
      ])
      .where('catalog.products.store_id', '=', '20000000-0000-4000-8000-000000000001')
      .where('catalog.products.status', '=', 'ACTIVE')
      .compile();

    assert.ok(query.sql.includes('from "catalog"."products"'));
    assert.ok(query.sql.includes('inner join "identity"."stores"'));
    assert.ok(query.sql.includes('left join "catalog"."categories"'));
    assert.ok(query.sql.includes('"catalog"."products"."store_id" = $1'));
  });
});
