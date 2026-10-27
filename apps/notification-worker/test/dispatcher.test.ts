import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OutboxRow, NotificationLogRow } from '@grocery/database';
import {
  createNotificationDispatcher,
  createNotificationWorker,
  type OutboxRepository,
  type NotificationLogRepository,
  type NotificationChannelAdapter,
} from '../dist/index.js';

const STORE_ID = '00000000-0000-4000-8000-000000000001';
const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const AGGREGATE_ID = '22222222-2222-4222-8222-222222222222';
const LOG_ID = '33333333-3333-4333-8333-333333333333';

function createMockEvent(retryCount = 0, maxRetries = 3): OutboxRow {
  return {
    id: EVENT_ID,
    store_id: STORE_ID,
    event_type: 'order.confirmed.v1',
    aggregate_type: 'ORDER',
    aggregate_id: AGGREGATE_ID,
    payload: {
      order_id: AGGREGATE_ID,
      customer_phone: '+919876543210',
      total_amount_minor: 25000,
    },
    metadata: null,
    status: 'PENDING',
    retry_count: retryCount,
    max_retries: maxRetries,
    scheduled_at: new Date('2026-10-25T10:00:00Z'),
    processed_at: null,
    last_error: null,
    created_at: new Date('2026-10-25T10:00:00Z'),
  };
}

describe('Notification Dispatcher Engine & Delivery Tracking', () => {
  it('dispatches pending outbox events via WhatsApp, logs audit record, and marks event published', async () => {
    let publishedId = '';
    let processingIds: readonly string[] = [];
    let loggedParams: any;

    const mockOutboxRepo: OutboxRepository = {
      insertEvent: async () => ({}) as OutboxRow,
      fetchPending: async () => [createMockEvent()],
      markProcessing: async (ids) => {
        processingIds = ids;
      },
      markPublished: async (id) => {
        publishedId = id;
      },
      markFailed: async () => {},
      markDeadLetter: async () => {},
    };

    const mockLogRepo: NotificationLogRepository = {
      createLog: async (params) => {
        loggedParams = params;
        return {
          id: LOG_ID,
          store_id: params.storeId,
          outbox_id: params.outboxId ?? null,
          channel: params.channel,
          recipient: params.recipient,
          template_name: params.templateName,
          payload: params.payload,
          status: params.status ?? 'PENDING',
          provider_message_id: params.providerMessageId ?? null,
          sent_at: new Date(),
          delivered_at: null,
          error_message: null,
          created_at: new Date(),
        };
      },
      updateStatus: async () => {},
      listByRecipient: async () => [],
    };

    let sentMessage: any;
    const mockWhatsAppAdapter: NotificationChannelAdapter = {
      channel: 'WHATSAPP',
      send: async (msg) => {
        sentMessage = msg;
        return { success: true, providerMessageId: 'wamid_test_123' };
      },
    };

    const dispatcher = createNotificationDispatcher(mockOutboxRepo, mockLogRepo, [
      mockWhatsAppAdapter,
    ]);

    const result = await dispatcher.processPendingBatch(10);

    assert.equal(result.processed, 1);
    assert.equal(result.failed, 0);
    assert.equal(publishedId, EVENT_ID);
    assert.deepEqual(processingIds, [EVENT_ID]);
    assert.ok(sentMessage);
    assert.equal(sentMessage.recipient, '+919876543210');
    assert.equal(sentMessage.templateName, 'order_confirmed');
    assert.ok(loggedParams);
    assert.equal(loggedParams.providerMessageId, 'wamid_test_123');
  });

  it('schedules retry with exponential backoff when notification channel fails', async () => {
    let failedId = '';
    let failedError = '';
    let scheduledNextRetry: Date | undefined;

    const mockOutboxRepo: OutboxRepository = {
      insertEvent: async () => ({}) as OutboxRow,
      fetchPending: async () => [createMockEvent(1, 3)], // retryCount = 1, maxRetries = 3
      markProcessing: async () => {},
      markPublished: async () => {},
      markFailed: async (id, error, nextRetryAt) => {
        failedId = id;
        failedError = error;
        scheduledNextRetry = nextRetryAt;
      },
      markDeadLetter: async () => {},
    };

    const mockLogRepo: NotificationLogRepository = {
      createLog: async () => ({}) as NotificationLogRow,
      updateStatus: async () => {},
      listByRecipient: async () => [],
    };

    const mockFailingAdapter: NotificationChannelAdapter = {
      channel: 'WHATSAPP',
      send: async () => ({
        success: false,
        errorMessage: 'Meta Cloud API rate limit exceeded',
      }),
    };

    const dispatcher = createNotificationDispatcher(mockOutboxRepo, mockLogRepo, [
      mockFailingAdapter,
    ]);

    const result = await dispatcher.processPendingBatch(10);

    assert.equal(result.failed, 1);
    assert.equal(result.processed, 0);
    assert.equal(failedId, EVENT_ID);
    assert.equal(failedError, 'Meta Cloud API rate limit exceeded');
    assert.ok(scheduledNextRetry);
    // Exponential backoff for retry 2: 2^2 * 2s = 8 seconds delay
    assert.ok(scheduledNextRetry.getTime() > Date.now() + 5000);
  });

  it('moves event to DEAD_LETTER when maximum retries are exhausted', async () => {
    let deadLetteredId = '';
    let deadLetterError = '';

    const mockOutboxRepo: OutboxRepository = {
      insertEvent: async () => ({}) as OutboxRow,
      fetchPending: async () => [createMockEvent(2, 3)], // retry_count = 2, max_retries = 3 -> next retry is 3 (max exhausted)
      markProcessing: async () => {},
      markPublished: async () => {},
      markFailed: async () => {},
      markDeadLetter: async (id, error) => {
        deadLetteredId = id;
        deadLetterError = error;
      },
    };

    const mockLogRepo: NotificationLogRepository = {
      createLog: async () => ({}) as NotificationLogRow,
      updateStatus: async () => {},
      listByRecipient: async () => [],
    };

    const mockFailingAdapter: NotificationChannelAdapter = {
      channel: 'WHATSAPP',
      send: async () => ({
        success: false,
        errorMessage: 'Permanent template rejection',
      }),
    };

    const dispatcher = createNotificationDispatcher(mockOutboxRepo, mockLogRepo, [
      mockFailingAdapter,
    ]);

    const result = await dispatcher.processPendingBatch(10);

    assert.equal(result.deadLettered, 1);
    assert.equal(deadLetteredId, EVENT_ID);
    assert.equal(deadLetterError, 'Permanent template rejection');
  });

  it('runs worker lifecycle with start and stop', async () => {
    let executed = false;
    const worker = createNotificationWorker({
      pollingIntervalMs: 50,
      jobHandler: async () => {
        executed = true;
      },
    });

    const statusBefore = worker.getStatus();
    assert.equal(statusBefore.status, 'stopped');

    await worker.start();
    const statusRunning = worker.getStatus();
    assert.equal(statusRunning.status, 'running');

    // Wait for at least 1 job execution cycle
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(executed, true);

    await worker.stop();
    const statusStopped = worker.getStatus();
    assert.equal(statusStopped.status, 'stopped');
  });

  it('deduplicates redelivered events via consumer inbox without duplicate dispatch (ADR-009)', async () => {
    let sendCount = 0;
    const mockOutboxRepo: OutboxRepository = {
      insertEvent: async () => ({}) as OutboxRow,
      fetchPending: async () => [createMockEvent()],
      markProcessing: async () => {},
      markPublished: async () => {},
      markFailed: async () => {},
      markDeadLetter: async () => {},
    };
    const mockLogRepo: NotificationLogRepository = {
      createLog: async () => ({}) as NotificationLogRow,
      updateStatus: async () => {},
      listByRecipient: async () => [],
    };
    const mockAdapter: NotificationChannelAdapter = {
      channel: 'WHATSAPP',
      send: async () => {
        sendCount++;
        return { success: true, providerMessageId: 'msg-1' };
      },
    };

    const dispatcher = createNotificationDispatcher(mockOutboxRepo, mockLogRepo, [mockAdapter]);

    // First delivery
    const result1 = await dispatcher.processPendingBatch(10);
    assert.equal(result1.processed, 1);
    assert.equal(sendCount, 1);

    // Duplicate redelivery of the same event
    const result2 = await dispatcher.processPendingBatch(10);
    assert.equal(result2.processed, 1);
    // Send count must still be 1 (zero duplicate dispatch)
    assert.equal(sendCount, 1);
  });
});
