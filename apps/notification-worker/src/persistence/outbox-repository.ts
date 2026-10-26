import { sql } from 'kysely';
import type { OutboxRow } from '@grocery/database';
import type { DatabaseConnection, OutboxRepository, InsertOutboxEventParams } from './types.js';

export class KyselyOutboxRepository implements OutboxRepository {
  constructor(private readonly defaultDb: DatabaseConnection) {}

  private getExecutor(trx?: DatabaseConnection): DatabaseConnection {
    return trx ?? this.defaultDb;
  }

  async insertEvent(params: InsertOutboxEventParams, trx?: DatabaseConnection): Promise<OutboxRow> {
    return this.getExecutor(trx)
      .insertInto('events.outbox')
      .values({
        store_id: params.storeId,
        event_type: params.eventType,
        aggregate_type: params.aggregateType,
        aggregate_id: params.aggregateId,
        payload: JSON.stringify(params.payload),
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
        status: 'PENDING',
        retry_count: 0,
        max_retries: 5,
        scheduled_at: params.scheduledAt ?? new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async fetchPending(limit = 50, trx?: DatabaseConnection): Promise<OutboxRow[]> {
    return this.getExecutor(trx)
      .selectFrom('events.outbox')
      .selectAll()
      .where('status', '=', 'PENDING')
      .where('scheduled_at', '<=', new Date())
      .orderBy('scheduled_at', 'asc')
      .limit(limit)
      .execute();
  }

  async markProcessing(ids: readonly string[], trx?: DatabaseConnection): Promise<void> {
    if (ids.length === 0) return;
    await this.getExecutor(trx)
      .updateTable('events.outbox')
      .set({ status: 'PROCESSING' })
      .where('id', 'in', ids as string[])
      .execute();
  }

  async markPublished(id: string, trx?: DatabaseConnection): Promise<void> {
    await this.getExecutor(trx)
      .updateTable('events.outbox')
      .set({
        status: 'PUBLISHED',
        processed_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
  }

  async markFailed(
    id: string,
    error: string,
    nextRetryAt?: Date,
    trx?: DatabaseConnection,
  ): Promise<void> {
    const scheduled = nextRetryAt ?? new Date(Date.now() + 5000); // 5s default retry delay
    await this.getExecutor(trx)
      .updateTable('events.outbox')
      .set({
        status: 'PENDING',
        retry_count: sql<number>`retry_count + 1`,
        last_error: error,
        scheduled_at: scheduled,
      })
      .where('id', '=', id)
      .execute();
  }

  async markDeadLetter(id: string, error: string, trx?: DatabaseConnection): Promise<void> {
    await this.getExecutor(trx)
      .updateTable('events.outbox')
      .set({
        status: 'DEAD_LETTER',
        last_error: error,
        processed_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
  }
}

export function createOutboxRepository(db: DatabaseConnection): OutboxRepository {
  return new KyselyOutboxRepository(db);
}
