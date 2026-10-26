import type { Kysely, Transaction } from 'kysely';
import type {
  Database,
  OutboxRow,
  NewOutbox,
  OutboxStatus,
  NotificationLogRow,
  NewNotificationLog,
  NotificationStatus,
  NotificationChannel,
} from '@grocery/database';

export type DatabaseConnection = Kysely<Database> | Transaction<Database>;

export interface InsertOutboxEventParams {
  readonly storeId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly metadata?: unknown | null;
  readonly scheduledAt?: Date;
}

export interface OutboxRepository {
  insertEvent(params: InsertOutboxEventParams, trx?: DatabaseConnection): Promise<OutboxRow>;

  fetchPending(limit?: number, trx?: DatabaseConnection): Promise<OutboxRow[]>;

  markProcessing(ids: readonly string[], trx?: DatabaseConnection): Promise<void>;

  markPublished(id: string, trx?: DatabaseConnection): Promise<void>;

  markFailed(
    id: string,
    error: string,
    nextRetryAt?: Date,
    trx?: DatabaseConnection,
  ): Promise<void>;

  markDeadLetter(id: string, error: string, trx?: DatabaseConnection): Promise<void>;
}

export interface CreateNotificationLogParams {
  readonly storeId: string;
  readonly outboxId?: string | null;
  readonly channel: NotificationChannel;
  readonly recipient: string;
  readonly templateName: string;
  readonly payload: unknown;
  readonly status?: NotificationStatus;
  readonly providerMessageId?: string | null;
}

export interface NotificationLogRepository {
  createLog(
    params: CreateNotificationLogParams,
    trx?: DatabaseConnection,
  ): Promise<NotificationLogRow>;

  updateStatus(
    id: string,
    status: NotificationStatus,
    providerMessageId?: string | null,
    errorMessage?: string | null,
    trx?: DatabaseConnection,
  ): Promise<void>;

  listByRecipient(
    storeId: string,
    recipient: string,
    trx?: DatabaseConnection,
  ): Promise<NotificationLogRow[]>;
}
