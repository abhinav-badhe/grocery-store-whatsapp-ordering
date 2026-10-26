import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import crypto from 'node:crypto';
import type { PaymentRow, PaymentWebhookRow, RefundRow, PaymentStatus } from '@grocery/database';
import { mintInternalToken } from '@grocery/service-runtime';
import {
  createPaymentService,
  createPaymentServiceInstance,
  MockPaymentProviderAdapter,
  type PaymentRepository,
  type PaymentWebhookRepository,
} from '../dist/index.js';

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const PAYMENT_ID = '77777777-7777-4777-8777-777777777777';
const ORDER_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEST_SECRET = 'super-secret-internal-payment-token-key-32chars';
const WEBHOOK_SECRET = 'mock_webhook_secret';

function createMockPayment(status: PaymentStatus = 'SUCCEEDED'): PaymentRow {
  return {
    id: PAYMENT_ID,
    store_id: STORE_ID,
    order_id: ORDER_ID,
    payment_method: 'UPI',
    provider: 'MOCK',
    provider_order_id: 'mock_ord_123',
    provider_payment_id: 'mock_pay_123',
    amount_cents: 12000,
    currency: 'INR',
    status,
    idempotency_key: null,
    created_at: new Date('2026-10-25T10:00:00Z'),
    updated_at: new Date('2026-10-25T10:00:00Z'),
  };
}

describe('Payment Service HTTP Ingress API', () => {
  it('initiates payment via POST /api/v1/payments', async () => {
    const mockPaymentRepo: PaymentRepository = {
      createPayment: async () => createMockPayment('PENDING'),
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

    const paymentService = createPaymentServiceInstance(mockPaymentRepo, mockWebhookRepo);
    const server = createPaymentService({ port: 0, paymentService });
    const { port } = await server.start();

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-store-id': STORE_ID,
        },
        body: JSON.stringify({
          orderId: ORDER_ID,
          paymentMethod: 'UPI',
          provider: 'MOCK',
          amountCents: 12000,
        }),
      });

      assert.equal(response.status, 201);
      const json = (await response.json()) as {
        payment: { id: string; status: string; amountCents: number };
      };
      assert.equal(json.payment.id, PAYMENT_ID);
      assert.equal(json.payment.amountCents, 12000);
    } finally {
      await server.stop();
    }
  });

  it('retrieves payment details via GET /api/v1/payments/:id', async () => {
    const mockPaymentRepo: PaymentRepository = {
      createPayment: async () => createMockPayment(),
      findById: async (_storeId, id) => (id === PAYMENT_ID ? createMockPayment() : null),
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

    const paymentService = createPaymentServiceInstance(mockPaymentRepo, mockWebhookRepo);
    const server = createPaymentService({ port: 0, paymentService });
    const { port } = await server.start();

    try {
      const foundRes = await fetch(`http://127.0.0.1:${port}/api/v1/payments/${PAYMENT_ID}`, {
        headers: { 'x-store-id': STORE_ID },
      });
      assert.equal(foundRes.status, 200);
      const foundJson = (await foundRes.json()) as { payment: { id: string } };
      assert.equal(foundJson.payment.id, PAYMENT_ID);

      const notFoundRes = await fetch(
        `http://127.0.0.1:${port}/api/v1/payments/00000000-0000-4000-8000-000000000099`,
        {
          headers: { 'x-store-id': STORE_ID },
        },
      );
      assert.equal(notFoundRes.status, 404);
    } finally {
      await server.stop();
    }
  });

  it('retrieves payment by orderId via GET /api/v1/payments/order/:orderId', async () => {
    const mockPaymentRepo: PaymentRepository = {
      createPayment: async () => createMockPayment(),
      findById: async () => null,
      findByOrderId: async (_storeId, orderId) =>
        orderId === ORDER_ID ? createMockPayment() : null,
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

    const paymentService = createPaymentServiceInstance(mockPaymentRepo, mockWebhookRepo);
    const server = createPaymentService({ port: 0, paymentService });
    const { port } = await server.start();

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/payments/order/${ORDER_ID}`, {
        headers: { 'x-store-id': STORE_ID },
      });
      assert.equal(response.status, 200);
      const json = (await response.json()) as { payment: { orderId: string } };
      assert.equal(json.payment.orderId, ORDER_ID);
    } finally {
      await server.stop();
    }
  });

  it('processes refunds via POST /api/v1/payments/:id/refund', async () => {
    const mockPaymentRow = createMockPayment('SUCCEEDED');
    const mockRefundRow: RefundRow = {
      id: '88888888-8888-4888-8888-888888888888',
      payment_id: PAYMENT_ID,
      store_id: STORE_ID,
      amount_cents: 5000,
      reason: 'Returned item',
      provider_refund_id: 'mock_rfnd_123',
      status: 'SUCCEEDED',
      created_at: new Date(),
      updated_at: new Date(),
    };

    const mockPaymentRepo: PaymentRepository = {
      createPayment: async () => mockPaymentRow,
      findById: async () => mockPaymentRow,
      findByOrderId: async () => null,
      findByIdempotencyKey: async () => null,
      findByProviderPaymentId: async () => null,
      updateStatus: async () => null,
      createRefund: async () => mockRefundRow,
      listRefundsByPayment: async () => [],
    };

    const mockWebhookRepo: PaymentWebhookRepository = {
      recordWebhook: async () => ({}) as PaymentWebhookRow,
      findWebhook: async () => null,
      markProcessed: async () => null,
    };

    const paymentService = createPaymentServiceInstance(mockPaymentRepo, mockWebhookRepo);
    const server = createPaymentService({ port: 0, paymentService });
    const { port } = await server.start();

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/v1/payments/${PAYMENT_ID}/refund`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-store-id': STORE_ID,
          },
          body: JSON.stringify({
            amountCents: 5000,
            reason: 'Returned item',
          }),
        },
      );

      assert.equal(response.status, 200);
      const json = (await response.json()) as { refund: { id: string; amountCents: number } };
      assert.equal(json.refund.id, mockRefundRow.id);
      assert.equal(json.refund.amountCents, 5000);
    } finally {
      await server.stop();
    }
  });

  it('handles external webhook ingestion publicly via POST /api/v1/payments/webhooks/:provider', async () => {
    let capturedWebhook: any;
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
      recordWebhook: async (webhook) => {
        capturedWebhook = webhook;
        return {
          id: '55555555-5555-4555-8555-555555555555',
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
      },
      findWebhook: async () => null,
      markProcessed: async () => null,
    };

    const paymentService = createPaymentServiceInstance(
      mockPaymentRepo,
      mockWebhookRepo,
      [new MockPaymentProviderAdapter()],
      undefined,
      WEBHOOK_SECRET,
    );

    // Note: server configured with internalTokenSecret, but webhook route MUST remain public
    const server = createPaymentService({
      port: 0,
      paymentService,
      internalTokenSecret: TEST_SECRET,
    });
    const { port } = await server.start();

    try {
      const payload = JSON.stringify({
        eventId: 'evt_webhook_001',
        eventType: 'payment.captured',
        providerPaymentId: 'pay_capture_123',
      });

      const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');

      const response = await fetch(`http://127.0.0.1:${port}/api/v1/payments/webhooks/mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-payment-signature': signature,
        },
        body: payload,
      });

      assert.equal(response.status, 200);
      const json = (await response.json()) as { handled: boolean; eventId: string; status: string };
      assert.equal(json.handled, true);
      assert.equal(json.eventId, 'evt_webhook_001');
      assert.equal(json.status, 'PROCESSED');
      assert.ok(capturedWebhook);
    } finally {
      await server.stop();
    }
  });

  it('protects internal endpoints with X-Internal-Token when secret is configured', async () => {
    const mockPaymentRepo: PaymentRepository = {
      createPayment: async () => createMockPayment(),
      findById: async () => createMockPayment(),
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

    const paymentService = createPaymentServiceInstance(mockPaymentRepo, mockWebhookRepo);
    const server = createPaymentService({
      port: 0,
      paymentService,
      internalTokenSecret: TEST_SECRET,
    });
    const { port } = await server.start();

    try {
      // 1. Missing token -> 401
      const unauthRes = await fetch(`http://127.0.0.1:${port}/api/v1/payments/${PAYMENT_ID}`, {
        headers: { 'x-store-id': STORE_ID },
      });
      assert.equal(unauthRes.status, 401);

      // 2. Valid token -> 200
      const token = mintInternalToken(
        {
          sub: USER_ID,
          act: 'SHOPKEEPER',
          tid: STORE_ID,
          roles: ['OWNER'],
        },
        { secret: TEST_SECRET },
      );

      const authRes = await fetch(`http://127.0.0.1:${port}/api/v1/payments/${PAYMENT_ID}`, {
        headers: {
          'x-store-id': STORE_ID,
          'x-internal-token': token,
        },
      });
      assert.equal(authRes.status, 200);

      // 3. Mismatched tenant -> 403
      const mismatchToken = mintInternalToken(
        {
          sub: USER_ID,
          act: 'SHOPKEEPER',
          tid: '00000000-0000-0000-0000-000000000999',
          roles: ['OWNER'],
        },
        { secret: TEST_SECRET },
      );

      const mismatchRes = await fetch(`http://127.0.0.1:${port}/api/v1/payments/${PAYMENT_ID}`, {
        headers: {
          'x-store-id': STORE_ID,
          'x-internal-token': mismatchToken,
        },
      });
      assert.equal(mismatchRes.status, 403);
      const mismatchJson = (await mismatchRes.json()) as { code: string };
      assert.equal(mismatchJson.code, 'TENANT_MISMATCH');
    } finally {
      await server.stop();
    }
  });
});
