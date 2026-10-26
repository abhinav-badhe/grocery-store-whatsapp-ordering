import type { ProductRow, NewProduct, ProductUpdate } from '@grocery/database';
import type {
  DatabaseConnection,
  ProductRepository,
  ListProductsOptions,
  ListProductsResult,
} from './types.js';
import { mapCatalogDatabaseError } from './errors.js';

export class KyselyProductRepository implements ProductRepository {
  constructor(private readonly defaultDb: DatabaseConnection) {}

  private getExecutor(trx?: DatabaseConnection): DatabaseConnection {
    return trx ?? this.defaultDb;
  }

  async findById(
    storeId: string,
    id: string,
    trx?: DatabaseConnection,
  ): Promise<ProductRow | null> {
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('catalog.products')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('id', '=', id)
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapCatalogDatabaseError(err, `Failed to find product '${id}'`);
    }
  }

  async findBySlug(
    storeId: string,
    slug: string,
    trx?: DatabaseConnection,
  ): Promise<ProductRow | null> {
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('catalog.products')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('slug', '=', slug.trim().toLowerCase())
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapCatalogDatabaseError(err, `Failed to find product by slug '${slug}'`);
    }
  }

  async findBySku(
    storeId: string,
    sku: string,
    trx?: DatabaseConnection,
  ): Promise<ProductRow | null> {
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('catalog.products')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('sku', '=', sku.trim())
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapCatalogDatabaseError(err, `Failed to find product by SKU '${sku}'`);
    }
  }

  async listByStore(
    storeId: string,
    options?: ListProductsOptions,
    trx?: DatabaseConnection,
  ): Promise<ListProductsResult> {
    try {
      const executor = this.getExecutor(trx);
      const page = Math.max(1, options?.page ?? 1);
      const limit = Math.min(100, Math.max(1, options?.limit ?? 20));
      const offset = (page - 1) * limit;

      let baseQuery = executor.selectFrom('catalog.products').where('store_id', '=', storeId);

      if (options?.categoryId) {
        baseQuery = baseQuery.where('category_id', '=', options.categoryId);
      }

      if (options?.status) {
        baseQuery = baseQuery.where('status', '=', options.status);
      }

      if (options?.search && options.search.trim().length > 0) {
        baseQuery = baseQuery.where('name', 'ilike', `%${options.search.trim()}%`);
      }

      const countResult = await baseQuery
        .select((eb) => eb.fn.countAll<number | string>().as('count'))
        .executeTakeFirst();

      const total = Number(countResult?.count ?? 0);

      const products = await baseQuery
        .selectAll()
        .orderBy('name', 'asc')
        .limit(limit)
        .offset(offset)
        .execute();

      return { products, total };
    } catch (err) {
      throw mapCatalogDatabaseError(err, 'Failed to list products for store');
    }
  }

  async create(product: NewProduct, trx?: DatabaseConnection): Promise<ProductRow> {
    try {
      const created = await this.getExecutor(trx)
        .insertInto('catalog.products')
        .values({
          ...product,
          slug: product.slug.trim().toLowerCase(),
          sku: product.sku ? product.sku.trim() : null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return created;
    } catch (err) {
      throw mapCatalogDatabaseError(err, 'Failed to create product');
    }
  }

  async update(
    storeId: string,
    id: string,
    update: ProductUpdate,
    trx?: DatabaseConnection,
  ): Promise<ProductRow | null> {
    try {
      const payload: ProductUpdate = {
        ...update,
        updated_at: new Date(),
      };
      if (typeof update.slug === 'string') {
        payload.slug = update.slug.trim().toLowerCase();
      }
      if (typeof update.sku === 'string') {
        payload.sku = update.sku.trim();
      }

      const updated = await this.getExecutor(trx)
        .updateTable('catalog.products')
        .set(payload)
        .where('store_id', '=', storeId)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
      return updated ?? null;
    } catch (err) {
      throw mapCatalogDatabaseError(err, `Failed to update product '${id}'`);
    }
  }

  async delete(storeId: string, id: string, trx?: DatabaseConnection): Promise<boolean> {
    try {
      const result = await this.getExecutor(trx)
        .deleteFrom('catalog.products')
        .where('store_id', '=', storeId)
        .where('id', '=', id)
        .executeTakeFirst();
      return Number(result.numDeletedRows ?? 0) > 0;
    } catch (err) {
      throw mapCatalogDatabaseError(err, `Failed to delete product '${id}'`);
    }
  }
}

export function createProductRepository(db: DatabaseConnection): ProductRepository {
  return new KyselyProductRepository(db);
}
