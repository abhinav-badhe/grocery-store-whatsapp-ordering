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
import type { Database } from '@grocery/database';
import {
  createUserRepository,
  createCredentialRepository,
  createStoreRepository,
  createStoreMembershipRepository,
  createUserWithCredential,
  createStoreWithOwner,
  DuplicateEmailError,
  DuplicatePhoneError,
  DuplicateStoreCodeError,
  DuplicateMembershipError,
  ForeignKeyConstraintError,
  DatabaseOperationError,
} from '../dist/index.js';

interface MockKyselyOptions {
  onExecuteQuery?: (
    sql: string,
    parameters: readonly unknown[],
  ) => { rows: unknown[] } | Promise<{ rows: unknown[] }>;
  onBeginTransaction?: () => void;
  onCommitTransaction?: () => void;
  onRollbackTransaction?: () => void;
}

function createMockKysely(options: MockKyselyOptions = {}): Kysely<Database> {
  const connection: DatabaseConnection = {
    executeQuery: async <R>(compiledQuery: { sql: string; parameters: readonly unknown[] }) => {
      if (options.onExecuteQuery) {
        const result = await options.onExecuteQuery(compiledQuery.sql, compiledQuery.parameters);
        return { rows: (result.rows ?? []) as R[] };
      }
      return { rows: [] as R[] };
    },
    streamQuery: () => {
      throw new Error('Streaming not implemented in mock');
    },
  };

  const driver: Driver = {
    init: async () => {},
    acquireConnection: async () => connection,
    beginTransaction: async () => {
      options.onBeginTransaction?.();
    },
    commitTransaction: async () => {
      options.onCommitTransaction?.();
    },
    rollbackTransaction: async () => {
      options.onRollbackTransaction?.();
    },
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

describe('Identity Persistence Layer', () => {
  describe('User Repository', () => {
    it('normalizes email before lookups and uses schema-qualified identity.users', async () => {
      let capturedSql = '';
      let capturedParams: readonly unknown[] = [];

      const mockDb = createMockKysely({
        onExecuteQuery: (sql, params) => {
          capturedSql = sql;
          capturedParams = params;
          return {
            rows: [
              {
                id: '00000000-0000-0000-0000-000000000001',
                email: 'merchant@example.com',
                phone: null,
                full_name: 'Merchant Test',
                status: 'ACTIVE',
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        },
      });

      const userRepo = createUserRepository(mockDb);
      const user = await userRepo.findByEmail('  Merchant@EXAMPLE.COM  ');

      assert.ok(user);
      assert.equal(user.email, 'merchant@example.com');
      assert.ok(
        capturedSql.includes('"identity"."users"'),
        'Must query schema-qualified identity.users',
      );
      assert.equal(
        capturedParams[0],
        'merchant@example.com',
        'Email must be normalized to lowercase trimmed',
      );
      assert.equal('password_hash' in user, false, 'User record must strictly omit password_hash');
    });

    it('queries phone number by exact E.164 representation', async () => {
      let capturedParams: readonly unknown[] = [];

      const mockDb = createMockKysely({
        onExecuteQuery: (_sql, params) => {
          capturedParams = params;
          return {
            rows: [
              {
                id: '00000000-0000-0000-0000-000000000002',
                email: null,
                phone: '+919876543210',
                full_name: 'Phone User',
                status: 'ACTIVE',
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        },
      });

      const userRepo = createUserRepository(mockDb);
      const user = await userRepo.findByPhone('  +919876543210  ');

      assert.ok(user);
      assert.equal(user.phone, '+919876543210');
      assert.equal(capturedParams[0], '+919876543210');
    });

    it('normalizes email and phone when creating user', async () => {
      let capturedParams: readonly unknown[] = [];

      const mockDb = createMockKysely({
        onExecuteQuery: (_sql, params) => {
          capturedParams = params;
          return {
            rows: [
              {
                id: '00000000-0000-0000-0000-000000000003',
                email: 'newuser@example.com',
                phone: '+919876543211',
                full_name: 'New User',
                status: 'ACTIVE',
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        },
      });

      const userRepo = createUserRepository(mockDb);
      const created = await userRepo.create({
        email: '  NewUser@EXAMPLE.COM ',
        phone: ' +919876543211 ',
        full_name: 'New User',
      });

      assert.equal(created.email, 'newuser@example.com');
      assert.ok(capturedParams.includes('newuser@example.com'));
      assert.ok(capturedParams.includes('+919876543211'));
    });

    it('maps unique email constraint violation to DuplicateEmailError', async () => {
      const mockDb = createMockKysely({
        onExecuteQuery: () => {
          const pgError = new Error(
            'duplicate key value violates unique constraint',
          ) as unknown as {
            code: string;
            constraint: string;
          };
          pgError.code = '23505';
          pgError.constraint = 'users_email_unique_idx';
          throw pgError;
        },
      });

      const userRepo = createUserRepository(mockDb);
      await assert.rejects(
        async () => await userRepo.create({ email: 'dupe@example.com', full_name: 'Dupe' }),
        DuplicateEmailError,
      );
    });

    it('maps unique phone constraint violation to DuplicatePhoneError', async () => {
      const mockDb = createMockKysely({
        onExecuteQuery: () => {
          const pgError = new Error(
            'duplicate key value violates unique constraint',
          ) as unknown as {
            code: string;
            constraint: string;
          };
          pgError.code = '23505';
          pgError.constraint = 'users_phone_unique_idx';
          throw pgError;
        },
      });

      const userRepo = createUserRepository(mockDb);
      await assert.rejects(
        async () => await userRepo.create({ phone: '+919876543210', full_name: 'Dupe Phone' }),
        DuplicatePhoneError,
      );
    });

    it('explicitly sets updated_at on user updates', async () => {
      let capturedSql = '';

      const mockDb = createMockKysely({
        onExecuteQuery: (sql) => {
          capturedSql = sql;
          return {
            rows: [
              {
                id: '00000000-0000-0000-0000-000000000001',
                email: 'updated@example.com',
                phone: null,
                full_name: 'Updated Name',
                status: 'ACTIVE',
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        },
      });

      const userRepo = createUserRepository(mockDb);
      await userRepo.update('00000000-0000-0000-0000-000000000001', { full_name: 'Updated Name' });

      assert.ok(capturedSql.includes('"updated_at" ='), 'Must explicitly set updated_at column');
    });
  });

  describe('Credential Repository', () => {
    it('isolates password hash persistence to identity.user_credentials', async () => {
      let capturedSql = '';

      const mockDb = createMockKysely({
        onExecuteQuery: (sql) => {
          capturedSql = sql;
          return {
            rows: [
              {
                user_id: '00000000-0000-0000-0000-000000000001',
                password_hash: '$argon2id$v=19$m=65536,t=3,p=4$syntheticHash',
                algorithm: 'argon2id',
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        },
      });

      const credRepo = createCredentialRepository(mockDb);
      const cred = await credRepo.findByUserId('00000000-0000-0000-0000-000000000001');

      assert.ok(cred);
      assert.equal(cred.algorithm, 'argon2id');
      assert.ok(capturedSql.includes('"identity"."user_credentials"'));
    });

    it('explicitly sets updated_at when updating password hash', async () => {
      let capturedSql = '';

      const mockDb = createMockKysely({
        onExecuteQuery: (sql) => {
          capturedSql = sql;
          return {
            rows: [
              {
                user_id: '00000000-0000-0000-0000-000000000001',
                password_hash: '$argon2id$v=19$m=65536,t=3,p=4$newHash',
                algorithm: 'argon2id',
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        },
      });

      const credRepo = createCredentialRepository(mockDb);
      await credRepo.updatePasswordHash(
        '00000000-0000-0000-0000-000000000001',
        '$argon2id$v=19$m=65536,t=3,p=4$newHash',
      );

      assert.ok(capturedSql.includes('"updated_at" ='));
      assert.ok(capturedSql.includes('"password_hash" ='));
    });
  });

  describe('Store Repository', () => {
    it('creates store and queries store by ID and code', async () => {
      let capturedSql = '';

      const mockDb = createMockKysely({
        onExecuteQuery: (sql) => {
          capturedSql = sql;
          return {
            rows: [
              {
                id: '10000000-0000-0000-0000-000000000001',
                name: 'Main Mart',
                code: 'main-mart',
                currency: 'INR',
                timezone: 'Asia/Kolkata',
                status: 'ACTIVE',
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        },
      });

      const storeRepo = createStoreRepository(mockDb);
      const store = await storeRepo.findByCode('MAIN-MART');

      assert.ok(store);
      assert.equal(store.code, 'main-mart');
      assert.ok(capturedSql.includes('"identity"."stores"'));
    });

    it('maps unique store code violation to DuplicateStoreCodeError', async () => {
      const mockDb = createMockKysely({
        onExecuteQuery: () => {
          const pgError = new Error(
            'duplicate key value violates unique constraint',
          ) as unknown as {
            code: string;
            constraint: string;
          };
          pgError.code = '23505';
          pgError.constraint = 'stores_code_unique_idx';
          throw pgError;
        },
      });

      const storeRepo = createStoreRepository(mockDb);
      await assert.rejects(
        async () => await storeRepo.create({ name: 'Duplicate Store', code: 'main-mart' }),
        DuplicateStoreCodeError,
      );
    });

    it('lists stores associated with a user via store_memberships join', async () => {
      let capturedSql = '';

      const mockDb = createMockKysely({
        onExecuteQuery: (sql) => {
          capturedSql = sql;
          return {
            rows: [
              {
                id: '10000000-0000-0000-0000-000000000001',
                name: 'Store 1',
                code: 'store-1',
                currency: 'INR',
                timezone: 'Asia/Kolkata',
                status: 'ACTIVE',
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        },
      });

      const storeRepo = createStoreRepository(mockDb);
      const stores = await storeRepo.listStoresForUser('00000000-0000-0000-0000-000000000001');

      assert.equal(stores.length, 1);
      assert.ok(capturedSql.includes('"identity"."stores"'));
      assert.ok(capturedSql.includes('"identity"."store_memberships"'));
    });
  });

  describe('Store Membership Repository', () => {
    it('creates membership and queries by user and store', async () => {
      let capturedSql = '';

      const mockDb = createMockKysely({
        onExecuteQuery: (sql) => {
          capturedSql = sql;
          return {
            rows: [
              {
                id: '20000000-0000-0000-0000-000000000001',
                user_id: '00000000-0000-0000-0000-000000000001',
                store_id: '10000000-0000-0000-0000-000000000001',
                role: 'OWNER',
                status: 'ACTIVE',
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        },
      });

      const membershipRepo = createStoreMembershipRepository(mockDb);
      const membership = await membershipRepo.findByUserAndStore(
        '00000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000001',
      );

      assert.ok(membership);
      assert.equal(membership.role, 'OWNER');
      assert.ok(capturedSql.includes('"identity"."store_memberships"'));
    });

    it('maps unique (user_id, store_id) violation to DuplicateMembershipError', async () => {
      const mockDb = createMockKysely({
        onExecuteQuery: () => {
          const pgError = new Error(
            'duplicate key value violates unique constraint',
          ) as unknown as {
            code: string;
            constraint: string;
          };
          pgError.code = '23505';
          pgError.constraint = 'store_memberships_user_store_unique';
          throw pgError;
        },
      });

      const membershipRepo = createStoreMembershipRepository(mockDb);
      await assert.rejects(
        async () =>
          await membershipRepo.create({
            user_id: '00000000-0000-0000-0000-000000000001',
            store_id: '10000000-0000-0000-0000-000000000001',
            role: 'MANAGER',
          }),
        DuplicateMembershipError,
      );
    });

    it('maps foreign key violation to ForeignKeyConstraintError', async () => {
      const mockDb = createMockKysely({
        onExecuteQuery: () => {
          const pgError = new Error('violates foreign key constraint') as unknown as {
            code: string;
          };
          pgError.code = '23503';
          throw pgError;
        },
      });

      const membershipRepo = createStoreMembershipRepository(mockDb);
      await assert.rejects(
        async () =>
          await membershipRepo.create({
            user_id: 'non-existent-user',
            store_id: 'non-existent-store',
            role: 'STAFF',
          }),
        ForeignKeyConstraintError,
      );
    });
  });

  describe('Transactional Operations', () => {
    it('commits transaction when user and credential both succeed', async () => {
      let beginCalled = false;
      let commitCalled = false;
      let rollbackCalled = false;

      const mockDb = createMockKysely({
        onBeginTransaction: () => {
          beginCalled = true;
        },
        onCommitTransaction: () => {
          commitCalled = true;
        },
        onRollbackTransaction: () => {
          rollbackCalled = true;
        },
        onExecuteQuery: (sql) => {
          if (sql.includes('"identity"."users"')) {
            return {
              rows: [
                {
                  id: '00000000-0000-0000-0000-000000000001',
                  email: 'test@example.com',
                  phone: null,
                  full_name: 'Test User',
                  status: 'ACTIVE',
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }
          if (sql.includes('"identity"."user_credentials"')) {
            return {
              rows: [
                {
                  user_id: '00000000-0000-0000-0000-000000000001',
                  password_hash: '$argon2id$v=19$m=65536,t=3,p=4$hash',
                  algorithm: 'argon2id',
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }
          return { rows: [] };
        },
      });

      const result = await createUserWithCredential(mockDb, {
        user: { email: 'test@example.com', full_name: 'Test User' },
        credential: { passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$hash' },
      });

      assert.equal(beginCalled, true, 'Must begin transaction');
      assert.equal(commitCalled, true, 'Must commit transaction');
      assert.equal(rollbackCalled, false, 'Must not roll back on success');
      assert.equal(result.user.id, '00000000-0000-0000-0000-000000000001');
      assert.equal(result.credential.user_id, '00000000-0000-0000-0000-000000000001');
    });

    it('rolls back transaction atomically when credential creation fails after user creation', async () => {
      let rollbackCalled = false;

      const mockDb = createMockKysely({
        onRollbackTransaction: () => {
          rollbackCalled = true;
        },
        onExecuteQuery: (sql) => {
          if (sql.includes('"identity"."users"')) {
            return {
              rows: [
                {
                  id: '00000000-0000-0000-0000-000000000001',
                  email: 'test@example.com',
                  phone: null,
                  full_name: 'Test User',
                  status: 'ACTIVE',
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }
          if (sql.includes('"identity"."user_credentials"')) {
            throw new Error('Disk full during credential insertion');
          }
          return { rows: [] };
        },
      });

      await assert.rejects(
        async () =>
          await createUserWithCredential(mockDb, {
            user: { email: 'test@example.com', full_name: 'Test User' },
            credential: { passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$hash' },
          }),
        DatabaseOperationError,
      );

      assert.equal(rollbackCalled, true, 'Must roll back transaction when credential insert fails');
    });

    it('rolls back transaction atomically when owner membership creation fails after store creation', async () => {
      let rollbackCalled = false;

      const mockDb = createMockKysely({
        onRollbackTransaction: () => {
          rollbackCalled = true;
        },
        onExecuteQuery: (sql) => {
          if (sql.includes('"identity"."stores"')) {
            return {
              rows: [
                {
                  id: '10000000-0000-0000-0000-000000000001',
                  name: 'New Store',
                  code: 'new-store',
                  currency: 'INR',
                  timezone: 'Asia/Kolkata',
                  status: 'ACTIVE',
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }
          if (sql.includes('"identity"."store_memberships"')) {
            throw new Error('Connection lost during membership creation');
          }
          return { rows: [] };
        },
      });

      await assert.rejects(
        async () =>
          await createStoreWithOwner(mockDb, {
            store: { name: 'New Store', code: 'new-store' },
            ownerUserId: '00000000-0000-0000-0000-000000000001',
          }),
        DatabaseOperationError,
      );

      assert.equal(
        rollbackCalled,
        true,
        'Must roll back transaction when owner membership creation fails',
      );
    });
  });
});
