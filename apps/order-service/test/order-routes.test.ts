import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OrderStatus, OrderStatusHistoryRow } from '@grocery/database';
import { mintInternalToken } from '@grocery/service-runtime';
import {
  createOrderService,
  createOrderServiceInstance,
  type OrderRepository,
  type OrderWithItems,
} from '../dist/index.js';

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '77777777-7777-4777-8777-777777777777';
const PRODUCT_ID_1 = '44444444-4444-4444-8444-444444444444';
const PRODUCT_ID_2 = '55555555-5555-4555-8555-555555555555';
const ITEM_ID_1 = '88888888-8888-4888-8888-888888888888';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEST_SECRET = 'super-secret-internal-order-token-key-32chars';

function createMockOrder(status: OrderStatus = 'AWAITING_SHOPKEEPER_REVIEW'): OrderWithItems {
  return {
    id: ORDER_ID,
    store_id: STORE_ID,
    customer_id: USER_ID,
    order_number: 'ORD-TEST-001',
    status,
    fulfillment_type: 'PICKUP',
    delivery_address: null,
    customer_phone: '+919876543210',
    customer_name: 'Priya Sharma',
    total_amount_cents: 10000,
    currency: 'INR',
    notes: 'Test order',
    idempotency_key: null,
    created_at: new Date('2026-10-25T10:00:00Z'),
    updated_at: new Date('2026-10-25T10:00:00Z'),
    items: [
      {
        id: ITEM_ID_1,
        order_id: ORDER_ID,
        store_id: STORE_ID,
        product_id: PRODUCT_ID_1,
        product_name_snapshot: 'Test Flour 1kg',
        sku_snapshot: 'FLOUR-1K',
        unit_snapshot: 'PACKET',
        unit_price_cents: 10000,
        quantity: 1,
        total_price_cents: 10000,
        status: 'PENDING',
        substituted_product_id: null,
        substitution_notes: null,
        created_at: new Date('2026-10-25T10:00:00Z'),
        updated_at: new Date('2026-10-25T10:00:00Z'),
      },
    ],
  };
}

describe('Order Service HTTP Ingress API', () => {
  it('creates an order via POST /api/v1/orders', async () => {
    const mockRepo: OrderRepository = {
      createOrder: async () => createMockOrder('AWAITING_SHOPKEEPER_REVIEW'),
      findById: async () => null,
      findByOrderNumber: async () => null,
      findByIdempotencyKey: async () => null,
      listByStore: async () => ({ orders: [], totalCount: 0 }),
      updateStatus: async () => null,
      substituteItem: async () => null,
      getStatusHistory: async () => [],
    };

    const orderService = createOrderServiceInstance(mockRepo);
    const server = createOrderService({ port: 0, orderService });
    const { port } = await server.start();

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-store-id': STORE_ID,
        },
        body: JSON.stringify({
          customerId: USER_ID,
          fulfillmentType: 'PICKUP',
          customerPhone: '+919876543210',
          customerName: 'Priya Sharma',
          items: [
            {
              productId: PRODUCT_ID_1,
              quantity: 1,
            },
          ],
        }),
      });

      assert.equal(response.status, 201);
      const json = (await response.json()) as {
        order: { id: string; status: string; totalAmountCents: number };
      };
      assert.equal(json.order.id, ORDER_ID);
      assert.equal(json.order.status, 'AWAITING_SHOPKEEPER_REVIEW');
      assert.equal(json.order.totalAmountCents, 10000);
    } finally {
      await server.stop();
    }
  });

  it('rejects requests without store context with 400 RFC 7807 problem details', async () => {
    const mockRepo: OrderRepository = {
      createOrder: async () => createMockOrder(),
      findById: async () => null,
      findByOrderNumber: async () => null,
      findByIdempotencyKey: async () => null,
      listByStore: async () => ({ orders: [], totalCount: 0 }),
      updateStatus: async () => null,
      substituteItem: async () => null,
      getStatusHistory: async () => [],
    };

    const orderService = createOrderServiceInstance(mockRepo);
    const server = createOrderService({ port: 0, orderService });
    const { port } = await server.start();

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/orders`, {
        method: 'GET',
      });

      assert.equal(response.status, 400);
      assert.equal(response.headers.get('content-type'), 'application/problem+json; charset=utf-8');
      const json = (await response.json()) as { code: string; title: string };
      assert.equal(json.code, 'MISSING_STORE_ID');
    } finally {
      await server.stop();
    }
  });

  it('lists orders with pagination via GET /api/v1/orders', async () => {
    const mockRepo: OrderRepository = {
      createOrder: async () => createMockOrder(),
      findById: async () => null,
      findByOrderNumber: async () => null,
      findByIdempotencyKey: async () => null,
      listByStore: async () => ({
        orders: [createMockOrder('CONFIRMED')],
        totalCount: 1,
      }),
      updateStatus: async () => null,
      substituteItem: async () => null,
      getStatusHistory: async () => [],
    };

    const orderService = createOrderServiceInstance(mockRepo);
    const server = createOrderService({ port: 0, orderService });
    const { port } = await server.start();

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/orders?limit=10&offset=0`, {
        headers: { 'x-store-id': STORE_ID },
      });

      assert.equal(response.status, 200);
      const json = (await response.json()) as { data: unknown[]; total: number; limit: number };
      assert.equal(json.total, 1);
      assert.equal(json.data.length, 1);
      assert.equal(json.limit, 10);
    } finally {
      await server.stop();
    }
  });

  it('retrieves order details and audit history via GET /api/v1/orders/:id and /history', async () => {
    const mockHistory: OrderStatusHistoryRow = {
      id: '99999999-9999-4999-8999-999999999999',
      order_id: ORDER_ID,
      store_id: STORE_ID,
      from_status: 'AWAITING_SHOPKEEPER_REVIEW',
      to_status: 'CONFIRMED',
      changed_by_user_id: 'shopkeeper-1',
      reason: 'Confirmed',
      created_at: new Date('2026-10-25T10:05:00Z'),
    };

    const mockRepo: OrderRepository = {
      createOrder: async () => createMockOrder(),
      findById: async (_storeId, id) => (id === ORDER_ID ? createMockOrder('CONFIRMED') : null),
      findByOrderNumber: async () => null,
      findByIdempotencyKey: async () => null,
      listByStore: async () => ({ orders: [], totalCount: 0 }),
      updateStatus: async () => null,
      substituteItem: async () => null,
      getStatusHistory: async () => [mockHistory],
    };

    const orderService = createOrderServiceInstance(mockRepo);
    const server = createOrderService({ port: 0, orderService });
    const { port } = await server.start();

    try {
      // Order details
      const detailRes = await fetch(`http://127.0.0.1:${port}/api/v1/orders/${ORDER_ID}`, {
        headers: { 'x-store-id': STORE_ID },
      });
      assert.equal(detailRes.status, 200);
      const detailJson = (await detailRes.json()) as { order: { id: string } };
      assert.equal(detailJson.order.id, ORDER_ID);

      // 404 for unknown order
      const notFoundRes = await fetch(
        `http://127.0.0.1:${port}/api/v1/orders/00000000-0000-4000-8000-000000000099`,
        {
          headers: { 'x-store-id': STORE_ID },
        },
      );
      assert.equal(notFoundRes.status, 404);

      // Order history
      const historyRes = await fetch(`http://127.0.0.1:${port}/api/v1/orders/${ORDER_ID}/history`, {
        headers: { 'x-store-id': STORE_ID },
      });
      assert.equal(historyRes.status, 200);
      const historyJson = (await historyRes.json()) as { history: Array<{ toStatus: string }> };
      assert.equal(historyJson.history.length, 1);
      assert.equal(historyJson.history[0]!.toStatus, 'CONFIRMED');
    } finally {
      await server.stop();
    }
  });

  it('confirms order via POST /api/v1/orders/:id/confirm', async () => {
    let orderState = createMockOrder('AWAITING_SHOPKEEPER_REVIEW');

    const mockRepo: OrderRepository = {
      createOrder: async () => orderState,
      findById: async () => orderState,
      findByOrderNumber: async () => null,
      findByIdempotencyKey: async () => null,
      listByStore: async () => ({ orders: [], totalCount: 0 }),
      updateStatus: async (_storeId, _id, toStatus) => {
        orderState = { ...orderState, status: toStatus };
        return orderState;
      },
      substituteItem: async () => null,
      getStatusHistory: async () => [],
    };

    const orderService = createOrderServiceInstance(mockRepo);
    const server = createOrderService({ port: 0, orderService });
    const { port } = await server.start();

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/orders/${ORDER_ID}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-store-id': STORE_ID,
        },
        body: JSON.stringify({ userId: 'shopkeeper-1' }),
      });

      assert.equal(response.status, 200);
      const json = (await response.json()) as { order: { status: string } };
      assert.equal(json.order.status, 'CONFIRMED');
    } finally {
      await server.stop();
    }
  });

  it('substitutes an item via POST /api/v1/orders/:id/substitute', async () => {
    let orderState = createMockOrder('AWAITING_SHOPKEEPER_REVIEW');

    const mockRepo: OrderRepository = {
      createOrder: async () => orderState,
      findById: async () => orderState,
      findByOrderNumber: async () => null,
      findByIdempotencyKey: async () => null,
      listByStore: async () => ({ orders: [], totalCount: 0 }),
      updateStatus: async (_storeId, _id, toStatus) => {
        orderState = { ...orderState, status: toStatus };
        return orderState;
      },
      substituteItem: async () => orderState,
      getStatusHistory: async () => [],
    };

    const orderService = createOrderServiceInstance(mockRepo);
    const server = createOrderService({ port: 0, orderService });
    const { port } = await server.start();

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/v1/orders/${ORDER_ID}/substitute`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-store-id': STORE_ID,
          },
          body: JSON.stringify({
            itemId: ITEM_ID_1,
            substitutedProductId: PRODUCT_ID_2,
            substitutionNotes: 'Out of stock; replacing with alternative',
            newQuantity: 1,
            userId: 'shopkeeper-1',
          }),
        },
      );

      assert.equal(response.status, 200);
      const json = (await response.json()) as { order: { status: string } };
      assert.equal(json.order.status, 'CHANGE_REQUESTED');
    } finally {
      await server.stop();
    }
  });

  it('advances order status via POST /api/v1/orders/:id/status', async () => {
    let orderState = createMockOrder('CONFIRMED');

    const mockRepo: OrderRepository = {
      createOrder: async () => orderState,
      findById: async () => orderState,
      findByOrderNumber: async () => null,
      findByIdempotencyKey: async () => null,
      listByStore: async () => ({ orders: [], totalCount: 0 }),
      updateStatus: async (_storeId, _id, toStatus) => {
        orderState = { ...orderState, status: toStatus };
        return orderState;
      },
      substituteItem: async () => null,
      getStatusHistory: async () => [],
    };

    const orderService = createOrderServiceInstance(mockRepo);
    const server = createOrderService({ port: 0, orderService });
    const { port } = await server.start();

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/orders/${ORDER_ID}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-store-id': STORE_ID,
        },
        body: JSON.stringify({
          status: 'PREPARING',
          reason: 'Packing order items',
        }),
      });

      assert.equal(response.status, 200);
      const json = (await response.json()) as { order: { status: string } };
      assert.equal(json.order.status, 'PREPARING');
    } finally {
      await server.stop();
    }
  });

  it('cancels order via POST /api/v1/orders/:id/cancel', async () => {
    let orderState = createMockOrder('CONFIRMED');

    const mockRepo: OrderRepository = {
      createOrder: async () => orderState,
      findById: async () => orderState,
      findByOrderNumber: async () => null,
      findByIdempotencyKey: async () => null,
      listByStore: async () => ({ orders: [], totalCount: 0 }),
      updateStatus: async (_storeId, _id, toStatus) => {
        orderState = { ...orderState, status: toStatus };
        return orderState;
      },
      substituteItem: async () => null,
      getStatusHistory: async () => [],
    };

    const orderService = createOrderServiceInstance(mockRepo);
    const server = createOrderService({ port: 0, orderService });
    const { port } = await server.start();

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/orders/${ORDER_ID}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-store-id': STORE_ID,
        },
        body: JSON.stringify({
          reason: 'Customer cancelled before fulfillment',
          userId: USER_ID,
        }),
      });

      assert.equal(response.status, 200);
      const json = (await response.json()) as { order: { status: string } };
      assert.equal(json.order.status, 'CANCELLED');
    } finally {
      await server.stop();
    }
  });

  it('protects routes with internal token middleware when secret configured', async () => {
    const mockRepo: OrderRepository = {
      createOrder: async () => createMockOrder(),
      findById: async () => createMockOrder(),
      findByOrderNumber: async () => null,
      findByIdempotencyKey: async () => null,
      listByStore: async () => ({ orders: [], totalCount: 0 }),
      updateStatus: async () => null,
      substituteItem: async () => null,
      getStatusHistory: async () => [],
    };

    const orderService = createOrderServiceInstance(mockRepo);
    const server = createOrderService({
      port: 0,
      orderService,
      internalTokenSecret: TEST_SECRET,
    });
    const { port } = await server.start();

    try {
      // Missing token -> 401
      const unauthRes = await fetch(`http://127.0.0.1:${port}/api/v1/orders/${ORDER_ID}`, {
        headers: { 'x-store-id': STORE_ID },
      });
      assert.equal(unauthRes.status, 401);

      // Valid minted token -> 200
      const token = mintInternalToken(
        {
          sub: USER_ID,
          act: 'SHOPKEEPER',
          tid: STORE_ID,
          roles: ['OWNER'],
        },
        { secret: TEST_SECRET },
      );

      const authRes = await fetch(`http://127.0.0.1:${port}/api/v1/orders/${ORDER_ID}`, {
        headers: {
          'x-store-id': STORE_ID,
          'x-internal-token': token,
        },
      });
      assert.equal(authRes.status, 200);
    } finally {
      await server.stop();
    }
  });
});
