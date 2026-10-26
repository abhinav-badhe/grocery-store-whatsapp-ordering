import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createConversationCoordinator,
  type StoreChannelRepository,
  type InboundMessageRepository,
  type ConversationRepository,
  type QuoteRepository,
  type WhatsAppOutboundClient,
  CatalogResolver,
  type CatalogLookupClient,
  type InventoryLookupClient,
} from '../dist/index.js';
import type { ProvisionalQuoteSnapshot } from '@grocery/api-contracts';

const STORE_ID = '00000000-0000-4000-8000-000000000001';
const PHONE_NUMBER_ID = '109876543210987';
const SENDER_PHONE = '+919820011223';

describe('Conversation Coordinator Turn Orchestration (Subphase 3)', () => {
  function setupTestEnvironment(initialQuote?: ProvisionalQuoteSnapshot) {
    const outboundTexts: string[] = [];
    let currentActiveQuote: ProvisionalQuoteSnapshot | null = initialQuote ?? null;
    let currentConversationState = 'INITIATED';

    const storeChannelRepo: StoreChannelRepository = {
      async findByPhoneNumberId(phoneId) {
        if (phoneId === PHONE_NUMBER_ID) {
          return {
            id: 'channel-1',
            store_id: STORE_ID,
            phone_number_id: PHONE_NUMBER_ID,
            display_phone_number: '+919876543210',
            waba_id: 'waba-1',
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
          };
        }
        return null;
      },
      async findByStoreId() {
        return null;
      },
      async upsertChannel(ch) {
        return {
          ...ch,
          id: 'channel-1',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        };
      },
    };

    const seenMessages = new Set<string>();
    const inboundRepo: InboundMessageRepository = {
      async recordInboundMessage(input) {
        if (seenMessages.has(input.providerMessageId)) {
          return {
            isDuplicate: true,
            existingMessage: {
              id: 'inbound-existing',
              provider_message_id: input.providerMessageId,
              store_id: input.storeId,
              sender_phone_e164: input.senderPhoneE164,
              payload: input.payload,
              status: 'PROCESSED',
              attempt_count: 1,
              max_retries: 5,
              locked_until: null,
              last_error: null,
              created_at: new Date(),
              processed_at: new Date(),
            },
          };
        }
        seenMessages.add(input.providerMessageId);
        return {
          isDuplicate: false,
          message: {
            id: 'inbound-new',
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
          },
        };
      },
      async acquireProcessingLease() {
        return true;
      },
      async markProcessed() {},
      async markFailed() {},
      async findByProviderMessageId() {
        return null;
      },
    };

    const conversationRepo: ConversationRepository = {
      async getOrCreateConversation(storeId, senderPhone) {
        return {
          id: 'conv-123',
          store_id: storeId,
          sender_phone_e164: senderPhone,
          state: currentConversationState,
          context: {},
          last_inbound_at: new Date(),
          last_outbound_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        };
      },
      async updateConversationState(id, state) {
        currentConversationState = state;
        return {
          id,
          store_id: STORE_ID,
          sender_phone_e164: SENDER_PHONE,
          state,
          context: {},
          last_inbound_at: new Date(),
          last_outbound_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        };
      },
      async findById() {
        return null;
      },
      async recordOutboundActivity() {},
    };

    const quoteRepo: QuoteRepository = {
      async saveProvisionalQuote(_storeId, _convId, snapshot) {
        currentActiveQuote = snapshot;
        return { quoteId: 'quote-abc', version: 1 };
      },
      async getActiveQuote() {
        return currentActiveQuote;
      },
      async linkQuoteToOrder() {},
    };

    const catalogClient: CatalogLookupClient = {
      async searchProducts(_storeId, term) {
        if (term.toLowerCase().includes('rice')) {
          return [
            {
              id: 'p-rice',
              storeId: STORE_ID,
              name: 'Basmati Rice',
              slug: 'basmati-rice',
              priceCents: 10000,
              currency: 'INR',
              unit: 'KG',
              isWeightBased: true,
              status: 'ACTIVE',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ];
        }
        return [];
      },
      async getProductById() {
        return null;
      },
    };

    const inventoryClient: InventoryLookupClient = {
      async getStockBalance() {
        return {
          id: 'b-rice',
          storeId: STORE_ID,
          productId: 'p-rice',
          sku: 'RICE-01',
          onHandQuantity: 100,
          reservedQuantity: 0,
          availableQuantity: 100,
          reorderPoint: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      },
    };

    const catalogResolver = new CatalogResolver({ catalogClient, inventoryClient });

    const outboundClient: WhatsAppOutboundClient = {
      async sendTextMessage(params) {
        outboundTexts.push(params.text);
        return { messageId: 'out-1' };
      },
      async sendButtonsMessage(params) {
        outboundTexts.push(params.bodyText);
        return { messageId: 'out-2' };
      },
    };

    const coordinator = createConversationCoordinator({
      storeChannelRepo,
      inboundRepo,
      conversationRepo,
      quoteRepo,
      catalogResolver,
      outboundClient,
    });

    return {
      coordinator,
      outboundTexts,
      getActiveQuote: () => currentActiveQuote,
      getConversationState: () => currentConversationState,
    };
  }

  it('fails with STORE_CHANNEL_NOT_FOUND when phone number ID does not map to store channel', async () => {
    const { coordinator } = setupTestEnvironment();
    const result = await coordinator.processInboundMessage({
      phoneNumberId: 'UNKNOWN_PHONE_ID',
      message: {
        providerMessageId: 'msg-1',
        fromPhoneE164: SENDER_PHONE,
        timestamp: '1700000000',
        type: 'text',
        text: 'hello',
      },
      rawPayload: {},
    });

    assert.equal(result.outcome, 'STORE_CHANNEL_NOT_FOUND');
  });

  it('drops duplicate inbound messages without processing or sending replies', async () => {
    const { coordinator, outboundTexts } = setupTestEnvironment();

    // First delivery
    const res1 = await coordinator.processInboundMessage({
      phoneNumberId: PHONE_NUMBER_ID,
      message: {
        providerMessageId: 'msg-DUPE-TEST',
        fromPhoneE164: SENDER_PHONE,
        timestamp: '1700000000',
        type: 'text',
        text: 'hi',
      },
      rawPayload: {},
    });
    assert.equal(res1.outcome, 'GREETING_SENT');
    assert.equal(outboundTexts.length, 1);

    // Replay duplicate delivery
    const res2 = await coordinator.processInboundMessage({
      phoneNumberId: PHONE_NUMBER_ID,
      message: {
        providerMessageId: 'msg-DUPE-TEST',
        fromPhoneE164: SENDER_PHONE,
        timestamp: '1700000000',
        type: 'text',
        text: 'hi',
      },
      rawPayload: {},
    });
    assert.equal(res2.outcome, 'DUPLICATE_DROPPED');
    // Outbound messages count must remain exactly 1
    assert.equal(outboundTexts.length, 1);
  });

  it('processes grocery list, creates provisional quote, and sends customer summary text', async () => {
    const { coordinator, outboundTexts, getActiveQuote } = setupTestEnvironment();

    const res = await coordinator.processInboundMessage({
      phoneNumberId: PHONE_NUMBER_ID,
      message: {
        providerMessageId: 'msg-GROCERY-LIST',
        fromPhoneE164: SENDER_PHONE,
        timestamp: '1700000000',
        type: 'text',
        text: '2kg Basmati Rice',
      },
      rawPayload: {},
    });

    assert.equal(res.outcome, 'PROVISIONAL_QUOTE_SENT');
    if (res.outcome === 'PROVISIONAL_QUOTE_SENT') {
      assert.equal(res.quote.isPayable, false);
      assert.equal(res.quote.knownSubtotalMinor, 20000); // 2kg @ 100/kg
    }

    assert.equal(outboundTexts.length, 1);
    assert.ok(outboundTexts[0]?.includes('Estimated Grocery Quote'));
    assert.ok(outboundTexts[0]?.includes('Basmati Rice (2 KG): ₹200.00'));
    assert.ok(outboundTexts[0]?.includes('Reply *CONFIRM*'));

    const quote = getActiveQuote();
    assert.ok(quote !== null);
    assert.equal(quote?.isPayable, false);
  });

  it('handles customer CONFIRM message and transitions state to SUBMITTED_TO_SHOPKEEPER', async () => {
    const mockActiveQuote: ProvisionalQuoteSnapshot = {
      quoteId: 'quote-active-1',
      conversationId: 'conv-123',
      storeId: STORE_ID,
      quoteVersion: 1,
      isPayable: false,
      finalizationStatus: 'PROVISIONAL_PENDING_REVIEW',
      unresolvedCharges: [],
      hasUnpricedItems: false,
      knownSubtotalMinor: 20000,
      taxMinor: 0,
      deliveryMinor: 0,
      estimatedTotalMinor: 20000,
      currency: 'INR',
      items: [],
      disclaimer: 'Provisional estimate only',
      expiresAt: new Date(Date.now() + 900000).toISOString(),
      createdAt: new Date().toISOString(),
    };

    const { coordinator, outboundTexts, getConversationState } =
      setupTestEnvironment(mockActiveQuote);

    const res = await coordinator.processInboundMessage({
      phoneNumberId: PHONE_NUMBER_ID,
      message: {
        providerMessageId: 'msg-CONFIRM-ACTION',
        fromPhoneE164: SENDER_PHONE,
        timestamp: '1700000000',
        type: 'text',
        text: 'CONFIRM',
      },
      rawPayload: {},
    });

    assert.equal(res.outcome, 'ORDER_SUBMITTED');
    assert.equal(getConversationState(), 'SUBMITTED_TO_SHOPKEEPER');

    assert.equal(outboundTexts.length, 1);
    assert.ok(outboundTexts[0]?.includes('Order Submitted!'));
  });
});
