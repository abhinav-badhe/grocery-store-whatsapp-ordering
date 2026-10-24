import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EventEnvelopeBaseSchema,
  createEventEnvelopeSchema,
  createTenantEventEnvelopeSchema,
  createPlatformEventEnvelopeSchema,
  OrderConfirmedEventSchema,
  InventoryReservedEventSchema,
  PaymentCompletedEventSchema,
  PlatformMaintenanceScheduledEventSchema,
} from '../dist/index.js';
import { z } from 'zod';

describe('Event Contracts: Platform Envelope Invariants', () => {
  it('parses a valid standardized event envelope', () => {
    const validEnvelope = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'order.confirmed.v1',
      version: 1,
      occurred_at: '2026-10-24T10:00:00.000Z',
      source: 'order-service',
      correlation_id: '123e4567-e89b-12d3-a456-426614174000',
      store_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      data: { test: true },
    };

    const schema = createEventEnvelopeSchema(z.object({ test: z.boolean() }));
    const parsed = schema.parse(validEnvelope);

    assert.equal(parsed.id, validEnvelope.id);
    assert.equal(parsed.version, 1);
    assert.equal(parsed.data.test, true);

    const tenantSchema = createTenantEventEnvelopeSchema(z.object({ test: z.boolean() }));
    const parsedTenant = tenantSchema.parse(validEnvelope);
    assert.equal(parsedTenant.store_id, validEnvelope.store_id);

    const platformSchema = createPlatformEventEnvelopeSchema(z.object({ test: z.boolean() }));
    const parsedPlatform = platformSchema.parse({
      id: validEnvelope.id,
      type: 'platform.test.completed.v1',
      version: 1,
      occurred_at: validEnvelope.occurred_at,
      source: 'test-service',
      correlation_id: validEnvelope.correlation_id,
      data: { test: true },
    });
    assert.equal(parsedPlatform.store_id, undefined);
  });

  it('rejects mismatched event type suffix and version number', () => {
    const base = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      occurred_at: '2026-10-24T10:00:00.000Z',
      source: 'order-service',
      correlation_id: '123e4567-e89b-12d3-a456-426614174000',
    };

    // Type says .v2, version integer says 1 -> Contradiction!
    assert.throws(() =>
      EventEnvelopeBaseSchema.parse({
        ...base,
        type: 'order.confirmed.v2',
        version: 1,
      }),
    );

    // Type says .v1, version integer says 2 -> Contradiction!
    assert.throws(() =>
      EventEnvelopeBaseSchema.parse({
        ...base,
        type: 'order.confirmed.v1',
        version: 2,
      }),
    );
  });

  it('rejects malformed event type, non-positive version, or unsupported versions', () => {
    const base = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      occurred_at: '2026-10-24T10:00:00.000Z',
      source: 'order-service',
      correlation_id: '123e4567-e89b-12d3-a456-426614174000',
    };

    // Version zero is invalid
    assert.throws(() =>
      EventEnvelopeBaseSchema.parse({
        ...base,
        type: 'order.confirmed.v0',
        version: 0,
      }),
    );

    // Negative version is invalid
    assert.throws(() =>
      EventEnvelopeBaseSchema.parse({
        ...base,
        type: 'order.confirmed.v1',
        version: -1,
      }),
    );

    // Missing version suffix
    assert.throws(() =>
      EventEnvelopeBaseSchema.parse({
        ...base,
        type: 'order.confirmed',
        version: 1,
      }),
    );

    // Malformed naming convention
    assert.throws(() =>
      EventEnvelopeBaseSchema.parse({
        ...base,
        type: 'UPPERCASE_EVENT.v1',
        version: 1,
      }),
    );
  });

  it('validates real ISO 8601 UTC dates, rejecting impossible calendar dates and non-UTC offsets', () => {
    const base = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'order.confirmed.v1',
      version: 1,
      source: 'order-service',
      correlation_id: '123e4567-e89b-12d3-a456-426614174000',
      store_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    };

    // Valid ISO 8601 UTC timestamps (with and without fractional seconds)
    assert.doesNotThrow(() =>
      EventEnvelopeBaseSchema.parse({ ...base, occurred_at: '2026-10-24T10:00:00.000Z' }),
    );
    assert.doesNotThrow(() =>
      EventEnvelopeBaseSchema.parse({ ...base, occurred_at: '2026-10-24T10:00:00Z' }),
    );

    // Rejects impossible calendar dates (proves calendar validation, not just string shape)
    assert.throws(
      () => EventEnvelopeBaseSchema.parse({ ...base, occurred_at: '2026-02-31T10:00:00.000Z' }),
      /occurred_at/,
    );
    assert.throws(
      () => EventEnvelopeBaseSchema.parse({ ...base, occurred_at: '2026-02-29T10:00:00.000Z' }), // 2026 is non-leap year
      /occurred_at/,
    );
    assert.throws(
      () => EventEnvelopeBaseSchema.parse({ ...base, occurred_at: '2026-04-31T10:00:00.000Z' }), // April has 30 days
      /occurred_at/,
    );
    assert.throws(
      () => EventEnvelopeBaseSchema.parse({ ...base, occurred_at: '2026-11-31T10:00:00.000Z' }), // November has 30 days
      /occurred_at/,
    );
    assert.throws(
      () => EventEnvelopeBaseSchema.parse({ ...base, occurred_at: '2026-13-10T10:00:00.000Z' }), // Invalid month 13
      /occurred_at/,
    );

    // Rejects non-UTC offsets (platform policy strictly mandates UTC 'Z')
    assert.throws(() =>
      EventEnvelopeBaseSchema.parse({ ...base, occurred_at: '2026-10-24T10:00:00+05:30' }),
    );
    assert.throws(() =>
      EventEnvelopeBaseSchema.parse({ ...base, occurred_at: '2026-10-24T10:00:00+00:00' }),
    );

    // Rejects malformed / non-ISO text
    assert.throws(() => EventEnvelopeBaseSchema.parse({ ...base, occurred_at: 'not-a-date' }));
    assert.throws(() =>
      EventEnvelopeBaseSchema.parse({ ...base, occurred_at: '2026-10-24 10:00:00' }),
    );
  });

  it('allows platform-level events to omit store_id and strictly rejects platform events with store_id', () => {
    const validPlatformEvent = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'platform.maintenance.scheduled.v1',
      version: 1,
      occurred_at: '2026-10-24T10:00:00.000Z',
      source: 'ops-service',
      correlation_id: '123e4567-e89b-12d3-a456-426614174000',
      data: {
        maintenance_id: 'maint_001',
        scheduled_start: '2026-10-25T02:00:00.000Z',
        scheduled_end: '2026-10-25T04:00:00.000Z',
        description: 'PostgreSQL minor version upgrade',
      },
    };

    const parsed = PlatformMaintenanceScheduledEventSchema.parse(validPlatformEvent);
    assert.equal(parsed.store_id, undefined);
    assert.equal(parsed.data.maintenance_id, 'maint_001');

    // Platform events MUST NOT specify a store_id
    assert.throws(() =>
      PlatformMaintenanceScheduledEventSchema.parse({
        ...validPlatformEvent,
        store_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      }),
    );
  });

  it('strictly rejects tenant-scoped events if store_id is missing or non-UUID', () => {
    const baseTenantEvent = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'order.confirmed.v1',
      version: 1,
      occurred_at: '2026-10-24T10:00:00.000Z',
      source: 'order-service',
      correlation_id: '123e4567-e89b-12d3-a456-426614174000',
      data: {
        order_id: 'ord_1',
        store_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        customer_id: 'cust_1',
        total_amount_minor: 5000,
        currency: 'INR',
        confirmed_at: '2026-10-24T10:00:00.000Z',
      },
    };

    // Missing store_id on envelope
    assert.throws(() => OrderConfirmedEventSchema.parse(baseTenantEvent));

    // Invalid/non-UUID store_id on envelope
    assert.throws(() =>
      OrderConfirmedEventSchema.parse({
        ...baseTenantEvent,
        store_id: 'not-a-uuid',
      }),
    );
  });

  it('guarantees event identity stability across redeliveries', () => {
    const originalEvent = {
      id: '710b72a6-b518-4e57-9dbd-0210f845d42e',
      type: 'inventory.reserved.v1',
      version: 1,
      occurred_at: '2026-10-24T10:05:00.000Z',
      source: 'inventory-service',
      correlation_id: '123e4567-e89b-12d3-a456-426614174000',
      store_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      data: {
        reservation_id: 'res_001',
        order_id: 'ord_001',
        store_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        items: [{ sku: 'SKU-MILK-1L', quantity: 2, unit: 'L' as const }],
        expires_at: '2026-10-24T10:20:00.000Z',
      },
    };

    const firstDeliveryTransport = {
      deliveryTag: 1,
      redelivered: false,
      routingKey: 'inventory.reserved.v1',
      envelope: InventoryReservedEventSchema.parse(originalEvent),
    };

    const secondDeliveryTransport = {
      deliveryTag: 45,
      redelivered: true,
      routingKey: 'inventory.reserved.v1',
      envelope: InventoryReservedEventSchema.parse(originalEvent),
    };

    assert.equal(firstDeliveryTransport.envelope.id, secondDeliveryTransport.envelope.id);
  });
});

describe('Event Contracts: Representative Payloads Runtime Validation', () => {
  it('validates OrderConfirmedPayload enforces safe integer money and uppercase currency', () => {
    const valid = OrderConfirmedEventSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'order.confirmed.v1',
      version: 1,
      occurred_at: '2026-10-24T10:00:00.000Z',
      source: 'order-service',
      correlation_id: '123e4567-e89b-12d3-a456-426614174000',
      store_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      data: {
        order_id: 'ord_1',
        store_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        customer_id: 'cust_1',
        total_amount_minor: 5000,
        currency: 'INR',
        confirmed_at: '2026-10-24T10:00:00.000Z',
      },
    });

    assert.equal(valid.data.total_amount_minor, 5000);

    // Reject fractional minor units
    assert.throws(() =>
      OrderConfirmedEventSchema.parse({
        ...valid,
        data: { ...valid.data, total_amount_minor: 5000.5 },
      }),
    );

    // Reject negative amount
    assert.throws(() =>
      OrderConfirmedEventSchema.parse({
        ...valid,
        data: { ...valid.data, total_amount_minor: -100 },
      }),
    );

    // Reject lowercase currency
    assert.throws(() =>
      OrderConfirmedEventSchema.parse({
        ...valid,
        data: { ...valid.data, currency: 'inr' },
      }),
    );
  });

  it('validates InventoryReservedPayload enforces 3-decimal quantity and canonical units including PACK', () => {
    const valid = InventoryReservedEventSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'inventory.reserved.v1',
      version: 1,
      occurred_at: '2026-10-24T10:00:00.000Z',
      source: 'inventory-service',
      correlation_id: '123e4567-e89b-12d3-a456-426614174000',
      store_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      data: {
        reservation_id: 'res_001',
        order_id: 'ord_001',
        store_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        items: [
          { sku: 'SKU-RICE-1KG', quantity: 1.005, unit: 'KG' },
          { sku: 'SKU-MAGGI-PACK', quantity: 2, unit: 'PACK' },
        ],
        expires_at: '2026-10-24T10:15:00.000Z',
      },
    });

    assert.equal(valid.data.items.length, 2);
    assert.equal(valid.data.items[0].quantity, 1.005);
    assert.equal(valid.data.items[1].unit, 'PACK');

    // Reject 4-decimal quantity
    assert.throws(() =>
      InventoryReservedEventSchema.parse({
        ...valid,
        data: {
          ...valid.data,
          items: [{ sku: 'SKU-RICE-1KG', quantity: 1.0001, unit: 'KG' }],
        },
      }),
    );

    // Reject unapproved unit
    assert.throws(() =>
      InventoryReservedEventSchema.parse({
        ...valid,
        data: {
          ...valid.data,
          items: [{ sku: 'SKU-RICE-1KG', quantity: 1, unit: 'BOX' as unknown as 'KG' }],
        },
      }),
    );
  });

  it('validates PaymentCompletedPayload enforces positive minor units', () => {
    const valid = PaymentCompletedEventSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'payment.completed.v1',
      version: 1,
      occurred_at: '2026-10-24T10:00:00.000Z',
      source: 'payment-service',
      correlation_id: '123e4567-e89b-12d3-a456-426614174000',
      store_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      data: {
        payment_attempt_id: 'pay_001',
        order_id: 'ord_001',
        store_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        amount_minor: 25000,
        currency: 'INR',
        provider: 'razorpay',
        completed_at: '2026-10-24T10:00:00.000Z',
      },
    });

    assert.equal(valid.data.amount_minor, 25000);

    // Reject zero amount
    assert.throws(() =>
      PaymentCompletedEventSchema.parse({
        ...valid,
        data: { ...valid.data, amount_minor: 0 },
      }),
    );
  });
});
