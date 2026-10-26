import { sanitizeErrorMessage } from '@grocery/observability';

export class InventoryPersistenceError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'INVENTORY_PERSISTENCE_ERROR') {
    const sanitized = sanitizeErrorMessage(message);
    super(sanitized);
    this.name = 'InventoryPersistenceError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DuplicateReservationError extends InventoryPersistenceError {
  constructor(orderId: string) {
    super(`A stock reservation already exists for order '${orderId}'`, 'DUPLICATE_RESERVATION');
    this.name = 'DuplicateReservationError';
  }
}

export class StockBalancePersistenceNotFoundError extends InventoryPersistenceError {
  constructor(productId: string) {
    super(`Stock balance not found for product '${productId}'`, 'STOCK_BALANCE_NOT_FOUND');
    this.name = 'StockBalancePersistenceNotFoundError';
  }
}

export class InsufficientAvailableStockError extends InventoryPersistenceError {
  constructor(productId: string, requested: number, available: number) {
    super(
      `Insufficient available stock for product '${productId}'. Requested: ${requested}, Available: ${available}`,
      'INSUFFICIENT_STOCK',
    );
    this.name = 'InsufficientAvailableStockError';
  }
}

interface PostgresLikeError {
  code?: string;
  constraint?: string;
  message?: string;
  detail?: string;
}

export function mapInventoryDatabaseError(err: unknown, defaultMessage: string): Error {
  if (err instanceof InventoryPersistenceError) {
    return err;
  }

  const pgErr = err as PostgresLikeError | null | undefined;
  if (pgErr && typeof pgErr.code === 'string') {
    // 23505: Unique constraint violation
    if (pgErr.code === '23505') {
      const constraint = pgErr.constraint ?? '';
      if (constraint.includes('order')) {
        return new DuplicateReservationError('Duplicate order reservation');
      }
    }
    // 23514: Check constraint violation (e.g. on_hand >= reserved or quantity >= 0)
    if (pgErr.code === '23514') {
      const constraint = pgErr.constraint ?? '';
      if (constraint.includes('oversell') || constraint.includes('available')) {
        return new InventoryPersistenceError(
          'Inventory quantity invariant violated: cannot reserve more than available stock',
          'INSUFFICIENT_STOCK_INVARIANT',
        );
      }
    }
  }

  const baseMessage = err instanceof Error ? err.message : String(err);
  return new InventoryPersistenceError(`${defaultMessage}: ${baseMessage}`);
}
