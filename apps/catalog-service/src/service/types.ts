import type {
  CategoryRow,
  ProductRow,
  CategoryStatus,
  ProductStatus,
  ProductUnit,
} from '@grocery/database';
import type { ListProductsResult } from '../persistence/types.js';

export interface CreateCategoryData {
  readonly name: string;
  readonly slug: string;
  readonly description?: string | null;
  readonly parentId?: string | null;
  readonly sortOrder?: number;
  readonly status?: CategoryStatus;
}

export interface UpdateCategoryData {
  readonly name?: string;
  readonly slug?: string;
  readonly description?: string | null;
  readonly parentId?: string | null;
  readonly sortOrder?: number;
  readonly status?: CategoryStatus;
}

export interface ListCategoriesFilter {
  readonly parentId?: string | null;
  readonly status?: CategoryStatus;
}

export interface CreateProductData {
  readonly name: string;
  readonly slug: string;
  readonly sku?: string | null;
  readonly barcode?: string | null;
  readonly description?: string | null;
  readonly categoryId?: string | null;
  readonly priceCents: number;
  readonly currency?: string;
  readonly unit?: ProductUnit;
  readonly isWeightBased?: boolean;
  readonly status?: ProductStatus;
  readonly imageUrl?: string | null;
}

export interface UpdateProductData {
  readonly name?: string;
  readonly slug?: string;
  readonly sku?: string | null;
  readonly barcode?: string | null;
  readonly description?: string | null;
  readonly categoryId?: string | null;
  readonly priceCents?: number;
  readonly currency?: string;
  readonly unit?: ProductUnit;
  readonly isWeightBased?: boolean;
  readonly status?: ProductStatus;
  readonly imageUrl?: string | null;
}

export interface ListProductsFilter {
  readonly categoryId?: string;
  readonly status?: ProductStatus;
  readonly search?: string;
  readonly page?: number;
  readonly limit?: number;
}

export interface CatalogService {
  createCategory(storeId: string, data: CreateCategoryData): Promise<CategoryRow>;
  getCategoryById(storeId: string, id: string): Promise<CategoryRow | null>;
  getCategoryBySlug(storeId: string, slug: string): Promise<CategoryRow | null>;
  listCategories(storeId: string, filter?: ListCategoriesFilter): Promise<CategoryRow[]>;
  updateCategory(
    storeId: string,
    id: string,
    data: UpdateCategoryData,
  ): Promise<CategoryRow | null>;
  deleteCategory(storeId: string, id: string): Promise<boolean>;

  createProduct(storeId: string, data: CreateProductData): Promise<ProductRow>;
  getProductById(storeId: string, id: string): Promise<ProductRow | null>;
  getProductBySlug(storeId: string, slug: string): Promise<ProductRow | null>;
  getProductBySku(storeId: string, sku: string): Promise<ProductRow | null>;
  listProducts(storeId: string, filter?: ListProductsFilter): Promise<ListProductsResult>;
  updateProduct(storeId: string, id: string, data: UpdateProductData): Promise<ProductRow | null>;
  deleteProduct(storeId: string, id: string): Promise<boolean>;
}
