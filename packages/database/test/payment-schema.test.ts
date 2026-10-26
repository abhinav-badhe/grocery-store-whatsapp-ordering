import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
} from 'kysely';
import type { Database, PaymentRow, PaymentWebhookRow, RefundRow } from '../dist/index.js';
import {
  loadMigrationFiles,
  computeMigrationChecksum,
  getDefaultMigrationsDir,
} from '../dist/index.js';

function createMockKysely(): Kysely<Database> {
  const connection: DatabaseConnection = {
    executeQuery: async <R>() => ({ rows: [] as R[] }),
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

  return new Kysely<Database>({
    dialect: {
      createDriver: () => driver,
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createAdapter: () => new PostgresAdapter(),
      createIntrospector: (db) => new PostgresIntrospector(db),
    },
  });
}

describe('Payment Schema & Multi-Tenant Migrations', () => {
  const migrationsDir = getDefaultMigrationsDir();

  it('discovers 0008_payment_schema.sql in migrations directory with deterministic checksum', () => {
    const files = loadMigrationFiles(migrationsDir);
    const paymentMigration = files.find((f) => f.version === '0008');

    assert.ok(paymentMigration, '0008_payment_schema.sql must be discovered');
    assert.equal(paymentMigration.name, 'payment_schema');
    assert.equal(paymentMigration.isTransactional, true);

    const diskContent = fs.readFileSync(
      path.join(migrationsDir, '0008_payment_schema.sql'),
      'utf8',
    );
    assert.equal(paymentMigration.checksum, computeMigrationChecksum(diskContent));
  });

  it('contains expected DDL statements for payment schema, payments, webhooks, and refunds', () => {
    const migrationPath = path.join(migrationsDir, '0008_payment_schema.sql');
    const content = fs.readFileSync(migrationPath, 'utf8');

    // Schema creation
    assert.ok(content.includes('CREATE SCHEMA IF NOT EXISTS payment;'));

    // Tables
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS payment.payments'));
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS payment.payment_webhooks'));
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS payment.refunds'));

    // Tenant constraints
    assert.ok(content.includes('store_id UUID NOT NULL REFERENCES identity.stores(id)'));
    assert.ok(content.includes('order_id UUID NOT NULL REFERENCES "order".orders(id)'));

    // Check constraints
    assert.ok(content.includes('payments_status_check'));
    assert.ok(content.includes('payments_method_check'));
    assert.ok(content.includes('payments_provider_check'));
    assert.ok(content.includes('payment_webhooks_status_check'));
    assert.ok(content.includes('refunds_status_check'));

    // Webhook deduplication unique constraint
    assert.ok(
      content.includes('payment_webhooks_provider_event_id_unique UNIQUE (provider, event_id)'),
    );

    // Idempotency partial unique index
    assert.ok(content.includes('payments_store_idempotency_key_idx'));
  });

  it('verifies Kysely query compilation for payment schema tables', () => {
    const db = createMockKysely();

    const paymentQuery = db
      .selectFrom('payment.payments')
      .selectAll()
      .where('store_id', '=', '00000000-0000-4000-8000-000000000001')
      .where('status', '=', 'SUCCEEDED')
      .compile();

    assert.equal(
      paymentQuery.sql,
      'select * from "payment"."payments" where "store_id" = $1 and "status" = $2',
    );
    assert.deepEqual(paymentQuery.parameters, [
      '00000000-0000-4000-8000-000000000001',
      'SUCCEEDED',
    ]);

    const webhookQuery = db
      .selectFrom('payment.payment_webhooks')
      .selectAll()
      .where('provider', '=', 'RAZORPAY')
      .where('event_id', '=', 'evt_12345')
      .compile();

    assert.equal(
      webhookQuery.sql,
      'select * from "payment"."payment_webhooks" where "provider" = $1 and "event_id" = $2',
    );
    assert.deepEqual(webhookQuery.parameters, ['RAZORPAY', 'evt_12345']);

    const refundQuery = db
      .selectFrom('payment.refunds')
      .selectAll()
      .where('store_id', '=', '00000000-0000-4000-8000-000000000001')
      .where('payment_id', '=', '00000000-0000-4000-8000-000000000002')
      .compile();

    assert.equal(
      refundQuery.sql,
      'select * from "payment"."refunds" where "store_id" = $1 and "payment_id" = $2',
    );
  });
});
