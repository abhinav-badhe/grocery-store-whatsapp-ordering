import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createConversationCoordinator,
  type StoreChannelRepository,
  type InboundMessageRepository,
  type ConversationRepository,
  type QuoteRepository,
  type WhatsAppOutboundClient,
  type OrderLookupClient,
  type CreateOrderFromQuoteParams,
  CatalogResolver,
  type CatalogLookupClient,
  type InventoryLookupClient,
} from '../dist/index.js';
import type { ProvisionalQuoteSnapshot, Order } from '@grocery/api-contracts';

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const PHONE_NUMBER_ID = '109876543210987';
const SENDER_PHONE = '+919820011223';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';

describe('Quote to Order Bridge (Subphase 4)', () => {
  it('creates order in order-service with quote items when customer confirms', async () => {
    const outboundTexts: string[] = [];
    let linkedQuoteId: string | null = null;
    let linkedOrderId: string | null = null;
    let capturedOrderParams: CreateOrderFromQuoteParams | null = null;

    const mockQuote: ProvisionalQuoteSnapshot = {
      quoteId: 'quote-test-1',
      conversationId: 'conv-1',
      storeId: STORE_ID,
      quoteVersion: 1,
      isPayable: false,
      finalizationStatus: 'PROVISIONAL_PENDING_REVIEW',
      unresolvedCharges: [],
      hasUnpricedItems: false,
      knownSubtotalMinor: 24000,
      taxMinor: 0,
      deliveryMinor: 0,
      estimatedTotalMinor: 24000,
      currency: 'INR',
      items: [
        {
          rawText: '2kg Basmati Rice',
          productName: 'Basmati Rice',
          requestedQuantity: 2,
          requestedUnit: 'KG',
          outcome: 'EXACT_MATCH',
          matchedProduct: {
            id: 'prod-rice-1',
            storeId: STORE_ID,
            name: 'Basmati Rice',
            sku: 'RICE-01',
            priceCents: 12000,
            currency: 'INR',
            unit: 'KG',
            isWeightBased: true,
            availableQuantity: 50,
          },
          candidates: [],
          quantityMilliCatalogUnits: '2000',
          unitPriceCents: 12000,
          lineTotalCents: 24000,
          notes: null,
        },
      ],
      disclaimer: 'Provisional estimate only',
      expiresAt: new Date(Date.now() + 900000).toISOString(),
      createdAt: new Date().toISOString(),
    };

    const storeChannelRepo: StoreChannelRepository = {
      async findByPhoneNumberId() {
        return {
          id: 'chan-1',
          store_id: STORE_ID,
          phone_number_id: PHONE_NUMBER_ID,
          display_phone_number: '+919876543210',
          waba_id: 'waba-1',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        };
      },
      async findByStoreId() {
        return null;
      },
      async upsertChannel(ch) {
        return {
          ...ch,
          id: 'chan-1',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        };
      },
    };

    const inboundRepo: InboundMessageRepository = {
      async recordInboundMessage(input) {
        return {
          isDuplicate: false,
          message: {
            id: 'inb-1',
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
          id: 'conv-1',
          store_id: storeId,
          sender_phone_e164: senderPhone,
          state: 'PROVISIONAL_QUOTE_SENT',
          context: {},
          last_inbound_at: new Date(),
          last_outbound_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        };
      },
      async updateConversationState(id, state) {
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
      async saveProvisionalQuote() {
        return { quoteId: 'quote-test-1', version: 1 };
      },
      async getActiveQuote() {
        return mockQuote;
      },
      async linkQuoteToOrder(_storeId, quoteId, orderId) {
        linkedQuoteId = quoteId;
        linkedOrderId = orderId;
      },
    };

    const catalogClient: CatalogLookupClient = {
      async searchProducts() {
        return [];
      },
      async getProductById() {
        return null;
      },
    };

    const inventoryClient: InventoryLookupClient = {
      async getStockBalance() {
        return null;
      },
    };

    const catalogResolver = new CatalogResolver({ catalogClient, inventoryClient });

    const outboundClient: WhatsAppOutboundClient = {
      async sendTextMessage(params) {
        outboundTexts.push(params.text);
        return { messageId: 'msg-out' };
      },
      async sendButtonsMessage(params) {
        outboundTexts.push(params.bodyText);
        return { messageId: 'msg-out' };
      },
    };

    const orderClient: OrderLookupClient = {
      async createOrderFromQuote(params) {
        capturedOrderParams = params;
        return {
          id: ORDER_ID,
          storeId: params.storeId,
          customerId: null,
          orderNumber: 'ORD-TEST-1234',
          status: 'AWAITING_SHOPKEEPER_REVIEW',
          fulfillmentType: 'DELIVERY',
          deliveryAddress: null,
          customerPhone: params.customerPhone,
          customerName: null,
          totalAmountCents: 24000,
          currency: 'INR',
          notes: 'Submitted via WhatsApp',
          items: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      },
    };

    const coordinator = createConversationCoordinator({
      storeChannelRepo,
      inboundRepo,
      conversationRepo,
      quoteRepo,
      catalogResolver,
      outboundClient,
      orderClient,
    });

    const result = await coordinator.processInboundMessage({
      phoneNumberId: PHONE_NUMBER_ID,
      message: {
        providerMessageId: 'msg-CONFIRM-BRIDGED',
        fromPhoneE164: SENDER_PHONE,
        timestamp: '1700000000',
        type: 'text',
        text: 'CONFIRM',
      },
      rawPayload: {},
    });

    assert.equal(result.outcome, 'ORDER_SUBMITTED');

    // Verify order was created with quote items
    assert.ok(capturedOrderParams !== null);
    assert.equal((capturedOrderParams as CreateOrderFromQuoteParams).storeId, STORE_ID);
    assert.equal((capturedOrderParams as CreateOrderFromQuoteParams).customerPhone, SENDER_PHONE);
    assert.equal((capturedOrderParams as CreateOrderFromQuoteParams).items.length, 1);
    assert.equal(
      (capturedOrderParams as CreateOrderFromQuoteParams).items[0]?.productId,
      'prod-rice-1',
    );
    assert.equal((capturedOrderParams as CreateOrderFromQuoteParams).items[0]?.quantity, 2);

    // Verify quote was linked to created order
    assert.equal(linkedQuoteId, 'quote-test-1');
    assert.equal(linkedOrderId, ORDER_ID);

    // Verify outbound customer text included the order number
    assert.equal(outboundTexts.length, 1);
    assert.ok(outboundTexts[0]?.includes('Order Submitted (#ORD-TEST-1234)'));
  });
});
