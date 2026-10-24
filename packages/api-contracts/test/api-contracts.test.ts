import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PaginationQuerySchema,
  createPaginatedResponseSchema,
  ProblemDetailsSchema,
  createProblemDetails,
  StoreIdSchema,
  LivenessResponseSchema,
  ReadinessResponseSchema,
  MoneySchema,
  QuantitySchema,
  CanonicalUnitSchema,
} from '../dist/index.js';

import { z } from 'zod';

describe('API Contracts: Identifiers & Tenant Context', () => {
  it('accepts valid canonical RFC 4122 UUIDv4 store identifiers', () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    assert.equal(StoreIdSchema.parse(validUuid), validUuid);
  });

  it('rejects malformed, empty, or non-UUID tenant identifiers', () => {
    assert.throws(() => StoreIdSchema.parse(''));
    assert.throws(() => StoreIdSchema.parse('store_12345'));
    assert.throws(() => StoreIdSchema.parse('not-a-valid-uuid-format'));
    assert.throws(() => StoreIdSchema.parse(12345));
  });

  it('treats tenant identifier as data rather than proof of authorization', () => {
    const parsed = StoreIdSchema.safeParse('9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d');
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(typeof parsed.data, 'string');
    }
  });
});

describe('API Contracts: Pagination', () => {
  it('applies sensible defaults for page and limit', () => {
    const parsed = PaginationQuerySchema.parse({});
    assert.equal(parsed.page, 1);
    assert.equal(parsed.limit, 20);
  });

  it('coerces string query parameters and enforces bounds', () => {
    const parsed = PaginationQuerySchema.parse({ page: '3', limit: '50' });
    assert.equal(parsed.page, 3);
    assert.equal(parsed.limit, 50);
  });

  it('rejects limit exceeding maximum bound of 100', () => {
    assert.throws(() => PaginationQuerySchema.parse({ limit: 101 }));
  });

  it('rejects negative or zero page and limit', () => {
    assert.throws(() => PaginationQuerySchema.parse({ page: 0 }));
    assert.throws(() => PaginationQuerySchema.parse({ limit: -5 }));
  });

  it('validates generic paginated collection envelopes', () => {
    const ItemSchema = z.object({ id: z.string(), name: z.string() });
    const PaginatedItemsSchema = createPaginatedResponseSchema(ItemSchema);

    const validPayload = {
      data: [{ id: '1', name: 'Item 1' }],
      pagination: {
        page: 1,
        limit: 20,
        total_items: 1,
        total_pages: 1,
        has_next: false,
        has_prev: false,
      },
    };

    const parsed = PaginatedItemsSchema.parse(validPayload);
    assert.equal(parsed.data.length, 1);
    assert.equal(parsed.pagination.total_items, 1);
  });
});

describe('API Contracts: RFC 7807 / RFC 9457 Problem Details', () => {
  it('validates a conformant Problem Details payload with standard and extension fields', () => {
    const error = createProblemDetails({
      status: 404,
      title: 'Order Not Found',
      detail: 'Order ord_123 does not exist for this store',
      type: 'https://api.grocery.internal/errors/order-not-found',
      instance: '/orders/ord_123',
      code: 'ORDER_NOT_FOUND',
      request_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      invalid_params: [{ name: 'order_id', reason: 'Not found' }],
    });

    assert.equal(error.status, 404);
    assert.equal(error.title, 'Order Not Found');
    assert.equal(error.code, 'ORDER_NOT_FOUND');
    assert.equal(error.type, 'https://api.grocery.internal/errors/order-not-found');
    assert.equal(error.instance, '/orders/ord_123');
    assert.equal(error.invalid_params?.length, 1);
  });

  it('rejects status codes below 400 or above 599', () => {
    assert.throws(() =>
      ProblemDetailsSchema.parse({
        type: 'about:blank',
        title: 'OK',
        status: 200,
        detail: 'Not an error',
      }),
    );

    assert.throws(() =>
      ProblemDetailsSchema.parse({
        type: 'about:blank',
        title: 'Unknown',
        status: 600,
        detail: 'Invalid status',
      }),
    );
  });

  it('rejects Problem Details missing platform-required title or detail', () => {
    assert.throws(() =>
      ProblemDetailsSchema.parse({
        type: 'about:blank',
        status: 400,
      }),
    );
  });

  it('strictly rejects unauthorized internal fields like stack traces or SQL details', () => {
    const payloadWithLeak = {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'Unexpected database failure',
      stack: 'Error: Connection timeout at pg.connect(...)',
      sql_query: 'SELECT * FROM secrets',
    };

    assert.throws(() => ProblemDetailsSchema.parse(payloadWithLeak));
  });
});

describe('API Contracts: Health Envelopes', () => {
  it('validates conformant liveness response', () => {
    const live = LivenessResponseSchema.parse({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime_seconds: 123.45,
    });
    assert.equal(live.status, 'ok');
  });

  it('validates conformant readiness response with component checks', () => {
    const ready = ReadinessResponseSchema.parse({
      status: 'ready',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'healthy',
        broker: 'healthy',
      },
    });
    assert.equal(ready.checks.database, 'healthy');
  });

  it('rejects unapproved status values for liveness and readiness', () => {
    assert.throws(() =>
      LivenessResponseSchema.parse({
        status: 'running',
        timestamp: new Date().toISOString(),
        uptime_seconds: 10,
      }),
    );
  });
});

describe('API Contracts: Money, Units & Quantity', () => {
  it('enforces safe integer minor units for monetary amounts and rejects unsafe or fractional amounts', () => {
    const valid = MoneySchema.parse({ amount_minor: 1550, currency: 'INR' }); // ₹15.50
    assert.equal(valid.amount_minor, 1550);

    // Reject fractional minor units
    assert.throws(() => MoneySchema.parse({ amount_minor: 15.5 }));

    // Reject unsafe integers exceeding Number.MAX_SAFE_INTEGER
    assert.throws(() => MoneySchema.parse({ amount_minor: Number.MAX_SAFE_INTEGER + 10 }));

    // Reject NaN and Infinity
    assert.throws(() => MoneySchema.parse({ amount_minor: Number.NaN }));
    assert.throws(() => MoneySchema.parse({ amount_minor: Number.POSITIVE_INFINITY }));
  });

  it('enforces 3-letter uppercase currency code format shape, demonstrating format-only validation limitation', () => {
    // Valid ISO codes conforming to format
    assert.equal(MoneySchema.parse({ amount_minor: 100, currency: 'INR' }).currency, 'INR');
    assert.equal(MoneySchema.parse({ amount_minor: 100, currency: 'USD' }).currency, 'USD');
    assert.equal(MoneySchema.parse({ amount_minor: 100, currency: 'EUR' }).currency, 'EUR');

    // Demonstrates contract limitation: any 3-letter uppercase ASCII code matches format
    // because the contract validates shape rather than performing ISO 4217 dictionary lookup
    assert.equal(MoneySchema.parse({ amount_minor: 100, currency: 'ZZZ' }).currency, 'ZZZ');

    // Strictly rejects non-3-letter, lowercase, numeric, or whitespace strings
    assert.throws(() => MoneySchema.parse({ amount_minor: 100, currency: 'inr' }));
    assert.throws(() => MoneySchema.parse({ amount_minor: 100, currency: '123' }));
    assert.throws(() => MoneySchema.parse({ amount_minor: 100, currency: 'US' }));
    assert.throws(() => MoneySchema.parse({ amount_minor: 100, currency: 'USDD' }));
    assert.throws(() => MoneySchema.parse({ amount_minor: 100, currency: '   ' }));
  });

  it('validates canonical units of measure including PACK per ADR-010', () => {
    const validUnits = ['KG', 'G', 'L', 'ML', 'PIECE', 'PACK'] as const;
    for (const unit of validUnits) {
      assert.equal(CanonicalUnitSchema.parse(unit), unit);
    }

    assert.throws(() => CanonicalUnitSchema.parse('BOX'));
    assert.throws(() => CanonicalUnitSchema.parse('kilos'));
  });

  it('handles floating-point edge cases reliably for 3-decimal quantities', () => {
    // These specific IEEE 754 floats drift during simple * 1000 multiplication in JS
    assert.equal(QuantitySchema.parse(1.001), 1.001);
    assert.equal(QuantitySchema.parse(1.005), 1.005);
    assert.equal(QuantitySchema.parse(0.5), 0.5);
    assert.equal(QuantitySchema.parse(1.25), 1.25);
    assert.equal(QuantitySchema.parse(2.125), 2.125);
    assert.equal(QuantitySchema.parse(0.001), 0.001);

    // Reject values with more than 3 decimal places
    assert.throws(() => QuantitySchema.parse(1.0001));
    assert.throws(() => QuantitySchema.parse(1.0005));
    assert.throws(() => QuantitySchema.parse(2.1234));

    // Reject non-positive, NaN, and Infinity
    assert.throws(() => QuantitySchema.parse(0));
    assert.throws(() => QuantitySchema.parse(-1));
    assert.throws(() => QuantitySchema.parse(Number.NaN));
    assert.throws(() => QuantitySchema.parse(Number.POSITIVE_INFINITY));
  });
});
