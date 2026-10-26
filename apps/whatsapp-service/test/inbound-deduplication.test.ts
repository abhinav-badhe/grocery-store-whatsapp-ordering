import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { InboundMessageRow } from '@grocery/database';

describe('Inbound Message Deduplication Ledger (Subphase 3)', () => {
  function createMockRepo() {
    const messages = new Map<string, InboundMessageRow>();

    const repo = {
      async recordInboundMessage(input: {
        providerMessageId: string;
        storeId: string | null;
        senderPhoneE164: string;
        payload: unknown;
      }) {
        if (messages.has(input.providerMessageId)) {
          return {
            isDuplicate: true as const,
            existingMessage: messages.get(input.providerMessageId)!,
          };
        }

        const row: InboundMessageRow = {
          id: `inbound-${messages.size + 1}`,
          provider_message_id: input.providerMessageId,
          store_id: input.storeId,
          sender_phone_e164: input.senderPhoneE164,
          payload: input.payload,
          status: 'RECEIVED',
          attempt_count: 0,
          max_retries: 5,
          locked_until: null,
          last_error: null,
          created_at: new Date(),
          processed_at: null,
        };

        messages.set(input.providerMessageId, row);
        return { isDuplicate: false as const, message: row };
      },

      async acquireProcessingLease(messageId: string, leaseDurationMs = 30000) {
        for (const row of messages.values()) {
          if (row.id === messageId) {
            const now = new Date();
            if (
              row.status === 'RECEIVED' ||
              row.status === 'FAILED' ||
              (row.status === 'PROCESSING' && row.locked_until && row.locked_until < now)
            ) {
              row.status = 'PROCESSING';
              row.attempt_count += 1;
              row.locked_until = new Date(now.getTime() + leaseDurationMs);
              return true;
            }
            return false;
          }
        }
        return false;
      },

      async markProcessed(messageId: string) {
        for (const row of messages.values()) {
          if (row.id === messageId) {
            row.status = 'PROCESSED';
            row.processed_at = new Date();
            row.locked_until = null;
          }
        }
      },

      async markFailed(messageId: string, errorDetail: string) {
        for (const row of messages.values()) {
          if (row.id === messageId) {
            row.status = 'FAILED';
            row.last_error = errorDetail;
            row.locked_until = null;
          }
        }
      },

      async findByProviderMessageId(providerMessageId: string) {
        return messages.get(providerMessageId) ?? null;
      },
    };

    return { repo, messages };
  }

  it('records initial inbound message with status RECEIVED', async () => {
    const { repo } = createMockRepo();
    const result = await repo.recordInboundMessage({
      providerMessageId: 'wamid.123',
      storeId: '00000000-0000-4000-8000-000000000001',
      senderPhoneE164: '+919820011223',
      payload: { text: '1kg sugar' },
    });

    assert.equal(result.isDuplicate, false);
    if (result.isDuplicate) {
      assert.fail('Expected isDuplicate to be false');
    }

    assert.equal(result.message.provider_message_id, 'wamid.123');
    assert.equal(result.message.status, 'RECEIVED');
    assert.equal(result.message.attempt_count, 0);
  });

  it('detects duplicate message ID and returns existing record without inserting duplicate', async () => {
    const { repo } = createMockRepo();
    const first = await repo.recordInboundMessage({
      providerMessageId: 'wamid.DUPLICATE_TEST',
      storeId: '00000000-0000-4000-8000-000000000001',
      senderPhoneE164: '+919820011223',
      payload: { text: '1kg sugar' },
    });
    assert.equal(first.isDuplicate, false);

    // Replay same message ID
    const duplicate = await repo.recordInboundMessage({
      providerMessageId: 'wamid.DUPLICATE_TEST',
      storeId: '00000000-0000-4000-8000-000000000001',
      senderPhoneE164: '+919820011223',
      payload: { text: '1kg sugar' },
    });
    assert.equal(duplicate.isDuplicate, true);
    if (!duplicate.isDuplicate) {
      assert.fail('Expected isDuplicate to be true');
    }

    assert.equal(duplicate.existingMessage.provider_message_id, 'wamid.DUPLICATE_TEST');
  });

  it('acquires lease and manages state lifecycle from PROCESSING to PROCESSED', async () => {
    const { repo } = createMockRepo();
    const recorded = await repo.recordInboundMessage({
      providerMessageId: 'wamid.LEASE_TEST',
      storeId: '00000000-0000-4000-8000-000000000001',
      senderPhoneE164: '+919820011223',
      payload: {},
    });

    assert.equal(recorded.isDuplicate, false);
    if (recorded.isDuplicate) {
      assert.fail('Expected isDuplicate to be false');
    }

    // Acquire lease
    const acquired = await repo.acquireProcessingLease(recorded.message.id, 60000);
    assert.equal(acquired, true);

    // Concurrent lease acquisition attempt should fail
    const concurrentAcquire = await repo.acquireProcessingLease(recorded.message.id, 60000);
    assert.equal(concurrentAcquire, false);

    // Mark processed
    await repo.markProcessed(recorded.message.id);
    const updated = await repo.findByProviderMessageId('wamid.LEASE_TEST');
    assert.equal(updated?.status, 'PROCESSED');
    assert.ok(updated?.processed_at !== null);
  });
});
