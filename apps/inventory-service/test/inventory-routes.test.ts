import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StockBalanceRow, StockReservationRow } from '@grocery/database';
import { mintInternalToken } from '@grocery/service-runtime';
import {
  createInventoryService,
  createInventoryServiceInstance,
  type StockBalanceRepository,
  type StockReservationRepository,
  type StockMovementRepository,
  type StockReservationWithItems,
} from '../dist/index.js';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
} from 'kysely';
import type { Database } from '@grocery/database';

const STORE_ID_A = '11111111-1111-4111-8111-111111111111';
const STORE_ID_B = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID_1 = '44444444-4444-4444-8444-444444444444';
const ORDER_ID_1 = '77777777-7777-4777-8777-777777777777';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEST_SECRET = 'super-secret-internal-inventory-token-key-32chars';

function createMockKysely(): Kysely<Database> {
  const connection: DatabaseConnection = {
    executeQuery: async <R>() => ({ rows: [] as R[] }),
    streamQuery: () => {
      throw new Error('Streaming not implemented in mock');
    },
  };
  const driver: Driver = {
    init: async () => {},
    acquireConnection: async () => connection,
    beginTransaction: async () => {},
    commitTransaction: async () => {},
    rollbackTransaction: async () => {},
    releaseConnection: async () => {},
    destroy: async () => {},
  };
  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (d) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  Object.defineProperty(db, 'transaction', {
    value: () => ({
      execute: async <T>(callback: (trx: Kysely<Database>) => Promise<T>): Promise<T> => {
        return callback(db);
      },
    }),
  });

  return db;
}

function createMockService(initialBalance?: StockBalanceRow) {
  const db = createMockKysely();
  const balances = new Map<string, StockBalanceRow>();
  if (initialBalance) {
    balances.set(`${initialBalance.store_id}:${initialBalance.product_id}`, { ...initialBalance });
  }
  const reservations = new Map<string, StockReservationWithItems>();

  const stockRepo: StockBalanceRepository = {
    async findByProductId(storeId, productId) {
      return balances.get(`${storeId}:${productId}`) ?? null;
    },
    async listByStore(storeId) {
      return Array.from(balances.values()).filter((b) => b.store_id === storeId);
    },
    async upsertBalance(b) {
      const row: StockBalanceRow = {
        id: '99999999-9999-4999-8999-999999999999',
        store_id: b.store_id,
        product_id: b.product_id,
        sku: b.sku ?? null,
        on_hand_quantity: b.on_hand_quantity ?? '0',
        reserved_quantity: b.reserved_quantity ?? '0',
        available_quantity: b.available_quantity ?? '0',
        reorder_point: b.reorder_point ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      balances.set(`${b.store_id}:${b.product_id}`, row);
      return row;
    },
    async updateQuantities(storeId, productId, onHand, reorderPoint) {
      const existing = balances.get(`${storeId}:${productId}`);
      if (!existing) return null;
      const reserved = Number(existing.reserved_quantity);
      const updated: StockBalanceRow = {
        ...existing,
        on_hand_quantity: String(onHand),
        available_quantity: String(onHand - reserved),
        reorder_point:
          reorderPoint !== undefined && reorderPoint !== null
            ? String(reorderPoint)
            : existing.reorder_point,
        updated_at: new Date(),
      };
      balances.set(`${storeId}:${productId}`, updated);
      return updated;
    },
    async findAndLockForUpdate(storeId, productIds) {
      return productIds
        .map((id) => balances.get(`${storeId}:${id}`))
        .filter((b): b is StockBalanceRow => b !== undefined);
    },
    async applyReservationHold(storeId, productId, quantity) {
      const existing = balances.get(`${storeId}:${productId}`)!;
      const reserved = Number(existing.reserved_quantity) + quantity;
      const available = Number(existing.available_quantity) - quantity;
      const updated: StockBalanceRow = {
        ...existing,
        reserved_quantity: String(reserved),
        available_quantity: String(available),
      };
      balances.set(`${storeId}:${productId}`, updated);
      return updated;
    },
    async applyReservationRelease(storeId, productId, quantity) {
      const existing = balances.get(`${storeId}:${productId}`)!;
      const reserved = Number(existing.reserved_quantity) - quantity;
      const available = Number(existing.available_quantity) + quantity;
      const updated: StockBalanceRow = {
        ...existing,
        reserved_quantity: String(reserved),
        available_quantity: String(available),
      };
      balances.set(`${storeId}:${productId}`, updated);
      return updated;
    },
    async applyFulfillmentOutflow(storeId, productId, quantity) {
      const existing = balances.get(`${storeId}:${productId}`)!;
      const onHand = Number(existing.on_hand_quantity) - quantity;
      const reserved = Number(existing.reserved_quantity) - quantity;
      const updated: StockBalanceRow = {
        ...existing,
        on_hand_quantity: String(onHand),
        reserved_quantity: String(reserved),
      };
      balances.set(`${storeId}:${productId}`, updated);
      return updated;
    },
  };

  const reservationRepo: StockReservationRepository = {
    async findById() {
      return null;
    },
    async findByOrderId(storeId, orderId) {
      return reservations.get(`${storeId}:${orderId}`) ?? null;
    },
    async createReservation(res, items) {
      const row: StockReservationWithItems = {
        id: '88888888-8888-4888-8888-888888888888',
        store_id: res.store_id,
        order_id: res.order_id,
        status: 'ACTIVE',
        expires_at: res.expires_at,
        created_at: new Date(),
        updated_at: new Date(),
        items: items.map((i, idx) => ({
          id: `66666666-6666-4666-8666-66666666666${idx}`,
          reservation_id: '88888888-8888-4888-8888-888888888888',
          store_id: res.store_id,
          product_id: i.product_id,
          quantity: String(i.quantity),
          created_at: new Date(),
        })),
      };
      reservations.set(`${res.store_id}:${res.order_id}`, row);
      return row;
    },
    async updateStatus(storeId, id, status) {
      for (const [key, res] of reservations.entries()) {
        if (res.id === id && res.store_id === storeId) {
          const updated = { ...res, status, updated_at: new Date() };
          reservations.set(key, updated);
          return updated;
        }
      }
      return null;
    },
    async listExpiredActive() {
      return [];
    },
  };

  const movementRepo: StockMovementRepository = {
    async recordMovement(m) {
      return {
        id: 'mov-1',
        store_id: m.store_id,
        product_id: m.product_id,
        delta_quantity: String(m.delta_quantity),
        reason: m.reason,
        reference_id: m.reference_id ?? null,
        created_at: new Date(),
      };
    },
    async listByProduct() {
      return [];
    },
  };

  return createInventoryServiceInstance(db, stockRepo, reservationRepo, movementRepo);
}

describe('Inventory HTTP Ingress & REST API', () => {
  it('requires x-internal-token and rejects unauthenticated requests with 401', async () => {
    const service = createInventoryService({
      port: 0,
      inventoryService: createMockService(),
      internalTokenSecret: TEST_SECRET,
    });

    const { port } = await service.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/inventory/stocks`);
      assert.equal(res.status, 401);
    } finally {
      await service.stop();
    }
  });

  it('rejects request with 403 Forbidden when x-store-id contradicts internal token tid', async () => {
    const service = createInventoryService({
      port: 0,
      inventoryService: createMockService(),
      internalTokenSecret: TEST_SECRET,
    });

    const tokenForStoreA = mintInternalToken(
      {
        sub: USER_ID,
        act: 'STAFF',
        tid: STORE_ID_A,
        roles: ['STAFF'],
      },
      { secret: TEST_SECRET },
    );

    const { port } = await service.start();
    try {
      // Pass token for STORE_ID_A, but header for STORE_ID_B
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/inventory/stocks`, {
        headers: {
          'x-internal-token': tokenForStoreA,
          'x-store-id': STORE_ID_B,
        },
      });

      assert.equal(res.status, 403);
      const body = (await res.json()) as { code: string; title: string };
      assert.equal(body.code, 'TENANT_MISMATCH');
      assert.equal(body.title, 'Forbidden');
    } finally {
      await service.stop();
    }
  });

  it('allows validly authenticated STAFF token to read /api/v1/inventory/stocks/:productId', async () => {
    const initialBalance: StockBalanceRow = {
      id: '99999999-9999-4999-8999-999999999999',
      store_id: STORE_ID_A,
      product_id: PRODUCT_ID_1,
      sku: 'SKU-001',
      on_hand_quantity: '50.000',
      reserved_quantity: '0.000',
      available_quantity: '50.000',
      reorder_point: '10.000',
      created_at: new Date(),
      updated_at: new Date(),
    };

    const service = createInventoryService({
      port: 0,
      inventoryService: createMockService(initialBalance),
      internalTokenSecret: TEST_SECRET,
    });

    const staffToken = mintInternalToken(
      {
        sub: 'whatsapp-service',
        act: 'SYSTEM',
        tid: STORE_ID_A,
        roles: ['STAFF'],
      },
      { secret: TEST_SECRET },
    );

    const { port } = await service.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/inventory/stocks/${PRODUCT_ID_1}`, {
        headers: {
          'x-internal-token': staffToken,
          'x-store-id': STORE_ID_A,
        },
      });

      assert.equal(res.status, 200);
      const body = (await res.json()) as { stock: { availableQuantity: number } };
      assert.equal(body.stock.availableQuantity, 50);
    } finally {
      await service.stop();
    }
  });

  it('manages stock quantities, reservations, releases, and fulfillments over HTTP', async () => {
    const initialBalance: StockBalanceRow = {
      id: '99999999-9999-4999-8999-999999999999',
      store_id: STORE_ID_A,
      product_id: PRODUCT_ID_1,
      sku: 'SKU-001',
      on_hand_quantity: '50.000',
      reserved_quantity: '0.000',
      available_quantity: '50.000',
      reorder_point: '10.000',
      created_at: new Date(),
      updated_at: new Date(),
    };

    const inventoryService = createMockService(initialBalance);
    const service = createInventoryService({
      port: 0,
      inventoryService,
      internalTokenSecret: TEST_SECRET,
    });

    const token = mintInternalToken(
      {
        sub: USER_ID,
        act: 'SHOPKEEPER',
        tid: STORE_ID_A,
        roles: ['OWNER'],
      },
      { secret: TEST_SECRET },
    );

    const { port } = await service.start();
    try {
      // 1. GET Stock Balance: GET /api/v1/inventory/stocks/:productId
      const getRes = await fetch(
        `http://127.0.0.1:${port}/api/v1/inventory/stocks/${PRODUCT_ID_1}`,
        {
          headers: { 'x-internal-token': token },
        },
      );
      assert.equal(getRes.status, 200);
      const getBody = (await getRes.json()) as { stock: { availableQuantity: number } };
      assert.equal(getBody.stock.availableQuantity, 50);

      // 2. PUT Update Stock: PUT /api/v1/inventory/stocks/:productId
      const updateRes = await fetch(
        `http://127.0.0.1:${port}/api/v1/inventory/stocks/${PRODUCT_ID_1}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-token': token,
          },
          body: JSON.stringify({ onHandQuantity: 60, reorderPoint: 15 }),
        },
      );
      assert.equal(updateRes.status, 200);
      const updateBody = (await updateRes.json()) as { stock: { onHandQuantity: number } };
      assert.equal(updateBody.stock.onHandQuantity, 60);

      // 3. POST Reserve Stock: POST /api/v1/inventory/reservations
      const reserveRes = await fetch(`http://127.0.0.1:${port}/api/v1/inventory/reservations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': token,
        },
        body: JSON.stringify({
          orderId: ORDER_ID_1,
          items: [{ productId: PRODUCT_ID_1, quantity: 10 }],
        }),
      });

      assert.equal(reserveRes.status, 201);
      const reserveBody = (await reserveRes.json()) as {
        reservation: { orderId: string; status: string; items: unknown[] };
      };
      assert.equal(reserveBody.reservation.orderId, ORDER_ID_1);
      assert.equal(reserveBody.reservation.status, 'ACTIVE');
      assert.equal(reserveBody.reservation.items.length, 1);

      // 4. GET Reservation: GET /api/v1/inventory/reservations/order/:orderId
      const getResRes = await fetch(
        `http://127.0.0.1:${port}/api/v1/inventory/reservations/order/${ORDER_ID_1}`,
        {
          headers: { 'x-internal-token': token },
        },
      );
      assert.equal(getResRes.status, 200);

      // 5. POST Release Reservation: POST /api/v1/inventory/reservations/order/:orderId/release
      const releaseRes = await fetch(
        `http://127.0.0.1:${port}/api/v1/inventory/reservations/order/${ORDER_ID_1}/release`,
        {
          method: 'POST',
          headers: { 'x-internal-token': token },
        },
      );
      assert.equal(releaseRes.status, 200);
      const releaseBody = (await releaseRes.json()) as { reservation: { status: string } };
      assert.equal(releaseBody.reservation.status, 'RELEASED');
    } finally {
      await service.stop();
    }
  });

  it('guarantees tenant isolation: token for Store B cannot access Store A inventory', async () => {
    const initialBalance: StockBalanceRow = {
      id: '99999999-9999-4999-8999-999999999999',
      store_id: STORE_ID_A,
      product_id: PRODUCT_ID_1,
      sku: 'SKU-001',
      on_hand_quantity: '50.000',
      reserved_quantity: '0.000',
      available_quantity: '50.000',
      reorder_point: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const service = createInventoryService({
      port: 0,
      inventoryService: createMockService(initialBalance),
      internalTokenSecret: TEST_SECRET,
    });

    const storeBToken = mintInternalToken(
      {
        sub: USER_ID,
        act: 'SHOPKEEPER',
        tid: STORE_ID_B,
        roles: ['OWNER'],
      },
      { secret: TEST_SECRET },
    );

    const { port } = await service.start();
    try {
      // Store B queries Store A's product -> 404
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/inventory/stocks/${PRODUCT_ID_1}`, {
        headers: { 'x-internal-token': storeBToken },
      });
      assert.equal(res.status, 404);
    } finally {
      await service.stop();
    }
  });
});
