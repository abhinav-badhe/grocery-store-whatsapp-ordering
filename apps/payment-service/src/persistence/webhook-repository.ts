import type { PaymentWebhookRow, WebhookStatus } from '@grocery/database';
import type { DatabaseConnection, PaymentWebhookRepository } from './types.js';
import { mapPaymentDatabaseError } from './errors.js';

export class KyselyPaymentWebhookRepository implements PaymentWebhookRepository {
  constructor(private readonly defaultDb: DatabaseConnection) {}

  private getExecutor(trx?: DatabaseConnection): DatabaseConnection {
    return trx ?? this.defaultDb;
  }

  async recordWebhook(
    webhook: {
      storeId: string;
      provider: string;
      eventId: string;
      eventType: string;
      payload: unknown;
      signature: string;
    },
    trx?: DatabaseConnection,
  ): Promise<PaymentWebhookRow> {
    try {
      return await this.getExecutor(trx)
        .insertInto('payment.payment_webhooks')
        .values({
          store_id: webhook.storeId,
          provider: webhook.provider,
          event_id: webhook.eventId,
          event_type: webhook.eventType,
          payload: JSON.stringify(webhook.payload),
          signature: webhook.signature,
          status: 'RECEIVED',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (err) {
      throw mapPaymentDatabaseError(
        err,
        `Failed to record webhook event '${webhook.eventId}' for provider '${webhook.provider}'`,
      );
    }
  }

  async findWebhook(
    provider: string,
    eventId: string,
    trx?: DatabaseConnection,
  ): Promise<PaymentWebhookRow | null> {
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('payment.payment_webhooks')
        .selectAll()
        .where('provider', '=', provider)
        .where('event_id', '=', eventId)
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapPaymentDatabaseError(
        err,
        `Failed to find webhook event '${eventId}' for provider '${provider}'`,
      );
    }
  }

  async markProcessed(
    id: string,
    status: WebhookStatus,
    trx?: DatabaseConnection,
  ): Promise<PaymentWebhookRow | null> {
    try {
      const row = await this.getExecutor(trx)
        .updateTable('payment.payment_webhooks')
        .set({
          status,
          processed_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapPaymentDatabaseError(err, `Failed to update webhook '${id}'`);
    }
  }
}

export function createPaymentWebhookRepository(db: DatabaseConnection): PaymentWebhookRepository {
  return new KyselyPaymentWebhookRepository(db);
}
