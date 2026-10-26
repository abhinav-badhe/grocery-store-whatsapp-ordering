import type { CategoryRow, ProductRow, NewCategory, NewProduct } from '@grocery/database';
import type { CategoryRepository, ProductRepository } from '../persistence/types.js';
import { DuplicateSlugError, DuplicateSkuError } from '../persistence/errors.js';
import type {
  CatalogService,
  CreateCategoryData,
  UpdateCategoryData,
  ListCategoriesFilter,
  CreateProductData,
  UpdateProductData,
  ListProductsFilter,
} from './types.js';
import type { ListProductsResult } from '../persistence/types.js';
import {
  CategoryNotFoundError,
  ProductNotFoundError,
  ParentCategoryNotFoundError,
  InvalidProductCategoryError,
  DuplicateSlugConflictError,
  DuplicateSkuConflictError,
  CatalogDomainError,
} from './errors.js';

export class DefaultCatalogService implements CatalogService {
  constructor(
    private readonly categoryRepo: CategoryRepository,
    private readonly productRepo: ProductRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // Category Domain Operations
  // ---------------------------------------------------------------------------

  async createCategory(storeId: string, data: CreateCategoryData): Promise<CategoryRow> {
    if (data.parentId) {
      const parent = await this.categoryRepo.findById(storeId, data.parentId);
      if (!parent) {
        throw new ParentCategoryNotFoundError(data.parentId);
      }
    }

    const existingSlug = await this.categoryRepo.findBySlug(storeId, data.slug);
    if (existingSlug) {
      throw new DuplicateSlugConflictError(data.slug, 'category');
    }

    const newRecord: NewCategory = {
      store_id: storeId,
      name: data.name.trim(),
      slug: data.slug.trim().toLowerCase(),
      description: data.description?.trim() || null,
      parent_id: data.parentId ?? null,
      sort_order: data.sortOrder ?? 0,
      status: data.status ?? 'ACTIVE',
    };

    try {
      return await this.categoryRepo.create(newRecord);
    } catch (err) {
      if (err instanceof DuplicateSlugError) {
        throw new DuplicateSlugConflictError(data.slug, 'category');
      }
      throw err;
    }
  }

  async getCategoryById(storeId: string, id: string): Promise<CategoryRow | null> {
    return this.categoryRepo.findById(storeId, id);
  }

  async getCategoryBySlug(storeId: string, slug: string): Promise<CategoryRow | null> {
    return this.categoryRepo.findBySlug(storeId, slug);
  }

  async listCategories(storeId: string, filter?: ListCategoriesFilter): Promise<CategoryRow[]> {
    return this.categoryRepo.listByStore(storeId, filter);
  }

  async updateCategory(
    storeId: string,
    id: string,
    data: UpdateCategoryData,
  ): Promise<CategoryRow | null> {
    const existing = await this.categoryRepo.findById(storeId, id);
    if (!existing) {
      throw new CategoryNotFoundError(id);
    }

    if (data.parentId !== undefined) {
      if (data.parentId === id) {
        throw new CatalogDomainError(
          'A category cannot be its own parent',
          400,
          'CIRCULAR_CATEGORY_DEPENDENCY',
        );
      }
      if (data.parentId !== null) {
        const parent = await this.categoryRepo.findById(storeId, data.parentId);
        if (!parent) {
          throw new ParentCategoryNotFoundError(data.parentId);
        }
      }
    }

    if (data.slug) {
      const existingSlug = await this.categoryRepo.findBySlug(storeId, data.slug);
      if (existingSlug && existingSlug.id !== id) {
        throw new DuplicateSlugConflictError(data.slug, 'category');
      }
    }

    try {
      return await this.categoryRepo.update(storeId, id, {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.slug !== undefined ? { slug: data.slug.trim().toLowerCase() } : {}),
        ...(data.description !== undefined
          ? { description: data.description?.trim() || null }
          : {}),
        ...(data.parentId !== undefined ? { parent_id: data.parentId } : {}),
        ...(data.sortOrder !== undefined ? { sort_order: data.sortOrder } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      });
    } catch (err) {
      if (err instanceof DuplicateSlugError) {
        throw new DuplicateSlugConflictError(data.slug ?? '', 'category');
      }
      throw err;
    }
  }

  async deleteCategory(storeId: string, id: string): Promise<boolean> {
    const existing = await this.categoryRepo.findById(storeId, id);
    if (!existing) {
      throw new CategoryNotFoundError(id);
    }
    return this.categoryRepo.delete(storeId, id);
  }

  // ---------------------------------------------------------------------------
  // Product Domain Operations
  // ---------------------------------------------------------------------------

  async createProduct(storeId: string, data: CreateProductData): Promise<ProductRow> {
    if (data.categoryId) {
      const category = await this.categoryRepo.findById(storeId, data.categoryId);
      if (!category) {
        throw new InvalidProductCategoryError(data.categoryId);
      }
    }

    const existingSlug = await this.productRepo.findBySlug(storeId, data.slug);
    if (existingSlug) {
      throw new DuplicateSlugConflictError(data.slug, 'product');
    }

    if (data.sku) {
      const existingSku = await this.productRepo.findBySku(storeId, data.sku);
      if (existingSku) {
        throw new DuplicateSkuConflictError(data.sku);
      }
    }

    const newRecord: NewProduct = {
      store_id: storeId,
      category_id: data.categoryId ?? null,
      name: data.name.trim(),
      slug: data.slug.trim().toLowerCase(),
      sku: data.sku ? data.sku.trim() : null,
      barcode: data.barcode ? data.barcode.trim() : null,
      description: data.description?.trim() || null,
      price_cents: BigInt(data.priceCents) as unknown as number,
      currency: (data.currency ?? 'INR').trim().toUpperCase(),
      unit: data.unit ?? 'PIECE',
      is_weight_based: data.isWeightBased ?? false,
      status: data.status ?? 'ACTIVE',
      image_url: data.imageUrl?.trim() || null,
    };

    try {
      return await this.productRepo.create(newRecord);
    } catch (err) {
      if (err instanceof DuplicateSlugError) {
        throw new DuplicateSlugConflictError(data.slug, 'product');
      }
      if (err instanceof DuplicateSkuError) {
        throw new DuplicateSkuConflictError(data.sku ?? '');
      }
      throw err;
    }
  }

  async getProductById(storeId: string, id: string): Promise<ProductRow | null> {
    return this.productRepo.findById(storeId, id);
  }

  async getProductBySlug(storeId: string, slug: string): Promise<ProductRow | null> {
    return this.productRepo.findBySlug(storeId, slug);
  }

  async getProductBySku(storeId: string, sku: string): Promise<ProductRow | null> {
    return this.productRepo.findBySku(storeId, sku);
  }

  async listProducts(storeId: string, filter?: ListProductsFilter): Promise<ListProductsResult> {
    return this.productRepo.listByStore(storeId, filter);
  }

  async updateProduct(
    storeId: string,
    id: string,
    data: UpdateProductData,
  ): Promise<ProductRow | null> {
    const existing = await this.productRepo.findById(storeId, id);
    if (!existing) {
      throw new ProductNotFoundError(id);
    }

    if (data.categoryId !== undefined && data.categoryId !== null) {
      const category = await this.categoryRepo.findById(storeId, data.categoryId);
      if (!category) {
        throw new InvalidProductCategoryError(data.categoryId);
      }
    }

    if (data.slug) {
      const existingSlug = await this.productRepo.findBySlug(storeId, data.slug);
      if (existingSlug && existingSlug.id !== id) {
        throw new DuplicateSlugConflictError(data.slug, 'product');
      }
    }

    if (data.sku) {
      const existingSku = await this.productRepo.findBySku(storeId, data.sku);
      if (existingSku && existingSku.id !== id) {
        throw new DuplicateSkuConflictError(data.sku);
      }
    }

    try {
      return await this.productRepo.update(storeId, id, {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.slug !== undefined ? { slug: data.slug.trim().toLowerCase() } : {}),
        ...(data.sku !== undefined ? { sku: data.sku ? data.sku.trim() : null } : {}),
        ...(data.barcode !== undefined
          ? { barcode: data.barcode ? data.barcode.trim() : null }
          : {}),
        ...(data.description !== undefined
          ? { description: data.description?.trim() || null }
          : {}),
        ...(data.categoryId !== undefined ? { category_id: data.categoryId } : {}),
        ...(data.priceCents !== undefined
          ? { price_cents: BigInt(data.priceCents) as unknown as number }
          : {}),
        ...(data.currency !== undefined ? { currency: data.currency.trim().toUpperCase() } : {}),
        ...(data.unit !== undefined ? { unit: data.unit } : {}),
        ...(data.isWeightBased !== undefined ? { is_weight_based: data.isWeightBased } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.imageUrl !== undefined ? { image_url: data.imageUrl?.trim() || null } : {}),
      });
    } catch (err) {
      if (err instanceof DuplicateSlugError) {
        throw new DuplicateSlugConflictError(data.slug ?? '', 'product');
      }
      if (err instanceof DuplicateSkuError) {
        throw new DuplicateSkuConflictError(data.sku ?? '');
      }
      throw err;
    }
  }

  async deleteProduct(storeId: string, id: string): Promise<boolean> {
    const existing = await this.productRepo.findById(storeId, id);
    if (!existing) {
      throw new ProductNotFoundError(id);
    }
    return this.productRepo.delete(storeId, id);
  }
}

export function createCatalogServiceInstance(
  categoryRepo: CategoryRepository,
  productRepo: ProductRepository,
): CatalogService {
  return new DefaultCatalogService(categoryRepo, productRepo);
}
