import { sanitizeErrorMessage } from '@grocery/observability';

export class OrderDomainError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 400, code = 'ORDER_DOMAIN_ERROR') {
    const sanitized = sanitizeErrorMessage(message);
    super(sanitized);
    this.name = 'OrderDomainError';
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

export class OrderNotFoundError extends OrderDomainError {
  constructor(orderId: string) {
    super(`Order '${orderId}' was not found in the current store`, 404, 'ORDER_NOT_FOUND');
    this.name = 'OrderNotFoundError';
  }
}

export class OrderItemNotFoundError extends OrderDomainError {
  constructor(itemId: string, orderId: string) {
    super(`Item '${itemId}' was not found in order '${orderId}'`, 404, 'ORDER_ITEM_NOT_FOUND');
    this.name = 'OrderItemNotFoundError';
  }
}

export class InvalidOrderStateTransitionError extends OrderDomainError {
  constructor(orderId: string, currentStatus: string, targetStatus: string) {
    super(
      `Cannot transition order '${orderId}' from '${currentStatus}' to '${targetStatus}'`,
      409,
      'INVALID_ORDER_STATE_TRANSITION',
    );
    this.name = 'InvalidOrderStateTransitionError';
  }
}

export class OrderAlreadyConfirmedError extends OrderDomainError {
  constructor(orderId: string, currentStatus: string) {
    super(
      `Order '${orderId}' cannot be confirmed because its current status is '${currentStatus}'`,
      409,
      'ORDER_ALREADY_CONFIRMED',
    );
    this.name = 'OrderAlreadyConfirmedError';
  }
}

export class InventoryReservationFailedError extends OrderDomainError {
  constructor(orderId: string, reason?: string) {
    super(
      `Inventory reservation failed for order '${orderId}'${reason ? `: ${reason}` : ''}`,
      409,
      'INVENTORY_RESERVATION_FAILED',
    );
    this.name = 'InventoryReservationFailedError';
  }
}

export class ItemSubstitutionError extends OrderDomainError {
  constructor(orderId: string, reason: string) {
    super(
      `Item substitution failed for order '${orderId}': ${reason}`,
      400,
      'ITEM_SUBSTITUTION_ERROR',
    );
    this.name = 'ItemSubstitutionError';
  }
}
