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
import type { Database } from '../dist/index.js';
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

describe('Transactional Outbox Schema & Multi-Tenant Migrations', () => {
  const migrationsDir = getDefaultMigrationsDir();

  it('discovers 0009_outbox_schema.sql in migrations directory with deterministic checksum', () => {
    const files = loadMigrationFiles(migrationsDir);
    const outboxMigration = files.find((f) => f.version === '0009');

    assert.ok(outboxMigration, '0009_outbox_schema.sql must be discovered');
    assert.equal(outboxMigration.name, 'outbox_schema');
    assert.equal(outboxMigration.isTransactional, true);

    const diskContent = fs.readFileSync(path.join(migrationsDir, '0009_outbox_schema.sql'), 'utf8');
    assert.equal(outboxMigration.checksum, computeMigrationChecksum(diskContent));
  });

  it('contains expected DDL statements for events schema, outbox queue, and notification logs', () => {
    const migrationPath = path.join(migrationsDir, '0009_outbox_schema.sql');
    const content = fs.readFileSync(migrationPath, 'utf8');

    // Schema creation
    assert.ok(content.includes('CREATE SCHEMA IF NOT EXISTS events;'));

    // Tables
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS events.outbox'));
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS events.notification_logs'));

    // Tenant constraints
    assert.ok(content.includes('store_id UUID NOT NULL REFERENCES identity.stores(id)'));

    // Status and channel checks
    assert.ok(content.includes('outbox_status_check'));
    assert.ok(content.includes('notification_logs_channel_check'));
    assert.ok(content.includes('notification_logs_status_check'));

    // Polling index for worker
    assert.ok(content.includes('outbox_pending_polling_idx'));
  });

  it('verifies Kysely query compilation for events schema tables', () => {
    const db = createMockKysely();

    const pendingOutboxQuery = db
      .selectFrom('events.outbox')
      .selectAll()
      .where('status', '=', 'PENDING')
      .orderBy('scheduled_at', 'asc')
      .limit(50)
      .compile();

    assert.equal(
      pendingOutboxQuery.sql,
      'select * from "events"."outbox" where "status" = $1 order by "scheduled_at" asc limit $2',
    );
    assert.deepEqual(pendingOutboxQuery.parameters, ['PENDING', 50]);

    const notificationQuery = db
      .selectFrom('events.notification_logs')
      .selectAll()
      .where('store_id', '=', '00000000-0000-4000-8000-000000000001')
      .where('channel', '=', 'WHATSAPP')
      .compile();

    assert.equal(
      notificationQuery.sql,
      'select * from "events"."notification_logs" where "store_id" = $1 and "channel" = $2',
    );
  });
});
