import type {
  PaymentRow,
  RefundRow,
  PaymentStatus,
  PaymentMethod,
  PaymentProvider,
  WebhookStatus,
} from '@grocery/database';

export interface CreatePaymentServiceParams {
  readonly storeId: string;
  readonly orderId: string;
  readonly paymentMethod: PaymentMethod;
  readonly provider: PaymentProvider;
  readonly amountCents?: number;
  readonly currency?: string;
  readonly idempotencyKey?: string | null;
}

export interface PaymentProviderAdapter {
  readonly provider: PaymentProvider;

  createOrder(
    storeId: string,
    amountCents: number,
    currency: string,
    receiptId: string,
  ): Promise<{ providerOrderId: string }>;

  verifyWebhookSignature(payload: string, signature: string, secret?: string): boolean;

  processRefund(
    providerPaymentId: string,
    amountCents: number,
    reason?: string,
  ): Promise<{ providerRefundId: string }>;
}

export interface OrderLookupClient {
  getOrder(
    storeId: string,
    orderId: string,
  ): Promise<{ id: string; totalAmountCents: number; status: string } | null>;
}

export interface WebhookProcessingResult {
  readonly handled: boolean;
  readonly eventId: string;
  readonly eventType: string;
  readonly status: WebhookStatus;
}

export interface PaymentService {
  initiatePayment(params: CreatePaymentServiceParams): Promise<PaymentRow>;

  getPayment(storeId: string, id: string): Promise<PaymentRow>;

  getPaymentByOrderId(storeId: string, orderId: string): Promise<PaymentRow | null>;

  handleWebhook(
    provider: PaymentProvider,
    rawBody: string,
    signature: string,
    storeId?: string,
  ): Promise<WebhookProcessingResult>;

  refundPayment(
    storeId: string,
    paymentId: string,
    amountCents?: number,
    reason?: string,
  ): Promise<RefundRow>;
}
