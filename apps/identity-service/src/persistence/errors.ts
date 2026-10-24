import { sanitizeErrorMessage } from '@grocery/observability';

/**
 * Base persistence error for identity domain operations.
 * Preserves the original cause internally while providing a sanitized message.
 */
export class IdentityPersistenceError extends Error {
  public readonly code: string;
  public override readonly cause?: unknown;

  constructor(message: string, code = 'IDENTITY_PERSISTENCE_ERROR', cause?: unknown) {
    super(sanitizeErrorMessage(message));
    this.name = this.constructor.name;
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when an insert or update collides with an existing email address.
 */
export class DuplicateEmailError extends IdentityPersistenceError {
  constructor(message = 'A user with this email address already exists', cause?: unknown) {
    super(message, 'DUPLICATE_EMAIL', cause);
  }
}

/**
 * Thrown when an insert or update collides with an existing phone number.
 */
export class DuplicatePhoneError extends IdentityPersistenceError {
  constructor(message = 'A user with this phone number already exists', cause?: unknown) {
    super(message, 'DUPLICATE_PHONE', cause);
  }
}

/**
 * Thrown when a store creation collides with an existing unique store code.
 */
export class DuplicateStoreCodeError extends IdentityPersistenceError {
  constructor(message = 'A store with this code already exists', cause?: unknown) {
    super(message, 'DUPLICATE_STORE_CODE', cause);
  }
}

/**
 * Thrown when a user already holds a membership in the target store.
 */
export class DuplicateMembershipError extends IdentityPersistenceError {
  constructor(message = 'User already has a membership in this store', cause?: unknown) {
    super(message, 'DUPLICATE_MEMBERSHIP', cause);
  }
}

/**
 * Thrown when a refresh-token hash collides with an existing token hash.
 */
export class DuplicateTokenHashError extends IdentityPersistenceError {
  constructor(message = 'Refresh token hash collision occurred', cause?: unknown) {
    super(message, 'DUPLICATE_TOKEN_HASH', cause);
  }
}

/**
 * Thrown when an expected entity (user, store, or membership) is not found.
 */
export class EntityNotFoundError extends IdentityPersistenceError {
  constructor(message = 'Requested entity not found', cause?: unknown) {
    super(message, 'ENTITY_NOT_FOUND', cause);
  }
}

/**
 * Thrown when a foreign key relationship is violated (e.g. referencing non-existent user or store).
 */
export class ForeignKeyConstraintError extends IdentityPersistenceError {
  constructor(message = 'Referenced entity does not exist', cause?: unknown) {
    super(message, 'FOREIGN_KEY_VIOLATION', cause);
  }
}

/**
 * Fallback error for unexpected database execution errors.
 */
export class DatabaseOperationError extends IdentityPersistenceError {
  constructor(message = 'Database operation failed', cause?: unknown) {
    super(message, 'DATABASE_OPERATION_ERROR', cause);
  }
}

/**
 * Maps PostgreSQL and generic database errors to typed IdentityPersistenceError instances.
 * Accurately detects unique-constraint violations without misclassifying other error types.
 *
 * @param err The caught error
 * @param fallbackMessage Contextual message if generic error occurs
 */
export function mapDatabaseError(
  err: unknown,
  fallbackMessage = 'Database operation failed',
): Error {
  if (err instanceof IdentityPersistenceError) {
    return err;
  }

  if (typeof err === 'object' && err !== null && 'code' in err) {
    const pgErr = err as { code: string; constraint?: string; message?: string };

    // PostgreSQL code 23505: unique_violation
    if (pgErr.code === '23505') {
      const constraint = pgErr.constraint ?? '';
      if (constraint === 'users_email_unique_idx' || constraint.includes('email')) {
        return new DuplicateEmailError('A user with this email address already exists', err);
      }
      if (constraint === 'users_phone_unique_idx' || constraint.includes('phone')) {
        return new DuplicatePhoneError('A user with this phone number already exists', err);
      }
      if (constraint === 'stores_code_unique_idx' || constraint.includes('code')) {
        return new DuplicateStoreCodeError('A store with this code already exists', err);
      }
      if (
        constraint === 'store_memberships_user_store_unique' ||
        constraint.includes('user_store') ||
        constraint.includes('membership')
      ) {
        return new DuplicateMembershipError('User already has a membership in this store', err);
      }
      if (
        constraint === 'refresh_tokens_hash_unique_idx' ||
        constraint.includes('refresh_tokens')
      ) {
        return new DuplicateTokenHashError('Refresh token hash collision occurred', err);
      }
      return new IdentityPersistenceError('Unique constraint violation', 'UNIQUE_VIOLATION', err);
    }

    // PostgreSQL code 23503: foreign_key_violation
    if (pgErr.code === '23503') {
      return new ForeignKeyConstraintError('Referenced entity does not exist', err);
    }

    // PostgreSQL code 23514: check_violation
    if (pgErr.code === '23514') {
      return new IdentityPersistenceError(
        'Check constraint violation',
        'CHECK_CONSTRAINT_VIOLATION',
        err,
      );
    }
  }

  return new DatabaseOperationError(fallbackMessage, err);
}
