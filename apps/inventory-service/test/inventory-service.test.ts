import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
} from 'kysely';
import type {
  Database,
  StockBalanceRow,
  StockReservationRow,
  StockReservationItemRow,
  StockMovementRow,
  NewStockBalance,
} from '@grocery/database';
import type {
  StockBalanceRepository,
  StockReservationRepository,
  StockMovementRepository,
  StockReservationWithItems,
} from '../dist/index.js';
import {
  createInventoryServiceInstance,
  InsufficientStockDomainError,
  StockBalanceNotFoundError,
  InvalidReservationStateError,
  InventoryDomainError,
} from '../dist/index.js';

const STORE_ID_A = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID_1 = '44444444-4444-4444-8444-444444444444';
const PRODUCT_ID_2 = '55555555-5555-4555-8555-555555555555';
const ORDER_ID_1 = '77777777-7777-4777-8777-777777777777';
const RESERVATION_ID_1 = '88888888-8888-4888-8888-888888888888';

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
      createIntrospector: (dbInstance) => new PostgresIntrospector(dbInstance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

  // Mock transaction runner to execute callback directly with db
  Object.defineProperty(db, 'transaction', {
    value: () => ({
      execute: async <T>(callback: (trx: Kysely<Database>) => Promise<T>): Promise<T> => {
        return callback(db);
      },
    }),
  });

  return db;
}

function createMockRepositories(initialBalances: StockBalanceRow[] = []) {
  const balances = new Map<string, StockBalanceRow>(
    initialBalances.map((b) => [`${b.store_id}:${b.product_id}`, { ...b }]),
  );
  const reservations = new Map<string, StockReservationWithItems>();
  const movements: StockMovementRow[] = [];

  const stockRepo: StockBalanceRepository = {
    async findByProductId(storeId, productId) {
      return balances.get(`${storeId}:${productId}`) ?? null;
    },
    async listByStore(storeId) {
      return Array.from(balances.values()).filter((b) => b.store_id === storeId);
    },
    async upsertBalance(b) {
      const row: StockBalanceRow = {
        id: 'bal-id',
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
      const result: StockBalanceRow[] = [];
      for (const id of productIds) {
        const row = balances.get(`${storeId}:${id}`);
        if (row) result.push({ ...row });
      }
      return result;
    },
    async applyReservationHold(storeId, productId, quantity) {
      const existing = balances.get(`${storeId}:${productId}`);
      if (!existing) throw new Error('Not found');
      const reserved = Number(existing.reserved_quantity) + quantity;
      const available = Number(existing.available_quantity) - quantity;
      const updated: StockBalanceRow = {
        ...existing,
        reserved_quantity: String(reserved),
        available_quantity: String(available),
        updated_at: new Date(),
      };
      balances.set(`${storeId}:${productId}`, updated);
      return updated;
    },
    async applyReservationRelease(storeId, productId, quantity) {
      const existing = balances.get(`${storeId}:${productId}`);
      if (!existing) throw new Error('Not found');
      const reserved = Number(existing.reserved_quantity) - quantity;
      const available = Number(existing.available_quantity) + quantity;
      const updated: StockBalanceRow = {
        ...existing,
        reserved_quantity: String(reserved),
        available_quantity: String(available),
        updated_at: new Date(),
      };
      balances.set(`${storeId}:${productId}`, updated);
      return updated;
    },
    async applyFulfillmentOutflow(storeId, productId, quantity) {
      const existing = balances.get(`${storeId}:${productId}`);
      if (!existing) throw new Error('Not found');
      const onHand = Number(existing.on_hand_quantity) - quantity;
      const reserved = Number(existing.reserved_quantity) - quantity;
      const updated: StockBalanceRow = {
        ...existing,
        on_hand_quantity: String(onHand),
        reserved_quantity: String(reserved),
        updated_at: new Date(),
      };
      balances.set(`${storeId}:${productId}`, updated);
      return updated;
    },
  };

  const reservationRepo: StockReservationRepository = {
    async findById(storeId, id) {
      for (const res of reservations.values()) {
        if (res.store_id === storeId && res.id === id) return res;
      }
      return null;
    },
    async findByOrderId(storeId, orderId) {
      return reservations.get(`${storeId}:${orderId}`) ?? null;
    },
    async createReservation(res, items) {
      const reservationRecord: StockReservationWithItems = {
        id: RESERVATION_ID_1,
        store_id: res.store_id,
        order_id: res.order_id,
        status: 'ACTIVE',
        expires_at: res.expires_at,
        created_at: new Date(),
        updated_at: new Date(),
        items: items.map((i, idx) => ({
          id: `item-${idx}`,
          reservation_id: RESERVATION_ID_1,
          store_id: res.store_id,
          product_id: i.product_id,
          quantity: String(i.quantity),
          created_at: new Date(),
        })),
      };
      reservations.set(`${res.store_id}:${res.order_id}`, reservationRecord);
      return reservationRecord;
    },
    async updateStatus(storeId, id, status) {
      for (const [key, res] of reservations.entries()) {
        if (res.store_id === storeId && res.id === id) {
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
      const row: StockMovementRow = {
        id: `mov-${movements.length + 1}`,
        store_id: m.store_id,
        product_id: m.product_id,
        delta_quantity: String(m.delta_quantity),
        reason: m.reason,
        reference_id: m.reference_id ?? null,
        created_at: new Date(),
      };
      movements.push(row);
      return row;
    },
    async listByProduct(storeId, productId) {
      return movements.filter((m) => m.store_id === storeId && m.product_id === productId);
    },
  };

  return { stockRepo, reservationRepo, movementRepo, balances, reservations, movements };
}

describe('Inventory Domain Service: Reservation Engine & Concurrency', () => {
  it('successfully executes atomic multi-item reservation and records audit ledger movements', async () => {
    const db = createMockKysely();
    const initialBalances: StockBalanceRow[] = [
      {
        id: 'bal-1',
        store_id: STORE_ID_A,
        product_id: PRODUCT_ID_1,
        sku: 'RICE-5KG',
        on_hand_quantity: '20.000',
        reserved_quantity: '0.000',
        available_quantity: '20.000',
        reorder_point: '5.000',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: 'bal-2',
        store_id: STORE_ID_A,
        product_id: PRODUCT_ID_2,
        sku: 'DAL-1KG',
        on_hand_quantity: '30.000',
        reserved_quantity: '0.000',
        available_quantity: '30.000',
        reorder_point: '10.000',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    const { stockRepo, reservationRepo, movementRepo, balances, movements } =
      createMockRepositories(initialBalances);
    const service = createInventoryServiceInstance(db, stockRepo, reservationRepo, movementRepo);

    const reservation = await service.reserveStock(STORE_ID_A, {
      orderId: ORDER_ID_1,
      items: [
        { productId: PRODUCT_ID_1, quantity: 2 },
        { productId: PRODUCT_ID_2, quantity: 5 },
      ],
    });

    assert.equal(reservation.order_id, ORDER_ID_1);
    assert.equal(reservation.status, 'ACTIVE');
    assert.equal(reservation.items.length, 2);

    // Verify balance holds
    const bal1 = balances.get(`${STORE_ID_A}:${PRODUCT_ID_1}`)!;
    assert.equal(bal1.reserved_quantity, '2');
    assert.equal(bal1.available_quantity, '18');

    const bal2 = balances.get(`${STORE_ID_A}:${PRODUCT_ID_2}`)!;
    assert.equal(bal2.reserved_quantity, '5');
    assert.equal(bal2.available_quantity, '25');

    // Verify audit movements recorded
    assert.equal(movements.length, 2);
    assert.equal(movements[0].reason, 'RESERVATION_HOLD');
    assert.equal(movements[0].delta_quantity, '-2');
    assert.equal(movements[1].reason, 'RESERVATION_HOLD');
    assert.equal(movements[1].delta_quantity, '-5');
  });

  it('guarantees idempotency: retrying reservation for same order returns existing active reservation without duplicate deductions', async () => {
    const db = createMockKysely();
    const initialBalances: StockBalanceRow[] = [
      {
        id: 'bal-1',
        store_id: STORE_ID_A,
        product_id: PRODUCT_ID_1,
        sku: 'RICE-5KG',
        on_hand_quantity: '20.000',
        reserved_quantity: '0.000',
        available_quantity: '20.000',
        reorder_point: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    const { stockRepo, reservationRepo, movementRepo, balances } =
      createMockRepositories(initialBalances);
    const service = createInventoryServiceInstance(db, stockRepo, reservationRepo, movementRepo);

    const res1 = await service.reserveStock(STORE_ID_A, {
      orderId: ORDER_ID_1,
      items: [{ productId: PRODUCT_ID_1, quantity: 3 }],
    });

    const res2 = await service.reserveStock(STORE_ID_A, {
      orderId: ORDER_ID_1,
      items: [{ productId: PRODUCT_ID_1, quantity: 3 }],
    });

    assert.equal(res1.id, res2.id);

    // Reserved quantity must remain exactly 3, NOT 6
    const bal = balances.get(`${STORE_ID_A}:${PRODUCT_ID_1}`)!;
    assert.equal(bal.reserved_quantity, '3');
    assert.equal(bal.available_quantity, '17');
  });

  it('rejects reservation with InsufficientStockDomainError when any item exceeds available stock', async () => {
    const db = createMockKysely();
    const initialBalances: StockBalanceRow[] = [
      {
        id: 'bal-1',
        store_id: STORE_ID_A,
        product_id: PRODUCT_ID_1,
        sku: 'RICE-5KG',
        on_hand_quantity: '5.000',
        reserved_quantity: '2.000',
        available_quantity: '3.000', // only 3 available
        reorder_point: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    const { stockRepo, reservationRepo, movementRepo } = createMockRepositories(initialBalances);
    const service = createInventoryServiceInstance(db, stockRepo, reservationRepo, movementRepo);

    await assert.rejects(
      () =>
        service.reserveStock(STORE_ID_A, {
          orderId: ORDER_ID_1,
          items: [{ productId: PRODUCT_ID_1, quantity: 4 }], // requests 4 > 3
        }),
      (err: unknown) => {
        assert.ok(err instanceof InsufficientStockDomainError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.available, 3);
        assert.equal(err.requested, 4);
        return true;
      },
    );
  });

  it('executes idempotent saga compensation on releaseReservation', async () => {
    const db = createMockKysely();
    const initialBalances: StockBalanceRow[] = [
      {
        id: 'bal-1',
        store_id: STORE_ID_A,
        product_id: PRODUCT_ID_1,
        sku: 'MILK-1L',
        on_hand_quantity: '10.000',
        reserved_quantity: '0.000',
        available_quantity: '10.000',
        reorder_point: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    const { stockRepo, reservationRepo, movementRepo, balances, movements } =
      createMockRepositories(initialBalances);
    const service = createInventoryServiceInstance(db, stockRepo, reservationRepo, movementRepo);

    // 1. Reserve 4 units
    await service.reserveStock(STORE_ID_A, {
      orderId: ORDER_ID_1,
      items: [{ productId: PRODUCT_ID_1, quantity: 4 }],
    });

    assert.equal(balances.get(`${STORE_ID_A}:${PRODUCT_ID_1}`)!.available_quantity, '6');

    // 2. Release reservation (Saga compensation)
    const released1 = await service.releaseReservation(STORE_ID_A, ORDER_ID_1);
    assert.ok(released1);
    assert.equal(released1.status, 'RELEASED');
    assert.equal(balances.get(`${STORE_ID_A}:${PRODUCT_ID_1}`)!.available_quantity, '10');
    assert.equal(balances.get(`${STORE_ID_A}:${PRODUCT_ID_1}`)!.reserved_quantity, '0');

    // 3. Duplicate release must be idempotent no-op (no double increment)
    const released2 = await service.releaseReservation(STORE_ID_A, ORDER_ID_1);
    assert.ok(released2);
    assert.equal(released2.status, 'RELEASED');
    assert.equal(balances.get(`${STORE_ID_A}:${PRODUCT_ID_1}`)!.available_quantity, '10');
  });

  it('fulfills reservation: converts holds to inventory outflows', async () => {
    const db = createMockKysely();
    const initialBalances: StockBalanceRow[] = [
      {
        id: 'bal-1',
        store_id: STORE_ID_A,
        product_id: PRODUCT_ID_1,
        sku: 'OIL-1L',
        on_hand_quantity: '20.000',
        reserved_quantity: '0.000',
        available_quantity: '20.000',
        reorder_point: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    const { stockRepo, reservationRepo, movementRepo, balances, movements } =
      createMockRepositories(initialBalances);
    const service = createInventoryServiceInstance(db, stockRepo, reservationRepo, movementRepo);

    await service.reserveStock(STORE_ID_A, {
      orderId: ORDER_ID_1,
      items: [{ productId: PRODUCT_ID_1, quantity: 5 }],
    });

    const fulfilled = await service.fulfillReservation(STORE_ID_A, ORDER_ID_1);
    assert.ok(fulfilled);
    assert.equal(fulfilled.status, 'FULFILLED');

    // On-hand must decrease from 20 to 15, reserved must return to 0
    const bal = balances.get(`${STORE_ID_A}:${PRODUCT_ID_1}`)!;
    assert.equal(bal.on_hand_quantity, '15');
    assert.equal(bal.reserved_quantity, '0');
    assert.equal(bal.available_quantity, '15');

    // Movement must record FULFILLMENT_OUTFLOW
    const outflow = movements.find((m) => m.reason === 'FULFILLMENT_OUTFLOW');
    assert.ok(outflow);
    assert.equal(outflow.delta_quantity, '-5');
  });

  it('prevents stock adjustment from dropping on-hand below active reservations', async () => {
    const db = createMockKysely();
    const initialBalances: StockBalanceRow[] = [
      {
        id: 'bal-1',
        store_id: STORE_ID_A,
        product_id: PRODUCT_ID_1,
        sku: 'SUGAR-1KG',
        on_hand_quantity: '10.000',
        reserved_quantity: '8.000',
        available_quantity: '2.000',
        reorder_point: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    const { stockRepo, reservationRepo, movementRepo } = createMockRepositories(initialBalances);
    const service = createInventoryServiceInstance(db, stockRepo, reservationRepo, movementRepo);

    // Try adjusting by -3 (would make on-hand 7 < 8 reserved)
    await assert.rejects(
      () =>
        service.adjustStock(STORE_ID_A, PRODUCT_ID_1, {
          deltaQuantity: -3,
          reason: 'SHRINKAGE_DAMAGE',
        }),
      (err: unknown) => {
        assert.ok(err instanceof InventoryDomainError);
        assert.equal(err.code, 'INSUFFICIENT_STOCK_INVARIANT');
        return true;
      },
    );
  });
});
