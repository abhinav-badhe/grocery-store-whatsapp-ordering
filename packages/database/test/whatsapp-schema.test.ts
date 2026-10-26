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

describe('WhatsApp Commerce Schema & Cross-Schema Isolation (0010)', () => {
  const migrationsDir = getDefaultMigrationsDir();

  it('discovers 0010_whatsapp_commerce_schema.sql with deterministic checksum', () => {
    const files = loadMigrationFiles(migrationsDir);
    const waMigration = files.find((f) => f.version === '0010');

    assert.ok(waMigration, '0010_whatsapp_commerce_schema.sql must be discovered');
    assert.equal(waMigration.name, 'whatsapp_commerce_schema');
    assert.equal(waMigration.isTransactional, true);

    const diskContent = fs.readFileSync(
      path.join(migrationsDir, '0010_whatsapp_commerce_schema.sql'),
      'utf8',
    );
    assert.equal(waMigration.checksum, computeMigrationChecksum(diskContent));
  });

  it('enforces ADR-002: ZERO cross-schema foreign keys in whatsapp schema', () => {
    const migrationPath = path.join(migrationsDir, '0010_whatsapp_commerce_schema.sql');
    const content = fs.readFileSync(migrationPath, 'utf8');

    // Must NOT have cross-schema foreign keys
    assert.ok(
      !content.includes('REFERENCES identity.'),
      'Must NOT reference identity schema via foreign key',
    );
    assert.ok(
      !content.includes('REFERENCES orders.'),
      'Must NOT reference orders schema via foreign key',
    );
    assert.ok(
      !content.includes('REFERENCES catalog.'),
      'Must NOT reference catalog schema via foreign key',
    );
    assert.ok(
      !content.includes('REFERENCES inventory.'),
      'Must NOT reference inventory schema via foreign key',
    );

    // Internal schema foreign key IS permitted
    assert.ok(
      content.includes('REFERENCES whatsapp.conversations(id)'),
      'Must reference whatsapp.conversations internally',
    );
  });

  it('contains expected DDL statements for whatsapp tables, deduplication, and constraints', () => {
    const migrationPath = path.join(migrationsDir, '0010_whatsapp_commerce_schema.sql');
    const content = fs.readFileSync(migrationPath, 'utf8');

    // Schema creation
    assert.ok(content.includes('CREATE SCHEMA IF NOT EXISTS whatsapp;'));

    // Tables
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS whatsapp.store_channels'));
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS whatsapp.inbound_messages'));
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS whatsapp.conversations'));
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS whatsapp.provisional_quotes'));
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS whatsapp.customer_phone_links'));

    // Constraints & indexes
    assert.ok(content.includes('inbound_messages_provider_msg_unique'));
    assert.ok(content.includes('inbound_messages_status_check'));
    assert.ok(content.includes('inbound_messages_polling_idx'));
    assert.ok(content.includes('quotes_status_check'));
    assert.ok(content.includes('quotes_amounts_check'));
    assert.ok(content.includes('conversations_unique_sender'));
  });

  it('verifies Kysely query compilation for whatsapp schema tables', () => {
    const db = createMockKysely();

    const pendingInboundQuery = db
      .selectFrom('whatsapp.inbound_messages')
      .selectAll()
      .where('status', '=', 'RECEIVED')
      .orderBy('created_at', 'asc')
      .limit(10)
      .compile();

    assert.equal(
      pendingInboundQuery.sql,
      'select * from "whatsapp"."inbound_messages" where "status" = $1 order by "created_at" asc limit $2',
    );

    const activeQuoteQuery = db
      .selectFrom('whatsapp.provisional_quotes')
      .selectAll()
      .where('conversation_id', '=', '00000000-0000-4000-8000-000000000001')
      .where('status', '=', 'ACTIVE')
      .compile();

    assert.equal(
      activeQuoteQuery.sql,
      'select * from "whatsapp"."provisional_quotes" where "conversation_id" = $1 and "status" = $2',
    );
  });
});
