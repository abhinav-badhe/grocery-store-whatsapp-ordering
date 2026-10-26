import { sanitizeErrorMessage } from '@grocery/observability';

export class CatalogPersistenceError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'CATALOG_PERSISTENCE_ERROR') {
    const sanitized = sanitizeErrorMessage(message);
    super(sanitized);
    this.name = 'CatalogPersistenceError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DuplicateSlugError extends CatalogPersistenceError {
  constructor(message = 'A record with this slug already exists for this store') {
    super(message, 'DUPLICATE_SLUG');
    this.name = 'DuplicateSlugError';
  }
}

export class DuplicateSkuError extends CatalogPersistenceError {
  constructor(message = 'A product with this SKU already exists for this store') {
    super(message, 'DUPLICATE_SKU');
    this.name = 'DuplicateSkuError';
  }
}

export class CategoryPersistenceNotFoundError extends CatalogPersistenceError {
  constructor(message = 'Category not found') {
    super(message, 'CATEGORY_NOT_FOUND');
    this.name = 'CategoryPersistenceNotFoundError';
  }
}

export class ProductPersistenceNotFoundError extends CatalogPersistenceError {
  constructor(message = 'Product not found') {
    super(message, 'PRODUCT_NOT_FOUND');
    this.name = 'ProductPersistenceNotFoundError';
  }
}

interface PostgresLikeError {
  code?: string;
  constraint?: string;
  message?: string;
  detail?: string;
}

/**
 * Maps raw PostgreSQL error codes to strongly-typed domain persistence errors.
 */
export function mapCatalogDatabaseError(err: unknown, defaultMessage: string): Error {
  if (err instanceof CatalogPersistenceError) {
    return err;
  }

  const pgErr = err as PostgresLikeError | null | undefined;
  if (pgErr && typeof pgErr.code === 'string') {
    // 23505: Unique constraint violation
    if (pgErr.code === '23505') {
      const constraint = pgErr.constraint ?? '';
      if (constraint.includes('slug')) {
        return new DuplicateSlugError(
          'A category or product with this slug already exists in this store',
        );
      }
      if (constraint.includes('sku')) {
        return new DuplicateSkuError('A product with this SKU already exists in this store');
      }
    }
  }

  const baseMessage = err instanceof Error ? err.message : String(err);
  return new CatalogPersistenceError(`${defaultMessage}: ${baseMessage}`);
}
