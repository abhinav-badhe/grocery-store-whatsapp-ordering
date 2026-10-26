import { sanitizeErrorMessage } from '@grocery/observability';

export class CatalogDomainError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 400, code = 'CATALOG_DOMAIN_ERROR') {
    const sanitized = sanitizeErrorMessage(message);
    super(sanitized);
    this.name = 'CatalogDomainError';
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      type: 'https://tools.ietf.org/html/rfc7807',
      title: this.name,
      status: this.statusCode,
      detail: this.message,
      code: this.code,
    };
  }
}

export class CategoryNotFoundError extends CatalogDomainError {
  constructor(categoryId: string) {
    super(`Category '${categoryId}' was not found in the current store`, 404, 'CATEGORY_NOT_FOUND');
    this.name = 'CategoryNotFoundError';
  }
}

export class ProductNotFoundError extends CatalogDomainError {
  constructor(productId: string) {
    super(`Product '${productId}' was not found in the current store`, 404, 'PRODUCT_NOT_FOUND');
    this.name = 'ProductNotFoundError';
  }
}

export class ParentCategoryNotFoundError extends CatalogDomainError {
  constructor(parentId: string) {
    super(
      `Parent category '${parentId}' does not exist in the current store`,
      400,
      'PARENT_CATEGORY_NOT_FOUND',
    );
    this.name = 'ParentCategoryNotFoundError';
  }
}

export class InvalidProductCategoryError extends CatalogDomainError {
  constructor(categoryId: string) {
    super(
      `Associated category '${categoryId}' does not exist in the current store`,
      400,
      'INVALID_PRODUCT_CATEGORY',
    );
    this.name = 'InvalidProductCategoryError';
  }
}

export class DuplicateSlugConflictError extends CatalogDomainError {
  constructor(slug: string, entity = 'item') {
    super(
      `A ${entity} with slug '${slug}' already exists in this store`,
      409,
      'DUPLICATE_SLUG_CONFLICT',
    );
    this.name = 'DuplicateSlugConflictError';
  }
}

export class DuplicateSkuConflictError extends CatalogDomainError {
  constructor(sku: string) {
    super(
      `A product with SKU '${sku}' already exists in this store`,
      409,
      'DUPLICATE_SKU_CONFLICT',
    );
    this.name = 'DuplicateSkuConflictError';
  }
}

export class InsufficientRoleError extends CatalogDomainError {
  constructor(requiredRoles: string[]) {
    super(
      `Operation requires one of the following roles: ${requiredRoles.join(', ')}`,
      403,
      'INSUFFICIENT_PERMISSIONS',
    );
    this.name = 'InsufficientRoleError';
  }
}
