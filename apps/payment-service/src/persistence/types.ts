import type { Kysely, Transaction } from 'kysely';
import type {
  Database,
  PaymentRow,
  NewPayment,
  PaymentStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentWebhookRow,
  NewPaymentWebhook,
  WebhookStatus,
  RefundRow,
  NewRefund,
  RefundStatus,
} from '@grocery/database';

export type DatabaseConnection = Kysely<Database> | Transaction<Database>;

export interface CreatePaymentParams {
  readonly storeId: string;
  readonly orderId: string;
  readonly paymentMethod: PaymentMethod;
  readonly provider: PaymentProvider;
  readonly amountCents: number;
  readonly currency?: string;
  readonly providerOrderId?: string | null;
  readonly providerPaymentId?: string | null;
  readonly idempotencyKey?: string | null;
  readonly status?: PaymentStatus;
}

export interface CreateRefundParams {
  readonly storeId: string;
  readonly paymentId: string;
  readonly amountCents: number;
  readonly reason?: string | null;
  readonly providerRefundId?: string | null;
  readonly status?: RefundStatus;
}

export interface PaymentRepository {
  createPayment(params: CreatePaymentParams, trx?: DatabaseConnection): Promise<PaymentRow>;

  findById(storeId: string, id: string, trx?: DatabaseConnection): Promise<PaymentRow | null>;

  findByOrderId(
    storeId: string,
    orderId: string,
    trx?: DatabaseConnection,
  ): Promise<PaymentRow | null>;

  findByIdempotencyKey(
    storeId: string,
    idempotencyKey: string,
    trx?: DatabaseConnection,
  ): Promise<PaymentRow | null>;

  findByProviderPaymentId(
    provider: string,
    providerPaymentId: string,
    trx?: DatabaseConnection,
  ): Promise<PaymentRow | null>;

  updateStatus(
    storeId: string,
    id: string,
    status: PaymentStatus,
    providerPaymentId?: string | null,
    trx?: DatabaseConnection,
  ): Promise<PaymentRow | null>;

  createRefund(params: CreateRefundParams, trx?: DatabaseConnection): Promise<RefundRow>;

  listRefundsByPayment(
    storeId: string,
    paymentId: string,
    trx?: DatabaseConnection,
  ): Promise<RefundRow[]>;
}

export interface PaymentWebhookRepository {
  recordWebhook(
    webhook: {
      storeId: string;
      provider: string;
      eventId: string;
      eventType: string;
      payload: unknown;
      signature: string;
    },
    trx?: DatabaseConnection,
  ): Promise<PaymentWebhookRow>;

  findWebhook(
    provider: string,
    eventId: string,
    trx?: DatabaseConnection,
  ): Promise<PaymentWebhookRow | null>;

  markProcessed(
    id: string,
    status: WebhookStatus,
    trx?: DatabaseConnection,
  ): Promise<PaymentWebhookRow | null>;
}
