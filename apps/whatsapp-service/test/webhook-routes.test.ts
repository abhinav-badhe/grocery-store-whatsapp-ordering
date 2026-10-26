import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createWhatsAppService,
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

const TEST_VERIFY_TOKEN = 'test-meta-verify-token-xyz';
const TEST_APP_SECRET = 'test-meta-app-secret-32-chars-long!!';
const TEST_PHONE_NUMBER_ID = '109876543210987';
const TEST_STORE_ID = '00000000-0000-4000-8000-000000000001';

function signPayload(payloadString: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(Buffer.from(payloadString, 'utf8'));
  return `sha256=${hmac.digest('hex')}`;
}

describe('WhatsApp Webhook HTTP Ingress & Verification (Subphase 3)', () => {
  function createMockCoordinator(outboundMessages: string[] = []) {
    const mockStoreChannelRepo: StoreChannelRepository = {
      async findByPhoneNumberId(phoneId) {
        if (phoneId === TEST_PHONE_NUMBER_ID) {
          return {
            id: 'channel-1',
            store_id: TEST_STORE_ID,
            phone_number_id: TEST_PHONE_NUMBER_ID,
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

    const mockInboundRepo: InboundMessageRepository = {
      async recordInboundMessage(input) {
        return {
          isDuplicate: false,
          message: {
            id: 'inbound-1',
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

    const mockConversationRepo: ConversationRepository = {
      async getOrCreateConversation(storeId, senderPhone) {
        return {
          id: 'conv-1',
          store_id: storeId,
          sender_phone_e164: senderPhone,
          state: 'INITIATED',
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
          store_id: TEST_STORE_ID,
          sender_phone_e164: '+919820011223',
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

    const mockQuoteRepo: QuoteRepository = {
      async saveProvisionalQuote() {
        return { quoteId: 'quote-1', version: 1 };
      },
      async getActiveQuote() {
        return null;
      },
      async linkQuoteToOrder() {},
    };

    const mockCatalogClient: CatalogLookupClient = {
      async searchProducts(_storeId, term) {
        if (term.toLowerCase().includes('rice')) {
          return [
            {
              id: 'p-1',
              storeId: TEST_STORE_ID,
              name: 'Basmati Rice',
              slug: 'basmati-rice',
              priceCents: 12000,
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

    const mockInventoryClient: InventoryLookupClient = {
      async getStockBalance() {
        return {
          id: 'b-1',
          storeId: TEST_STORE_ID,
          productId: 'p-1',
          sku: 'RICE-01',
          onHandQuantity: 50,
          reservedQuantity: 0,
          availableQuantity: 50,
          reorderPoint: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      },
    };

    const catalogResolver = new CatalogResolver({
      catalogClient: mockCatalogClient,
      inventoryClient: mockInventoryClient,
    });

    const mockOutboundClient: WhatsAppOutboundClient = {
      async sendTextMessage(params) {
        outboundMessages.push(params.text);
        return { messageId: 'msg-out-1' };
      },
      async sendButtonsMessage(params) {
        outboundMessages.push(params.bodyText);
        return { messageId: 'msg-out-2' };
      },
    };

    return createConversationCoordinator({
      storeChannelRepo: mockStoreChannelRepo,
      inboundRepo: mockInboundRepo,
      conversationRepo: mockConversationRepo,
      quoteRepo: mockQuoteRepo,
      catalogResolver,
      outboundClient: mockOutboundClient,
    });
  }

  it('satisfies Meta webhook handshake (GET) when verify token is correct', async () => {
    const coordinator = createMockCoordinator();
    const service = createWhatsAppService({
      port: 0,
      coordinator,
      verifyToken: TEST_VERIFY_TOKEN,
      appSecret: TEST_APP_SECRET,
    });

    const { port } = await service.start();
    try {
      const challengeStr = 'challenge_string_12345';
      const url = `http://127.0.0.1:${port}/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${TEST_VERIFY_TOKEN}&hub.challenge=${challengeStr}`;
      const res = await fetch(url);

      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
      const body = await res.text();
      assert.equal(body, challengeStr);
    } finally {
      await service.stop();
    }
  });

  it('rejects Meta webhook handshake (GET) with 403 when verify token mismatches', async () => {
    const coordinator = createMockCoordinator();
    const service = createWhatsAppService({
      port: 0,
      coordinator,
      verifyToken: TEST_VERIFY_TOKEN,
      appSecret: TEST_APP_SECRET,
    });

    const { port } = await service.start();
    try {
      const url = `http://127.0.0.1:${port}/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=WRONG_TOKEN&hub.challenge=123`;
      const res = await fetch(url);

      assert.equal(res.status, 403);
      const json = (await res.json()) as { code: string };
      assert.equal(json.code, 'INVALID_VERIFY_TOKEN');
    } finally {
      await service.stop();
    }
  });

  it('rejects POST webhook with 401 when X-Hub-Signature-256 is missing or invalid', async () => {
    const coordinator = createMockCoordinator();
    const service = createWhatsAppService({
      port: 0,
      coordinator,
      verifyToken: TEST_VERIFY_TOKEN,
      appSecret: TEST_APP_SECRET,
    });

    const { port } = await service.start();
    try {
      const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

      // 1. Missing signature
      const resMissing = await fetch(`http://127.0.0.1:${port}/api/v1/whatsapp/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      assert.equal(resMissing.status, 401);

      // 2. Tampered signature
      const resTampered = await fetch(`http://127.0.0.1:${port}/api/v1/whatsapp/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': 'sha256=invalidhexsignature',
        },
        body: payload,
      });
      assert.equal(resTampered.status, 401);
    } finally {
      await service.stop();
    }
  });

  it('processes validly signed POST webhook, parses grocery list, and sends quote summary', async () => {
    const outboundMessages: string[] = [];
    const coordinator = createMockCoordinator(outboundMessages);
    const service = createWhatsAppService({
      port: 0,
      coordinator,
      verifyToken: TEST_VERIFY_TOKEN,
      appSecret: TEST_APP_SECRET,
    });

    const { port } = await service.start();
    try {
      const webhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-1',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '+919876543210',
                    phone_number_id: TEST_PHONE_NUMBER_ID,
                  },
                  messages: [
                    {
                      id: 'wamid.HBgLM...',
                      from: '919820011223',
                      timestamp: '1700000000',
                      type: 'text',
                      text: {
                        body: '1kg Basmati Rice',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const payloadStr = JSON.stringify(webhookPayload);
      const signature = signPayload(payloadStr, TEST_APP_SECRET);

      const res = await fetch(`http://127.0.0.1:${port}/api/v1/whatsapp/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signature,
        },
        body: payloadStr,
      });

      assert.equal(res.status, 200);
      const resJson = (await res.json()) as {
        received: boolean;
        processed: Array<{ outcome: string }>;
      };
      assert.equal(resJson.received, true);
      assert.equal(resJson.processed[0]?.outcome, 'PROVISIONAL_QUOTE_SENT');

      // Verify that outbound WhatsApp summary was generated
      assert.equal(outboundMessages.length, 1);
      assert.ok(outboundMessages[0]?.includes('Estimated Grocery Quote'));
      assert.ok(outboundMessages[0]?.includes('Basmati Rice'));
      assert.ok(outboundMessages[0]?.includes('₹120.00'));
    } finally {
      await service.stop();
    }
  });
});
