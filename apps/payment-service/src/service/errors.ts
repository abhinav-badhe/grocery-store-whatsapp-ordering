import { sanitizeErrorMessage } from '@grocery/observability';

export class PaymentDomainError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 400, code = 'PAYMENT_DOMAIN_ERROR') {
    const sanitized = sanitizeErrorMessage(message);
    super(sanitized);
    this.name = 'PaymentDomainError';
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

export class PaymentNotFoundError extends PaymentDomainError {
  constructor(paymentId: string) {
    super(`Payment '${paymentId}' was not found in the current store`, 404, 'PAYMENT_NOT_FOUND');
    this.name = 'PaymentNotFoundError';
  }
}

export class OrderNotPayableError extends PaymentDomainError {
  constructor(orderId: string, reason: string) {
    super(`Order '${orderId}' cannot be paid: ${reason}`, 400, 'ORDER_NOT_PAYABLE');
    this.name = 'OrderNotPayableError';
  }
}

export class InvalidPaymentStatusError extends PaymentDomainError {
  constructor(paymentId: string, currentStatus: string, action: string) {
    super(
      `Cannot ${action} payment '${paymentId}' because its status is '${currentStatus}'`,
      400,
      'INVALID_PAYMENT_STATUS',
    );
    this.name = 'InvalidPaymentStatusError';
  }
}

export class WebhookSignatureVerificationError extends PaymentDomainError {
  constructor(provider: string) {
    super(
      `Webhook signature verification failed for provider '${provider}'`,
      401,
      'INVALID_WEBHOOK_SIGNATURE',
    );
    this.name = 'WebhookSignatureVerificationError';
  }
}

export class RefundExceedsAmountError extends PaymentDomainError {
  constructor(paymentId: string, requestedCents: number, remainingCents: number) {
    super(
      `Refund amount (${requestedCents} cents) exceeds refundable balance (${remainingCents} cents) for payment '${paymentId}'`,
      400,
      'REFUND_EXCEEDS_AMOUNT',
    );
    this.name = 'RefundExceedsAmountError';
  }
}
