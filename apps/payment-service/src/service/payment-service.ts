import type {
  PaymentRow,
  RefundRow,
  PaymentProvider,
  WebhookStatus,
  PaymentStatus,
} from '@grocery/database';
import type { PaymentRepository, PaymentWebhookRepository } from '../persistence/types.js';
import type {
  PaymentService,
  PaymentProviderAdapter,
  OrderLookupClient,
  CreatePaymentServiceParams,
  WebhookProcessingResult,
} from './types.js';
import {
  PaymentNotFoundError,
  OrderNotPayableError,
  InvalidPaymentStatusError,
  WebhookSignatureVerificationError,
  RefundExceedsAmountError,
} from './errors.js';
import { MockPaymentProviderAdapter } from './adapters/mock-adapter.js';
import { RazorpayPaymentProviderAdapter } from './adapters/razorpay-adapter.js';

export class DefaultPaymentService implements PaymentService {
  private readonly adapters: Map<PaymentProvider, PaymentProviderAdapter>;

  constructor(
    private readonly paymentRepo: PaymentRepository,
    private readonly webhookRepo: PaymentWebhookRepository,
    adapters?: readonly PaymentProviderAdapter[],
    private readonly orderClient?: OrderLookupClient,
    private readonly defaultWebhookSecret?: string,
  ) {
    this.adapters = new Map();

    // Register provided adapters or sensible defaults
    if (adapters && adapters.length > 0) {
      for (const adapter of adapters) {
        this.adapters.set(adapter.provider, adapter);
      }
    } else {
      this.adapters.set('MOCK', new MockPaymentProviderAdapter());
      this.adapters.set('RAZORPAY', new RazorpayPaymentProviderAdapter());
    }
  }

  async initiatePayment(params: CreatePaymentServiceParams): Promise<PaymentRow> {
    let amountCents = params.amountCents;

    if (this.orderClient) {
      const order = await this.orderClient.getOrder(params.storeId, params.orderId);
      if (!order) {
        throw new OrderNotPayableError(params.orderId, 'Order was not found');
      }

      const payableStatuses = ['CONFIRMED', 'PROCESSING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'];
      if (!payableStatuses.includes(order.status)) {
        throw new OrderNotPayableError(
          params.orderId,
          `Cannot pay for order in status '${order.status}'. Order must be confirmed by shopkeeper first.`,
        );
      }

      if (amountCents === undefined) {
        amountCents = order.totalAmountCents;
      }
    }

    if (!amountCents || amountCents <= 0) {
      throw new OrderNotPayableError(params.orderId, 'Payment amount must be strictly positive');
    }

    const adapter = this.adapters.get(params.provider) ?? new MockPaymentProviderAdapter();
    const { providerOrderId } = await adapter.createOrder(
      params.storeId,
      amountCents,
      params.currency ?? 'INR',
      params.orderId,
    );

    return this.paymentRepo.createPayment({
      storeId: params.storeId,
      orderId: params.orderId,
      paymentMethod: params.paymentMethod,
      provider: params.provider,
      amountCents,
      currency: params.currency ?? 'INR',
      providerOrderId,
      idempotencyKey: params.idempotencyKey ?? null,
      status: 'PENDING',
    });
  }

  async getPayment(storeId: string, id: string): Promise<PaymentRow> {
    const payment = await this.paymentRepo.findById(storeId, id);
    if (!payment) {
      throw new PaymentNotFoundError(id);
    }
    return payment;
  }

  async getPaymentByOrderId(storeId: string, orderId: string): Promise<PaymentRow | null> {
    return this.paymentRepo.findByOrderId(storeId, orderId);
  }

  async handleWebhook(
    provider: PaymentProvider,
    rawBody: string,
    signature: string,
    storeId?: string,
  ): Promise<WebhookProcessingResult> {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new WebhookSignatureVerificationError(provider);
    }

    const isValid = adapter.verifyWebhookSignature(rawBody, signature, this.defaultWebhookSecret);

    if (!isValid) {
      throw new WebhookSignatureVerificationError(provider);
    }

    let payload: Record<string, any>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = {};
    }

    // Extract event details
    const eventId = String(
      payload.id ?? payload.eventId ?? payload.event_id ?? `evt_${Date.now()}`,
    );
    const eventType = String(
      payload.event ?? payload.eventType ?? payload.type ?? 'payment.unknown',
    );

    // Deduplication check per ADR-008 §4
    const existing = await this.webhookRepo.findWebhook(provider, eventId);
    if (existing) {
      return {
        handled: true,
        eventId,
        eventType,
        status: 'IGNORED',
      };
    }

    const effectiveStoreId = storeId ?? payload.storeId ?? '00000000-0000-4000-8000-000000000001';

    const recordedWebhook = await this.webhookRepo.recordWebhook({
      storeId: effectiveStoreId,
      provider,
      eventId,
      eventType,
      payload,
      signature,
    });

    // Check if event maps to a payment transition
    let targetStatus: PaymentStatus | null = null;
    let providerPaymentId: string | null = null;
    let providerOrderId: string | null = null;

    if (
      eventType === 'payment.captured' ||
      eventType === 'payment_intent.succeeded' ||
      eventType === 'PAYMENT_SUCCESS'
    ) {
      targetStatus = 'SUCCEEDED';
      providerPaymentId =
        payload.payload?.payment?.entity?.id ??
        payload.data?.object?.id ??
        payload.providerPaymentId ??
        null;
      providerOrderId =
        payload.payload?.payment?.entity?.order_id ??
        payload.data?.object?.order_id ??
        payload.providerOrderId ??
        null;
    } else if (
      eventType === 'payment.failed' ||
      eventType === 'payment_intent.payment_failed' ||
      eventType === 'PAYMENT_FAILED'
    ) {
      targetStatus = 'FAILED';
      providerPaymentId =
        payload.payload?.payment?.entity?.id ??
        payload.data?.object?.id ??
        payload.providerPaymentId ??
        null;
    }

    if (targetStatus && (providerPaymentId || providerOrderId)) {
      let payment: PaymentRow | null = null;
      if (providerPaymentId) {
        payment = await this.paymentRepo.findByProviderPaymentId(provider, providerPaymentId);
      }
      if (!payment && providerOrderId) {
        // Look up by order id
        payment = await this.paymentRepo.findByOrderId(effectiveStoreId, providerOrderId);
      }

      if (payment && payment.status !== 'SUCCEEDED' && payment.status !== 'REFUNDED') {
        if (targetStatus === 'SUCCEEDED' && this.orderClient && payment.order_id) {
          try {
            const order = await this.orderClient.getOrder(payment.store_id, payment.order_id);
            if (order && (order.status === 'CANCELLED' || order.status === 'REJECTED')) {
              await this.paymentRepo.updateStatus(
                payment.store_id,
                payment.id,
                'SUCCEEDED',
                providerPaymentId,
              );
              await this.refundPayment(
                payment.store_id,
                payment.id,
                Number(payment.amount_cents),
                'Automatic refund: late payment received for cancelled/expired order',
              );
              await this.webhookRepo.markProcessed(recordedWebhook.id, 'PROCESSED');
              return {
                handled: true,
                eventId,
                eventType,
                status: 'PROCESSED',
              };
            }
          } catch {
            // If order lookup fails, proceed with standard status update
          }
        }

        await this.paymentRepo.updateStatus(
          payment.store_id,
          payment.id,
          targetStatus,
          providerPaymentId,
        );
      }
    }

    await this.webhookRepo.markProcessed(recordedWebhook.id, 'PROCESSED');

    return {
      handled: true,
      eventId,
      eventType,
      status: 'PROCESSED',
    };
  }

  async refundPayment(
    storeId: string,
    paymentId: string,
    amountCents?: number,
    reason?: string,
  ): Promise<RefundRow> {
    const payment = await this.getPayment(storeId, paymentId);

    if (payment.status !== 'SUCCEEDED') {
      throw new InvalidPaymentStatusError(paymentId, payment.status, 'refund');
    }

    const existingRefunds = await this.paymentRepo.listRefundsByPayment(storeId, paymentId);
    const totalRefundedSoFar = existingRefunds
      .filter((r) => r.status === 'SUCCEEDED')
      .reduce((acc, r) => acc + Number(r.amount_cents), 0);

    const remainingRefundable = Number(payment.amount_cents) - totalRefundedSoFar;
    const requestedRefundCents = amountCents !== undefined ? amountCents : remainingRefundable;

    if (requestedRefundCents <= 0 || requestedRefundCents > remainingRefundable) {
      throw new RefundExceedsAmountError(paymentId, requestedRefundCents, remainingRefundable);
    }

    const adapter = this.adapters.get(payment.provider) ?? new MockPaymentProviderAdapter();
    const { providerRefundId } = await adapter.processRefund(
      payment.provider_payment_id ?? payment.id,
      requestedRefundCents,
      reason,
    );

    const refund = await this.paymentRepo.createRefund({
      storeId,
      paymentId,
      amountCents: requestedRefundCents,
      reason: reason ?? null,
      providerRefundId,
      status: 'SUCCEEDED',
    });

    if (totalRefundedSoFar + requestedRefundCents >= Number(payment.amount_cents)) {
      await this.paymentRepo.updateStatus(storeId, paymentId, 'REFUNDED');
    }

    return refund;
  }
}

export function createPaymentServiceInstance(
  paymentRepo: PaymentRepository,
  webhookRepo: PaymentWebhookRepository,
  adapters?: readonly PaymentProviderAdapter[],
  orderClient?: OrderLookupClient,
  defaultWebhookSecret?: string,
): PaymentService {
  return new DefaultPaymentService(
    paymentRepo,
    webhookRepo,
    adapters,
    orderClient,
    defaultWebhookSecret,
  );
}
