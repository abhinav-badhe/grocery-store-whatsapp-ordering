import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import http from 'node:http';
import crypto from 'node:crypto';
import type {
  Database,
  UserRow,
  StoreRow,
  StoreMembershipRow,
  StoreRole,
  MembershipStatus,
} from '@grocery/database';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
} from 'kysely';
import {
  createStoreService,
  createStoreRepository,
  createStoreMembershipRepository,
  createUserRepository,
  createIdentityService,
  generateEd25519KeyPair,
  signAccessToken,
  createAuthService,
  StoreNotFoundError,
  DuplicateStoreCodeError,
  StoreAccessDeniedError,
  StoreUnauthorizedError,
  type StoreRepository,
  type StoreMembershipRepository,
  type UserRepository,
  type CredentialRepository,
} from '../dist/index.js';

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

  return new Kysely<Database>({
    dialect: {
      createDriver: () => driver,
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createAdapter: () => new PostgresAdapter(),
      createIntrospector: (db) => new PostgresIntrospector(db),
    },
  });
}

function createMockUserRepo(initialUsers: UserRow[] = []): UserRepository {
  const users = [...initialUsers];
  return {
    async findById(id) {
      return users.find((u) => u.id === id) ?? null;
    },
    async findByEmail(email) {
      const normalized = email.trim().toLowerCase();
      return users.find((u) => u.email === normalized) ?? null;
    },
    async findByPhone(phone) {
      const normalized = phone.trim();
      return users.find((u) => u.phone === normalized) ?? null;
    },
    async create(newUser) {
      const row: UserRow = {
        id: crypto.randomUUID(),
        email: newUser.email ?? null,
        phone: newUser.phone ?? null,
        full_name: newUser.full_name,
        status: (newUser.status as UserRow['status']) ?? 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      };
      users.push(row);
      return row;
    },
    async update(id, update) {
      const idx = users.findIndex((u) => u.id === id);
      if (idx === -1) return null;
      const current = users[idx]!;
      const updated: UserRow = {
        ...current,
        full_name: update.full_name ?? current.full_name,
        email: update.email !== undefined ? update.email : current.email,
        phone: update.phone !== undefined ? update.phone : current.phone,
        status: (update.status as UserRow['status']) ?? current.status,
        updated_at: new Date(),
      };
      users[idx] = updated;
      return updated;
    },
  };
}

function createMockStoreRepo(initialStores: StoreRow[] = []): StoreRepository {
  const stores = [...initialStores];
  return {
    async findById(id) {
      return stores.find((s) => s.id === id) ?? null;
    },
    async findByCode(code) {
      const trimmed = code.trim().toLowerCase();
      return stores.find((s) => s.code?.toLowerCase() === trimmed) ?? null;
    },
    async create(newStore) {
      const code = newStore.code ? newStore.code.trim().toLowerCase() : null;
      if (code && stores.some((s) => s.code === code)) {
        const err = new Error('duplicate key value violates unique constraint');
        (err as unknown as Record<string, unknown>).code = '23505';
        (err as unknown as Record<string, unknown>).constraint = 'stores_code_unique_idx';
        throw err;
      }
      const row: StoreRow = {
        id: crypto.randomUUID(),
        name: newStore.name,
        code,
        currency: newStore.currency ?? 'INR',
        timezone: newStore.timezone ?? 'Asia/Kolkata',
        status: (newStore.status as StoreRow['status']) ?? 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      };
      stores.push(row);
      return row;
    },
    async update(id, update) {
      const idx = stores.findIndex((s) => s.id === id);
      if (idx === -1) return null;
      const current = stores[idx]!;
      const updated: StoreRow = {
        ...current,
        name: update.name ?? current.name,
        code:
          update.code !== undefined
            ? update.code
              ? update.code.trim().toLowerCase()
              : null
            : current.code,
        currency: update.currency ?? current.currency,
        timezone: update.timezone ?? current.timezone,
        status: (update.status as StoreRow['status']) ?? current.status,
        updated_at: new Date(),
      };
      stores[idx] = updated;
      return updated;
    },
    async listStoresForUser() {
      return stores;
    },
  };
}

function createMockMembershipRepo(
  initialMemberships: StoreMembershipRow[] = [],
): StoreMembershipRepository {
  const memberships = [...initialMemberships];
  return {
    async findByUserAndStore(userId, storeId) {
      return memberships.find((m) => m.user_id === userId && m.store_id === storeId) ?? null;
    },
    async listByUser(userId) {
      return memberships.filter((m) => m.user_id === userId);
    },
    async listByStore(storeId) {
      return memberships.filter((m) => m.store_id === storeId);
    },
    async create(newMembership) {
      const row: StoreMembershipRow = {
        id: crypto.randomUUID(),
        user_id: newMembership.user_id,
        store_id: newMembership.store_id,
        role: newMembership.role as StoreRole,
        status: (newMembership.status as MembershipStatus) ?? 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      };
      memberships.push(row);
      return row;
    },
    async updateRole(userId, storeId, role) {
      const idx = memberships.findIndex((m) => m.user_id === userId && m.store_id === storeId);
      if (idx === -1) return null;
      const current = memberships[idx]!;
      const updated: StoreMembershipRow = {
        ...current,
        role,
        updated_at: new Date(),
      };
      memberships[idx] = updated;
      return updated;
    },
    async updateStatus(userId, storeId, status) {
      const idx = memberships.findIndex((m) => m.user_id === userId && m.store_id === storeId);
      if (idx === -1) return null;
      const current = memberships[idx]!;
      const updated: StoreMembershipRow = {
        ...current,
        status,
        updated_at: new Date(),
      };
      memberships[idx] = updated;
      return updated;
    },
  };
}

function makeHttpRequest(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...headers,
          ...(body ? { 'Content-Length': Buffer.byteLength(body).toString() } : {}),
        },
      },
      (res) => {
        let resBody = '';
        res.on('data', (chunk) => {
          resBody += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 500,
            headers: res.headers,
            body: resBody,
          });
        });
      },
    );
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

describe('Multi-Tenant Store and Membership Foundation', () => {
  const testUserId = '10000000-0000-4000-8000-000000000001';
  const testUser: UserRow = {
    id: testUserId,
    email: 'shopkeeper@grocerystore.local',
    phone: '+919876543210',
    full_name: 'Shopkeeper Joe',
    status: 'ACTIVE',
    created_at: new Date(),
    updated_at: new Date(),
  };

  describe('StoreService (Service Layer)', () => {
    it('creates store and assigns creating user as OWNER atomically', async () => {
      const mockDb = createMockKysely();
      const userRepo = createMockUserRepo([testUser]);
      const storeRepo = createMockStoreRepo();
      const membershipRepo = createMockMembershipRepo();

      const storeService = createStoreService({
        db: mockDb,
        userRepo,
        storeRepo,
        membershipRepo,
      });

      const result = await storeService.createStore(testUserId, {
        name: 'Downtown Organic Market',
        code: 'downtown-organic',
        currency: 'INR',
        timezone: 'Asia/Kolkata',
      });

      assert.ok(result.store);
      assert.equal(result.store.name, 'Downtown Organic Market');
      assert.equal(result.store.code, 'downtown-organic');
      assert.equal(result.store.currency, 'INR');
      assert.equal(result.store.status, 'ACTIVE');

      assert.ok(result.membership);
      assert.equal(result.membership.userId, testUserId);
      assert.equal(result.membership.storeId, result.store.id);
      assert.equal(result.membership.role, 'OWNER');
      assert.equal(result.membership.status, 'ACTIVE');
    });

    it('rejects store creation when user is inactive or non-existent', async () => {
      const mockDb = createMockKysely();
      const userRepo = createMockUserRepo([]);
      const storeService = createStoreService({ db: mockDb, userRepo });

      await assert.rejects(
        storeService.createStore('unknown-user', { name: 'Failing Store' }),
        (err) => {
          assert.ok(err instanceof StoreUnauthorizedError);
          assert.equal(err.statusCode, 401);
          return true;
        },
      );
    });

    it('retrieves store by ID with tenant access enforcement', async () => {
      const mockDb = createMockKysely();
      const storeRepo = createMockStoreRepo();
      const membershipRepo = createMockMembershipRepo();
      const userRepo = createMockUserRepo([testUser]);

      const storeService = createStoreService({
        db: mockDb,
        userRepo,
        storeRepo,
        membershipRepo,
      });

      const created = await storeService.createStore(testUserId, {
        name: 'Neighborhood Fresh',
        code: 'neighborhood-fresh',
      });

      // Valid lookup by owner
      const store = await storeService.getStoreById(created.store.id, testUserId);
      assert.equal(store.name, 'Neighborhood Fresh');

      // Access denied for non-member
      await assert.rejects(
        storeService.getStoreById(created.store.id, 'other-unauthorized-user'),
        (err) => {
          assert.ok(err instanceof StoreAccessDeniedError);
          assert.equal(err.statusCode, 403);
          return true;
        },
      );

      // Not found for non-existent store
      await assert.rejects(
        storeService.getStoreById('00000000-0000-4000-8000-000000000099', testUserId),
        (err) => {
          assert.ok(err instanceof StoreNotFoundError);
          assert.equal(err.statusCode, 404);
          return true;
        },
      );
    });

    it('lists all stores associated with an active user membership', async () => {
      const mockDb = createMockKysely();
      const storeRepo = createMockStoreRepo();
      const membershipRepo = createMockMembershipRepo();
      const userRepo = createMockUserRepo([testUser]);

      const storeService = createStoreService({
        db: mockDb,
        userRepo,
        storeRepo,
        membershipRepo,
      });

      await storeService.createStore(testUserId, { name: 'Store Alpha', code: 'alpha' });
      await storeService.createStore(testUserId, { name: 'Store Beta', code: 'beta' });

      const userStores = await storeService.listStoresForUser(testUserId);
      assert.equal(userStores.length, 2);
      assert.equal(userStores[0]!.role, 'OWNER');
      assert.equal(userStores[1]!.role, 'OWNER');
    });

    it('allows OWNER to assign and update store memberships for other users', async () => {
      const mockDb = createMockKysely();
      const staffUser: UserRow = {
        id: '10000000-0000-4000-8000-000000000002',
        email: 'staff@grocerystore.local',
        phone: null,
        full_name: 'Staff Member',
        status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const storeRepo = createMockStoreRepo();
      const membershipRepo = createMockMembershipRepo();
      const userRepo = createMockUserRepo([testUser, staffUser]);

      const storeService = createStoreService({
        db: mockDb,
        userRepo,
        storeRepo,
        membershipRepo,
      });

      const { store } = await storeService.createStore(testUserId, { name: 'Flagship Store' });

      // Owner assigns staff user as STAFF
      const assigned = await storeService.assignMembership(testUserId, store.id, {
        userId: staffUser.id,
        storeId: store.id,
        role: 'STAFF',
      });

      assert.equal(assigned.userId, staffUser.id);
      assert.equal(assigned.role, 'STAFF');

      // Owner promotes staff user to MANAGER
      const promoted = await storeService.assignMembership(testUserId, store.id, {
        userId: staffUser.id,
        storeId: store.id,
        role: 'MANAGER',
      });

      assert.equal(promoted.role, 'MANAGER');

      // Staff member cannot assign roles (fails with 403)
      await assert.rejects(
        storeService.assignMembership('unauthorized-user', store.id, {
          userId: staffUser.id,
          storeId: store.id,
          role: 'STAFF',
        }),
        (err) => {
          assert.ok(err instanceof StoreAccessDeniedError);
          assert.equal(err.statusCode, 403);
          return true;
        },
      );
    });
  });

  describe('Store HTTP Endpoints over Network', () => {
    it('serves POST /api/v1/stores with 201 Created and GET /api/v1/users/me/stores with 200', async () => {
      const keyPair = generateEd25519KeyPair();
      const mockDb = createMockKysely();
      const userRepo = createMockUserRepo([testUser]);
      const storeRepo = createMockStoreRepo();
      const membershipRepo = createMockMembershipRepo();

      const authService = createAuthService({
        db: mockDb,
        userRepo,
        keyPair: {
          publicKey: keyPair.publicKey,
          privateKey: keyPair.privateKey,
        },
      });

      const storeService = createStoreService({
        db: mockDb,
        userRepo,
        storeRepo,
        membershipRepo,
      });

      const server = createIdentityService({
        authService,
        storeService,
        port: 0,
        host: '127.0.0.1',
      });

      await server.start();
      const address = server.server.address() as { port: number };
      const port = address.port;

      const accessToken = signAccessToken(
        {
          sub: testUserId,
          email: testUser.email,
          fullName: testUser.full_name,
        },
        { privateKey: keyPair.privateKey },
      );

      try {
        // 1. Create Store via POST /api/v1/stores
        const createRes = await makeHttpRequest(
          port,
          'POST',
          '/api/v1/stores',
          {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          JSON.stringify({
            name: 'Metro Grocery Mart',
            code: 'metro-mart',
            currency: 'INR',
          }),
        );

        assert.equal(createRes.statusCode, 201);
        const createData = JSON.parse(createRes.body);
        assert.ok(createData.store);
        assert.equal(createData.store.name, 'Metro Grocery Mart');
        assert.equal(createData.store.code, 'metro-mart');
        assert.equal(createData.membership.role, 'OWNER');
        assert.equal(createData.membership.userId, testUserId);

        const storeId = createData.store.id;

        // 2. Lookup Store via GET /api/v1/stores/:id
        const lookupRes = await makeHttpRequest(port, 'GET', `/api/v1/stores/${storeId}`, {
          Authorization: `Bearer ${accessToken}`,
        });
        assert.equal(lookupRes.statusCode, 200);
        const lookupData = JSON.parse(lookupRes.body);
        assert.equal(lookupData.store.id, storeId);
        assert.equal(lookupData.store.name, 'Metro Grocery Mart');

        // 3. List User Stores via GET /api/v1/users/me/stores
        const listRes = await makeHttpRequest(port, 'GET', '/api/v1/users/me/stores', {
          Authorization: `Bearer ${accessToken}`,
        });
        assert.equal(listRes.statusCode, 200);
        const listData = JSON.parse(listRes.body);
        assert.equal(listData.stores.length, 1);
        assert.equal(listData.stores[0].store.id, storeId);
        assert.equal(listData.stores[0].role, 'OWNER');

        // 4. Test missing auth returns 401 Unauthorized
        const unauthRes = await makeHttpRequest(
          port,
          'POST',
          '/api/v1/stores',
          { 'Content-Type': 'application/json' },
          JSON.stringify({ name: 'Unauthorized Store' }),
        );
        assert.equal(unauthRes.statusCode, 401);
      } finally {
        await server.stop();
      }
    });
  });
});
