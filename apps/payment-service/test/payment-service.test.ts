import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import crypto from 'node:crypto';
import type { PaymentRow, PaymentWebhookRow, RefundRow, PaymentStatus } from '@grocery/database';
import {
  createPaymentServiceInstance,
  PaymentNotFoundError,
  OrderNotPayableError,
  InvalidPaymentStatusError,
  WebhookSignatureVerificationError,
  RefundExceedsAmountError,
  MockPaymentProviderAdapter,
  type PaymentRepository,
  type PaymentWebhookRepository,
  type OrderLookupClient,
} from '../dist/index.js';

const STORE_ID = '00000000-0000-4000-8000-000000000001';
const PAYMENT_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const REFUND_ID = '33333333-3333-4333-8333-333333333333';
const WEBHOOK_ID = '44444444-4444-4444-8444-444444444444';
const WEBHOOK_SECRET = 'test_webhook_signing_secret_32bytes';

function createMockPayment(amountCents = 10000, status: PaymentStatus = 'SUCCEEDED'): PaymentRow {
  return {
    id: PAYMENT_ID,
    store_id: STORE_ID,
    order_id: ORDER_ID,
    payment_method: 'UPI',
    provider: 'MOCK',
    provider_order_id: 'mock_ord_1',
    provider_payment_id: 'mock_pay_1',
    amount_cents: amountCents,
    currency: 'INR',
    status,
    idempotency_key: null,
    created_at: new Date('2026-10-25T10:00:00Z'),
    updated_at: new Date('2026-10-25T10:00:00Z'),
  };
}

describe('Payment Service Domain Logic & Webhook Lifecycle', () => {
  it('initiates payment: verifies order and generates provider order id', async () => {
    let capturedParams: any;
    const mockPaymentRepo: PaymentRepository = {
      createPayment: async (params) => {
        capturedParams = params;
        return createMockPayment(params.amountCents, 'PENDING');
      },
      findById: async () => null,
      findByOrderId: async () => null,
      findByIdempotencyKey: async () => null,
      findByProviderPaymentId: async () => null,
      updateStatus: async () => null,
      createRefund: async () => ({}) as RefundRow,
      listRefundsByPayment: async () => [],
    };

    const mockWebhookRepo: PaymentWebhookRepository = {
      recordWebhook: async () => ({}) as PaymentWebhookRow,
      findWebhook: async () => null,
      markProcessed: async () => null,
    };

    const mockOrderClient: OrderLookupClient = {
      getOrder: async (_storeId, orderId) => ({
        id: orderId,
        totalAmountCents: 15000,
        status: 'CONFIRMED',
      }),
    };

    const service = createPaymentServiceInstance(
      mockPaymentRepo,
      mockWebhookRepo,
      undefined,
      mockOrderClient,
    );

    const payment = await service.initiatePayment({
      storeId: STORE_ID,
      orderId: ORDER_ID,
      paymentMethod: 'UPI',
      provider: 'MOCK',
    });

    assert.equal(payment.status, 'PENDING');
    assert.equal(capturedParams.amountCents, 15000);
    assert.ok(capturedParams.providerOrderId.startsWith('mock_ord_'));
  });

  it('rejects payment initiation for cancelled or non-payable orders', async () => {
    const mockPaymentRepo: PaymentRepository = {
      createPayment: async () => createMockPayment(),
      findById: async () => null,
      findByOrderId: async () => null,
      findByIdempotencyKey: async () => null,
      findByProviderPaymentId: async () => null,
      updateStatus: async () => null,
      createRefund: async () => ({}) as RefundRow,
      listRefundsByPayment: async () => [],
    };

    const mockWebhookRepo: PaymentWebhookRepository = {
      recordWebhook: async () => ({}) as PaymentWebhookRow,
      findWebhook: async () => null,
      markProcessed: async () => null,
    };

    const mockOrderClient: OrderLookupClient = {
      getOrder: async () => ({
        id: ORDER_ID,
        totalAmountCents: 10000,
        status: 'CANCELLED',
      }),
    };

    const service = createPaymentServiceInstance(
      mockPaymentRepo,
      mockWebhookRepo,
      undefined,
      mockOrderClient,
    );

    await assert.rejects(
      async () =>
        service.initiatePayment({
          storeId: STORE_ID,
          orderId: ORDER_ID,
          paymentMethod: 'UPI',
          provider: 'MOCK',
        }),
      (err: unknown) => err instanceof OrderNotPayableError,
    );
  });

  it('handles webhook: verifies signature, deduplicates, and transitions payment', async () => {
    let paymentState = createMockPayment(10000, 'PENDING');
    let webhookMarkedProcessed = false;

    const mockPaymentRepo: PaymentRepository = {
      createPayment: async () => paymentState,
      findById: async () => paymentState,
      findByOrderId: async () => paymentState,
      findByIdempotencyKey: async () => null,
      findByProviderPaymentId: async () => paymentState,
      updateStatus: async (_storeId, _id, status, providerPaymentId) => {
        paymentState = { ...paymentState, status, provider_payment_id: providerPaymentId ?? null };
        return paymentState;
      },
      createRefund: async () => ({}) as RefundRow,
      listRefundsByPayment: async () => [],
    };

    const recordedWebhooks: PaymentWebhookRow[] = [];
    const mockWebhookRepo: PaymentWebhookRepository = {
      recordWebhook: async (webhook) => {
        const row: PaymentWebhookRow = {
          id: WEBHOOK_ID,
          store_id: webhook.storeId,
          provider: webhook.provider,
          event_id: webhook.eventId,
          event_type: webhook.eventType,
          payload: webhook.payload,
          signature: webhook.signature,
          status: 'RECEIVED',
          processed_at: null,
          created_at: new Date(),
        };
        recordedWebhooks.push(row);
        return row;
      },
      findWebhook: async (_provider, eventId) => {
        return recordedWebhooks.find((w) => w.event_id === eventId) ?? null;
      },
      markProcessed: async () => {
        webhookMarkedProcessed = true;
        return null;
      },
    };

    const adapter = new MockPaymentProviderAdapter();
    const service = createPaymentServiceInstance(
      mockPaymentRepo,
      mockWebhookRepo,
      [adapter],
      undefined,
      WEBHOOK_SECRET,
    );

    const payload = JSON.stringify({
      eventId: 'evt_001',
      eventType: 'payment.captured',
      providerPaymentId: 'pay_capture_abc',
      providerOrderId: 'mock_ord_1',
    });

    const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');

    // 1. Process valid webhook
    const result1 = await service.handleWebhook('MOCK', payload, signature, STORE_ID);
    assert.equal(result1.handled, true);
    assert.equal(result1.status, 'PROCESSED');
    assert.equal(paymentState.status, 'SUCCEEDED');
    assert.equal(paymentState.provider_payment_id, 'pay_capture_abc');
    assert.ok(webhookMarkedProcessed);

    // 2. Duplicate presentation returns IGNORED without re-processing (idempotent)
    const result2 = await service.handleWebhook('MOCK', payload, signature, STORE_ID);
    assert.equal(result2.status, 'IGNORED');

    // 3. Invalid signature throws WebhookSignatureVerificationError
    await assert.rejects(
      async () => service.handleWebhook('MOCK', payload, 'tampered_signature', STORE_ID),
      (err: unknown) => err instanceof WebhookSignatureVerificationError,
    );
  });

  it('executes refund: verifies amount constraints, calls adapter, and updates status', async () => {
    let paymentState = createMockPayment(10000, 'SUCCEEDED');
    const refundsList: RefundRow[] = [];

    const mockPaymentRepo: PaymentRepository = {
      createPayment: async () => paymentState,
      findById: async () => paymentState,
      findByOrderId: async () => paymentState,
      findByIdempotencyKey: async () => null,
      findByProviderPaymentId: async () => null,
      updateStatus: async (_storeId, _id, status) => {
        paymentState = { ...paymentState, status };
        return paymentState;
      },
      createRefund: async (params) => {
        const row: RefundRow = {
          id: REFUND_ID,
          payment_id: params.paymentId,
          store_id: params.storeId,
          amount_cents: params.amountCents,
          reason: params.reason ?? null,
          provider_refund_id: params.providerRefundId ?? null,
          status: params.status ?? 'PENDING',
          created_at: new Date(),
          updated_at: new Date(),
        };
        refundsList.push(row);
        return row;
      },
      listRefundsByPayment: async () => refundsList,
    };

    const mockWebhookRepo: PaymentWebhookRepository = {
      recordWebhook: async () => ({}) as PaymentWebhookRow,
      findWebhook: async () => null,
      markProcessed: async () => null,
    };

    const service = createPaymentServiceInstance(mockPaymentRepo, mockWebhookRepo);

    // Partial refund (4000 cents)
    const refund1 = await service.refundPayment(STORE_ID, PAYMENT_ID, 4000, 'Defective item');
    assert.equal(refund1.amount_cents, 4000);
    assert.equal(paymentState.status, 'SUCCEEDED'); // Still partially unrefunded

    // Exceeding remaining refund (7000 cents > 6000 cents remaining) throws RefundExceedsAmountError
    await assert.rejects(
      async () => service.refundPayment(STORE_ID, PAYMENT_ID, 7000),
      (err: unknown) => err instanceof RefundExceedsAmountError,
    );

    // Full refund of remaining 6000 cents transitions payment to REFUNDED
    const refund2 = await service.refundPayment(STORE_ID, PAYMENT_ID, 6000, 'Remainder');
    assert.equal(refund2.amount_cents, 6000);
    assert.equal(paymentState.status, 'REFUNDED');
  });

  it('rejects refund if payment is not in SUCCEEDED status', async () => {
    const paymentState = createMockPayment(10000, 'PENDING');

    const mockPaymentRepo: PaymentRepository = {
      createPayment: async () => paymentState,
      findById: async () => paymentState,
      findByOrderId: async () => paymentState,
      findByIdempotencyKey: async () => null,
      findByProviderPaymentId: async () => null,
      updateStatus: async () => null,
      createRefund: async () => ({}) as RefundRow,
      listRefundsByPayment: async () => [],
    };

    const mockWebhookRepo: PaymentWebhookRepository = {
      recordWebhook: async () => ({}) as PaymentWebhookRow,
      findWebhook: async () => null,
      markProcessed: async () => null,
    };

    const service = createPaymentServiceInstance(mockPaymentRepo, mockWebhookRepo);

    await assert.rejects(
      async () => service.refundPayment(STORE_ID, PAYMENT_ID, 1000),
      (err: unknown) => err instanceof InvalidPaymentStatusError,
    );
  });

  it('rejects payment initiation if order is in AWAITING_SHOPKEEPER_REVIEW', async () => {
    const mockPaymentRepo: PaymentRepository = {
      createPayment: async () => createMockPayment(),
      findById: async () => null,
      findByOrderId: async () => null,
      findByIdempotencyKey: async () => null,
      findByProviderPaymentId: async () => null,
      updateStatus: async () => null,
      createRefund: async () => ({}) as RefundRow,
      listRefundsByPayment: async () => [],
    };

    const mockWebhookRepo: PaymentWebhookRepository = {
      recordWebhook: async () => ({}) as PaymentWebhookRow,
      findWebhook: async () => null,
      markProcessed: async () => null,
    };

    const mockOrderClient: OrderLookupClient = {
      getOrder: async () => ({
        id: ORDER_ID,
        totalAmountCents: 10000,
        status: 'AWAITING_SHOPKEEPER_REVIEW',
      }),
    };

    const service = createPaymentServiceInstance(
      mockPaymentRepo,
      mockWebhookRepo,
      undefined,
      mockOrderClient,
    );

    await assert.rejects(
      async () =>
        service.initiatePayment({
          storeId: STORE_ID,
          orderId: ORDER_ID,
          paymentMethod: 'UPI',
          provider: 'MOCK',
        }),
      (err: unknown) => err instanceof OrderNotPayableError,
    );
  });

  it('automatically refunds late payment webhook when order was cancelled/expired', async () => {
    let paymentState = createMockPayment(10000, 'PENDING');
    let refundCreated = false;
    let refundedAmount = 0;

    const mockPaymentRepo: PaymentRepository = {
      createPayment: async () => paymentState,
      findById: async () => paymentState,
      findByOrderId: async () => paymentState,
      findByIdempotencyKey: async () => null,
      findByProviderPaymentId: async () => paymentState,
      updateStatus: async (_storeId, _id, status) => {
        paymentState = { ...paymentState, status };
        return paymentState;
      },
      createRefund: async (params) => {
        refundCreated = true;
        refundedAmount = params.amountCents;
        return {
          id: REFUND_ID,
          store_id: params.storeId,
          payment_id: params.paymentId,
          amount_cents: params.amountCents,
          reason: params.reason ?? null,
          provider_refund_id: 'ref_late_123',
          status: 'SUCCEEDED',
          created_at: new Date(),
          updated_at: new Date(),
        };
      },
      listRefundsByPayment: async () => [],
    };

    const mockWebhookRepo: PaymentWebhookRepository = {
      recordWebhook: async (webhook) => ({
        id: WEBHOOK_ID,
        store_id: webhook.storeId,
        provider: webhook.provider,
        event_id: webhook.eventId,
        event_type: webhook.eventType,
        payload: webhook.payload,
        signature: webhook.signature,
        status: 'RECEIVED',
        processed_at: null,
        created_at: new Date(),
      }),
      findWebhook: async () => null,
      markProcessed: async () => null,
    };

    // Order was CANCELLED due to reservation timeout
    const mockOrderClient: OrderLookupClient = {
      getOrder: async () => ({
        id: ORDER_ID,
        totalAmountCents: 10000,
        status: 'CANCELLED',
      }),
    };

    const service = createPaymentServiceInstance(
      mockPaymentRepo,
      mockWebhookRepo,
      undefined,
      mockOrderClient,
      WEBHOOK_SECRET,
    );

    const webhookPayload = JSON.stringify({
      id: 'evt_late_123',
      event: 'PAYMENT_SUCCESS',
      providerPaymentId: 'mock_pay_late',
      storeId: STORE_ID,
    });

    const signature = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(webhookPayload)
      .digest('hex');

    const result = await service.handleWebhook('MOCK', webhookPayload, signature, STORE_ID);

    assert.equal(result.handled, true);
    assert.equal(result.status, 'PROCESSED');
    assert.equal(refundCreated, true);
    assert.equal(refundedAmount, 10000);
    assert.equal(paymentState.status, 'REFUNDED');
  });
});
