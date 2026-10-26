import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
} from 'kysely';
import type { Database, PaymentRow, PaymentWebhookRow, RefundRow } from '@grocery/database';
import {
  createPaymentRepository,
  createPaymentWebhookRepository,
  DuplicatePaymentIdempotencyError,
  DuplicateWebhookEventError,
} from '../dist/index.js';

interface QueryRecord {
  sql: string;
  parameters: readonly unknown[];
}

interface MockKyselyOptions {
  onExecuteQuery?: (
    sql: string,
    parameters: readonly unknown[],
  ) =>
    | { rows: unknown[]; numAffectedRows?: bigint }
    | Promise<{ rows: unknown[]; numAffectedRows?: bigint }>;
}

function createMockKysely(options: MockKyselyOptions = {}): {
  db: Kysely<Database>;
  queries: QueryRecord[];
} {
  const queries: QueryRecord[] = [];
  const connection: DatabaseConnection = {
    executeQuery: async <R>(compiledQuery: { sql: string; parameters: readonly unknown[] }) => {
      queries.push({
        sql: compiledQuery.sql,
        parameters: compiledQuery.parameters,
      });
      if (options.onExecuteQuery) {
        const result = await options.onExecuteQuery(compiledQuery.sql, compiledQuery.parameters);
        return {
          rows: (result.rows ?? []) as R[],
          numAffectedRows: result.numAffectedRows,
        };
      }
      return { rows: [] as R[] };
    },
    streamQuery: () => {
      throw new Error('Streaming not implemented in mock');
    },
  };

  const driver: Driver = {
    init: async () => {},
    acquireConnection: async () => connection,
    beginTransaction: async () => {},
    commitTransaction: async () => {},
    rollbackTransaction: async () => {},
    releaseConnection: async () => {},
    destroy: async () => {},
  };

  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (instance) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

  return { db, queries };
}

const STORE_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_STORE_ID = '00000000-0000-4000-8000-000000000002';
const PAYMENT_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const REFUND_ID = '33333333-3333-4333-8333-333333333333';
const WEBHOOK_ID = '44444444-4444-4444-8444-444444444444';

describe('Payment & Webhook Persistence Repositories', () => {
  it('creates a payment with default status and currency', async () => {
    const mockPaymentRow: PaymentRow = {
      id: PAYMENT_ID,
      store_id: STORE_ID,
      order_id: ORDER_ID,
      payment_method: 'UPI',
      provider: 'RAZORPAY',
      provider_order_id: 'order_rzp_123',
      provider_payment_id: null,
      amount_cents: 15000,
      currency: 'INR',
      status: 'PENDING',
      idempotency_key: 'idem-pay-1',
      created_at: new Date('2026-10-25T10:00:00Z'),
      updated_at: new Date('2026-10-25T10:00:00Z'),
    };

    const { db, queries } = createMockKysely({
      onExecuteQuery: (sql) => {
        if (sql.includes('insert into "payment"."payments"')) {
          return { rows: [mockPaymentRow] };
        }
        return { rows: [] };
      },
    });

    const repo = createPaymentRepository(db);

    const payment = await repo.createPayment({
      storeId: STORE_ID,
      orderId: ORDER_ID,
      paymentMethod: 'UPI',
      provider: 'RAZORPAY',
      amountCents: 15000,
      providerOrderId: 'order_rzp_123',
      idempotencyKey: 'idem-pay-1',
    });

    assert.equal(payment.id, PAYMENT_ID);
    assert.equal(payment.status, 'PENDING');
    assert.equal(payment.amount_cents, 15000);
    assert.ok(queries.some((q) => q.sql.includes('insert into "payment"."payments"')));
  });

  it('retrieves payment by id scoped to store_id', async () => {
    const mockPaymentRow: PaymentRow = {
      id: PAYMENT_ID,
      store_id: STORE_ID,
      order_id: ORDER_ID,
      payment_method: 'UPI',
      provider: 'RAZORPAY',
      provider_order_id: null,
      provider_payment_id: 'pay_rzp_999',
      amount_cents: 15000,
      currency: 'INR',
      status: 'SUCCEEDED',
      idempotency_key: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const { db } = createMockKysely({
      onExecuteQuery: (sql, params) => {
        if (
          sql.includes('from "payment"."payments"') &&
          params.includes(STORE_ID) &&
          params.includes(PAYMENT_ID)
        ) {
          return { rows: [mockPaymentRow] };
        }
        return { rows: [] };
      },
    });

    const repo = createPaymentRepository(db);

    const payment = await repo.findById(STORE_ID, PAYMENT_ID);
    assert.ok(payment);
    assert.equal(payment.id, PAYMENT_ID);

    const notFound = await repo.findById(OTHER_STORE_ID, PAYMENT_ID);
    assert.equal(notFound, null);
  });

  it('retrieves payment by order_id', async () => {
    const mockPaymentRow: PaymentRow = {
      id: PAYMENT_ID,
      store_id: STORE_ID,
      order_id: ORDER_ID,
      payment_method: 'CARD',
      provider: 'STRIPE',
      provider_order_id: null,
      provider_payment_id: 'pi_test_123',
      amount_cents: 20000,
      currency: 'INR',
      status: 'SUCCEEDED',
      idempotency_key: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const { db } = createMockKysely({
      onExecuteQuery: (sql, params) => {
        if (
          sql.includes('from "payment"."payments"') &&
          params.includes(STORE_ID) &&
          params.includes(ORDER_ID)
        ) {
          return { rows: [mockPaymentRow] };
        }
        return { rows: [] };
      },
    });

    const repo = createPaymentRepository(db);
    const payment = await repo.findByOrderId(STORE_ID, ORDER_ID);
    assert.ok(payment);
    assert.equal(payment.order_id, ORDER_ID);
  });

  it('updates payment status and records provider payment id', async () => {
    const updatedRow: PaymentRow = {
      id: PAYMENT_ID,
      store_id: STORE_ID,
      order_id: ORDER_ID,
      payment_method: 'UPI',
      provider: 'RAZORPAY',
      provider_order_id: null,
      provider_payment_id: 'pay_capture_123',
      amount_cents: 15000,
      currency: 'INR',
      status: 'SUCCEEDED',
      idempotency_key: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const { db, queries } = createMockKysely({
      onExecuteQuery: (sql) => {
        if (sql.includes('update "payment"."payments"')) {
          return { rows: [updatedRow] };
        }
        return { rows: [] };
      },
    });

    const repo = createPaymentRepository(db);
    const result = await repo.updateStatus(STORE_ID, PAYMENT_ID, 'SUCCEEDED', 'pay_capture_123');

    assert.ok(result);
    assert.equal(result.status, 'SUCCEEDED');
    assert.equal(result.provider_payment_id, 'pay_capture_123');

    const updateQuery = queries.find((q) => q.sql.includes('update "payment"."payments"'));
    assert.ok(updateQuery);
    assert.ok(updateQuery.parameters.includes('SUCCEEDED'));
    assert.ok(updateQuery.parameters.includes('pay_capture_123'));
  });

  it('creates and lists refund records for a payment', async () => {
    const mockRefundRow: RefundRow = {
      id: REFUND_ID,
      payment_id: PAYMENT_ID,
      store_id: STORE_ID,
      amount_cents: 5000,
      reason: 'Customer returned 1 item',
      provider_refund_id: 'rfnd_123',
      status: 'SUCCEEDED',
      created_at: new Date(),
      updated_at: new Date(),
    };

    const { db, queries } = createMockKysely({
      onExecuteQuery: (sql) => {
        if (sql.includes('insert into "payment"."refunds"')) {
          return { rows: [mockRefundRow] };
        }
        if (sql.includes('from "payment"."refunds"')) {
          return { rows: [mockRefundRow] };
        }
        return { rows: [] };
      },
    });

    const repo = createPaymentRepository(db);

    const createdRefund = await repo.createRefund({
      storeId: STORE_ID,
      paymentId: PAYMENT_ID,
      amountCents: 5000,
      reason: 'Customer returned 1 item',
      providerRefundId: 'rfnd_123',
      status: 'SUCCEEDED',
    });

    assert.equal(createdRefund.id, REFUND_ID);
    assert.equal(createdRefund.amount_cents, 5000);

    const refunds = await repo.listRefundsByPayment(STORE_ID, PAYMENT_ID);
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0]!.id, REFUND_ID);
  });

  it('records, finds, and updates webhook events', async () => {
    const mockWebhookRow: PaymentWebhookRow = {
      id: WEBHOOK_ID,
      store_id: STORE_ID,
      provider: 'RAZORPAY',
      event_id: 'evt_rzp_test_001',
      event_type: 'payment.captured',
      payload: { payment: { id: 'pay_123' } },
      signature: 'sig_test_hash',
      status: 'RECEIVED',
      processed_at: null,
      created_at: new Date(),
    };

    const updatedWebhookRow: PaymentWebhookRow = {
      ...mockWebhookRow,
      status: 'PROCESSED',
      processed_at: new Date(),
    };

    const { db, queries } = createMockKysely({
      onExecuteQuery: (sql, params) => {
        if (sql.includes('insert into "payment"."payment_webhooks"')) {
          return { rows: [mockWebhookRow] };
        }
        if (sql.includes('from "payment"."payment_webhooks"')) {
          if (params.includes('RAZORPAY') && params.includes('evt_rzp_test_001')) {
            return { rows: [mockWebhookRow] };
          }
          return { rows: [] };
        }
        if (sql.includes('update "payment"."payment_webhooks"')) {
          return { rows: [updatedWebhookRow] };
        }
        return { rows: [] };
      },
    });

    const webhookRepo = createPaymentWebhookRepository(db);

    const recorded = await webhookRepo.recordWebhook({
      storeId: STORE_ID,
      provider: 'RAZORPAY',
      eventId: 'evt_rzp_test_001',
      eventType: 'payment.captured',
      payload: { payment: { id: 'pay_123' } },
      signature: 'sig_test_hash',
    });

    assert.equal(recorded.id, WEBHOOK_ID);
    assert.equal(recorded.status, 'RECEIVED');

    const found = await webhookRepo.findWebhook('RAZORPAY', 'evt_rzp_test_001');
    assert.ok(found);
    assert.equal(found.event_id, 'evt_rzp_test_001');

    const notFound = await webhookRepo.findWebhook('RAZORPAY', 'evt_unknown');
    assert.equal(notFound, null);

    const processed = await webhookRepo.markProcessed(WEBHOOK_ID, 'PROCESSED');
    assert.ok(processed);
    assert.equal(processed.status, 'PROCESSED');
  });

  it('maps unique constraint violations to typed domain errors', async () => {
    const { db: dbIdemp } = createMockKysely({
      onExecuteQuery: () => {
        const error = new Error('duplicate key value violates unique constraint') as Error & {
          code: string;
          constraint: string;
        };
        error.code = '23505';
        error.constraint = 'payments_store_idempotency_key_idx';
        throw error;
      },
    });

    const paymentRepo = createPaymentRepository(dbIdemp);
    await assert.rejects(
      async () =>
        paymentRepo.createPayment({
          storeId: STORE_ID,
          orderId: ORDER_ID,
          paymentMethod: 'UPI',
          provider: 'MOCK',
          amountCents: 1000,
          idempotencyKey: 'dup-pay',
        }),
      (err: unknown) => err instanceof DuplicatePaymentIdempotencyError,
    );

    const { db: dbWebhook } = createMockKysely({
      onExecuteQuery: () => {
        const error = new Error('duplicate key value violates unique constraint') as Error & {
          code: string;
          constraint: string;
        };
        error.code = '23505';
        error.constraint = 'payment_webhooks_provider_event_id_unique';
        throw error;
      },
    });

    const webhookRepo = createPaymentWebhookRepository(dbWebhook);
    await assert.rejects(
      async () =>
        webhookRepo.recordWebhook({
          storeId: STORE_ID,
          provider: 'RAZORPAY',
          eventId: 'dup-evt',
          eventType: 'payment.captured',
          payload: {},
          signature: 'sig',
        }),
      (err: unknown) => err instanceof DuplicateWebhookEventError,
    );
  });
});
