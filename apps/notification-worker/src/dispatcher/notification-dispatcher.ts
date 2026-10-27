import type { OutboxRow, NotificationChannel } from '@grocery/database';
import type { OutboxRepository, NotificationLogRepository } from '../persistence/types.js';
import type { NotificationChannelAdapter, NotificationMessage } from '../channels/types.js';
import { WhatsAppChannelAdapter } from '../channels/whatsapp-adapter.js';
import { SmsChannelAdapter } from '../channels/sms-adapter.js';

import {
  InMemoryInboxRepository,
  type InboxRepositoryPort,
} from '../persistence/inbox-repository.js';

export interface DispatcherResult {
  readonly processed: number;
  readonly failed: number;
  readonly deadLettered: number;
}

export class NotificationDispatcher {
  private readonly adapters: Map<NotificationChannel, NotificationChannelAdapter>;

  constructor(
    private readonly outboxRepo: OutboxRepository,
    private readonly logRepo: NotificationLogRepository,
    adapters?: readonly NotificationChannelAdapter[],
    private readonly inboxRepo: InboxRepositoryPort = new InMemoryInboxRepository(),
  ) {
    this.adapters = new Map();
    if (adapters && adapters.length > 0) {
      for (const adapter of adapters) {
        this.adapters.set(adapter.channel, adapter);
      }
    } else {
      this.adapters.set('WHATSAPP', new WhatsAppChannelAdapter());
      this.adapters.set('SMS', new SmsChannelAdapter());
    }
  }

  async processPendingBatch(batchSize = 50): Promise<DispatcherResult> {
    const events = await this.outboxRepo.fetchPending(batchSize);
    if (events.length === 0) {
      return { processed: 0, failed: 0, deadLettered: 0 };
    }

    const eventIds = events.map((e) => e.id);
    await this.outboxRepo.markProcessing(eventIds);

    let processed = 0;
    let failed = 0;
    let deadLettered = 0;

    for (const event of events) {
      try {
        // ADR-009 Consumer Inbox Deduplication:
        const isNew = await this.inboxRepo.recordProcessed(event.id, 'notification-worker');
        if (!isNew) {
          await this.outboxRepo.markPublished(event.id);
          processed++;
          continue;
        }

        const messages = this.mapEventToNotifications(event);

        let eventSuccess = true;
        let lastError = '';

        for (const msg of messages) {
          const adapter = this.adapters.get(msg.channel) ?? this.adapters.get('WHATSAPP');
          if (!adapter) {
            throw new Error(`No adapter registered for channel '${msg.channel}'`);
          }

          const sendResult = await adapter.send(msg);

          const log = await this.logRepo.createLog({
            storeId: msg.storeId,
            outboxId: msg.outboxId,
            channel: msg.channel,
            recipient: msg.recipient,
            templateName: msg.templateName,
            payload: msg.payload ?? msg.variables,
            status: sendResult.success ? 'SENT' : 'FAILED',
            providerMessageId: sendResult.providerMessageId,
          });

          if (!sendResult.success) {
            eventSuccess = false;
            lastError = sendResult.errorMessage ?? 'Failed to send notification';
            await this.logRepo.updateStatus(log.id, 'FAILED', null, lastError);
          }
        }

        if (eventSuccess) {
          await this.outboxRepo.markPublished(event.id);
          processed++;
        } else {
          failed++;
          if (event.retry_count + 1 >= event.max_retries) {
            await this.outboxRepo.markDeadLetter(event.id, lastError);
            deadLettered++;
          } else {
            // Exponential backoff: 2^(retry_count + 1) * 2 seconds
            const delaySec = Math.pow(2, event.retry_count + 1) * 2;
            const nextRetryAt = new Date(Date.now() + delaySec * 1000);
            await this.outboxRepo.markFailed(event.id, lastError, nextRetryAt);
          }
        }
      } catch (err) {
        failed++;
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (event.retry_count + 1 >= event.max_retries) {
          await this.outboxRepo.markDeadLetter(event.id, errorMessage);
          deadLettered++;
        } else {
          const nextRetryAt = new Date(Date.now() + 5000);
          await this.outboxRepo.markFailed(event.id, errorMessage, nextRetryAt);
        }
      }
    }

    return { processed, failed, deadLettered };
  }

  private mapEventToNotifications(event: OutboxRow): NotificationMessage[] {
    let payload: Record<string, any>;
    try {
      payload =
        typeof event.payload === 'string' ? JSON.parse(event.payload) : (event.payload as any);
    } catch {
      payload = {};
    }

    const recipient = String(payload.customer_phone ?? payload.recipient ?? '+919876543210');
    const orderNumber = String(payload.order_number ?? payload.order_id ?? 'ORD-REF');

    const baseVariables: Record<string, string> = {
      order_number: orderNumber,
      amount: String(
        payload.total_amount_minor ? payload.total_amount_minor / 100 : (payload.amount ?? '0'),
      ),
    };

    let templateName = 'order_status_update';
    if (event.event_type.includes('confirmed')) {
      templateName = 'order_confirmed';
    } else if (event.event_type.includes('dispatched') || event.event_type.includes('ready')) {
      templateName = 'order_dispatched';
    } else if (event.event_type.includes('cancelled')) {
      templateName = 'order_cancelled';
    } else if (event.event_type.includes('payment')) {
      templateName = 'payment_confirmed';
    }

    return [
      {
        storeId: event.store_id,
        outboxId: event.id,
        channel: 'WHATSAPP',
        recipient,
        templateName,
        variables: baseVariables,
        payload,
      },
    ];
  }
}

export function createNotificationDispatcher(
  outboxRepo: OutboxRepository,
  logRepo: NotificationLogRepository,
  adapters?: readonly NotificationChannelAdapter[],
): NotificationDispatcher {
  return new NotificationDispatcher(outboxRepo, logRepo, adapters);
}
