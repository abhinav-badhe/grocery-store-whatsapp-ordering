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
import type { Database, OutboxRow, NotificationLogRow } from '@grocery/database';
import { createOutboxRepository, createNotificationLogRepository } from '../dist/index.js';

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
const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const AGGREGATE_ID = '22222222-2222-4222-8222-222222222222';
const LOG_ID = '33333333-3333-4333-8333-333333333333';

describe('Transactional Outbox & Notification Log Persistence', () => {
  it('inserts outbox event with PENDING status and default retry configuration', async () => {
    const mockOutboxRow: OutboxRow = {
      id: EVENT_ID,
      store_id: STORE_ID,
      event_type: 'order.confirmed.v1',
      aggregate_type: 'ORDER',
      aggregate_id: AGGREGATE_ID,
      payload: { order_id: AGGREGATE_ID, total_amount_minor: 15000 },
      metadata: null,
      status: 'PENDING',
      retry_count: 0,
      max_retries: 5,
      scheduled_at: new Date('2026-10-25T10:00:00Z'),
      processed_at: null,
      last_error: null,
      created_at: new Date('2026-10-25T10:00:00Z'),
    };

    const { db, queries } = createMockKysely({
      onExecuteQuery: (sql) => {
        if (sql.includes('insert into "events"."outbox"')) {
          return { rows: [mockOutboxRow] };
        }
        return { rows: [] };
      },
    });

    const repo = createOutboxRepository(db);

    const inserted = await repo.insertEvent({
      storeId: STORE_ID,
      eventType: 'order.confirmed.v1',
      aggregateType: 'ORDER',
      aggregateId: AGGREGATE_ID,
      payload: { order_id: AGGREGATE_ID, total_amount_minor: 15000 },
    });

    assert.equal(inserted.id, EVENT_ID);
    assert.equal(inserted.status, 'PENDING');
    assert.equal(inserted.retry_count, 0);
    assert.ok(queries.some((q) => q.sql.includes('insert into "events"."outbox"')));
  });

  it('fetches pending outbox events scheduled at or before current time', async () => {
    const mockOutboxRow: OutboxRow = {
      id: EVENT_ID,
      store_id: STORE_ID,
      event_type: 'order.confirmed.v1',
      aggregate_type: 'ORDER',
      aggregate_id: AGGREGATE_ID,
      payload: {},
      metadata: null,
      status: 'PENDING',
      retry_count: 0,
      max_retries: 5,
      scheduled_at: new Date(Date.now() - 1000),
      processed_at: null,
      last_error: null,
      created_at: new Date(Date.now() - 1000),
    };

    const { db, queries } = createMockKysely({
      onExecuteQuery: (sql) => {
        if (sql.includes('from "events"."outbox"')) {
          return { rows: [mockOutboxRow] };
        }
        return { rows: [] };
      },
    });

    const repo = createOutboxRepository(db);
    const pending = await repo.fetchPending(10);

    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.id, EVENT_ID);
    const query = queries.find((q) => q.sql.includes('from "events"."outbox"'));
    assert.ok(query);
    assert.ok(query.sql.includes('"status" = $1'));
  });

  it('updates outbox state through processing, published, failed, and dead-letter', async () => {
    const { db, queries } = createMockKysely();
    const repo = createOutboxRepository(db);

    // markProcessing
    await repo.markProcessing([EVENT_ID]);
    assert.ok(
      queries.some(
        (q) => q.sql.includes('update "events"."outbox"') && q.parameters.includes('PROCESSING'),
      ),
    );

    // markPublished
    await repo.markPublished(EVENT_ID);
    assert.ok(
      queries.some(
        (q) => q.sql.includes('update "events"."outbox"') && q.parameters.includes('PUBLISHED'),
      ),
    );

    // markFailed
    await repo.markFailed(EVENT_ID, 'Network timeout connecting to WhatsApp gateway');
    assert.ok(
      queries.some(
        (q) =>
          q.sql.includes('update "events"."outbox"') &&
          q.parameters.includes('Network timeout connecting to WhatsApp gateway'),
      ),
    );

    // markDeadLetter
    await repo.markDeadLetter(EVENT_ID, 'Max retries exceeded');
    assert.ok(
      queries.some(
        (q) => q.sql.includes('update "events"."outbox"') && q.parameters.includes('DEAD_LETTER'),
      ),
    );
  });

  it('creates and tracks notification logs', async () => {
    const mockLog: NotificationLogRow = {
      id: LOG_ID,
      store_id: STORE_ID,
      outbox_id: EVENT_ID,
      channel: 'WHATSAPP',
      recipient: '+919876543210',
      template_name: 'order_confirmed',
      payload: { order_number: 'ORD-123' },
      status: 'SENT',
      provider_message_id: 'wamid_123',
      sent_at: new Date(),
      delivered_at: null,
      error_message: null,
      created_at: new Date(),
    };

    const { db, queries } = createMockKysely({
      onExecuteQuery: (sql) => {
        if (sql.includes('insert into "events"."notification_logs"')) {
          return { rows: [mockLog] };
        }
        if (sql.includes('from "events"."notification_logs"')) {
          return { rows: [mockLog] };
        }
        return { rows: [] };
      },
    });

    const repo = createNotificationLogRepository(db);

    const log = await repo.createLog({
      storeId: STORE_ID,
      outboxId: EVENT_ID,
      channel: 'WHATSAPP',
      recipient: '+919876543210',
      templateName: 'order_confirmed',
      payload: { order_number: 'ORD-123' },
      providerMessageId: 'wamid_123',
      status: 'SENT',
    });

    assert.equal(log.id, LOG_ID);
    assert.equal(log.channel, 'WHATSAPP');

    await repo.updateStatus(LOG_ID, 'DELIVERED', 'wamid_123');
    assert.ok(
      queries.some(
        (q) =>
          q.sql.includes('update "events"."notification_logs"') &&
          q.parameters.includes('DELIVERED'),
      ),
    );

    const list = await repo.listByRecipient(STORE_ID, '+919876543210');
    assert.equal(list.length, 1);
  });
});
