import type { Kysely, Transaction } from 'kysely';
import type {
  Database,
  CategoryRow,
  NewCategory,
  CategoryUpdate,
  CategoryStatus,
  ProductRow,
  NewProduct,
  ProductUpdate,
  ProductStatus,
} from '@grocery/database';

export type DatabaseConnection = Kysely<Database> | Transaction<Database>;

export interface ListCategoriesOptions {
  readonly parentId?: string | null;
  readonly status?: CategoryStatus;
}

export interface CategoryRepository {
  findById(storeId: string, id: string, trx?: DatabaseConnection): Promise<CategoryRow | null>;
  findBySlug(storeId: string, slug: string, trx?: DatabaseConnection): Promise<CategoryRow | null>;
  listByStore(
    storeId: string,
    options?: ListCategoriesOptions,
    trx?: DatabaseConnection,
  ): Promise<CategoryRow[]>;
  create(category: NewCategory, trx?: DatabaseConnection): Promise<CategoryRow>;
  update(
    storeId: string,
    id: string,
    update: CategoryUpdate,
    trx?: DatabaseConnection,
  ): Promise<CategoryRow | null>;
  delete(storeId: string, id: string, trx?: DatabaseConnection): Promise<boolean>;
}

export interface ListProductsOptions {
  readonly categoryId?: string;
  readonly status?: ProductStatus;
  readonly search?: string;
  readonly page?: number;
  readonly limit?: number;
}

export interface ListProductsResult {
  readonly products: readonly ProductRow[];
  readonly total: number;
}

export interface ProductRepository {
  findById(storeId: string, id: string, trx?: DatabaseConnection): Promise<ProductRow | null>;
  findBySlug(storeId: string, slug: string, trx?: DatabaseConnection): Promise<ProductRow | null>;
  findBySku(storeId: string, sku: string, trx?: DatabaseConnection): Promise<ProductRow | null>;
  listByStore(
    storeId: string,
    options?: ListProductsOptions,
    trx?: DatabaseConnection,
  ): Promise<ListProductsResult>;
  create(product: NewProduct, trx?: DatabaseConnection): Promise<ProductRow>;
  update(
    storeId: string,
    id: string,
    update: ProductUpdate,
    trx?: DatabaseConnection,
  ): Promise<ProductRow | null>;
  delete(storeId: string, id: string, trx?: DatabaseConnection): Promise<boolean>;
}
