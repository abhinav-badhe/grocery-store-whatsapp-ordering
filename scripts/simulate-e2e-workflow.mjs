import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mintInternalToken } from '../packages/service-runtime/dist/index.js';

// Import service factories from dist
import {
  createCatalogService,
  createCatalogServiceInstance,
} from '../apps/catalog-service/dist/index.js';
import {
  createInventoryService,
  createInventoryServiceInstance,
} from '../apps/inventory-service/dist/index.js';
import {
  createOrderService,
  createOrderServiceInstance,
  HttpInventoryClient,
} from '../apps/order-service/dist/index.js';
import {
  createPaymentService,
  createPaymentServiceInstance,
  HttpOrderLookupClient as PaymentOrderClient,
} from '../apps/payment-service/dist/index.js';
import {
  createWhatsAppService,
  createConversationCoordinator,
  CatalogResolver,
  HttpCatalogLookupClient,
  HttpInventoryLookupClient,
  HttpOrderLookupClient as WhatsAppOrderClient,
} from '../apps/whatsapp-service/dist/index.js';
import { createApiGateway } from '../apps/api-gateway/dist/index.js';
import { createNotificationDispatcher } from '../apps/notification-worker/dist/index.js';
import { createWebService } from '../apps/web/dist/index.js';

console.log('========================================================================');
console.log('🚀 END-TO-END CROSS-SERVICE WORKFLOW SIMULATION');
console.log('========================================================================\n');

const STORE_ID = '00000000-0000-4000-8000-000000000001';
const INTERNAL_SECRET = 'simulation-internal-token-secret-32chars!';
const WEBHOOK_SECRET = 'mock_webhook_secret_key_32chars!';
const WHATSAPP_VERIFY_TOKEN = 'test_meta_verify_token_123';
const WHATSAPP_APP_SECRET = 'test_meta_app_secret_123';
const PHONE_NUMBER_ID = '987654321098765';
const CUSTOMER_PHONE = '+919876543210';
const PROD_RICE_ID = '11111111-1111-4111-8111-111111111111';
const PROD_ATTA_ID = '22222222-2222-4222-8222-222222222222';

// In-Memory Test State
const catalogProducts = [
  {
    id: PROD_RICE_ID,
    store_id: STORE_ID,
    category_id: null,
    name: 'Daawat Basmati Rice',
    slug: 'daawat-basmati-rice',
    sku: 'RICE-01',
    barcode: '8901234567890',
    description: 'Premium aromatic basmati rice',
    price_cents: 12000,
    currency: 'INR',
    unit: 'PACK',
    is_weight_based: false,
    status: 'ACTIVE',
    image_url: null,
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: PROD_ATTA_ID,
    store_id: STORE_ID,
    category_id: null,
    name: 'Aashirvaad Chakki Atta',
    slug: 'aashirvaad-chakki-atta',
    sku: 'ATTA-01',
    barcode: '8901234567891',
    description: 'Whole wheat atta 5kg',
    price_cents: 25000,
    currency: 'INR',
    unit: 'PACK',
    is_weight_based: false,
    status: 'ACTIVE',
    image_url: null,
    created_at: new Date(),
    updated_at: new Date(),
  },
];

const mockCategoryRepo = {
  async findById() { return null; },
  async findBySlug() { return null; },
  async listByStore() { return []; },
  async create(c) { return { ...c, id: 'cat-1', created_at: new Date(), updated_at: new Date() }; },
  async update() { return null; },
  async delete() { return true; },
};

const mockProductRepo = {
  async findById(storeId, id) {
    return catalogProducts.find((p) => p.store_id === storeId && p.id === id) ?? null;
  },
  async findBySlug(storeId, slug) {
    return catalogProducts.find((p) => p.store_id === storeId && p.slug === slug) ?? null;
  },
  async findBySku(storeId, sku) {
    return catalogProducts.find((p) => p.store_id === storeId && p.sku === sku) ?? null;
  },
  async listByStore(storeId, options) {
    let list = catalogProducts.filter((p) => p.store_id === storeId);
    if (options?.search) {
      const q = options.search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
    }
    return { products: list, total: list.length };
  },
};

const stockBalances = new Map([
  [
    PROD_RICE_ID,
    {
      productId: PROD_RICE_ID,
      storeId: STORE_ID,
      onHandQuantity: 30,
      reservedQuantity: 0,
      availableQuantity: 30,
    },
  ],
  [
    PROD_ATTA_ID,
    {
      productId: PROD_ATTA_ID,
      storeId: STORE_ID,
      onHandQuantity: 20,
      reservedQuantity: 0,
      availableQuantity: 20,
    },
  ],
]);

const reservations = new Map();
const orders = new Map();
const orderHistory = [];
const outboxEvents = [];
const payments = new Map();
const webhooks = new Map();
const sentWhatsAppMessages = [];

const mockDb = {
  transaction() {
    return {
      execute: async (cb) => cb({}),
    };
  },
};

const mockStockBalanceRepo = {
  async findByProductId(storeId, productId) {
    const b = stockBalances.get(productId);
    if (!b || b.storeId !== storeId) return null;
    return {
      id: crypto.randomUUID(),
      store_id: b.storeId,
      product_id: b.productId,
      sku: b.productId === PROD_RICE_ID ? 'RICE-01' : 'ATTA-01',
      on_hand_quantity: b.onHandQuantity,
      reserved_quantity: b.reservedQuantity,
      available_quantity: b.availableQuantity,
      reorder_point: 5,
      unit: 'PACK',
      version: 1,
      created_at: new Date(),
      updated_at: new Date(),
    };
  },
  async findAndLockForUpdate(storeId, productIds, trx) {
    const results = [];
    for (const pid of productIds) {
      const b = await this.findByProductId(storeId, pid, trx);
      if (b) results.push(b);
    }
    return results;
  },
  async applyReservationHold(storeId, productId, qty, trx) {
    const b = stockBalances.get(productId);
    if (!b) throw new Error('Product not found in mock balance');
    b.reservedQuantity += qty;
    b.availableQuantity -= qty;
    return this.findByProductId(storeId, productId, trx);
  },
  async applyReservationRelease(storeId, productId, qty, trx) {
    const b = stockBalances.get(productId);
    if (!b) throw new Error('Product not found in mock balance');
    b.reservedQuantity -= qty;
    b.availableQuantity += qty;
    return this.findByProductId(storeId, productId, trx);
  },
  async applyFulfillmentOutflow(storeId, productId, qty, trx) {
    const b = stockBalances.get(productId);
    if (!b) throw new Error('Product not found in mock balance');
    b.onHandQuantity -= qty;
    b.reservedQuantity -= qty;
    return this.findByProductId(storeId, productId, trx);
  },
  async updateQuantities(storeId, productId, onHand, reorderPoint, trx) {
    const b = stockBalances.get(productId);
    if (!b) return null;
    b.onHandQuantity = onHand;
    b.availableQuantity = onHand - b.reservedQuantity;
    return this.findByProductId(storeId, productId, trx);
  },
  async fulfillStock(storeId, productId, qty) {
    return this.applyFulfillmentOutflow(storeId, productId, qty);
  },
};

const mockStockReservationRepo = {
  async findById(storeId, id) {
    for (const r of reservations.values()) {
      if (r.id === id && r.store_id === storeId) return r;
    }
    return null;
  },
  async findByOrderId(storeId, orderId) {
    for (const r of reservations.values()) {
      if (r.order_id === orderId && r.store_id === storeId) return r;
    }
    return null;
  },
  async createReservation(reservation, items) {
    const id = crypto.randomUUID();
    const row = {
      id,
      store_id: reservation.store_id,
      order_id: reservation.order_id,
      status: reservation.status ?? 'ACTIVE',
      expires_at: reservation.expires_at,
      created_at: new Date(),
      updated_at: new Date(),
      items: items.map((i) => ({
        id: crypto.randomUUID(),
        reservation_id: id,
        product_id: i.product_id,
        quantity: String(i.quantity),
        created_at: new Date(),
      })),
    };
    reservations.set(id, row);
    return row;
  },
  async updateStatus(storeId, id, status) {
    for (const r of reservations.values()) {
      if (r.id === id && r.store_id === storeId) {
        r.status = status;
        r.updated_at = new Date();
        return r;
      }
    }
    return null;
  },
};

const mockStockMovementRepo = {
  async recordMovement(movement) {
    return {
      id: crypto.randomUUID(),
      ...movement,
      created_at: new Date(),
    };
  },
  async listByProduct() {
    return [];
  },
};

const mockOrderRepo = {
  async createOrder(params, items = []) {
    const id = crypto.randomUUID();
    const orderNumber = `ORD-${Date.now().toString().slice(-6)}`;
    const totalCents = items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
    const row = {
      id,
      store_id: params.storeId,
      order_number: orderNumber,
      customer_id: params.customerId ?? null,
      customer_name: params.customerName ?? 'Valued Customer',
      customer_phone: params.customerPhone,
      status: 'AWAITING_SHOPKEEPER_REVIEW',
      fulfillment_type: params.fulfillmentType ?? 'PICKUP',
      delivery_address: params.deliveryAddress ?? null,
      currency: params.currency ?? 'INR',
      subtotal_cents: totalCents,
      delivery_fee_cents: 0,
      total_amount_cents: totalCents,
      notes: params.notes ?? null,
      idempotency_key: params.idempotencyKey ?? null,
      created_at: new Date(),
      updated_at: new Date(),
      items: items.map((item) => ({
        id: crypto.randomUUID(),
        order_id: id,
        store_id: params.storeId,
        product_id: item.productId,
        product_name_snapshot: item.productNameSnapshot ?? item.productName ?? 'Product',
        sku_snapshot: item.skuSnapshot ?? item.sku ?? null,
        quantity: item.quantity,
        unit_snapshot: item.unitSnapshot ?? item.unit ?? 'PIECE',
        unit_price_cents: item.unitPriceCents,
        total_price_cents: item.unitPriceCents * item.quantity,
        status: 'PENDING',
        substituted_product_id: null,
        substitution_notes: null,
        created_at: new Date(),
        updated_at: new Date(),
      })),
    };
    orders.set(id, row);
    orderHistory.push({
      id: crypto.randomUUID(),
      order_id: id,
      store_id: params.storeId,
      from_status: null,
      to_status: 'AWAITING_SHOPKEEPER_REVIEW',
      changed_by_user_id: null,
      reason: 'Order submitted via WhatsApp',
      created_at: new Date(),
    });
    return row;
  },
  async findById(storeId, id) {
    const o = orders.get(id);
    return o && o.store_id === storeId ? o : null;
  },
  async updateStatus(storeId, id, toStatus, userId, reason) {
    const o = orders.get(id);
    if (!o || o.store_id !== storeId) return null;
    const fromStatus = o.status;
    o.status = toStatus;
    o.updated_at = new Date();
    orderHistory.push({
      id: `hist-${Date.now()}`,
      order_id: id,
      store_id: storeId,
      from_status: fromStatus,
      to_status: toStatus,
      changed_by_user_id: userId ?? null,
      reason: reason ?? null,
      created_at: new Date(),
    });
    // Add outbox event transactionally
    outboxEvents.push({
      id: `evt-${Date.now()}`,
      store_id: storeId,
      event_type: toStatus === 'CONFIRMED' ? 'OrderConfirmed.v1' : 'OrderUpdated.v1',
      aggregate_type: 'ORDER',
      aggregate_id: id,
      status: 'PENDING',
      payload: { orderId: id, orderNumber: o.order_number, totalAmountCents: o.total_amount_cents, status: toStatus },
      created_at: new Date(),
    });
    return o;
  },
};

const mockPaymentRepo = {
  async createPayment(params) {
    const id = crypto.randomUUID();
    const row = {
      id,
      store_id: params.storeId,
      order_id: params.orderId,
      payment_method: params.paymentMethod,
      provider: params.provider,
      provider_order_id: params.providerOrderId ?? null,
      provider_payment_id: null,
      amount_cents: params.amountCents,
      currency: params.currency,
      status: params.status ?? 'PENDING',
      idempotency_key: params.idempotencyKey ?? null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    payments.set(id, row);
    return row;
  },
  async findById(storeId, id) {
    const p = payments.get(id);
    return p && p.store_id === storeId ? p : null;
  },
  async findByOrderId(storeId, orderId) {
    for (const p of payments.values()) {
      if (p.store_id === storeId && (p.order_id === orderId || p.provider_order_id === orderId)) return p;
    }
    return null;
  },
  async findByProviderPaymentId(provider, providerPaymentId) {
    for (const p of payments.values()) {
      if (p.provider === provider && (p.provider_payment_id === providerPaymentId || p.provider_order_id === providerPaymentId)) return p;
    }
    return null;
  },
  async updateStatus(storeId, id, status, providerPaymentId) {
    const p = payments.get(id);
    if (p && p.store_id === storeId) {
      p.status = status;
      if (providerPaymentId) p.provider_payment_id = providerPaymentId;
      p.updated_at = new Date();
      return p;
    }
    return null;
  },
  async createRefund(params) {
    return {
      id: `ref-${Date.now()}`,
      store_id: params.storeId,
      payment_id: params.paymentId,
      amount_cents: params.amountCents,
      reason: params.reason,
      provider_refund_id: 'mock_ref_123',
      status: 'SUCCEEDED',
      created_at: new Date(),
      updated_at: new Date(),
    };
  },
  async listRefundsByPayment() {
    return [];
  },
};

const mockWebhookRepo = {
  async recordWebhook(params) {
    const id = `wbk-${Date.now()}`;
    const row = {
      id,
      store_id: params.storeId,
      provider: params.provider,
      event_id: params.eventId,
      event_type: params.eventType,
      payload: params.payload,
      signature: params.signature,
      status: 'RECEIVED',
      processed_at: null,
      created_at: new Date(),
    };
    webhooks.set(params.eventId, row);
    return row;
  },
  async findWebhook(provider, eventId) {
    return webhooks.get(eventId) ?? null;
  },
  async markProcessed(id, status) {
    for (const w of webhooks.values()) {
      if (w.id === id) {
        w.status = status;
        w.processed_at = new Date();
      }
    }
  },
};

// WhatsApp In-Memory Repositories
let currentActiveQuote = null;
let conversationState = 'IDLE';

const mockWhatsAppStoreChannelRepo = {
  async findByPhoneNumberId(phoneNumberId) {
    if (phoneNumberId === PHONE_NUMBER_ID) {
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
    }
    return null;
  },
};

const mockWhatsAppInboundRepo = {
  receivedMessages: new Map(),
  async recordInboundMessage(input) {
    if (this.receivedMessages.has(input.providerMessageId)) {
      return { isDuplicate: true, existingMessage: this.receivedMessages.get(input.providerMessageId) };
    }
    const row = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      provider_message_id: input.providerMessageId,
      store_id: input.storeId,
      sender_phone_e164: input.senderPhoneE164,
      payload: JSON.stringify(input.payload),
      status: 'RECEIVED',
      attempt_count: 0,
      max_retries: 5,
      lease_expires_at: null,
      processed_at: null,
      last_error: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    this.receivedMessages.set(input.providerMessageId, row);
    return { isDuplicate: false, message: row };
  },
  async acquireProcessingLease(messageId) {
    return true;
  },
  async markProcessed(messageId) {
    for (const row of this.receivedMessages.values()) {
      if (row.id === messageId) {
        row.status = 'PROCESSED';
        row.processed_at = new Date();
      }
    }
  },
  async markFailed(messageId, errorDetail) {
    for (const row of this.receivedMessages.values()) {
      if (row.id === messageId) {
        row.status = 'FAILED';
        row.last_error = errorDetail;
      }
    }
  },
  async findByProviderMessageId(providerMessageId) {
    return this.receivedMessages.get(providerMessageId) ?? null;
  },
};

const mockWhatsAppConversationRepo = {
  async getOrCreateConversation(storeId, senderPhoneE164) {
    return {
      id: 'conv-sim-01',
      store_id: storeId,
      sender_phone_e164: senderPhoneE164,
      state: conversationState,
      context: {},
      created_at: new Date(),
      updated_at: new Date(),
    };
  },
  async updateConversationState(conversationId, state, context) {
    conversationState = state;
    return {
      id: conversationId,
      store_id: STORE_ID,
      sender_phone_e164: CUSTOMER_PHONE,
      state,
      context: context ?? {},
      created_at: new Date(),
      updated_at: new Date(),
    };
  },
  async findById(conversationId) {
    return {
      id: conversationId,
      store_id: STORE_ID,
      sender_phone_e164: CUSTOMER_PHONE,
      state: conversationState,
      context: {},
      created_at: new Date(),
      updated_at: new Date(),
    };
  },
  async recordOutboundActivity() {},
};

const mockWhatsAppQuoteRepo = {
  versionCounter: 0,
  async saveProvisionalQuote(storeId, convId, snapshot) {
    this.versionCounter++;
    const quoteId = `quote-v${this.versionCounter}`;
    currentActiveQuote = { ...snapshot, quoteId, quoteVersion: this.versionCounter };
    return { quoteId, version: this.versionCounter };
  },
  async getActiveQuote() {
    return currentActiveQuote;
  },
  async linkQuoteToOrder(storeId, quoteId, orderId) {
    if (currentActiveQuote && currentActiveQuote.quoteId === quoteId) {
      currentActiveQuote.linkedOrderId = orderId;
    }
  },
};

const mockWhatsAppOutboundClient = {
  async sendTextMessage(params) {
    sentWhatsAppMessages.push(params);
    return { success: true, messageId: `out-${Date.now()}` };
  },
};

// --------------------------------------------------------------------------
// Start Microservices
// --------------------------------------------------------------------------

// 1. Catalog Service
const catalogServiceInstance = createCatalogServiceInstance(mockCategoryRepo, mockProductRepo);
const catalogServer = createCatalogService({
  port: 0,
  catalogService: catalogServiceInstance,
  internalTokenSecret: INTERNAL_SECRET,
});
const { port: catalogPort } = await catalogServer.start();
console.log(`✅ [1/5] Catalog Service running on port ${catalogPort}`);

// 2. Inventory Service
const inventoryServiceInstance = createInventoryServiceInstance(
  mockDb,
  mockStockBalanceRepo,
  mockStockReservationRepo,
  mockStockMovementRepo,
);
const inventoryServer = createInventoryService({
  port: 0,
  inventoryService: inventoryServiceInstance,
  internalTokenSecret: INTERNAL_SECRET,
});
const { port: inventoryPort } = await inventoryServer.start();
console.log(`✅ [2/5] Inventory Service running on port ${inventoryPort}`);

// 3. Order Service
const orderInventoryClient = new HttpInventoryClient({
  baseUrl: `http://127.0.0.1:${inventoryPort}`,
  internalTokenSecret: INTERNAL_SECRET,
});
const orderCatalogClient = {
  async getProduct(storeId, productId) {
    const res = await fetch(`http://127.0.0.1:${catalogPort}/api/v1/catalog/products/${productId}`, {
      headers: {
        'x-store-id': storeId,
        'x-internal-token': mintInternalToken(
          { sub: 'order-service', act: 'SYSTEM', tid: storeId, roles: ['STAFF'] },
          { secret: INTERNAL_SECRET },
        ),
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.product;
  },
};
const orderServiceInstance = createOrderServiceInstance(
  mockOrderRepo,
  orderInventoryClient,
  orderCatalogClient,
);
const orderServer = createOrderService({
  port: 0,
  orderService: orderServiceInstance,
  internalTokenSecret: INTERNAL_SECRET,
});
const { port: orderPort } = await orderServer.start();
console.log(`✅ [3/5] Order Service running on port ${orderPort}`);

// 4. Payment Service
const paymentOrderClient = new PaymentOrderClient({
  baseUrl: `http://127.0.0.1:${orderPort}`,
  internalTokenSecret: INTERNAL_SECRET,
});
const paymentServiceInstance = createPaymentServiceInstance(
  mockPaymentRepo,
  mockWebhookRepo,
  undefined,
  paymentOrderClient,
  WEBHOOK_SECRET,
);
const paymentServer = createPaymentService({
  port: 0,
  paymentService: paymentServiceInstance,
  internalTokenSecret: INTERNAL_SECRET,
});
const { port: paymentPort } = await paymentServer.start();
console.log(`✅ [4/5] Payment Service running on port ${paymentPort}`);

// 5. WhatsApp Service
const whatsAppCatalogClient = new HttpCatalogLookupClient({
  baseUrl: `http://127.0.0.1:${catalogPort}`,
  internalTokenSecret: INTERNAL_SECRET,
});
const whatsAppInventoryClient = new HttpInventoryLookupClient({
  baseUrl: `http://127.0.0.1:${inventoryPort}`,
  internalTokenSecret: INTERNAL_SECRET,
});
const whatsAppOrderClient = new WhatsAppOrderClient({
  baseUrl: `http://127.0.0.1:${orderPort}`,
  internalTokenSecret: INTERNAL_SECRET,
});

const catalogResolver = new CatalogResolver({
  catalogClient: whatsAppCatalogClient,
  inventoryClient: whatsAppInventoryClient,
});
const conversationCoordinator = createConversationCoordinator({
  storeChannelRepo: mockWhatsAppStoreChannelRepo,
  inboundRepo: mockWhatsAppInboundRepo,
  conversationRepo: mockWhatsAppConversationRepo,
  quoteRepo: mockWhatsAppQuoteRepo,
  catalogResolver,
  outboundClient: mockWhatsAppOutboundClient,
  orderClient: whatsAppOrderClient,
});

const whatsAppServer = createWhatsAppService({
  port: 0,
  coordinator: conversationCoordinator,
  verifyToken: WHATSAPP_VERIFY_TOKEN,
  appSecret: WHATSAPP_APP_SECRET,
});
const { port: whatsAppPort } = await whatsAppServer.start();
console.log(`✅ [5/6] WhatsApp Service running on port ${whatsAppPort}`);

// 6. API Gateway Ingress (Reverse Proxy to downstream microservices)
const gatewayServer = createApiGateway({
  port: 0,
  internalTokenSecret: INTERNAL_SECRET,
  corsAllowedOrigins: ['https://store.grocerystore.com', 'http://localhost:3000'],
  serviceUrls: {
    identity: 'http://127.0.0.1:3001',
    catalog: `http://127.0.0.1:${catalogPort}`,
    inventory: `http://127.0.0.1:${inventoryPort}`,
    order: `http://127.0.0.1:${orderPort}`,
    payment: `http://127.0.0.1:${paymentPort}`,
  },
});
const { port: gatewayPort } = await gatewayServer.start();
console.log(`✅ [6/7] API Gateway Ingress running on port ${gatewayPort}`);

// 7. Web Frontend (Customer Storefront, Shopkeeper Admin Console, and Ingress Proxy)
const webServer = createWebService({
  port: 0,
  gatewayUrl: `http://127.0.0.1:${gatewayPort}`,
});
const { port: webPort } = await webServer.start();
console.log(`✅ [7/7] Web Frontend Service running on port ${webPort}\n`);

// --------------------------------------------------------------------------
// EXECUTE END-TO-END FLOW
// --------------------------------------------------------------------------

try {
  console.log('------------------------------------------------------------------------');
  console.log('📍 STEP 1: Customer submits grocery list via WhatsApp');
  console.log('------------------------------------------------------------------------');

  const incomingPayload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+919876543210',
                phone_number_id: PHONE_NUMBER_ID,
              },
              messages: [
                {
                  from: CUSTOMER_PHONE,
                  id: 'wamid.HBgLMTA5ODc2NTQzMjEwFQIAEhgUM0EBQ0Y0MkQ5ODcwNTI1REQzM0EA',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: {
                    body: '2 packets Daawat Basmati Rice\n1 packet Aashirvaad Chakki Atta',
                  },
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };

  const rawBody = JSON.stringify(incomingPayload);
  const sig = crypto.createHmac('sha256', WHATSAPP_APP_SECRET).update(rawBody).digest('hex');


  const webhookRes = await fetch(`http://127.0.0.1:${whatsAppPort}/api/v1/whatsapp/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': `sha256=${sig}`,
    },
    body: rawBody,
  });

  if (webhookRes.status !== 200) {
    const errorBody = await webhookRes.text();
    console.error('Webhook error response:', errorBody);
  }
  assert.equal(webhookRes.status, 200, 'WhatsApp webhook returned HTTP 200');
  console.log(' -> Meta Webhook successfully processed.');
  assert.ok(currentActiveQuote, 'Provisional quote generated');
  console.log(` -> Provisional Quote Generated: ID=${currentActiveQuote.quoteId}, Version=${currentActiveQuote.quoteVersion}`);
  console.log(` -> Subtotal: ₹${(currentActiveQuote.knownSubtotalMinor / 100).toFixed(2)} (${currentActiveQuote.knownSubtotalMinor} paise)`);
  console.log(` -> Non-Payable Invariant: isPayable = ${currentActiveQuote.isPayable}`);
  assert.equal(currentActiveQuote.isPayable, false);
  assert.equal(currentActiveQuote.knownSubtotalMinor, 49000); // 2 * 12000 + 1 * 25000 = 49000

  assert.ok(sentWhatsAppMessages.length > 0, 'WhatsApp outbound message sent to customer');
  console.log(' -> Customer received provisional quote summary via WhatsApp:');
  console.log(`    "${sentWhatsAppMessages[0].text.split('\n')[0]}..."\n`);

  console.log('------------------------------------------------------------------------');
  console.log('📍 STEP 2: Customer approves provisional quote ("CONFIRM")');
  console.log('------------------------------------------------------------------------');

  const confirmPayload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+919876543210',
                phone_number_id: PHONE_NUMBER_ID,
              },
              messages: [
                {
                  from: CUSTOMER_PHONE,
                  id: 'wamid.CONFIRM_001_ABCXYZ',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: 'CONFIRM' },
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };

  const confirmRawBody = JSON.stringify(confirmPayload);
  const confirmSig = crypto.createHmac('sha256', WHATSAPP_APP_SECRET).update(confirmRawBody).digest('hex');

  const confirmRes = await fetch(`http://127.0.0.1:${whatsAppPort}/api/v1/whatsapp/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': `sha256=${confirmSig}`,
    },
    body: confirmRawBody,
  });

  assert.equal(confirmRes.status, 200);
  assert.equal(conversationState, 'SUBMITTED_TO_SHOPKEEPER');
  console.log(' -> Customer confirmed order. Conversation state: SUBMITTED_TO_SHOPKEEPER');

  // Verify created order in order-service
  const createdOrder = Array.from(orders.values())[0];
  assert.ok(createdOrder, 'Order created in order-service');
  console.log(` -> Order created in order-service: ID=${createdOrder.id}, Number=${createdOrder.order_number}`);
  console.log(` -> Order Status: ${createdOrder.status} (ADR-007: Review status BEFORE stock hold)`);
  assert.equal(createdOrder.status, 'AWAITING_SHOPKEEPER_REVIEW');
  assert.equal(reservations.size, 0, 'Zero stock reservations held prior to shopkeeper review');
  console.log(' -> Verified invariant: Stock is NOT held prematurely prior to shopkeeper review.\n');

  console.log('------------------------------------------------------------------------');
  console.log('📍 STEP 3: Shopkeeper reviews & confirms order (Stock Reservation Hold)');
  console.log('------------------------------------------------------------------------');

  const staffToken = mintInternalToken(
    {
      sub: 'shopkeeper-user-001',
      act: 'SHOPKEEPER',
      tid: STORE_ID,
      roles: ['OWNER', 'STAFF'],
    },
    { secret: INTERNAL_SECRET },
  );

  const confirmOrderRes = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/orders/${createdOrder.id}/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-store-id': STORE_ID,
    },
  });

  assert.equal(confirmOrderRes.status, 200, 'Order confirmation returned HTTP 200');
  const confirmOrderJson = await confirmOrderRes.json();
  assert.equal(confirmOrderJson.order.status, 'CONFIRMED');
  console.log(` -> Order state transitioned to: ${confirmOrderJson.order.status}`);

  // Verify stock reservation in inventory-service
  assert.equal(reservations.size, 1, 'Stock reservation record created in inventory-service');
  const reservation = Array.from(reservations.values())[0];
  console.log(` -> Inventory Reservation created: ID=${reservation.id}, Status=${reservation.status}`);
  console.log(` -> Reserved items: 2x Daawat Rice (available now=${stockBalances.get(PROD_RICE_ID).availableQuantity}), 1x Aashirvaad Atta (available now=${stockBalances.get(PROD_ATTA_ID).availableQuantity})`);

  // Verify outbox event insertion
  assert.ok(outboxEvents.length > 0, 'Transactional outbox event OrderConfirmed.v1 inserted');
  console.log(` -> Transactional outbox event created: ${outboxEvents[0].event_type} (Status: ${outboxEvents[0].status})\n`);

  console.log('------------------------------------------------------------------------');
  console.log('📍 STEP 4: Payment Session Initiation & Webhook Settlement');
  console.log('------------------------------------------------------------------------');

  // Initiate Payment via API Gateway Ingress
  const initiatePaymentRes = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-store-id': STORE_ID,
    },
    body: JSON.stringify({
      orderId: createdOrder.id,
      paymentMethod: 'UPI',
      provider: 'MOCK',
      amountCents: createdOrder.total_amount_cents,
      currency: 'INR',
    }),
  });

  if (initiatePaymentRes.status !== 201) {
    const errText = await initiatePaymentRes.text();
    console.error('Payment initiation error:', errText);
  }
  assert.equal(initiatePaymentRes.status, 201, 'Payment session initiated with HTTP 201');
  const paymentJson = await initiatePaymentRes.json();
  const paymentRecord = paymentJson.payment;
  console.log(` -> Payment initiated: ID=${paymentRecord.id}, Provider Order ID=${paymentRecord.providerOrderId}`);
  console.log(` -> Payment Status: ${paymentRecord.status}, Amount: ₹${(paymentRecord.amountCents / 100).toFixed(2)}`);
  assert.equal(paymentRecord.status, 'PENDING');

  // Payment Provider Webhook Settlement
  const paymentWebhookPayload = {
    id: `evt_pay_${Date.now()}`,
    event: 'PAYMENT_SUCCESS',
    providerOrderId: paymentRecord.providerOrderId,
    providerPaymentId: `pay_mock_${Date.now()}`,
    storeId: STORE_ID,
  };
  const paymentWebhookBody = JSON.stringify(paymentWebhookPayload);
  const paymentSig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(paymentWebhookBody).digest('hex');

  const webhookPaymentRes = await fetch(`http://127.0.0.1:${paymentPort}/api/v1/payments/webhooks/MOCK`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-payment-signature': paymentSig,
    },
    body: paymentWebhookBody,
  });

  assert.equal(webhookPaymentRes.status, 200, 'Payment webhook returned HTTP 200');
  const updatedPayment = payments.get(paymentRecord.id);
  assert.equal(updatedPayment.status, 'SUCCEEDED', 'Payment transitioned to SUCCEEDED');
  console.log(` -> Webhook processed. Payment ID=${updatedPayment.id} transitioned to: ${updatedPayment.status}`);
  console.log(` -> Provider Transaction Reference: ${updatedPayment.provider_payment_id}\n`);

  console.log('------------------------------------------------------------------------');
  console.log('📍 STEP 5: Order Advancement & Inventory Fulfillment');
  console.log('------------------------------------------------------------------------');

  // Advance to PREPARING via API Gateway
  const preparingRes = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/orders/${createdOrder.id}/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-store-id': STORE_ID,
    },
    body: JSON.stringify({
      status: 'PREPARING',
      reason: 'Shopkeeper started packing items',
    }),
  });
  if (preparingRes.status !== 200) {
    console.error('Preparing error:', await preparingRes.text());
  }
  assert.equal(preparingRes.status, 200);
  console.log(' -> Order advanced to: PREPARING (via API Gateway)');

  // Advance to READY_FOR_PICKUP via API Gateway
  const readyRes = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/orders/${createdOrder.id}/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-store-id': STORE_ID,
    },
    body: JSON.stringify({
      status: 'READY_FOR_PICKUP',
      reason: 'Packed and verified by shopkeeper',
    }),
  });
  if (readyRes.status !== 200) {
    console.error('Ready error:', await readyRes.text());
  }
  assert.equal(readyRes.status, 200);
  console.log(' -> Order advanced to: READY_FOR_PICKUP (via API Gateway)');

  // Advance to COMPLETED via API Gateway
  const completeRes = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/orders/${createdOrder.id}/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-store-id': STORE_ID,
    },
    body: JSON.stringify({
      status: 'COMPLETED',
      reason: 'Delivered/handed over to customer',
    }),
  });
  if (completeRes.status !== 200) {
    console.error('Complete error:', await completeRes.text());
  }
  assert.equal(completeRes.status, 200);
  console.log(' -> Order advanced to: COMPLETED (via API Gateway)');

  // Verify automatic cross-service inventory fulfillment triggered by order-service
  const finalReservation = reservations.get(reservation.id);
  assert.equal(finalReservation?.status, 'FULFILLED', 'Reservation marked FULFILLED via HTTP inventory fulfillment');
  console.log(` -> Cross-service inventory fulfillment verified: Reservation ID=${reservation.id} status=${finalReservation.status}`);
  console.log(` -> Final Stock On-Hand: Rice=${stockBalances.get(PROD_RICE_ID).onHandQuantity} (reserved=${stockBalances.get(PROD_RICE_ID).reservedQuantity}), Atta=${stockBalances.get(PROD_ATTA_ID).onHandQuantity} (reserved=${stockBalances.get(PROD_ATTA_ID).reservedQuantity})\n`);
  assert.equal(stockBalances.get(PROD_RICE_ID).onHandQuantity, 28);
  assert.equal(stockBalances.get(PROD_RICE_ID).reservedQuantity, 0);
  assert.equal(stockBalances.get(PROD_ATTA_ID).onHandQuantity, 19);
  assert.equal(stockBalances.get(PROD_ATTA_ID).reservedQuantity, 0);

  console.log('------------------------------------------------------------------------');
  console.log('📍 STEP 6: Notification Outbox Worker Dispatch (ADR-009)');
  console.log('------------------------------------------------------------------------');

  const deliveredNotificationLogs = [];
  const mockNotificationOutboxRepo = {
    async insertEvent() {},
    async fetchPending(limit = 50) {
      return outboxEvents.filter((e) => e.status === 'PENDING').slice(0, limit);
    },
    async markProcessing(ids) {
      for (const e of outboxEvents) {
        if (ids.includes(e.id)) e.status = 'PROCESSING';
      }
    },
    async markPublished(id) {
      for (const e of outboxEvents) {
        if (e.id === id) {
          e.status = 'PUBLISHED';
          e.published_at = new Date();
        }
      }
    },
    async markFailed(id, err) {
      for (const e of outboxEvents) {
        if (e.id === id) {
          e.status = 'FAILED';
          e.last_error = err;
        }
      }
    },
    async markDeadLetter(id, err) {
      for (const e of outboxEvents) {
        if (e.id === id) {
          e.status = 'DEAD_LETTER';
          e.last_error = err;
        }
      }
    },
  };

  const mockNotificationLogRepo = {
    async createLog(params) {
      const row = {
        id: crypto.randomUUID(),
        store_id: params.storeId,
        outbox_id: params.outboxId ?? null,
        channel: params.channel,
        recipient: params.recipient,
        template_name: params.templateName,
        payload: params.payload,
        status: params.status ?? 'SENT',
        provider_message_id: params.providerMessageId ?? `mock_outbox_${Date.now()}`,
        created_at: new Date(),
      };
      deliveredNotificationLogs.push(row);
      return row;
    },
    async updateStatus() {},
  };

  const notificationDispatcher = createNotificationDispatcher(
    mockNotificationOutboxRepo,
    mockNotificationLogRepo,
  );
  const dispatchResult = await notificationDispatcher.processPendingBatch();
  assert.ok(dispatchResult.processed > 0, 'NotificationDispatcher processed pending outbox batch');
  assert.ok(deliveredNotificationLogs.length > 0, 'Notification audit record created');
  console.log(` -> Notification Dispatcher processed: ${dispatchResult.processed} event(s)`);
  console.log(` -> Notification Audit Record created: ID=${deliveredNotificationLogs[0].id}, Channel=${deliveredNotificationLogs[0].channel}, Recipient=${deliveredNotificationLogs[0].recipient}, Template=${deliveredNotificationLogs[0].template_name}\n`);

  console.log('------------------------------------------------------------------------');
  console.log('📍 STEP 7: Frontend Web Service Integration (Storefront, Admin, & Ingress)');
  console.log('------------------------------------------------------------------------');

  // 1. Customer Storefront HTML rendering
  const storefrontRes = await fetch(`http://127.0.0.1:${webPort}/`);
  assert.equal(storefrontRes.status, 200, 'Customer Storefront returns 200 OK');
  const storefrontHtml = await storefrontRes.text();
  assert.ok(
    storefrontHtml.includes('Grocery') || storefrontHtml.includes('<!DOCTYPE html>'),
    'Storefront HTML rendered successfully',
  );
  console.log(' -> Customer Storefront (GET /) verified: 200 OK HTML delivered');

  // 2. Catalog page rendering
  const catalogPageRes = await fetch(`http://127.0.0.1:${webPort}/catalog`);
  assert.equal(catalogPageRes.status, 200, 'Customer Catalog returns 200 OK');
  console.log(' -> Customer Catalog (GET /catalog) verified: 200 OK');

  // 3. Shopkeeper Admin Console rendering
  const adminPageRes = await fetch(`http://127.0.0.1:${webPort}/admin`);
  assert.equal(adminPageRes.status, 200, 'Shopkeeper Console returns 200 OK');
  const adminHtml = await adminPageRes.text();
  assert.ok(
    adminHtml.includes('Console') || adminHtml.includes('OPERATOR'),
    'Shopkeeper Console HTML rendered successfully',
  );
  console.log(' -> Shopkeeper Console (GET /admin) verified: 200 OK HTML delivered');

  // 4. Online Customer Order Submission through Frontend /api/v1/orders proxy
  const webOrderRes = await fetch(`http://127.0.0.1:${webPort}/api/v1/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Store-ID': STORE_ID,
    },
    body: JSON.stringify({
      customerName: 'Aarav Mehta (Web Customer)',
      customerPhone: '+919876543210',
      fulfillmentType: 'DELIVERY',
      deliveryAddress: 'Flat 402, Sea Green Apts, Bandra West, Mumbai',
      items: [
        {
          productId: PROD_RICE_ID,
          quantity: 2,
        },
      ],
    }),
  });
  if (webOrderRes.status !== 201) {
    console.error('Web Order creation error:', await webOrderRes.text());
  }
  assert.equal(
    webOrderRes.status,
    201,
    'Order created via Web Frontend -> Gateway -> Order Service proxy',
  );
  const webOrderData = await webOrderRes.json();
  const createdWebOrder = webOrderData.order;
  assert.ok(createdWebOrder.id, 'Frontend-submitted order has canonical UUID id');
  assert.ok(createdWebOrder.orderNumber, 'Frontend-submitted order has orderNumber');
  console.log(
    ` -> Web Frontend Order Placement verified: ID=${createdWebOrder.id}, Number=${createdWebOrder.orderNumber}, Status=${createdWebOrder.status}`,
  );

  // 5. Shopkeeper Order Confirmation & Stock Reservation through Frontend proxy
  const confirmWebOrderRes = await fetch(
    `http://127.0.0.1:${webPort}/api/v1/orders/${createdWebOrder.id}/confirm`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Store-ID': STORE_ID,
      },
      body: JSON.stringify({ userId: 'shopkeeper-admin' }),
    },
  );
  assert.equal(confirmWebOrderRes.status, 200, 'Order confirmed via Web Frontend Ingress');
  const confirmedWebOrder = (await confirmWebOrderRes.json()).order;
  assert.equal(confirmedWebOrder.status, 'CONFIRMED');
  console.log(
    ` -> Shopkeeper Review & Confirm via Frontend verified: Status=${confirmedWebOrder.status}`,
  );

  // 6. Shopkeeper Stock Adjustment (Intake) through Frontend proxy
  const stockAdjustRes = await fetch(
    `http://127.0.0.1:${webPort}/api/v1/inventory/stocks/${PROD_RICE_ID}/adjust`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Store-ID': STORE_ID,
      },
      body: JSON.stringify({
        deltaQuantity: 20,
        reason: 'INFLOW_PURCHASE',
      }),
    },
  );
  assert.equal(stockAdjustRes.status, 200, 'Stock adjusted via Web Frontend Ingress');
  const adjustedStock = (await stockAdjustRes.json()).stock;
  console.log(
    ` -> Shopkeeper Inventory Intake via Frontend verified: Product=${adjustedStock.productId}, OnHand=${adjustedStock.onHandQuantity}\n`,
  );

  console.log('========================================================================');
  console.log('🎉 SIMULATION PASSED: Complete End-to-End Cross-Service Workflow Verified!');
  console.log('========================================================================\n');

} finally {
  console.log('🧹 Shutting down all microservices gracefully...');
  await Promise.all([
    webServer.stop(),
    gatewayServer.stop(),
    catalogServer.stop(),
    inventoryServer.stop(),
    orderServer.stop(),
    paymentServer.stop(),
    whatsAppServer.stop(),
  ]);
  console.log('✅ All services stopped. Zero lingering connections or sockets.\n');
}
