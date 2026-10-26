import { sanitizeErrorMessage } from '@grocery/observability';

export class OrderPersistenceError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'ORDER_PERSISTENCE_ERROR') {
    const sanitized = sanitizeErrorMessage(message);
    super(sanitized);
    this.name = 'OrderPersistenceError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class OrderPersistenceNotFoundError extends OrderPersistenceError {
  constructor(orderId: string) {
    super(`Order '${orderId}' not found`, 'ORDER_NOT_FOUND');
    this.name = 'OrderPersistenceNotFoundError';
  }
}

export class DuplicateOrderNumberError extends OrderPersistenceError {
  constructor(orderNumber: string) {
    super(
      `An order with number '${orderNumber}' already exists in this store`,
      'DUPLICATE_ORDER_NUMBER',
    );
    this.name = 'DuplicateOrderNumberError';
  }
}

export class DuplicateIdempotencyKeyError extends OrderPersistenceError {
  constructor(idempotencyKey: string) {
    super(
      `An order with idempotency key '${idempotencyKey}' already exists in this store`,
      'DUPLICATE_IDEMPOTENCY_KEY',
    );
    this.name = 'DuplicateIdempotencyKeyError';
  }
}

interface PostgresLikeError {
  code?: string;
  constraint?: string;
  message?: string;
  detail?: string;
}

export function mapOrderDatabaseError(err: unknown, defaultMessage: string): Error {
  if (err instanceof OrderPersistenceError) {
    return err;
  }

  const pgErr = err as PostgresLikeError | null | undefined;
  if (pgErr && typeof pgErr.code === 'string') {
    // 23505: Unique constraint violation
    if (pgErr.code === '23505') {
      const constraint = pgErr.constraint ?? '';
      if (constraint.includes('order_number')) {
        return new DuplicateOrderNumberError('duplicate');
      }
      if (constraint.includes('idempotency')) {
        return new DuplicateIdempotencyKeyError('duplicate');
      }
    }
  }

  const baseMessage = err instanceof Error ? err.message : String(err);
  return new OrderPersistenceError(`${defaultMessage}: ${baseMessage}`);
}
