import crypto from 'node:crypto';
import { mintInternalToken } from '../packages/service-runtime/dist/index.js';

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
  InvoiceService,
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
import { createWebService, STOREFRONT_PRODUCT_IDS } from '../apps/web/dist/index.js';

const STORE_ID = process.env.STORE_ID ?? '00000000-0000-4000-8000-000000000001';
const INTERNAL_SECRET = process.env.INTERNAL_TOKEN_SECRET ?? 'development-internal-secret-32chars!';
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'mock_webhook_secret_key_32chars!';
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? 'dev_verify_token_123';
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET ?? 'dev_app_secret_123';

// Fixed Ports for local dev environment
const WEB_PORT = parseInt(process.env.WEB_PORT ?? '3000', 10);
const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT ?? '3001', 10);
const CATALOG_PORT = parseInt(process.env.CATALOG_PORT ?? '3002', 10);
const INVENTORY_PORT = parseInt(process.env.INVENTORY_PORT ?? '3003', 10);
const ORDER_PORT = parseInt(process.env.ORDER_PORT ?? '3004', 10);
const PAYMENT_PORT = parseInt(process.env.PAYMENT_PORT ?? '3005', 10);
const WHATSAPP_PORT = parseInt(process.env.WHATSAPP_PORT ?? '3006', 10);

// In-Memory Catalog Seed (matching storefront IDs)
const catalogProducts = [
  {
    id: STOREFRONT_PRODUCT_IDS.apple,
    store_id: STORE_ID,
    name: 'Fresh Fuji Apples',
    slug: 'fresh-fuji-apples',
    sku: 'APPL-01',
    description: 'Crisp, sweet, and locally sourced Himachal apples.',
    price_cents: 14000,
    currency: 'INR',
    unit: 'KG',
    status: 'ACTIVE',
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: STOREFRONT_PRODUCT_IDS.mango,
    store_id: STORE_ID,
    name: 'Ratnagiri Alphonso Mangoes',
    slug: 'alphonso-mangoes',
    sku: 'MANG-01',
    description: 'Directly sourced premium GI-tagged Alphonso mangoes.',
    price_cents: 75000,
    currency: 'INR',
    unit: 'PACK',
    status: 'ACTIVE',
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: STOREFRONT_PRODUCT_IDS.spinach,
    store_id: STORE_ID,
    name: 'Hydroponic Baby Spinach (250g)',
    slug: 'baby-spinach',
    sku: 'SPIN-01',
    description: 'Zero pesticides, harvested same morning for maximum nutrients.',
    price_cents: 4500,
    currency: 'INR',
    unit: 'PACK',
    status: 'ACTIVE',
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: STOREFRONT_PRODUCT_IDS.tomatoes,
    store_id: STORE_ID,
    name: 'Vine-Ripened Roma Tomatoes',
    slug: 'roma-tomatoes',
    sku: 'TOMA-01',
    description: 'Firm, juicy, and ideal for curries, salads, and sauces.',
    price_cents: 3800,
    currency: 'INR',
    unit: 'KG',
    status: 'ACTIVE',
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: STOREFRONT_PRODUCT_IDS.milk,
    store_id: STORE_ID,
    name: 'Organic Whole Milk 1L',
    slug: 'organic-whole-milk',
    sku: 'MILK-01',
    description: 'Pure pasteurized whole milk from grass-fed cows.',
    price_cents: 6500,
    currency: 'INR',
    unit: 'LITRE',
    status: 'ACTIVE',
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: STOREFRONT_PRODUCT_IDS.eggs,
    store_id: STORE_ID,
    name: 'Farm Fresh Brown Eggs (Pack of 6)',
    slug: 'brown-eggs-6',
    sku: 'EGGS-01',
    description: 'Nutrient-rich golden yolk eggs from cage-free heritage hens.',
    price_cents: 6000,
    currency: 'INR',
    unit: 'PIECE',
    status: 'ACTIVE',
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: STOREFRONT_PRODUCT_IDS.butter,
    store_id: STORE_ID,
    name: 'Cultured Farmhouse Butter 500g',
    slug: 'farmhouse-butter',
    sku: 'BUTE-01',
    description: 'Slow-churned salted butter with authentic creamy richness.',
    price_cents: 26500,
    currency: 'INR',
    unit: 'PACK',
    status: 'ACTIVE',
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: STOREFRONT_PRODUCT_IDS.yogurt,
    store_id: STORE_ID,
    name: 'Artisanal Plain Greek Yogurt 400g',
    slug: 'greek-yogurt',
    sku: 'YOGU-01',
    description: 'Thick strained probiotic yogurt packed with 10g protein.',
    price_cents: 14500,
    currency: 'INR',
    unit: 'PACK',
    status: 'ACTIVE',
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: STOREFRONT_PRODUCT_IDS.rice,
    store_id: STORE_ID,
    name: 'Daawat Rozana Basmati Rice 5kg',
    slug: 'daawat-basmati-rice',
    sku: 'RICE-01',
    description: 'Aromatic aged long-grain basmati rice for daily meals.',
    price_cents: 36000,
    currency: 'INR',
    unit: 'PACK',
    status: 'ACTIVE',
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: STOREFRONT_PRODUCT_IDS.flour,
    store_id: STORE_ID,
    name: 'Stoneground Whole Wheat Atta 5kg',
    slug: 'whole-wheat-atta',
    sku: 'ATTA-01',
    description: '100% whole grain chakki atta for soft and healthy rotis.',
    price_cents: 24000,
    currency: 'INR',
    unit: 'PACK',
    status: 'ACTIVE',
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: STOREFRONT_PRODUCT_IDS.oil,
    store_id: STORE_ID,
    name: 'Extra Virgin Olive Oil 500ml',
    slug: 'extra-virgin-olive-oil',
    sku: 'OIL-01',
    description: 'First cold-pressed Mediterranean olive oil.',
    price_cents: 38000,
    currency: 'INR',
    unit: 'PACK',
    status: 'ACTIVE',
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: STOREFRONT_PRODUCT_IDS.coffee,
    store_id: STORE_ID,
    name: 'Single-Origin Arabica Beans 250g',
    slug: 'arabica-coffee-beans',
    sku: 'COFF-01',
    description: 'Medium-dark roast with notes of chocolate and roasted hazelnut.',
    price_cents: 42000,
    currency: 'INR',
    unit: 'PACK',
    status: 'ACTIVE',
    created_at: new Date(),
    updated_at: new Date(),
  },
];

// In-Memory Stock Balances
const stockBalances = new Map();
for (const p of catalogProducts) {
  stockBalances.set(p.id, {
    productId: p.id,
    storeId: STORE_ID,
    sku: p.sku,
    onHandQuantity: 50,
    reservedQuantity: 0,
    availableQuantity: 50,
  });
}

const reservations = new Map();
const orders = new Map();
const orderHistory = [];
const outboxEvents = [];
const payments = new Map();
const webhooks = new Map();
const sentWhatsAppMessages = [];

// Seed initial demo orders matching storefront and admin console
const initialOrderId = '00000000-0000-4000-8000-000000000101';
orders.set(initialOrderId, {
  id: initialOrderId,
  store_id: STORE_ID,
  order_number: 'ORD-1001',
  customer_phone: '+919876543210',
  customer_name: 'Pooja Verma',
  status: 'AWAITING_SHOPKEEPER_REVIEW',
  fulfillment_type: 'DELIVERY',
  delivery_address: 'Flat 12, Ocean View, Carter Road, Bandra West',
  total_amount_cents: 28000,
  currency: 'INR',
  items: [
    {
      id: crypto.randomUUID(),
      order_id: initialOrderId,
      product_id: STOREFRONT_PRODUCT_IDS.apple,
      product_name: 'Fresh Fuji Apples',
      product_name_snapshot: 'Fresh Fuji Apples',
      sku: 'APPL-01',
      sku_snapshot: 'APPL-01',
      unit: 'KG',
      unit_snapshot: 'KG',
      quantity: 2,
      unit_price_cents: 14000,
      total_price_cents: 28000,
      status: 'CONFIRMED',
    },
  ],
  created_at: new Date(),
  updated_at: new Date(),
});

// Seed console orders (ORD-7821, ORD-7820, ORD-7819)
const consoleOrders = [
  {
    id: '00000000-0000-4000-8000-000000001001',
    store_id: STORE_ID,
    order_number: 'ORD-7821',
    customer_phone: '+919820123456',
    customer_name: 'Aarav Mehta',
    status: 'AWAITING_SHOPKEEPER_REVIEW',
    fulfillment_type: 'DELIVERY',
    delivery_address: 'Flat 402, Green Valley Apartments, Hill Road, Bandra West',
    total_amount_cents: 32350,
    currency: 'INR',
    items: [
      {
        id: '00000000-0000-4000-8000-000000000101',
        order_id: '00000000-0000-4000-8000-000000001001',
        product_id: STOREFRONT_PRODUCT_IDS.apple,
        product_name: 'Fresh Fuji Apples',
        product_name_snapshot: 'Fresh Fuji Apples',
        sku: 'APPL-01',
        sku_snapshot: 'APPL-01',
        unit: 'KG',
        unit_snapshot: 'KG',
        quantity: 1,
        unit_price_cents: 14000,
        total_price_cents: 14000,
        status: 'CONFIRMED',
      },
      {
        id: '00000000-0000-4000-8000-000000000102',
        order_id: '00000000-0000-4000-8000-000000001001',
        product_id: STOREFRONT_PRODUCT_IDS.milk,
        product_name: 'Organic Whole Milk 1L',
        product_name_snapshot: 'Organic Whole Milk 1L',
        sku: 'MILK-01',
        sku_snapshot: 'MILK-01',
        unit: 'LITRE',
        unit_snapshot: 'LITRE',
        quantity: 2,
        unit_price_cents: 6500,
        total_price_cents: 13000,
        status: 'CONFIRMED',
      },
    ],
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: '00000000-0000-4000-8000-000000001002',
    store_id: STORE_ID,
    order_number: 'ORD-7820',
    customer_phone: '+919819876543',
    customer_name: 'Neha Sharma',
    status: 'CONFIRMED',
    fulfillment_type: 'DELIVERY',
    delivery_address: 'Bungalow 7, Perry Cross Road, Bandra West',
    total_amount_cents: 59850,
    currency: 'INR',
    items: [
      {
        id: '00000000-0000-4000-8000-000000000103',
        order_id: '00000000-0000-4000-8000-000000001002',
        product_id: STOREFRONT_PRODUCT_IDS.rice,
        product_name: 'Daawat Rozana Basmati Rice 5kg',
        product_name_snapshot: 'Daawat Rozana Basmati Rice 5kg',
        sku: 'RICE-01',
        sku_snapshot: 'RICE-01',
        unit: 'PACK',
        unit_snapshot: 'PACK',
        quantity: 1,
        unit_price_cents: 36000,
        total_price_cents: 36000,
        status: 'CONFIRMED',
      },
      {
        id: '00000000-0000-4000-8000-000000000104',
        order_id: '00000000-0000-4000-8000-000000001002',
        product_id: STOREFRONT_PRODUCT_IDS.butter,
        product_name: 'Cultured Farmhouse Butter 500g',
        product_name_snapshot: 'Cultured Farmhouse Butter 500g',
        sku: 'BUTE-01',
        sku_snapshot: 'BUTE-01',
        unit: 'PACK',
        unit_snapshot: 'PACK',
        quantity: 1,
        unit_price_cents: 26500,
        total_price_cents: 26500,
        status: 'CONFIRMED',
      },
    ],
    created_at: new Date(Date.now() - 3600000),
    updated_at: new Date(Date.now() - 3600000),
  },
  {
    id: '00000000-0000-4000-8000-000000001003',
    store_id: STORE_ID,
    order_number: 'ORD-7819',
    customer_phone: '+919870098765',
    customer_name: 'Kunal Kapoor',
    status: 'PREPARING',
    fulfillment_type: 'PICKUP',
    delivery_address: null,
    total_amount_cents: 136500,
    currency: 'INR',
    items: [
      {
        id: '00000000-0000-4000-8000-000000000105',
        order_id: '00000000-0000-4000-8000-000000001003',
        product_id: STOREFRONT_PRODUCT_IDS.coffee,
        product_name: 'Single-Origin Arabica Beans 250g',
        product_name_snapshot: 'Single-Origin Arabica Beans 250g',
        sku: 'COFF-01',
        sku_snapshot: 'COFF-01',
        unit: 'PACK',
        unit_snapshot: 'PACK',
        quantity: 1,
        unit_price_cents: 42000,
        total_price_cents: 42000,
        status: 'CONFIRMED',
      },
    ],
    created_at: new Date(Date.now() - 7200000),
    updated_at: new Date(Date.now() - 7200000),
  },
];

for (const o of consoleOrders) {
  orders.set(o.id, o);
}

// Mock Repositories
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

const mockDb = {
  transaction() {
    return { execute: async (cb) => cb({}) };
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
      sku: b.sku,
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
    if (!b) throw new Error('Product not found in stock');
    b.reservedQuantity += qty;
    b.availableQuantity -= qty;
    return this.findByProductId(storeId, productId, trx);
  },
  async applyReservationRelease(storeId, productId, qty, trx) {
    const b = stockBalances.get(productId);
    if (!b) throw new Error('Product not found in stock');
    b.reservedQuantity -= qty;
    b.availableQuantity += qty;
    return this.findByProductId(storeId, productId, trx);
  },
  async applyFulfillmentOutflow(storeId, productId, qty, trx) {
    const b = stockBalances.get(productId);
    if (!b) throw new Error('Product not found in stock');
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
  async findActiveByOrderId(storeId, orderId) {
    for (const r of reservations.values()) {
      if (r.order_id === orderId && r.store_id === storeId && r.status === 'ACTIVE') return r;
    }
    return null;
  },
  async createReservation(reservation, items) {
    const id = crypto.randomUUID();
    const row = {
      id,
      store_id: reservation.store_id ?? reservation.storeId,
      order_id: reservation.order_id ?? reservation.orderId,
      status: reservation.status ?? 'ACTIVE',
      expires_at: reservation.expires_at ?? reservation.expiresAt,
      created_at: new Date(),
      updated_at: new Date(),
      items: (items ?? reservation.items ?? []).map((i) => ({
        id: crypto.randomUUID(),
        reservation_id: id,
        product_id: i.product_id ?? i.productId,
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
  async insertMovement(movement) {
    return this.recordMovement(movement);
  },
  async listByProduct() {
    return [];
  },
  async listByProductId() {
    return [];
  },
};

const mockOrderRepo = {
  orderCounter: 1001,
  async create(order, items) {
    const id = crypto.randomUUID();
    this.orderCounter++;
    const orderNumber = `ORD-${this.orderCounter}`;
    const row = {
      id,
      store_id: order.storeId,
      order_number: orderNumber,
      customer_id: order.customerId ?? null,
      customer_phone: order.customerPhone ?? null,
      customer_name: order.customerName ?? null,
      status: order.status ?? 'AWAITING_SHOPKEEPER_REVIEW',
      fulfillment_type: order.fulfillmentType ?? 'PICKUP',
      delivery_address: order.deliveryAddress ?? null,
      notes: order.notes ?? null,
      currency: order.currency ?? 'INR',
      total_amount_cents: items.reduce((s, it) => s + it.totalPriceCents, 0),
      items: items.map((it) => ({
        id: crypto.randomUUID(),
        order_id: id,
        product_id: it.productId,
        product_name: it.productName,
        sku: it.sku ?? 'SKU-01',
        unit: it.unit,
        quantity: it.quantity,
        unit_price_cents: it.unitPriceCents,
        total_price_cents: it.totalPriceCents,
      })),
      created_at: new Date(),
      updated_at: new Date(),
    };
    orders.set(id, row);
    orderHistory.push({
      id: crypto.randomUUID(),
      orderId: id,
      fromStatus: null,
      toStatus: row.status,
      changedByUserId: 'system',
      reason: 'Order created',
      createdAt: new Date(),
    });
    return row;
  },
  async createOrder(order, items) {
    return this.create(order, items);
  },
  async findById(storeId, orderId) {
    const o = orders.get(orderId);
    if (!o || o.store_id !== storeId) return null;
    return o;
  },
  async findByOrderNumber(storeId, orderNumber) {
    for (const o of orders.values()) {
      if (o.order_number === orderNumber && o.store_id === storeId) return o;
    }
    return null;
  },
  async findByIdempotencyKey() {
    return null;
  },
  async list(storeId, options) {
    let list = Array.from(orders.values()).filter((o) => o.store_id === storeId);
    return { orders: list, total: list.length, totalCount: list.length };
  },
  async listByStore(storeId, options) {
    let list = Array.from(orders.values()).filter((o) => o.store_id === storeId);
    return { orders: list, totalCount: list.length };
  },
  async updateStatus(storeId, orderId, status, changedByUserId, reason) {
    const o = orders.get(orderId);
    if (!o || o.store_id !== storeId) return null;
    const fromStatus = o.status;
    o.status = status;
    o.updated_at = new Date();
    orderHistory.push({
      id: crypto.randomUUID(),
      orderId,
      fromStatus,
      toStatus: status,
      changedByUserId,
      reason,
      createdAt: new Date(),
    });
    return o;
  },
  async substituteItem(storeId, orderId, itemId, subProductId, subSku, subProductName, subUnit, subPriceCents, newQty, userId) {
    const o = orders.get(orderId);
    if (!o) return null;
    const it = o.items.find((i) => i.id === itemId);
    if (!it) return null;
    it.product_id = subProductId;
    it.sku = subSku;
    it.product_name = subProductName;
    it.unit = subUnit;
    it.unit_price_cents = subPriceCents;
    if (newQty) it.quantity = newQty;
    it.total_price_cents = it.unit_price_cents * it.quantity;
    o.total_amount_cents = o.items.reduce((s, i) => s + i.total_price_cents, 0);
    return o;
  },
  async getStatusHistory(storeId, orderId) {
    return orderHistory.filter((h) => h.orderId === orderId);
  },
  async insertOutboxEvent(storeId, event) {
    outboxEvents.push({ id: crypto.randomUUID(), storeId, ...event, status: 'PENDING' });
  },
};

const mockPaymentRepo = {
  async createPayment(p) {
    const id = crypto.randomUUID();
    const row = {
      id,
      store_id: p.storeId,
      order_id: p.orderId,
      amount_cents: p.amountCents,
      currency: p.currency ?? 'INR',
      status: p.status ?? 'PENDING',
      provider: p.provider ?? 'MOCK_RAZORPAY',
      provider_order_id: p.providerOrderId ?? null,
      provider_payment_id: null,
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
      if (p.order_id === orderId && p.store_id === storeId) return p;
    }
    return null;
  },
  async updatePaymentStatus(storeId, id, status, provPaymentId) {
    const p = payments.get(id);
    if (!p) return null;
    p.status = status;
    if (provPaymentId) p.provider_payment_id = provPaymentId;
    p.updated_at = new Date();
    return p;
  },
};

const mockWebhookRepo = {
  async recordWebhook(p) {
    const row = { id: crypto.randomUUID(), ...p, status: 'PROCESSED', created_at: new Date() };
    webhooks.set(p.providerEventId, row);
    return row;
  },
  async findByEventId(eventId) {
    return webhooks.get(eventId) ?? null;
  },
};

const mockWhatsAppStoreChannelRepo = {
  async findByPhoneNumberId(phoneNumberId) {
    return {
      id: 'chan-dev-01',
      store_id: STORE_ID,
      phone_number_id: phoneNumberId,
      business_phone_e164: '+919876543210',
      status: 'ACTIVE',
      created_at: new Date(),
      updated_at: new Date(),
    };
  },
  async findByStoreId(storeId) {
    return this.findByPhoneNumberId('987654321098765');
  },
};

const mockWhatsAppInboundRepo = {
  receivedMessages: new Map(),
  async recordInboundMessage(input) {
    const row = { id: crypto.randomUUID(), ...input, status: 'RECEIVED', created_at: new Date() };
    this.receivedMessages.set(input.providerMessageId, row);
    return { isDuplicate: false, message: row };
  },
  async acquireProcessingLease() { return true; },
  async markProcessed() {},
  async markFailed() {},
  async findByProviderMessageId(id) { return this.receivedMessages.get(id) ?? null; },
};

const mockWhatsAppConversationRepo = {
  async getOrCreateConversation(storeId, senderPhoneE164) {
    return {
      id: 'conv-dev-01',
      store_id: storeId,
      sender_phone_e164: senderPhoneE164,
      state: 'IDLE',
      context: {},
      created_at: new Date(),
      updated_at: new Date(),
    };
  },
  async updateConversationState(conversationId, state, context) {
    return { id: conversationId, store_id: STORE_ID, sender_phone_e164: '+919876543210', state, context: context ?? {}, created_at: new Date(), updated_at: new Date() };
  },
  async findById(conversationId) {
    return { id: conversationId, store_id: STORE_ID, sender_phone_e164: '+919876543210', state: 'IDLE', context: {}, created_at: new Date(), updated_at: new Date() };
  },
  async recordOutboundActivity() {},
};

const mockWhatsAppQuoteRepo = {
  quotes: new Map(),
  async saveProvisionalQuote(storeId, convId, snapshot) {
    const quoteId = `quote-${Date.now()}`;
    const q = { ...snapshot, quoteId, quoteVersion: 1 };
    this.quotes.set(quoteId, q);
    return { quoteId, version: 1 };
  },
  async getActiveQuote() { return null; },
  async linkQuoteToOrder() {},
};

const mockWhatsAppOutboundClient = {
  async sendTextMessage(params) {
    sentWhatsAppMessages.push(params);
    return { success: true, messageId: `out-${Date.now()}` };
  },
};

// --------------------------------------------------------------------------
// Start All Services
// --------------------------------------------------------------------------

console.log('========================================================================');
console.log('🛒 GROCERY STORE & WHATSAPP COMMERCE — FULL STACK RUNTIME');
console.log('========================================================================\n');

// 1. Catalog Service
const catalogServiceInstance = createCatalogServiceInstance(mockCategoryRepo, mockProductRepo);
const catalogServer = createCatalogService({
  port: CATALOG_PORT,
  catalogService: catalogServiceInstance,
  internalTokenSecret: INTERNAL_SECRET,
});
await catalogServer.start();
console.log(`✅ [1/7] Catalog Service    : http://127.0.0.1:${CATALOG_PORT}`);

// 2. Inventory Service
const inventoryServiceInstance = createInventoryServiceInstance(
  mockDb,
  mockStockBalanceRepo,
  mockStockReservationRepo,
  mockStockMovementRepo,
);
const inventoryServer = createInventoryService({
  port: INVENTORY_PORT,
  inventoryService: inventoryServiceInstance,
  internalTokenSecret: INTERNAL_SECRET,
});
await inventoryServer.start();
console.log(`✅ [2/7] Inventory Service  : http://127.0.0.1:${INVENTORY_PORT}`);

// 3. Order Service
const orderInventoryClient = new HttpInventoryClient({
  baseUrl: `http://127.0.0.1:${INVENTORY_PORT}`,
  internalTokenSecret: INTERNAL_SECRET,
});
const orderCatalogClient = {
  async getProduct(storeId, productId) {
    const res = await fetch(`http://127.0.0.1:${CATALOG_PORT}/api/v1/catalog/products/${productId}`, {
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
const invoiceServiceInstance = new InvoiceService({ orderRepository: mockOrderRepo });
const orderServer = createOrderService({
  port: ORDER_PORT,
  orderService: orderServiceInstance,
  invoiceService: invoiceServiceInstance,
  internalTokenSecret: INTERNAL_SECRET,
});
await orderServer.start();
console.log(`✅ [3/7] Order Service      : http://127.0.0.1:${ORDER_PORT}`);

// 4. Payment Service
const paymentOrderClient = new PaymentOrderClient({
  baseUrl: `http://127.0.0.1:${ORDER_PORT}`,
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
  port: PAYMENT_PORT,
  paymentService: paymentServiceInstance,
  internalTokenSecret: INTERNAL_SECRET,
});
await paymentServer.start();
console.log(`✅ [4/7] Payment Service    : http://127.0.0.1:${PAYMENT_PORT}`);

// 5. WhatsApp Service
const whatsAppCatalogClient = new HttpCatalogLookupClient({
  baseUrl: `http://127.0.0.1:${CATALOG_PORT}`,
  internalTokenSecret: INTERNAL_SECRET,
});
const whatsAppInventoryClient = new HttpInventoryLookupClient({
  baseUrl: `http://127.0.0.1:${INVENTORY_PORT}`,
  internalTokenSecret: INTERNAL_SECRET,
});
const whatsAppOrderClient = new WhatsAppOrderClient({
  baseUrl: `http://127.0.0.1:${ORDER_PORT}`,
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
  port: WHATSAPP_PORT,
  coordinator: conversationCoordinator,
  verifyToken: WHATSAPP_VERIFY_TOKEN,
  appSecret: WHATSAPP_APP_SECRET,
});
await whatsAppServer.start();
console.log(`✅ [5/7] WhatsApp Service   : http://127.0.0.1:${WHATSAPP_PORT}`);

// 6. API Gateway Ingress
const gatewayServer = createApiGateway({
  port: GATEWAY_PORT,
  internalTokenSecret: INTERNAL_SECRET,
  corsAllowedOrigins: [
    `http://localhost:${WEB_PORT}`,
    `http://127.0.0.1:${WEB_PORT}`,
  ],
  serviceUrls: {
    identity: 'http://127.0.0.1:3001',
    catalog: `http://127.0.0.1:${CATALOG_PORT}`,
    inventory: `http://127.0.0.1:${INVENTORY_PORT}`,
    order: `http://127.0.0.1:${ORDER_PORT}`,
    payment: `http://127.0.0.1:${PAYMENT_PORT}`,
  },
});
await gatewayServer.start();
console.log(`✅ [6/7] API Gateway        : http://127.0.0.1:${GATEWAY_PORT}`);

// 7. Web Frontend
const webServer = createWebService({
  port: WEB_PORT,
  gatewayUrl: `http://127.0.0.1:${GATEWAY_PORT}`,
  storeId: STORE_ID,
});
await webServer.start();
console.log(`✅ [7/7] Web Application    : http://127.0.0.1:${WEB_PORT}\n`);

console.log('========================================================================');
console.log('🌟 APPLICATION READY & ACCESSIBLE:');
console.log(`   🛍️  Customer Storefront  : http://localhost:${WEB_PORT}/`);
console.log(`   📦  Catalog Browsing     : http://localhost:${WEB_PORT}/catalog`);
console.log(`   🏪  Shopkeeper Console   : http://localhost:${WEB_PORT}/admin`);
console.log(`   🌐  API Gateway Ingress  : http://localhost:${GATEWAY_PORT}/`);
console.log('========================================================================\n');
console.log('👉 Press Ctrl+C at any time to shutdown all microservices gracefully.\n');

// Graceful Shutdown
const shutdown = async () => {
  console.log('\n🧹 Shutting down all microservices gracefully...');
  await Promise.all([
    webServer.stop(),
    gatewayServer.stop(),
    catalogServer.stop(),
    inventoryServer.stop(),
    orderServer.stop(),
    paymentServer.stop(),
    whatsAppServer.stop(),
  ]);
  console.log('✅ All services stopped cleanly. Sockets closed.\n');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
