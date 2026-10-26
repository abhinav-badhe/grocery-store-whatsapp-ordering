import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OrderStatus, OrderStatusHistoryRow } from '@grocery/database';
import type {
  OrderRepository,
  OrderWithItems,
  ListOrdersOptions,
  CreateOrderParams,
  CreateOrderItemParams,
} from '../dist/index.js';
import {
  createOrderServiceInstance,
  InvalidOrderStateTransitionError,
  OrderAlreadyConfirmedError,
  InventoryReservationFailedError,
  ItemSubstitutionError,
  type InventoryClient,
  type CatalogLookupClient,
} from '../dist/index.js';

const STORE_ID = '00000000-0000-4000-8000-000000000001';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID_1 = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID_2 = '33333333-3333-4333-8333-333333333333';
const ITEM_ID_1 = '44444444-4444-4444-8444-444444444444';
const USER_ID = '66666666-6666-4666-8666-666666666666';

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

describe('OrderService Domain Logic & State Machine', () => {
  it('creates order in AWAITING_SHOPKEEPER_REVIEW without reserving stock immediately', async () => {
    let capturedParams: CreateOrderParams | undefined;
    let capturedItems: readonly CreateOrderItemParams[] | undefined;

    const mockRepo: OrderRepository = {
      createOrder: async (params, items) => {
        capturedParams = params;
        capturedItems = items;
        return createMockOrder('AWAITING_SHOPKEEPER_REVIEW');
      },
      findById: async () => null,
      findByOrderNumber: async () => null,
      findByIdempotencyKey: async () => null,
      listByStore: async () => ({ orders: [], totalCount: 0 }),
      updateStatus: async () => null,
      substituteItem: async () => null,
      getStatusHistory: async () => [],
    };

    const mockCatalog: CatalogLookupClient = {
      getProduct: async (_storeId, productId) => ({
        id: productId,
        name: 'Organic Wheat Flour',
        sku: 'WHEAT-1K',
        unit: 'KG',
        priceCents: 6500,
        isActive: true,
      }),
    };

    const service = createOrderServiceInstance(mockRepo, undefined, mockCatalog);

    const order = await service.createOrder({
      storeId: STORE_ID,
      customerId: USER_ID,
      fulfillmentType: 'PICKUP',
      items: [{ productId: PRODUCT_ID_1, quantity: 2 }],
    });

    assert.equal(order.status, 'AWAITING_SHOPKEEPER_REVIEW');
    assert.ok(capturedParams);
    assert.equal(capturedParams.storeId, STORE_ID);
    assert.ok(capturedItems);
    assert.equal(capturedItems.length, 1);
    assert.equal(capturedItems[0]!.productNameSnapshot, 'Organic Wheat Flour');
    assert.equal(capturedItems[0]!.unitPriceCents, 6500);
  });

  it('confirms order: orchestrates reservation and transitions to CONFIRMED', async () => {
    let orderState = createMockOrder('AWAITING_SHOPKEEPER_REVIEW');
    const statusTransitions: OrderStatus[] = [];
    let reservationReserved = false;

    const mockRepo: OrderRepository = {
      createOrder: async () => orderState,
      findById: async () => orderState,
      findByOrderNumber: async () => null,
      findByIdempotencyKey: async () => null,
      listByStore: async () => ({ orders: [], totalCount: 0 }),
      updateStatus: async (_storeId, _id, toStatus) => {
        statusTransitions.push(toStatus);
        orderState = { ...orderState, status: toStatus };
        return orderState;
      },
      substituteItem: async () => null,
      getStatusHistory: async () => [],
    };

    const mockInventory: InventoryClient = {
      reserveStock: async (_storeId, _orderId, _items) => {
        reservationReserved = true;
        return { success: true, reservationId: 'res-1' };
      },
      releaseStock: async () => {},
      fulfillStock: async () => {},
    };

    const service = createOrderServiceInstance(mockRepo, mockInventory);

    const confirmed = await service.confirmOrder(STORE_ID, ORDER_ID, 'shopkeeper-1');

    assert.equal(confirmed.status, 'CONFIRMED');
    assert.ok(reservationReserved);
    assert.deepEqual(statusTransitions, ['CONFIRMATION_PENDING_RESERVATION', 'CONFIRMED']);
  });

  it('rolls back to AWAITING_SHOPKEEPER_REVIEW when inventory reservation fails', async () => {
    let orderState = createMockOrder('AWAITING_SHOPKEEPER_REVIEW');
    const statusTransitions: OrderStatus[] = [];

    const mockRepo: OrderRepository = {
      createOrder: async () => orderState,
      findById: async () => orderState,
      findByOrderNumber: async () => null,
      findByIdempotencyKey: async () => null,
      listByStore: async () => ({ orders: [], totalCount: 0 }),
      updateStatus: async (_storeId, _id, toStatus) => {
        statusTransitions.push(toStatus);
        orderState = { ...orderState, status: toStatus };
        return orderState;
      },
      substituteItem: async () => null,
      getStatusHistory: async () => [],
    };

    const mockInventory: InventoryClient = {
      reserveStock: async () => ({
        success: false,
        errorMessage: 'Insufficient available quantity for product',
      }),
      releaseStock: async () => {},
      fulfillStock: async () => {},
    };

    const service = createOrderServiceInstance(mockRepo, mockInventory);

    await assert.rejects(
      async () => service.confirmOrder(STORE_ID, ORDER_ID, 'shopkeeper-1'),
      (err: unknown) => err instanceof InventoryReservationFailedError,
    );

    assert.deepEqual(statusTransitions, [
      'CONFIRMATION_PENDING_RESERVATION',
      'AWAITING_SHOPKEEPER_REVIEW',
    ]);
    assert.equal(orderState.status, 'AWAITING_SHOPKEEPER_REVIEW');
  });

  it('rejects confirmation if order is not in review state', async () => {
    const orderState = createMockOrder('COMPLETED');
    const mockRepo: OrderRepository = {
      createOrder: async () => orderState,
      findById: async () => orderState,
      findByOrderNumber: async () => null,
      findByIdempotencyKey: async () => null,
      listByStore: async () => ({ orders: [], totalCount: 0 }),
      updateStatus: async () => null,
      substituteItem: async () => null,
      getStatusHistory: async () => [],
    };

    const service = createOrderServiceInstance(mockRepo);

    await assert.rejects(
      async () => service.confirmOrder(STORE_ID, ORDER_ID, 'shopkeeper-1'),
      (err: unknown) => err instanceof OrderAlreadyConfirmedError,
    );
  });

  it('substitutes an item and transitions order to CHANGE_REQUESTED', async () => {
    let orderState = createMockOrder('AWAITING_SHOPKEEPER_REVIEW');
    let substitutedCalled = false;

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
      substituteItem: async () => {
        substitutedCalled = true;
        return orderState;
      },
      getStatusHistory: async () => [],
    };

    const service = createOrderServiceInstance(mockRepo);

    const updated = await service.substituteItem({
      storeId: STORE_ID,
      orderId: ORDER_ID,
      itemId: ITEM_ID_1,
      substitutedProductId: PRODUCT_ID_2,
      substitutionNotes: 'Out of stock; offering premium brand',
      newQuantity: 1,
      substitutedByUserId: 'shopkeeper-1',
    });

    assert.ok(substitutedCalled);
    assert.equal(updated.status, 'CHANGE_REQUESTED');
  });

  it('enforces state machine transitions during advanceOrderStatus', async () => {
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

    const service = createOrderServiceInstance(mockRepo);

    // Valid: CONFIRMED -> PREPARING
    const prep = await service.advanceOrderStatus(STORE_ID, ORDER_ID, 'PREPARING', 'worker-1');
    assert.equal(prep.status, 'PREPARING');

    // Valid: PREPARING -> READY_FOR_PICKUP
    const ready = await service.advanceOrderStatus(
      STORE_ID,
      ORDER_ID,
      'READY_FOR_PICKUP',
      'worker-1',
    );
    assert.equal(ready.status, 'READY_FOR_PICKUP');

    // Invalid: READY_FOR_PICKUP -> AWAITING_SHOPKEEPER_REVIEW
    await assert.rejects(
      async () =>
        service.advanceOrderStatus(STORE_ID, ORDER_ID, 'AWAITING_SHOPKEEPER_REVIEW', 'worker-1'),
      (err: unknown) => err instanceof InvalidOrderStateTransitionError,
    );
  });

  it('cancels order and releases stock reservation if stock was held', async () => {
    let orderState = createMockOrder('CONFIRMED');
    let releaseCalled = false;

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

    const mockInventory: InventoryClient = {
      reserveStock: async () => ({ success: true }),
      releaseStock: async () => {
        releaseCalled = true;
      },
      fulfillStock: async () => {},
    };

    const service = createOrderServiceInstance(mockRepo, mockInventory);

    const cancelled = await service.cancelOrder(STORE_ID, ORDER_ID, 'customer-1', 'Changed mind');

    assert.equal(cancelled.status, 'CANCELLED');
    assert.ok(releaseCalled);
  });
});
