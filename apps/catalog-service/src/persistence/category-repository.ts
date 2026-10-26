import type { CategoryRow, NewCategory, CategoryUpdate } from '@grocery/database';
import type { DatabaseConnection, CategoryRepository, ListCategoriesOptions } from './types.js';
import { mapCatalogDatabaseError } from './errors.js';

export class KyselyCategoryRepository implements CategoryRepository {
  constructor(private readonly defaultDb: DatabaseConnection) {}

  private getExecutor(trx?: DatabaseConnection): DatabaseConnection {
    return trx ?? this.defaultDb;
  }

  async findById(
    storeId: string,
    id: string,
    trx?: DatabaseConnection,
  ): Promise<CategoryRow | null> {
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('catalog.categories')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('id', '=', id)
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapCatalogDatabaseError(err, `Failed to find category '${id}'`);
    }
  }

  async findBySlug(
    storeId: string,
    slug: string,
    trx?: DatabaseConnection,
  ): Promise<CategoryRow | null> {
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('catalog.categories')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('slug', '=', slug.trim().toLowerCase())
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapCatalogDatabaseError(err, `Failed to find category by slug '${slug}'`);
    }
  }

  async listByStore(
    storeId: string,
    options?: ListCategoriesOptions,
    trx?: DatabaseConnection,
  ): Promise<CategoryRow[]> {
    try {
      let query = this.getExecutor(trx)
        .selectFrom('catalog.categories')
        .selectAll()
        .where('store_id', '=', storeId);

      if (options?.parentId !== undefined) {
        if (options.parentId === null) {
          query = query.where('parent_id', 'is', null);
        } else {
          query = query.where('parent_id', '=', options.parentId);
        }
      }

      if (options?.status) {
        query = query.where('status', '=', options.status);
      }

      return await query.orderBy('sort_order', 'asc').orderBy('name', 'asc').execute();
    } catch (err) {
      throw mapCatalogDatabaseError(err, 'Failed to list categories for store');
    }
  }

  async create(category: NewCategory, trx?: DatabaseConnection): Promise<CategoryRow> {
    try {
      const created = await this.getExecutor(trx)
        .insertInto('catalog.categories')
        .values({
          ...category,
          slug: category.slug.trim().toLowerCase(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return created;
    } catch (err) {
      throw mapCatalogDatabaseError(err, 'Failed to create category');
    }
  }

  async update(
    storeId: string,
    id: string,
    update: CategoryUpdate,
    trx?: DatabaseConnection,
  ): Promise<CategoryRow | null> {
    try {
      const payload: CategoryUpdate = {
        ...update,
        updated_at: new Date(),
      };
      if (typeof update.slug === 'string') {
        payload.slug = update.slug.trim().toLowerCase();
      }

      const updated = await this.getExecutor(trx)
        .updateTable('catalog.categories')
        .set(payload)
        .where('store_id', '=', storeId)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
      return updated ?? null;
    } catch (err) {
      throw mapCatalogDatabaseError(err, `Failed to update category '${id}'`);
    }
  }

  async delete(storeId: string, id: string, trx?: DatabaseConnection): Promise<boolean> {
    try {
      const result = await this.getExecutor(trx)
        .deleteFrom('catalog.categories')
        .where('store_id', '=', storeId)
        .where('id', '=', id)
        .executeTakeFirst();
      return Number(result.numDeletedRows ?? 0) > 0;
    } catch (err) {
      throw mapCatalogDatabaseError(err, `Failed to delete category '${id}'`);
    }
  }
}

export function createCategoryRepository(db: DatabaseConnection): CategoryRepository {
  return new KyselyCategoryRepository(db);
}
