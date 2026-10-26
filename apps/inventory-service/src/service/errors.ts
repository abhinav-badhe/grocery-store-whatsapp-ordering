import { sanitizeErrorMessage } from '@grocery/observability';

export class InventoryDomainError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 400, code = 'INVENTORY_DOMAIN_ERROR') {
    const sanitized = sanitizeErrorMessage(message);
    super(sanitized);
    this.name = 'InventoryDomainError';
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

export class StockBalanceNotFoundError extends InventoryDomainError {
  constructor(productId: string) {
    super(
      `Stock balance for product '${productId}' was not found in the current store`,
      404,
      'STOCK_BALANCE_NOT_FOUND',
    );
    this.name = 'StockBalanceNotFoundError';
  }
}

export class InsufficientStockDomainError extends InventoryDomainError {
  constructor(
    public readonly productId: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(
      `Insufficient available stock for product '${productId}'. Requested: ${requested}, Available: ${available}`,
      409,
      'INSUFFICIENT_STOCK',
    );
    this.name = 'InsufficientStockDomainError';
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      productId: this.productId,
      requested: this.requested,
      available: this.available,
    };
  }
}

export class ReservationNotFoundError extends InventoryDomainError {
  constructor(orderId: string) {
    super(
      `Stock reservation for order '${orderId}' was not found in the current store`,
      404,
      'RESERVATION_NOT_FOUND',
    );
    this.name = 'ReservationNotFoundError';
  }
}

export class InvalidReservationStateError extends InventoryDomainError {
  constructor(orderId: string, currentStatus: string, action: string) {
    super(
      `Cannot ${action} reservation for order '${orderId}' because its status is already '${currentStatus}'`,
      400,
      'INVALID_RESERVATION_STATE',
    );
    this.name = 'InvalidReservationStateError';
  }
}

export class DuplicateReservationConflictError extends InventoryDomainError {
  constructor(orderId: string) {
    super(
      `An active stock reservation already exists for order '${orderId}'`,
      409,
      'DUPLICATE_RESERVATION_CONFLICT',
    );
    this.name = 'DuplicateReservationConflictError';
  }
}
