import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CategoryRow, ProductRow } from '@grocery/database';
import type {
  CategoryRepository,
  ProductRepository,
  ListCategoriesOptions,
  ListProductsOptions,
  ListProductsResult,
} from '../dist/index.js';
import {
  createCatalogServiceInstance,
  CategoryNotFoundError,
  ProductNotFoundError,
  ParentCategoryNotFoundError,
  InvalidProductCategoryError,
  DuplicateSlugConflictError,
  DuplicateSkuConflictError,
  CatalogDomainError,
} from '../dist/index.js';

const STORE_ID_A = '11111111-1111-4111-8111-111111111111';
const STORE_ID_B = '22222222-2222-4222-8222-222222222222';
const CATEGORY_ID_1 = '33333333-3333-4333-8333-333333333333';
const CATEGORY_ID_PARENT = '33333333-3333-4333-8333-999999999999';
const PRODUCT_ID_1 = '44444444-4444-4444-8444-444444444444';

function createMockCategoryRepo(initial: CategoryRow[] = []): CategoryRepository {
  const store = new Map<string, CategoryRow>(initial.map((c) => [`${c.store_id}:${c.id}`, c]));

  return {
    async findById(storeId: string, id: string): Promise<CategoryRow | null> {
      return store.get(`${storeId}:${id}`) ?? null;
    },
    async findBySlug(storeId: string, slug: string): Promise<CategoryRow | null> {
      const normalized = slug.trim().toLowerCase();
      for (const cat of store.values()) {
        if (cat.store_id === storeId && cat.slug === normalized) {
          return cat;
        }
      }
      return null;
    },
    async listByStore(storeId: string, options?: ListCategoriesOptions): Promise<CategoryRow[]> {
      const results: CategoryRow[] = [];
      for (const cat of store.values()) {
        if (cat.store_id !== storeId) continue;
        if (options?.parentId !== undefined) {
          if (cat.parent_id !== options.parentId) continue;
        }
        if (options?.status && cat.status !== options.status) continue;
        results.push(cat);
      }
      return results;
    },
    async create(category): Promise<CategoryRow> {
      const record: CategoryRow = {
        id: CATEGORY_ID_1,
        store_id: category.store_id,
        name: category.name,
        slug: category.slug,
        description: category.description ?? null,
        parent_id: category.parent_id ?? null,
        sort_order: category.sort_order ?? 0,
        status: category.status ?? 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      };
      store.set(`${record.store_id}:${record.id}`, record);
      return record;
    },
    async update(storeId: string, id: string, update): Promise<CategoryRow | null> {
      const existing = store.get(`${storeId}:${id}`);
      if (!existing) return null;
      const updated: CategoryRow = {
        ...existing,
        ...update,
        updated_at: new Date(),
      };
      store.set(`${storeId}:${id}`, updated);
      return updated;
    },
    async delete(storeId: string, id: string): Promise<boolean> {
      return store.delete(`${storeId}:${id}`);
    },
  };
}

function createMockProductRepo(initial: ProductRow[] = []): ProductRepository {
  const store = new Map<string, ProductRow>(initial.map((p) => [`${p.store_id}:${p.id}`, p]));

  return {
    async findById(storeId: string, id: string): Promise<ProductRow | null> {
      return store.get(`${storeId}:${id}`) ?? null;
    },
    async findBySlug(storeId: string, slug: string): Promise<ProductRow | null> {
      const normalized = slug.trim().toLowerCase();
      for (const prod of store.values()) {
        if (prod.store_id === storeId && prod.slug === normalized) {
          return prod;
        }
      }
      return null;
    },
    async findBySku(storeId: string, sku: string): Promise<ProductRow | null> {
      const normalized = sku.trim();
      for (const prod of store.values()) {
        if (prod.store_id === storeId && prod.sku === normalized) {
          return prod;
        }
      }
      return null;
    },
    async listByStore(storeId: string, options?: ListProductsOptions): Promise<ListProductsResult> {
      const results: ProductRow[] = [];
      for (const prod of store.values()) {
        if (prod.store_id !== storeId) continue;
        if (options?.categoryId && prod.category_id !== options.categoryId) continue;
        if (options?.status && prod.status !== options.status) continue;
        if (options?.search && !prod.name.toLowerCase().includes(options.search.toLowerCase())) {
          continue;
        }
        results.push(prod);
      }
      return { products: results, total: results.length };
    },
    async create(product): Promise<ProductRow> {
      const record: ProductRow = {
        id: PRODUCT_ID_1,
        store_id: product.store_id,
        category_id: product.category_id ?? null,
        name: product.name,
        slug: product.slug,
        sku: product.sku ?? null,
        barcode: product.barcode ?? null,
        description: product.description ?? null,
        price_cents: product.price_cents,
        currency: product.currency ?? 'INR',
        unit: product.unit ?? 'PIECE',
        is_weight_based: product.is_weight_based ?? false,
        status: product.status ?? 'ACTIVE',
        image_url: product.image_url ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      store.set(`${record.store_id}:${record.id}`, record);
      return record;
    },
    async update(storeId: string, id: string, update): Promise<ProductRow | null> {
      const existing = store.get(`${storeId}:${id}`);
      if (!existing) return null;
      const updated: ProductRow = {
        ...existing,
        ...update,
        updated_at: new Date(),
      };
      store.set(`${storeId}:${id}`, updated);
      return updated;
    },
    async delete(storeId: string, id: string): Promise<boolean> {
      return store.delete(`${storeId}:${id}`);
    },
  };
}

describe('Catalog Domain Service Invariants & Business Logic', () => {
  describe('Category Invariants', () => {
    it('creates category with valid parent in same store', async () => {
      const parent: CategoryRow = {
        id: CATEGORY_ID_PARENT,
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

      const categoryRepo = createMockCategoryRepo([parent]);
      const productRepo = createMockProductRepo();
      const service = createCatalogServiceInstance(categoryRepo, productRepo);

      const created = await service.createCategory(STORE_ID_A, {
        name: 'Fruit Juices',
        slug: 'fruit-juices',
        parentId: CATEGORY_ID_PARENT,
      });

      assert.equal(created.name, 'Fruit Juices');
      assert.equal(created.parent_id, CATEGORY_ID_PARENT);
    });

    it('rejects category creation when parentId does not exist in same store (cross-tenant isolation)', async () => {
      // Parent exists only in STORE_ID_B
      const parentInStoreB: CategoryRow = {
        id: CATEGORY_ID_PARENT,
        store_id: STORE_ID_B,
        name: 'Other Store Category',
        slug: 'other-cat',
        description: null,
        parent_id: null,
        sort_order: 0,
        status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const categoryRepo = createMockCategoryRepo([parentInStoreB]);
      const productRepo = createMockProductRepo();
      const service = createCatalogServiceInstance(categoryRepo, productRepo);

      await assert.rejects(
        () =>
          service.createCategory(STORE_ID_A, {
            name: 'Fruit Juices',
            slug: 'fruit-juices',
            parentId: CATEGORY_ID_PARENT,
          }),
        (err: unknown) => {
          assert.ok(err instanceof ParentCategoryNotFoundError);
          assert.equal(err.statusCode, 400);
          return true;
        },
      );
    });

    it('rejects duplicate category slug within the same store with 409 conflict', async () => {
      const existing: CategoryRow = {
        id: CATEGORY_ID_1,
        store_id: STORE_ID_A,
        name: 'Dairy',
        slug: 'dairy',
        description: null,
        parent_id: null,
        sort_order: 0,
        status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const categoryRepo = createMockCategoryRepo([existing]);
      const productRepo = createMockProductRepo();
      const service = createCatalogServiceInstance(categoryRepo, productRepo);

      await assert.rejects(
        () =>
          service.createCategory(STORE_ID_A, {
            name: 'Dairy Products',
            slug: 'dairy',
          }),
        (err: unknown) => {
          assert.ok(err instanceof DuplicateSlugConflictError);
          assert.equal(err.statusCode, 409);
          return true;
        },
      );
    });

    it('rejects circular category dependency (category cannot be its own parent)', async () => {
      const category: CategoryRow = {
        id: CATEGORY_ID_1,
        store_id: STORE_ID_A,
        name: 'Snacks',
        slug: 'snacks',
        description: null,
        parent_id: null,
        sort_order: 0,
        status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const categoryRepo = createMockCategoryRepo([category]);
      const productRepo = createMockProductRepo();
      const service = createCatalogServiceInstance(categoryRepo, productRepo);

      await assert.rejects(
        () =>
          service.updateCategory(STORE_ID_A, CATEGORY_ID_1, {
            parentId: CATEGORY_ID_1,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CatalogDomainError);
          assert.equal(err.code, 'CIRCULAR_CATEGORY_DEPENDENCY');
          assert.equal(err.statusCode, 400);
          return true;
        },
      );
    });
  });

  describe('Product Invariants', () => {
    it('creates product with valid category in same store', async () => {
      const category: CategoryRow = {
        id: CATEGORY_ID_1,
        store_id: STORE_ID_A,
        name: 'Dairy',
        slug: 'dairy',
        description: null,
        parent_id: null,
        sort_order: 0,
        status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const categoryRepo = createMockCategoryRepo([category]);
      const productRepo = createMockProductRepo();
      const service = createCatalogServiceInstance(categoryRepo, productRepo);

      const product = await service.createProduct(STORE_ID_A, {
        name: 'Pasteurized Milk 500ml',
        slug: 'pasteurized-milk-500ml',
        categoryId: CATEGORY_ID_1,
        priceCents: 3200,
        currency: 'INR',
        unit: 'MILLILITRE',
      });

      assert.equal(product.name, 'Pasteurized Milk 500ml');
      assert.equal(product.category_id, CATEGORY_ID_1);
      assert.equal(product.price_cents, 3200n);
    });

    it('rejects product creation when categoryId belongs to a different store (cross-tenant categorization)', async () => {
      const categoryInStoreB: CategoryRow = {
        id: CATEGORY_ID_1,
        store_id: STORE_ID_B,
        name: 'Store B Dairy',
        slug: 'store-b-dairy',
        description: null,
        parent_id: null,
        sort_order: 0,
        status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const categoryRepo = createMockCategoryRepo([categoryInStoreB]);
      const productRepo = createMockProductRepo();
      const service = createCatalogServiceInstance(categoryRepo, productRepo);

      await assert.rejects(
        () =>
          service.createProduct(STORE_ID_A, {
            name: 'Milk 500ml',
            slug: 'milk-500ml',
            categoryId: CATEGORY_ID_1,
            priceCents: 3200,
          }),
        (err: unknown) => {
          assert.ok(err instanceof InvalidProductCategoryError);
          assert.equal(err.statusCode, 400);
          return true;
        },
      );
    });

    it('rejects duplicate product slug within the same store with 409 conflict', async () => {
      const existingProduct: ProductRow = {
        id: PRODUCT_ID_1,
        store_id: STORE_ID_A,
        category_id: null,
        name: 'Almonds 500g',
        slug: 'almonds-500g',
        sku: 'ALM-500',
        barcode: null,
        description: null,
        price_cents: 45000n as unknown as number,
        currency: 'INR',
        unit: 'GRAM',
        is_weight_based: true,
        status: 'ACTIVE',
        image_url: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const categoryRepo = createMockCategoryRepo();
      const productRepo = createMockProductRepo([existingProduct]);
      const service = createCatalogServiceInstance(categoryRepo, productRepo);

      await assert.rejects(
        () =>
          service.createProduct(STORE_ID_A, {
            name: 'Raw Almonds 500g',
            slug: 'almonds-500g',
            priceCents: 45000,
          }),
        (err: unknown) => {
          assert.ok(err instanceof DuplicateSlugConflictError);
          assert.equal(err.statusCode, 409);
          return true;
        },
      );
    });

    it('rejects duplicate product SKU within the same store with 409 conflict', async () => {
      const existingProduct: ProductRow = {
        id: PRODUCT_ID_1,
        store_id: STORE_ID_A,
        category_id: null,
        name: 'Cashews 500g',
        slug: 'cashews-500g',
        sku: 'CASHEW-500',
        barcode: null,
        description: null,
        price_cents: 50000n as unknown as number,
        currency: 'INR',
        unit: 'GRAM',
        is_weight_based: true,
        status: 'ACTIVE',
        image_url: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const categoryRepo = createMockCategoryRepo();
      const productRepo = createMockProductRepo([existingProduct]);
      const service = createCatalogServiceInstance(categoryRepo, productRepo);

      await assert.rejects(
        () =>
          service.createProduct(STORE_ID_A, {
            name: 'Salted Cashews 500g',
            slug: 'salted-cashews-500g',
            sku: 'CASHEW-500',
            priceCents: 52000,
          }),
        (err: unknown) => {
          assert.ok(err instanceof DuplicateSkuConflictError);
          assert.equal(err.statusCode, 409);
          return true;
        },
      );
    });

    it('throws ProductNotFoundError on get, update, or delete when product does not exist in store', async () => {
      const categoryRepo = createMockCategoryRepo();
      const productRepo = createMockProductRepo();
      const service = createCatalogServiceInstance(categoryRepo, productRepo);

      const notFound = await service.getProductById(STORE_ID_A, PRODUCT_ID_1);
      assert.equal(notFound, null);

      await assert.rejects(
        () => service.updateProduct(STORE_ID_A, PRODUCT_ID_1, { name: 'New Name' }),
        (err: unknown) => {
          assert.ok(err instanceof ProductNotFoundError);
          assert.equal(err.statusCode, 404);
          return true;
        },
      );

      await assert.rejects(
        () => service.deleteProduct(STORE_ID_A, PRODUCT_ID_1),
        (err: unknown) => {
          assert.ok(err instanceof ProductNotFoundError);
          assert.equal(err.statusCode, 404);
          return true;
        },
      );
    });
  });
});
