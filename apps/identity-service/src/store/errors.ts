import { sanitizeErrorMessage } from '@grocery/observability';

export interface InvalidParamDetail {
  readonly path: string;
  readonly message: string;
}

/**
 * Base domain error for store and membership operations.
 * Produces RFC 7807 Problem Details compliant serialization.
 */
export abstract class StoreError extends Error {
  public abstract readonly statusCode: number;
  public abstract readonly title: string;
  public readonly code: string;
  public readonly detail: string;
  public readonly invalidParams?: readonly InvalidParamDetail[];

  constructor(detail: string, code: string, invalidParams?: readonly InvalidParamDetail[]) {
    const sanitized = sanitizeErrorMessage(detail);
    super(sanitized);
    this.name = this.constructor.name;
    this.detail = sanitized;
    this.code = code;
    this.invalidParams = invalidParams;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      type: 'https://tools.ietf.org/html/rfc7807',
      title: this.title,
      status: this.statusCode,
      detail: this.detail,
      code: this.code,
      ...(this.invalidParams && this.invalidParams.length > 0
        ? { invalidParams: this.invalidParams }
        : {}),
    };
  }
}

/**
 * Thrown when request payload fails schema validation constraints.
 */
export class ValidationError extends StoreError {
  public readonly statusCode = 400;
  public readonly title = 'Bad Request';

  constructor(
    detail = 'Validation failed for request payload',
    invalidParams?: readonly InvalidParamDetail[],
  ) {
    super(detail, 'VALIDATION_ERROR', invalidParams);
  }
}

/**
 * Thrown when a store cannot be found by ID or code.
 */
export class StoreNotFoundError extends StoreError {
  public readonly statusCode = 404;
  public readonly title = 'Not Found';

  constructor(detail = 'Store not found') {
    super(detail, 'STORE_NOT_FOUND');
  }
}

/**
 * Thrown when a store membership cannot be found.
 */
export class MembershipNotFoundError extends StoreError {
  public readonly statusCode = 404;
  public readonly title = 'Not Found';

  constructor(detail = 'Store membership not found') {
    super(detail, 'MEMBERSHIP_NOT_FOUND');
  }
}

/**
 * Thrown when a store code collides with an existing store.
 */
export class DuplicateStoreCodeError extends StoreError {
  public readonly statusCode = 409;
  public readonly title = 'Conflict';

  constructor(detail = 'A store with this code already exists') {
    super(detail, 'DUPLICATE_STORE_CODE');
  }
}

/**
 * Thrown when an authenticated user lacks sufficient privileges in a store.
 */
export class StoreAccessDeniedError extends StoreError {
  public readonly statusCode = 403;
  public readonly title = 'Forbidden';

  constructor(detail = 'Access to this store is forbidden') {
    super(detail, 'STORE_ACCESS_DENIED');
  }
}

/**
 * Thrown when authentication is required but missing or invalid.
 */
export class StoreUnauthorizedError extends StoreError {
  public readonly statusCode = 401;
  public readonly title = 'Unauthorized';

  constructor(detail = 'Authentication required') {
    super(detail, 'UNAUTHORIZED');
  }
}
