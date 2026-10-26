import type { NotificationLogRow, NotificationStatus } from '@grocery/database';
import type {
  DatabaseConnection,
  NotificationLogRepository,
  CreateNotificationLogParams,
} from './types.js';

export class KyselyNotificationLogRepository implements NotificationLogRepository {
  constructor(private readonly defaultDb: DatabaseConnection) {}

  private getExecutor(trx?: DatabaseConnection): DatabaseConnection {
    return trx ?? this.defaultDb;
  }

  async createLog(
    params: CreateNotificationLogParams,
    trx?: DatabaseConnection,
  ): Promise<NotificationLogRow> {
    return this.getExecutor(trx)
      .insertInto('events.notification_logs')
      .values({
        store_id: params.storeId,
        outbox_id: params.outboxId ?? null,
        channel: params.channel,
        recipient: params.recipient,
        template_name: params.templateName,
        payload: JSON.stringify(params.payload),
        status: params.status ?? 'PENDING',
        provider_message_id: params.providerMessageId ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateStatus(
    id: string,
    status: NotificationStatus,
    providerMessageId?: string | null,
    errorMessage?: string | null,
    trx?: DatabaseConnection,
  ): Promise<void> {
    const updatePayload: Record<string, unknown> = {
      status,
    };
    if (status === 'SENT') {
      updatePayload.sent_at = new Date();
    } else if (status === 'DELIVERED') {
      updatePayload.delivered_at = new Date();
    }
    if (providerMessageId) {
      updatePayload.provider_message_id = providerMessageId;
    }
    if (errorMessage) {
      updatePayload.error_message = errorMessage;
    }

    await this.getExecutor(trx)
      .updateTable('events.notification_logs')
      .set(updatePayload)
      .where('id', '=', id)
      .execute();
  }

  async listByRecipient(
    storeId: string,
    recipient: string,
    trx?: DatabaseConnection,
  ): Promise<NotificationLogRow[]> {
    return this.getExecutor(trx)
      .selectFrom('events.notification_logs')
      .selectAll()
      .where('store_id', '=', storeId)
      .where('recipient', '=', recipient)
      .orderBy('created_at', 'desc')
      .execute();
  }
}

export function createNotificationLogRepository(db: DatabaseConnection): NotificationLogRepository {
  return new KyselyNotificationLogRepository(db);
}
