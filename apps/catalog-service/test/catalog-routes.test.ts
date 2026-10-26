import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CategoryRow, ProductRow } from '@grocery/database';
import { mintInternalToken } from '@grocery/service-runtime';
import {
  createCatalogService,
  createCatalogServiceInstance,
  type CategoryRepository,
  type ProductRepository,
  type ListCategoriesOptions,
  type ListProductsOptions,
  type ListProductsResult,
} from '../dist/index.js';

const STORE_ID_A = '11111111-1111-4111-8111-111111111111';
const STORE_ID_B = '22222222-2222-4222-8222-222222222222';
const USER_ID_OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID_STAFF = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CATEGORY_ID_1 = '33333333-3333-4333-8333-333333333333';
const PRODUCT_ID_1 = '44444444-4444-4444-8444-444444444444';
const TEST_INTERNAL_SECRET = 'super-secret-catalog-internal-key-at-least-32-chars';

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

describe('Catalog HTTP Ingress & REST API', () => {
  it('requires internal token when internalTokenSecret is configured and rejects missing token with 401', async () => {
    const categoryRepo = createMockCategoryRepo();
    const productRepo = createMockProductRepo();
    const catalogService = createCatalogServiceInstance(categoryRepo, productRepo);

    const service = createCatalogService({
      port: 0,
      catalogService,
      internalTokenSecret: TEST_INTERNAL_SECRET,
    });

    const { port } = await service.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/catalog/categories`);
      assert.equal(res.status, 401);
      const body = (await res.json()) as { code: string; title: string };
      assert.equal(body.code, 'MISSING_INTERNAL_TOKEN');
      assert.equal(body.title, 'Unauthorized');
    } finally {
      await service.stop();
    }
  });

  it('rejects mutating operations from STAFF role with 403 Forbidden', async () => {
    const categoryRepo = createMockCategoryRepo();
    const productRepo = createMockProductRepo();
    const catalogService = createCatalogServiceInstance(categoryRepo, productRepo);

    const service = createCatalogService({
      port: 0,
      catalogService,
      internalTokenSecret: TEST_INTERNAL_SECRET,
    });

    const staffToken = mintInternalToken(
      {
        sub: USER_ID_STAFF,
        act: 'STAFF',
        tid: STORE_ID_A,
        roles: ['STAFF'],
      },
      { secret: TEST_INTERNAL_SECRET },
    );

    const { port } = await service.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/catalog/categories`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': staffToken,
        },
        body: JSON.stringify({ name: 'Fresh Fruits' }),
      });

      assert.equal(res.status, 403);
      const body = (await res.json()) as { code: string };
      assert.equal(body.code, 'INSUFFICIENT_PERMISSIONS');
    } finally {
      await service.stop();
    }
  });

  it('rejects request with 403 Forbidden when x-store-id header contradicts token tenant claim (tid)', async () => {
    const categoryRepo = createMockCategoryRepo();
    const productRepo = createMockProductRepo();
    const catalogService = createCatalogServiceInstance(categoryRepo, productRepo);

    const service = createCatalogService({
      port: 0,
      catalogService,
      internalTokenSecret: TEST_INTERNAL_SECRET,
    });

    const tokenForStoreA = mintInternalToken(
      {
        sub: USER_ID_STAFF,
        act: 'STAFF',
        tid: STORE_ID_A,
        roles: ['STAFF'],
      },
      { secret: TEST_INTERNAL_SECRET },
    );

    const { port } = await service.start();
    try {
      // Pass token for STORE_ID_A, but pass header x-store-id for STORE_ID_B
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/catalog/products`, {
        headers: {
          'x-internal-token': tokenForStoreA,
          'x-store-id': STORE_ID_B,
        },
      });

      assert.equal(res.status, 403);
      const body = (await res.json()) as { code: string; title: string };
      assert.equal(body.code, 'TENANT_MISMATCH');
      assert.equal(body.title, 'Forbidden');
    } finally {
      await service.stop();
    }
  });

  it('allows validly authenticated STAFF token to read /api/v1/catalog/products', async () => {
    const categoryRepo = createMockCategoryRepo();
    const productRepo = createMockProductRepo();
    const catalogService = createCatalogServiceInstance(categoryRepo, productRepo);

    const service = createCatalogService({
      port: 0,
      catalogService,
      internalTokenSecret: TEST_INTERNAL_SECRET,
    });

    const staffToken = mintInternalToken(
      {
        sub: 'whatsapp-service',
        act: 'SYSTEM',
        tid: STORE_ID_A,
        roles: ['STAFF'],
      },
      { secret: TEST_INTERNAL_SECRET },
    );

    const { port } = await service.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/catalog/products`, {
        headers: {
          'x-internal-token': staffToken,
          'x-store-id': STORE_ID_A,
        },
      });

      assert.equal(res.status, 200);
      const body = (await res.json()) as { data: unknown[] };
      assert.ok(Array.isArray(body.data));
    } finally {
      await service.stop();
    }
  });

  it('allows OWNER to create category, retrieve it, update it, and delete it over HTTP', async () => {
    const categoryRepo = createMockCategoryRepo();
    const productRepo = createMockProductRepo();
    const catalogService = createCatalogServiceInstance(categoryRepo, productRepo);

    const service = createCatalogService({
      port: 0,
      catalogService,
      internalTokenSecret: TEST_INTERNAL_SECRET,
    });

    const ownerToken = mintInternalToken(
      {
        sub: USER_ID_OWNER,
        act: 'SHOPKEEPER',
        tid: STORE_ID_A,
        roles: ['OWNER'],
      },
      { secret: TEST_INTERNAL_SECRET },
    );

    const { port } = await service.start();
    try {
      // 1. Create Category: POST /api/v1/catalog/categories
      const createRes = await fetch(`http://127.0.0.1:${port}/api/v1/catalog/categories`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': ownerToken,
        },
        body: JSON.stringify({
          name: 'Organic Vegetables',
          description: 'Farm-fresh leafy greens and root vegetables',
          sortOrder: 1,
        }),
      });

      assert.equal(createRes.status, 201);
      const createBody = (await createRes.json()) as {
        category: { id: string; name: string; slug: string; storeId: string };
      };
      assert.equal(createBody.category.name, 'Organic Vegetables');
      assert.equal(createBody.category.slug, 'organic-vegetables');
      assert.equal(createBody.category.storeId, STORE_ID_A);
      const categoryId = createBody.category.id;

      // 2. Get Category By ID: GET /api/v1/catalog/categories/:id
      const getRes = await fetch(
        `http://127.0.0.1:${port}/api/v1/catalog/categories/${categoryId}`,
        {
          headers: { 'x-internal-token': ownerToken },
        },
      );
      assert.equal(getRes.status, 200);
      const getBody = (await getRes.json()) as { category: { id: string; name: string } };
      assert.equal(getBody.category.id, categoryId);

      // 3. Get Category By Slug: GET /api/v1/catalog/categories/slug/:slug
      const slugRes = await fetch(
        `http://127.0.0.1:${port}/api/v1/catalog/categories/slug/organic-vegetables`,
        {
          headers: { 'x-internal-token': ownerToken },
        },
      );
      assert.equal(slugRes.status, 200);

      // 4. List Categories: GET /api/v1/catalog/categories
      const listRes = await fetch(`http://127.0.0.1:${port}/api/v1/catalog/categories`, {
        headers: { 'x-internal-token': ownerToken },
      });
      assert.equal(listRes.status, 200);
      const listBody = (await listRes.json()) as { categories: unknown[] };
      assert.equal(listBody.categories.length, 1);

      // 5. Update Category: PATCH /api/v1/catalog/categories/:id
      const patchRes = await fetch(
        `http://127.0.0.1:${port}/api/v1/catalog/categories/${categoryId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-token': ownerToken,
          },
          body: JSON.stringify({ name: 'Fresh Organic Greens' }),
        },
      );
      assert.equal(patchRes.status, 200);
      const patchBody = (await patchRes.json()) as { category: { name: string } };
      assert.equal(patchBody.category.name, 'Fresh Organic Greens');

      // 6. Delete Category: DELETE /api/v1/catalog/categories/:id
      const deleteRes = await fetch(
        `http://127.0.0.1:${port}/api/v1/catalog/categories/${categoryId}`,
        {
          method: 'DELETE',
          headers: { 'x-internal-token': ownerToken },
        },
      );
      assert.equal(deleteRes.status, 204);

      // 7. Verify Gone: GET /api/v1/catalog/categories/:id -> 404
      const getDeletedRes = await fetch(
        `http://127.0.0.1:${port}/api/v1/catalog/categories/${categoryId}`,
        {
          headers: { 'x-internal-token': ownerToken },
        },
      );
      assert.equal(getDeletedRes.status, 404);
    } finally {
      await service.stop();
    }
  });

  it('allows MANAGER to create, list, paginate, update, and delete products over HTTP', async () => {
    const categoryRepo = createMockCategoryRepo();
    const productRepo = createMockProductRepo();
    const catalogService = createCatalogServiceInstance(categoryRepo, productRepo);

    const service = createCatalogService({
      port: 0,
      catalogService,
      internalTokenSecret: TEST_INTERNAL_SECRET,
    });

    const managerToken = mintInternalToken(
      {
        sub: USER_ID_OWNER,
        act: 'STAFF',
        tid: STORE_ID_A,
        roles: ['MANAGER'],
      },
      { secret: TEST_INTERNAL_SECRET },
    );

    const { port } = await service.start();
    try {
      // 1. Create Product: POST /api/v1/catalog/products
      const createRes = await fetch(`http://127.0.0.1:${port}/api/v1/catalog/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': managerToken,
        },
        body: JSON.stringify({
          name: 'Basmati Rice 5kg',
          sku: 'RICE-BAS-5KG',
          priceCents: 45000,
          currency: 'INR',
          unit: 'KG',
          isWeightBased: true,
        }),
      });

      assert.equal(createRes.status, 201);
      const createBody = (await createRes.json()) as {
        product: { id: string; name: string; slug: string; priceCents: number; unit: string };
      };
      assert.equal(createBody.product.name, 'Basmati Rice 5kg');
      assert.equal(createBody.product.slug, 'basmati-rice-5kg');
      assert.equal(createBody.product.priceCents, 45000);
      assert.equal(createBody.product.unit, 'KG');
      const productId = createBody.product.id;

      // 2. Get Product: GET /api/v1/catalog/products/:id
      const getRes = await fetch(`http://127.0.0.1:${port}/api/v1/catalog/products/${productId}`, {
        headers: { 'x-internal-token': managerToken },
      });
      assert.equal(getRes.status, 200);

      // 3. Paginated Product List: GET /api/v1/catalog/products?page=1&limit=10
      const listRes = await fetch(
        `http://127.0.0.1:${port}/api/v1/catalog/products?page=1&limit=10`,
        {
          headers: { 'x-internal-token': managerToken },
        },
      );
      assert.equal(listRes.status, 200);
      const listBody = (await listRes.json()) as {
        data: unknown[];
        pagination: { page: number; limit: number; total_items: number };
      };
      assert.equal(listBody.data.length, 1);
      assert.equal(listBody.pagination.page, 1);
      assert.equal(listBody.pagination.total_items, 1);

      // 4. Update Product: PATCH /api/v1/catalog/products/:id
      const patchRes = await fetch(
        `http://127.0.0.1:${port}/api/v1/catalog/products/${productId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-token': managerToken,
          },
          body: JSON.stringify({ priceCents: 49900 }),
        },
      );
      assert.equal(patchRes.status, 200);
      const patchBody = (await patchRes.json()) as { product: { priceCents: number } };
      assert.equal(patchBody.product.priceCents, 49900);

      // 5. Delete Product: DELETE /api/v1/catalog/products/:id
      const deleteRes = await fetch(
        `http://127.0.0.1:${port}/api/v1/catalog/products/${productId}`,
        {
          method: 'DELETE',
          headers: { 'x-internal-token': managerToken },
        },
      );
      assert.equal(deleteRes.status, 204);

      // 6. Confirm 404
      const getDeleted = await fetch(
        `http://127.0.0.1:${port}/api/v1/catalog/products/${productId}`,
        {
          headers: { 'x-internal-token': managerToken },
        },
      );
      assert.equal(getDeleted.status, 404);
    } finally {
      await service.stop();
    }
  });

  it('guarantees tenant isolation: tokens for Store B cannot access products in Store A', async () => {
    const existingProductInStoreA: ProductRow = {
      id: PRODUCT_ID_1,
      store_id: STORE_ID_A,
      category_id: null,
      name: 'Store A Exclusive Product',
      slug: 'store-a-exclusive',
      sku: 'EXC-A',
      barcode: null,
      description: null,
      price_cents: 1000n as unknown as number,
      currency: 'INR',
      unit: 'PIECE',
      is_weight_based: false,
      status: 'ACTIVE',
      image_url: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const categoryRepo = createMockCategoryRepo();
    const productRepo = createMockProductRepo([existingProductInStoreA]);
    const catalogService = createCatalogServiceInstance(categoryRepo, productRepo);

    const service = createCatalogService({
      port: 0,
      catalogService,
      internalTokenSecret: TEST_INTERNAL_SECRET,
    });

    const storeBToken = mintInternalToken(
      {
        sub: USER_ID_OWNER,
        act: 'SHOPKEEPER',
        tid: STORE_ID_B,
        roles: ['OWNER'],
      },
      { secret: TEST_INTERNAL_SECRET },
    );

    const { port } = await service.start();
    try {
      // Store B attempts to fetch Store A's product -> MUST 404 (not found in Store B!)
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/catalog/products/${PRODUCT_ID_1}`, {
        headers: { 'x-internal-token': storeBToken },
      });
      assert.equal(res.status, 404);

      // Store B lists products -> MUST return empty array
      const listRes = await fetch(`http://127.0.0.1:${port}/api/v1/catalog/products`, {
        headers: { 'x-internal-token': storeBToken },
      });
      assert.equal(listRes.status, 200);
      const listBody = (await listRes.json()) as {
        data: unknown[];
        pagination: { total_items: number };
      };
      assert.equal(listBody.data.length, 0);
      assert.equal(listBody.pagination.total_items, 0);
    } finally {
      await service.stop();
    }
  });
});
