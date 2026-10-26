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
import type { Database, CategoryRow, ProductRow } from '@grocery/database';
import {
  createCategoryRepository,
  createProductRepository,
  DuplicateSlugError,
  DuplicateSkuError,
  CatalogPersistenceError,
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
const CATEGORY_ID_1 = '33333333-3333-4333-8333-333333333333';
const PRODUCT_ID_1 = '44444444-4444-4444-8444-444444444444';

describe('Catalog Persistence Repositories & Tenant Scoping', () => {
  describe('CategoryRepository', () => {
    it('creates a category with normalized lowercase slug and returns the created row', async () => {
      const mockCategory: CategoryRow = {
        id: CATEGORY_ID_1,
        store_id: STORE_ID_A,
        name: 'Fresh Dairy',
        slug: 'fresh-dairy',
        description: 'Milk, butter, and yogurt',
        parent_id: null,
        sort_order: 1,
        status: 'ACTIVE',
        created_at: new Date('2026-10-25T12:00:00Z'),
        updated_at: new Date('2026-10-25T12:00:00Z'),
      };

      const { db, queries } = createMockKysely({
        onExecuteQuery: async () => ({
          rows: [mockCategory],
        }),
      });

      const repo = createCategoryRepository(db);
      const result = await repo.create({
        store_id: STORE_ID_A,
        name: 'Fresh Dairy',
        slug: 'FRESH-DAIRY',
        description: 'Milk, butter, and yogurt',
        parent_id: null,
        sort_order: 1,
        status: 'ACTIVE',
      });

      assert.deepEqual(result, mockCategory);
      assert.equal(queries.length, 1);
      assert.match(queries[0].sql, /insert into "catalog"\."categories"/i);
      // Slug parameter must be trimmed and lowercased
      assert.ok(queries[0].parameters.includes('fresh-dairy'));
      assert.ok(!queries[0].parameters.includes('FRESH-DAIRY'));
    });

    it('enforces storeId scoping on findById and returns null if not found', async () => {
      const { db, queries } = createMockKysely({
        onExecuteQuery: async () => ({ rows: [] }),
      });

      const repo = createCategoryRepository(db);
      const result = await repo.findById(STORE_ID_A, CATEGORY_ID_1);

      assert.equal(result, null);
      assert.equal(queries.length, 1);
      assert.match(queries[0].sql, /where "store_id" = \$1 and "id" = \$2/i);
      assert.equal(queries[0].parameters[0], STORE_ID_A);
      assert.equal(queries[0].parameters[1], CATEGORY_ID_1);
    });

    it('enforces storeId scoping and slug normalization on findBySlug', async () => {
      const mockCategory: CategoryRow = {
        id: CATEGORY_ID_1,
        store_id: STORE_ID_A,
        name: 'Beverages',
        slug: 'beverages',
        description: null,
        parent_id: null,
        sort_order: 0,
        status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const { db, queries } = createMockKysely({
        onExecuteQuery: async () => ({ rows: [mockCategory] }),
      });

      const repo = createCategoryRepository(db);
      const result = await repo.findBySlug(STORE_ID_A, '  BEVERAGES  ');

      assert.deepEqual(result, mockCategory);
      assert.equal(queries[0].parameters[0], STORE_ID_A);
      assert.equal(queries[0].parameters[1], 'beverages');
    });

    it('filters categories by storeId, parentId (root vs child), and status', async () => {
      const { db, queries } = createMockKysely({
        onExecuteQuery: async () => ({ rows: [] }),
      });

      const repo = createCategoryRepository(db);

      // 1. List root categories
      await repo.listByStore(STORE_ID_A, { parentId: null, status: 'ACTIVE' });
      assert.match(queries[0].sql, /"store_id" = \$1/i);
      assert.match(queries[0].sql, /"parent_id" is null/i);
      assert.match(queries[0].sql, /"status" = \$2/i);
      assert.match(queries[0].sql, /order by "sort_order" asc, "name" asc/i);
      assert.equal(queries[0].parameters[0], STORE_ID_A);
      assert.equal(queries[0].parameters[1], 'ACTIVE');

      // 2. List child categories for specific parent
      await repo.listByStore(STORE_ID_A, { parentId: CATEGORY_ID_1 });
      assert.match(queries[1].sql, /"parent_id" = \$2/i);
      assert.equal(queries[1].parameters[1], CATEGORY_ID_1);
    });

    it('updates category and returns null if not found in given store', async () => {
      const { db, queries } = createMockKysely({
        onExecuteQuery: async () => ({ rows: [] }),
      });

      const repo = createCategoryRepository(db);
      const updated = await repo.update(STORE_ID_A, CATEGORY_ID_1, {
        name: 'Updated Name',
        slug: 'NEW-SLUG',
      });

      assert.equal(updated, null);
      assert.match(queries[0].sql, /update "catalog"\."categories"/i);
      assert.match(queries[0].sql, /where "store_id" = \$\d+ and "id" = \$\d+/i);
      assert.ok(queries[0].parameters.includes('new-slug'));
    });

    it('deletes category scoped strictly to store_id', async () => {
      const { db, queries } = createMockKysely({
        onExecuteQuery: async () => ({ rows: [], numAffectedRows: 1n }),
      });

      const repo = createCategoryRepository(db);
      const deleted = await repo.delete(STORE_ID_A, CATEGORY_ID_1);

      assert.equal(deleted, true);
      assert.match(queries[0].sql, /delete from "catalog"\."categories"/i);
      assert.match(queries[0].sql, /where "store_id" = \$1 and "id" = \$2/i);
      assert.equal(queries[0].parameters[0], STORE_ID_A);
      assert.equal(queries[0].parameters[1], CATEGORY_ID_1);
    });

    it('maps unique constraint violations on slug to DuplicateSlugError', async () => {
      const { db } = createMockKysely({
        onExecuteQuery: async () => {
          const pgError = new Error('duplicate key value violates unique constraint') as Error & {
            code?: string;
            constraint?: string;
          };
          pgError.code = '23505';
          pgError.constraint = 'categories_store_slug_unique';
          throw pgError;
        },
      });

      const repo = createCategoryRepository(db);
      await assert.rejects(
        () =>
          repo.create({
            store_id: STORE_ID_A,
            name: 'Produce',
            slug: 'produce',
            parent_id: null,
            status: 'ACTIVE',
          }),
        (err: unknown) => {
          assert.ok(err instanceof DuplicateSlugError);
          assert.equal(err.code, 'DUPLICATE_SLUG');
          return true;
        },
      );
    });
  });

  describe('ProductRepository', () => {
    it('creates a product with normalized slug, trimmed sku, and returns created row', async () => {
      const mockProduct: ProductRow = {
        id: PRODUCT_ID_1,
        store_id: STORE_ID_A,
        category_id: CATEGORY_ID_1,
        name: 'Organic Whole Milk 1L',
        slug: 'organic-whole-milk-1l',
        sku: 'MILK-ORG-1L',
        barcode: '8901234567890',
        description: 'Fresh organic pasture-raised whole milk',
        price_cents: 6500n as unknown as number,
        currency: 'INR',
        unit: 'LITRE',
        is_weight_based: false,
        status: 'ACTIVE',
        image_url: 'https://cdn.example.com/milk.jpg',
        created_at: new Date('2026-10-25T12:00:00Z'),
        updated_at: new Date('2026-10-25T12:00:00Z'),
      };

      const { db, queries } = createMockKysely({
        onExecuteQuery: async () => ({ rows: [mockProduct] }),
      });

      const repo = createProductRepository(db);
      const created = await repo.create({
        store_id: STORE_ID_A,
        category_id: CATEGORY_ID_1,
        name: 'Organic Whole Milk 1L',
        slug: 'ORGANIC-WHOLE-MILK-1L',
        sku: '  MILK-ORG-1L  ',
        barcode: '8901234567890',
        description: 'Fresh organic pasture-raised whole milk',
        price_cents: 6500n as unknown as number,
        currency: 'INR',
        unit: 'LITRE',
        is_weight_based: false,
        status: 'ACTIVE',
        image_url: 'https://cdn.example.com/milk.jpg',
      });

      assert.deepEqual(created, mockProduct);
      assert.equal(queries.length, 1);
      assert.match(queries[0].sql, /insert into "catalog"\."products"/i);
      assert.ok(queries[0].parameters.includes('organic-whole-milk-1l'));
      assert.ok(queries[0].parameters.includes('MILK-ORG-1L'));
    });

    it('enforces storeId scoping on findById, findBySlug, and findBySku', async () => {
      const { db, queries } = createMockKysely({
        onExecuteQuery: async () => ({ rows: [] }),
      });

      const repo = createProductRepository(db);

      await repo.findById(STORE_ID_A, PRODUCT_ID_1);
      assert.match(queries[0].sql, /where "store_id" = \$1 and "id" = \$2/i);
      assert.equal(queries[0].parameters[0], STORE_ID_A);
      assert.equal(queries[0].parameters[1], PRODUCT_ID_1);

      await repo.findBySlug(STORE_ID_A, 'ORGANIC-MILK');
      assert.match(queries[1].sql, /where "store_id" = \$1 and "slug" = \$2/i);
      assert.equal(queries[1].parameters[0], STORE_ID_A);
      assert.equal(queries[1].parameters[1], 'organic-milk');

      await repo.findBySku(STORE_ID_A, 'SKU-100');
      assert.match(queries[2].sql, /where "store_id" = \$1 and "sku" = \$2/i);
      assert.equal(queries[2].parameters[0], STORE_ID_A);
      assert.equal(queries[2].parameters[1], 'SKU-100');
    });

    it('paginates, filters by category/status/search, and returns { products, total }', async () => {
      const mockProduct: ProductRow = {
        id: PRODUCT_ID_1,
        store_id: STORE_ID_A,
        category_id: CATEGORY_ID_1,
        name: 'Brown Eggs 12pk',
        slug: 'brown-eggs-12pk',
        sku: 'EGGS-12',
        barcode: null,
        description: null,
        price_cents: 9500n as unknown as number,
        currency: 'INR',
        unit: 'DOZEN',
        is_weight_based: false,
        status: 'ACTIVE',
        image_url: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const { db, queries } = createMockKysely({
        onExecuteQuery: async (sql) => {
          if (sql.includes('count(')) {
            return { rows: [{ count: '42' }] };
          }
          return { rows: [mockProduct] };
        },
      });

      const repo = createProductRepository(db);
      const result = await repo.listByStore(STORE_ID_A, {
        categoryId: CATEGORY_ID_1,
        status: 'ACTIVE',
        search: 'egg',
        page: 2,
        limit: 10,
      });

      assert.equal(result.total, 42);
      assert.equal(result.products.length, 1);
      assert.deepEqual(result.products[0], mockProduct);

      assert.equal(queries.length, 2);
      // Count query
      assert.match(queries[0].sql, /count\(\*\)/i);
      assert.match(queries[0].sql, /"store_id" = \$1/i);
      assert.match(queries[0].sql, /"category_id" = \$2/i);
      assert.match(queries[0].sql, /"status" = \$3/i);
      assert.match(queries[0].sql, /"name" ilike \$4/i);
      assert.equal(queries[0].parameters[0], STORE_ID_A);
      assert.equal(queries[0].parameters[1], CATEGORY_ID_1);
      assert.equal(queries[0].parameters[2], 'ACTIVE');
      assert.equal(queries[0].parameters[3], '%egg%');

      // Paginated list query
      assert.match(queries[1].sql, /limit \$5 offset \$6/i);
      assert.equal(queries[1].parameters[4], 10);
      assert.equal(queries[1].parameters[5], 10); // offset = (page 2 - 1) * 10 = 10
    });

    it('maps duplicate slug violations to DuplicateSlugError', async () => {
      const { db } = createMockKysely({
        onExecuteQuery: async () => {
          const pgError = new Error('duplicate key') as Error & {
            code?: string;
            constraint?: string;
          };
          pgError.code = '23505';
          pgError.constraint = 'products_store_slug_unique';
          throw pgError;
        },
      });

      const repo = createProductRepository(db);
      await assert.rejects(
        () =>
          repo.create({
            store_id: STORE_ID_A,
            name: 'Apple',
            slug: 'apple',
            price_cents: 1000n as unknown as number,
            currency: 'INR',
            unit: 'KG',
            is_weight_based: true,
            status: 'ACTIVE',
          }),
        (err: unknown) => {
          assert.ok(err instanceof DuplicateSlugError);
          assert.equal(err.code, 'DUPLICATE_SLUG');
          return true;
        },
      );
    });

    it('maps duplicate SKU violations to DuplicateSkuError', async () => {
      const { db } = createMockKysely({
        onExecuteQuery: async () => {
          const pgError = new Error('duplicate key') as Error & {
            code?: string;
            constraint?: string;
          };
          pgError.code = '23505';
          pgError.constraint = 'products_store_sku_unique_idx';
          throw pgError;
        },
      });

      const repo = createProductRepository(db);
      await assert.rejects(
        () =>
          repo.create({
            store_id: STORE_ID_A,
            name: 'Apple',
            slug: 'apple-green',
            sku: 'APPLE-001',
            price_cents: 1000n as unknown as number,
            currency: 'INR',
            unit: 'KG',
            is_weight_based: true,
            status: 'ACTIVE',
          }),
        (err: unknown) => {
          assert.ok(err instanceof DuplicateSkuError);
          assert.equal(err.code, 'DUPLICATE_SKU');
          return true;
        },
      );
    });

    it('enforces multi-tenant query isolation between Store A and Store B', async () => {
      const { db, queries } = createMockKysely({
        onExecuteQuery: async () => ({ rows: [] }),
      });

      const repo = createProductRepository(db);

      await repo.findById(STORE_ID_A, PRODUCT_ID_1);
      await repo.findById(STORE_ID_B, PRODUCT_ID_1);

      assert.equal(queries[0].parameters[0], STORE_ID_A);
      assert.equal(queries[1].parameters[0], STORE_ID_B);
      assert.notEqual(queries[0].parameters[0], queries[1].parameters[0]);
    });
  });
});
