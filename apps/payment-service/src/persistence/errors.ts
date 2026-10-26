import { sanitizeErrorMessage } from '@grocery/observability';

export class PaymentPersistenceError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'PAYMENT_PERSISTENCE_ERROR') {
    const sanitized = sanitizeErrorMessage(message);
    super(sanitized);
    this.name = 'PaymentPersistenceError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PaymentPersistenceNotFoundError extends PaymentPersistenceError {
  constructor(paymentId: string) {
    super(`Payment '${paymentId}' not found`, 'PAYMENT_NOT_FOUND');
    this.name = 'PaymentPersistenceNotFoundError';
  }
}

export class DuplicatePaymentIdempotencyError extends PaymentPersistenceError {
  constructor(idempotencyKey: string) {
    super(
      `A payment with idempotency key '${idempotencyKey}' already exists in this store`,
      'DUPLICATE_IDEMPOTENCY_KEY',
    );
    this.name = 'DuplicatePaymentIdempotencyError';
  }
}

export class DuplicateWebhookEventError extends PaymentPersistenceError {
  constructor(provider: string, eventId: string) {
    super(
      `Webhook event '${eventId}' from provider '${provider}' has already been recorded`,
      'DUPLICATE_WEBHOOK_EVENT',
    );
    this.name = 'DuplicateWebhookEventError';
  }
}

interface PostgresLikeError {
  code?: string;
  constraint?: string;
  message?: string;
  detail?: string;
}

export function mapPaymentDatabaseError(err: unknown, defaultMessage: string): Error {
  if (err instanceof PaymentPersistenceError) {
    return err;
  }

  const pgErr = err as PostgresLikeError | null | undefined;
  if (pgErr && typeof pgErr.code === 'string') {
    if (pgErr.code === '23505') {
      const constraint = pgErr.constraint ?? '';
      if (constraint.includes('idempotency')) {
        return new DuplicatePaymentIdempotencyError('duplicate');
      }
      if (constraint.includes('provider_event_id') || constraint.includes('webhook')) {
        return new DuplicateWebhookEventError('provider', 'event');
      }
    }
  }

  const baseMessage = err instanceof Error ? err.message : String(err);
  return new PaymentPersistenceError(`${defaultMessage}: ${baseMessage}`);
}
