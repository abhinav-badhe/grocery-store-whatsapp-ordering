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
import type { Database, UserRow, UserCredentialRow } from '@grocery/database';
import {
  createAuthService,
  createIdentityService,
  InMemoryRateLimiter,
  ValidationError,
  InvalidCredentialsError,
  AccountSuspendedError,
  AccountInactiveError,
  RegistrationConflictError,
  TooManyRequestsError,
  type UserRepository,
  type CredentialRepository,
} from '../dist/index.js';

interface MockKyselyOptions {
  onExecuteQuery?: (
    sql: string,
    parameters: readonly unknown[],
  ) =>
    | { rows: unknown[]; numAffectedRows?: bigint }
    | Promise<{ rows: unknown[]; numAffectedRows?: bigint }>;
  onBeginTransaction?: () => void;
  onCommitTransaction?: () => void;
  onRollbackTransaction?: () => void;
}

function createMockKysely(options: MockKyselyOptions = {}): Kysely<Database> {
  const connection: DatabaseConnection = {
    executeQuery: async <R>(compiledQuery: { sql: string; parameters: readonly unknown[] }) => {
      if (options.onExecuteQuery) {
        const result = await options.onExecuteQuery(compiledQuery.sql, compiledQuery.parameters);
        return {
          rows: (result.rows ?? []) as R[],
          numAffectedRows: result.numAffectedRows,
        };
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

function createMockUserRepo(users: UserRow[] = []): UserRepository {
  const userList = [...users];
  return {
    async findById(id: string) {
      return userList.find((u) => u.id === id) ?? null;
    },
    async findByEmail(email: string) {
      const normalized = email.trim().toLowerCase();
      return userList.find((u) => u.email === normalized) ?? null;
    },
    async findByPhone(phone: string) {
      const normalized = phone.trim();
      return userList.find((u) => u.phone === normalized) ?? null;
    },
    async create(newUser) {
      const row: UserRow = {
        id: '10000000-0000-4000-8000-000000000001',
        email: newUser.email ?? null,
        phone: newUser.phone ?? null,
        full_name: newUser.full_name,
        status: (newUser.status as UserRow['status']) ?? 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      };
      userList.push(row);
      return row;
    },
    async update(id, update) {
      const idx = userList.findIndex((u) => u.id === id);
      if (idx === -1) return null;
      const current = userList[idx]!;
      const updated: UserRow = {
        ...current,
        full_name: update.full_name ?? current.full_name,
        email: update.email !== undefined ? update.email : current.email,
        phone: update.phone !== undefined ? update.phone : current.phone,
        status: (update.status as UserRow['status']) ?? current.status,
        updated_at: new Date(),
      };
      userList[idx] = updated;
      return updated;
    },
  };
}

function createMockCredentialRepo(creds: UserCredentialRow[] = []): CredentialRepository {
  const credList = [...creds];
  return {
    async findByUserId(userId: string) {
      return credList.find((c) => c.user_id === userId) ?? null;
    },
    async create(newCred) {
      const row: UserCredentialRow = {
        user_id: newCred.user_id,
        password_hash: newCred.password_hash,
        algorithm: 'argon2id',
        created_at: new Date(),
        updated_at: new Date(),
      };
      credList.push(row);
      return row;
    },
    async updatePasswordHash(userId, passwordHash, algorithm = 'argon2id') {
      const idx = credList.findIndex((c) => c.user_id === userId);
      if (idx === -1) return null;
      const updated: UserCredentialRow = {
        ...credList[idx]!,
        password_hash: passwordHash,
        algorithm: algorithm as 'argon2id',
        updated_at: new Date(),
      };
      credList[idx] = updated;
      return updated;
    },
  };
}

describe('Identity Registration and Login Foundation', () => {
  describe('User Registration (Service Layer)', () => {
    it('successfully registers a user with email and password, hashing with Argon2id', async () => {
      const mockDb = createMockKysely({
        onExecuteQuery: (sql, params) => {
          if (sql.includes('insert into "identity"."users"')) {
            return {
              rows: [
                {
                  id: '10000000-0000-4000-8000-000000000001',
                  email: 'test@example.com',
                  phone: null,
                  full_name: 'Test Owner',
                  status: 'ACTIVE',
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }
          if (sql.includes('insert into "identity"."user_credentials"')) {
            const hash = String(params[1]);
            assert.ok(
              hash.startsWith('$argon2id$v=19$m=65536,t=3,p=4$'),
              'Must use approved Argon2id parameters',
            );
            return {
              rows: [
                {
                  user_id: '10000000-0000-4000-8000-000000000001',
                  password_hash: hash,
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

      const authService = createAuthService({ db: mockDb });
      const result = await authService.register({
        fullName: 'Test Owner',
        email: '  TEST@Example.com  ',
        password: 'ValidSecurePassword123!',
      });

      assert.ok(result.user);
      assert.equal(result.user.fullName, 'Test Owner');
      assert.equal(result.user.email, 'test@example.com');
      assert.equal(result.user.status, 'ACTIVE');
      // Crucial: Ensure NO password hash, credentials, or DB secrets in public DTO
      assert.equal('password_hash' in (result.user as Record<string, unknown>), false);
      assert.equal('passwordHash' in (result.user as Record<string, unknown>), false);
    });

    it('successfully registers a user with E.164 phone number', async () => {
      const mockDb = createMockKysely({
        onExecuteQuery: (sql) => {
          if (sql.includes('insert into "identity"."users"')) {
            return {
              rows: [
                {
                  id: '10000000-0000-4000-8000-000000000002',
                  email: null,
                  phone: '+919876543210',
                  full_name: 'Mobile User',
                  status: 'ACTIVE',
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }
          if (sql.includes('insert into "identity"."user_credentials"')) {
            return {
              rows: [
                {
                  user_id: '10000000-0000-4000-8000-000000000002',
                  password_hash: '$argon2id$...',
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

      const authService = createAuthService({ db: mockDb });
      const result = await authService.register({
        fullName: 'Mobile User',
        phone: '+919876543210',
        password: 'StrongMobilePass123',
      });

      assert.equal(result.user.phone, '+919876543210');
      assert.equal(result.user.email, null);
    });

    it('rejects registration when neither email nor phone is provided', async () => {
      const mockDb = createMockKysely();
      const authService = createAuthService({ db: mockDb });

      await assert.rejects(
        authService.register({
          fullName: 'No Contact User',
          password: 'ValidPassword123',
        }),
        (err) => {
          assert.ok(err instanceof ValidationError);
          assert.equal(err.statusCode, 400);
          assert.ok(
            err.invalidParams?.some((p) => p.message.includes('At least one contact identifier')),
          );
          return true;
        },
      );
    });

    it('rejects registration when password is shorter than 8 characters', async () => {
      const mockDb = createMockKysely();
      const authService = createAuthService({ db: mockDb });

      await assert.rejects(
        authService.register({
          fullName: 'Short Pass User',
          email: 'short@example.com',
          password: '12345',
        }),
        (err) => {
          assert.ok(err instanceof ValidationError);
          assert.equal(err.statusCode, 400);
          assert.ok(err.invalidParams?.some((p) => p.path === 'password'));
          return true;
        },
      );
    });

    it('rejects registration when password exceeds 128 characters (DoS mitigation)', async () => {
      const mockDb = createMockKysely();
      const authService = createAuthService({ db: mockDb });

      await assert.rejects(
        authService.register({
          fullName: 'Long Pass User',
          email: 'long@example.com',
          password: 'a'.repeat(129),
        }),
        (err) => {
          assert.ok(err instanceof ValidationError);
          assert.equal(err.statusCode, 400);
          return true;
        },
      );
    });

    it('maps duplicate email collision to RegistrationConflictError with 409 status', async () => {
      const mockDb = createMockKysely({
        onExecuteQuery: (sql) => {
          if (sql.includes('insert into "identity"."users"')) {
            const pgErr = {
              code: '23505',
              constraint: 'users_email_unique_idx',
              message: 'duplicate key value violates unique constraint',
            };
            throw pgErr;
          }
          return { rows: [] };
        },
      });

      const authService = createAuthService({ db: mockDb });
      await assert.rejects(
        authService.register({
          fullName: 'Duplicate User',
          email: 'duplicate@example.com',
          password: 'ValidPassword123!',
        }),
        (err) => {
          assert.ok(err instanceof RegistrationConflictError);
          assert.equal(err.statusCode, 409);
          assert.equal(err.code, 'DUPLICATE_EMAIL');
          return true;
        },
      );
    });

    it('maps duplicate phone collision to RegistrationConflictError with 409 status', async () => {
      const mockDb = createMockKysely({
        onExecuteQuery: (sql) => {
          if (sql.includes('insert into "identity"."users"')) {
            const pgErr = {
              code: '23505',
              constraint: 'users_phone_unique_idx',
              message: 'duplicate key value violates unique constraint',
            };
            throw pgErr;
          }
          return { rows: [] };
        },
      });

      const authService = createAuthService({ db: mockDb });
      await assert.rejects(
        authService.register({
          fullName: 'Duplicate User',
          phone: '+919876543210',
          password: 'ValidPassword123!',
        }),
        (err) => {
          assert.ok(err instanceof RegistrationConflictError);
          assert.equal(err.statusCode, 409);
          assert.equal(err.code, 'DUPLICATE_PHONE');
          return true;
        },
      );
    });
  });

  describe('User Login (Service Layer)', () => {
    it('successfully logs in with valid email and password', async () => {
      const mockDb = createMockKysely();
      // Use realistic Argon2id hash for test
      const testUser: UserRow = {
        id: '10000000-0000-4000-8000-000000000001',
        email: 'owner@example.com',
        phone: null,
        full_name: 'Store Owner',
        status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const userRepo = createMockUserRepo([testUser]);
      const credRepo = createMockCredentialRepo();
      const authService = createAuthService({
        db: mockDb,
        userRepo,
        credentialRepo: credRepo,
      });

      // Register first to produce a genuine Argon2id hash in mock creds
      await authService.register({
        fullName: 'Store Owner',
        email: 'owner@example.com',
        password: 'CorrectPassword123!',
      });

      // Now login with normalized email
      const result = await authService.login({
        identifier: '  OWNER@example.com  ',
        password: 'CorrectPassword123!',
      });

      assert.ok(result.user);
      assert.equal(result.user.email, 'owner@example.com');
      assert.equal(result.user.fullName, 'Store Owner');
    });

    it('successfully logs in with valid phone and password', async () => {
      const mockDb = createMockKysely();
      const userRepo = createMockUserRepo();
      const credRepo = createMockCredentialRepo();
      const authService = createAuthService({
        db: mockDb,
        userRepo,
        credentialRepo: credRepo,
      });

      await authService.register({
        fullName: 'Phone Owner',
        phone: '+919876543210',
        password: 'PhonePassword123!',
      });

      const result = await authService.login({
        identifier: '+919876543210',
        password: 'PhonePassword123!',
      });

      assert.ok(result.user);
      assert.equal(result.user.phone, '+919876543210');
    });

    it('returns generic InvalidCredentialsError (401) on non-existent identifier', async () => {
      const mockDb = createMockKysely();
      const userRepo = createMockUserRepo([]);
      const credRepo = createMockCredentialRepo([]);
      const authService = createAuthService({
        db: mockDb,
        userRepo,
        credentialRepo: credRepo,
      });

      await assert.rejects(
        authService.login({
          identifier: 'nonexistent@example.com',
          password: 'SomePassword123!',
        }),
        (err) => {
          assert.ok(err instanceof InvalidCredentialsError);
          assert.equal(err.statusCode, 401);
          assert.equal(err.detail, 'Invalid login identifier or password');
          return true;
        },
      );
    });

    it('returns identical generic InvalidCredentialsError (401) on wrong password for existing user', async () => {
      const mockDb = createMockKysely();
      const userRepo = createMockUserRepo();
      const credRepo = createMockCredentialRepo();
      const authService = createAuthService({
        db: mockDb,
        userRepo,
        credentialRepo: credRepo,
      });

      await authService.register({
        fullName: 'Real User',
        email: 'real@example.com',
        password: 'RealPassword123!',
      });

      await assert.rejects(
        authService.login({
          identifier: 'real@example.com',
          password: 'WrongPassword456!',
        }),
        (err) => {
          assert.ok(err instanceof InvalidCredentialsError);
          assert.equal(err.statusCode, 401);
          assert.equal(err.detail, 'Invalid login identifier or password');
          return true;
        },
      );
    });

    it('rejects suspended accounts with AccountSuspendedError (403)', async () => {
      const mockDb = createMockKysely();
      const suspendedUser: UserRow = {
        id: '10000000-0000-4000-8000-000000000003',
        email: 'suspended@example.com',
        phone: null,
        full_name: 'Suspended User',
        status: 'SUSPENDED',
        created_at: new Date(),
        updated_at: new Date(),
      };
      const userRepo = createMockUserRepo([suspendedUser]);
      const credRepo = createMockCredentialRepo();
      const authService = createAuthService({
        db: mockDb,
        userRepo,
        credentialRepo: credRepo,
      });

      await assert.rejects(
        authService.login({
          identifier: 'suspended@example.com',
          password: 'AnyPassword123!',
        }),
        (err) => {
          assert.ok(err instanceof AccountSuspendedError);
          assert.equal(err.statusCode, 403);
          assert.equal(err.code, 'ACCOUNT_SUSPENDED');
          return true;
        },
      );
    });

    it('rejects pending verification accounts with AccountInactiveError (403)', async () => {
      const mockDb = createMockKysely();
      const pendingUser: UserRow = {
        id: '10000000-0000-4000-8000-000000000004',
        email: 'pending@example.com',
        phone: null,
        full_name: 'Pending User',
        status: 'PENDING_VERIFICATION',
        created_at: new Date(),
        updated_at: new Date(),
      };
      const userRepo = createMockUserRepo([pendingUser]);
      const credRepo = createMockCredentialRepo();
      const authService = createAuthService({
        db: mockDb,
        userRepo,
        credentialRepo: credRepo,
      });

      await assert.rejects(
        authService.login({
          identifier: 'pending@example.com',
          password: 'AnyPassword123!',
        }),
        (err) => {
          assert.ok(err instanceof AccountInactiveError);
          assert.equal(err.statusCode, 403);
          assert.equal(err.code, 'ACCOUNT_INACTIVE');
          return true;
        },
      );
    });

    it('enforces rate limiting after 5 failed login attempts', async () => {
      const mockDb = createMockKysely();
      const userRepo = createMockUserRepo([]);
      const credRepo = createMockCredentialRepo([]);
      const rateLimiter = new InMemoryRateLimiter({ maxAttempts: 5, windowMs: 60000 });
      const authService = createAuthService({
        db: mockDb,
        userRepo,
        credentialRepo: credRepo,
        rateLimiter,
      });

      const clientIp = '192.168.1.100';
      const identifier = 'target@example.com';

      // 5 failed attempts
      for (let i = 0; i < 5; i++) {
        await assert.rejects(
          authService.login({ identifier, password: 'BadPassword123!' }, clientIp),
          (err) => err instanceof InvalidCredentialsError,
        );
      }

      // 6th attempt should be blocked immediately with TooManyRequestsError (429)
      await assert.rejects(
        authService.login({ identifier, password: 'BadPassword123!' }, clientIp),
        (err) => {
          assert.ok(err instanceof TooManyRequestsError);
          assert.equal(err.statusCode, 429);
          assert.equal(err.code, 'RATE_LIMITED');
          return true;
        },
      );
    });

    it('shares rate-limit bucket across equivalent normalized email identifiers (casing and whitespace)', async () => {
      const mockDb = createMockKysely();
      const userRepo = createMockUserRepo([]);
      const credRepo = createMockCredentialRepo([]);
      const rateLimiter = new InMemoryRateLimiter({ maxAttempts: 5, windowMs: 60000 });
      const authService = createAuthService({
        db: mockDb,
        userRepo,
        credentialRepo: credRepo,
        rateLimiter,
      });

      const clientIp = '10.0.0.1';
      const variations = [
        'target@example.com',
        'TARGET@EXAMPLE.COM',
        '  target@example.com  ',
        '  Target@Example.COM  ',
        'Target@EXAMPLE.com',
      ];

      for (const variant of variations) {
        await assert.rejects(
          authService.login({ identifier: variant, password: 'BadPassword123!' }, clientIp),
          (err) => err instanceof InvalidCredentialsError,
        );
      }

      await assert.rejects(
        authService.login(
          { identifier: 'target@example.com', password: 'BadPassword123!' },
          clientIp,
        ),
        (err) => {
          assert.ok(err instanceof TooManyRequestsError);
          assert.equal(err.statusCode, 429);
          return true;
        },
      );

      await assert.rejects(
        authService.login(
          { identifier: 'TARGET@EXAMPLE.COM', password: 'BadPassword123!' },
          clientIp,
        ),
        (err) => {
          assert.ok(err instanceof TooManyRequestsError);
          assert.equal(err.statusCode, 429);
          return true;
        },
      );
    });

    it('shares rate-limit bucket across equivalent normalized phone identifiers (whitespace)', async () => {
      const mockDb = createMockKysely();
      const userRepo = createMockUserRepo([]);
      const credRepo = createMockCredentialRepo([]);
      const rateLimiter = new InMemoryRateLimiter({ maxAttempts: 5, windowMs: 60000 });
      const authService = createAuthService({
        db: mockDb,
        userRepo,
        credentialRepo: credRepo,
        rateLimiter,
      });

      const clientIp = '10.0.0.2';
      const variations = [
        '+12025550123',
        '  +12025550123  ',
        '+12025550123',
        '  +12025550123',
        '+12025550123  ',
      ];

      for (const variant of variations) {
        await assert.rejects(
          authService.login({ identifier: variant, password: 'BadPassword123!' }, clientIp),
          (err) => err instanceof InvalidCredentialsError,
        );
      }

      await assert.rejects(
        authService.login({ identifier: '+12025550123', password: 'BadPassword123!' }, clientIp),
        (err) => {
          assert.ok(err instanceof TooManyRequestsError);
          assert.equal(err.statusCode, 429);
          return true;
        },
      );
    });

    it('increments rate-limit abuse tracking on suspended account attempts', async () => {
      const suspendedUser: UserRow = {
        id: '10000000-0000-4000-8000-000000000003',
        email: 'suspended-abuse@example.com',
        phone: null,
        full_name: 'Suspended User',
        status: 'SUSPENDED',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockDb = createMockKysely();
      const userRepo = createMockUserRepo([suspendedUser]);
      const credRepo = createMockCredentialRepo([]);
      const rateLimiter = new InMemoryRateLimiter({ maxAttempts: 5, windowMs: 60000 });
      const authService = createAuthService({
        db: mockDb,
        userRepo,
        credentialRepo: credRepo,
        rateLimiter,
      });

      const clientIp = '10.0.0.3';
      const identifier = 'suspended-abuse@example.com';

      // 5 attempts against suspended account
      for (let i = 0; i < 5; i++) {
        await assert.rejects(
          authService.login({ identifier, password: 'AnyPassword123!' }, clientIp),
          (err) => err instanceof AccountSuspendedError,
        );
      }

      // 6th attempt should be blocked by rate limiter before account check
      await assert.rejects(
        authService.login({ identifier, password: 'AnyPassword123!' }, clientIp),
        (err) => {
          assert.ok(err instanceof TooManyRequestsError);
          assert.equal(err.statusCode, 429);
          return true;
        },
      );
    });

    it('increments rate-limit abuse tracking on inactive account attempts', async () => {
      const inactiveUser: UserRow = {
        id: '10000000-0000-4000-8000-000000000004',
        email: 'inactive-abuse@example.com',
        phone: null,
        full_name: 'Inactive User',
        status: 'PENDING_VERIFICATION',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockDb = createMockKysely();
      const userRepo = createMockUserRepo([inactiveUser]);
      const credRepo = createMockCredentialRepo([]);
      const rateLimiter = new InMemoryRateLimiter({ maxAttempts: 5, windowMs: 60000 });
      const authService = createAuthService({
        db: mockDb,
        userRepo,
        credentialRepo: credRepo,
        rateLimiter,
      });

      const clientIp = '10.0.0.4';
      const identifier = 'inactive-abuse@example.com';

      // 5 attempts against inactive account
      for (let i = 0; i < 5; i++) {
        await assert.rejects(
          authService.login({ identifier, password: 'AnyPassword123!' }, clientIp),
          (err) => err instanceof AccountInactiveError,
        );
      }

      // 6th attempt should be blocked by rate limiter
      await assert.rejects(
        authService.login({ identifier, password: 'AnyPassword123!' }, clientIp),
        (err) => {
          assert.ok(err instanceof TooManyRequestsError);
          assert.equal(err.statusCode, 429);
          return true;
        },
      );
    });
  });

  describe('HTTP Endpoints & RFC 7807 Serialization', () => {
    interface AuthHttpResponse {
      readonly user?: {
        readonly email: string | null;
        readonly fullName: string;
      };
      readonly type?: string;
      readonly title?: string;
      readonly status?: number;
      readonly detail?: string;
      readonly code?: string;
    }

    it('serves POST /api/v1/auth/register with 201 Created on valid input', async () => {
      const mockDb = createMockKysely();
      const userRepo = createMockUserRepo();
      const credRepo = createMockCredentialRepo();
      const authService = createAuthService({
        db: mockDb,
        userRepo,
        credentialRepo: credRepo,
      });

      const service = createIdentityService({ port: 0, authService });
      const { port } = await service.start();

      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName: 'HTTP Registered Owner',
            email: 'http-owner@example.com',
            password: 'SecurePassword123!',
          }),
        });

        assert.equal(response.status, 201);
        const body = (await response.json()) as AuthHttpResponse;
        assert.ok(body.user);
        assert.equal(body.user.email, 'http-owner@example.com');
        assert.equal(body.user.fullName, 'HTTP Registered Owner');
      } finally {
        await service.stop();
      }
    });

    it('serves POST /api/v1/auth/login with 200 OK on valid credentials', async () => {
      const mockDb = createMockKysely();
      const userRepo = createMockUserRepo();
      const credRepo = createMockCredentialRepo();
      const authService = createAuthService({
        db: mockDb,
        userRepo,
        credentialRepo: credRepo,
      });

      await authService.register({
        fullName: 'Login User',
        email: 'login@example.com',
        password: 'Password123!',
      });

      const service = createIdentityService({ port: 0, authService });
      const { port } = await service.start();

      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identifier: 'login@example.com',
            password: 'Password123!',
          }),
        });

        assert.equal(response.status, 200);
        const body = (await response.json()) as AuthHttpResponse;
        assert.ok(body.user);
        assert.equal(body.user.email, 'login@example.com');
      } finally {
        await service.stop();
      }
    });

    it('returns RFC 7807 400 Bad Request on malformed JSON payload', async () => {
      const mockDb = createMockKysely();
      const authService = createAuthService({ db: mockDb });

      const service = createIdentityService({ port: 0, authService });
      const { port } = await service.start();

      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not a valid json {',
        });

        assert.equal(response.status, 400);
        const body = (await response.json()) as AuthHttpResponse;
        assert.equal(body.type, 'https://tools.ietf.org/html/rfc7807');
        assert.equal(body.status, 400);
        assert.ok(body.detail?.includes('Malformed JSON'));
      } finally {
        await service.stop();
      }
    });

    it('returns RFC 7807 401 Unauthorized on invalid login credentials', async () => {
      const mockDb = createMockKysely();
      const userRepo = createMockUserRepo();
      const credRepo = createMockCredentialRepo();
      const authService = createAuthService({
        db: mockDb,
        userRepo,
        credentialRepo: credRepo,
      });

      const service = createIdentityService({ port: 0, authService });
      const { port } = await service.start();

      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identifier: 'unknown@example.com',
            password: 'WrongPassword123!',
          }),
        });

        assert.equal(response.status, 401);
        const body = (await response.json()) as AuthHttpResponse;
        assert.equal(body.type, 'https://tools.ietf.org/html/rfc7807');
        assert.equal(body.title, 'Unauthorized');
        assert.equal(body.status, 401);
        assert.equal(body.detail, 'Invalid login identifier or password');
      } finally {
        await service.stop();
      }
    });

    it('returns RFC 7807 413 Payload Too Large on request body exceeding 64 KiB without crashing', async () => {
      const mockDb = createMockKysely();
      const authService = createAuthService({ db: mockDb });

      const service = createIdentityService({ port: 0, authService });
      const { port } = await service.start();

      try {
        // Create an oversized body: 65 KiB (exceeds 64 KiB limit)
        const oversizedData = JSON.stringify({
          email: 'oversized@example.com',
          password: 'Password123!',
          fullName: 'x'.repeat(65 * 1024),
        });

        const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: oversizedData,
        });

        assert.equal(response.status, 413);
        const body = (await response.json()) as AuthHttpResponse;
        assert.equal(body.type, 'https://tools.ietf.org/html/rfc7807');
        assert.equal(body.title, 'Payload Too Large');
        assert.equal(body.status, 413);
        assert.equal(body.code, 'PAYLOAD_TOO_LARGE');
        assert.ok(body.detail?.includes('65536 bytes'));

        // Verify the server remains fully responsive
        const probeResponse = await fetch(`http://127.0.0.1:${port}/health/live`);
        assert.equal(probeResponse.status, 200);
      } finally {
        await service.stop();
      }
    });

    it('returns RFC 7807 415 Unsupported Media Type on non-JSON content-type', async () => {
      const mockDb = createMockKysely();
      const authService = createAuthService({ db: mockDb });

      const service = createIdentityService({ port: 0, authService });
      const { port } = await service.start();

      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: 'plain text body',
        });

        assert.equal(response.status, 415);
        const body = (await response.json()) as AuthHttpResponse;
        assert.equal(body.type, 'https://tools.ietf.org/html/rfc7807');
        assert.equal(body.title, 'Unsupported Media Type');
        assert.equal(body.status, 415);
        assert.equal(body.code, 'UNSUPPORTED_MEDIA_TYPE');
        assert.equal(body.detail, 'Content-Type must be application/json');
      } finally {
        await service.stop();
      }
    });

    it('enforces rate limiting after 5 failed login attempts over HTTP with 429 Too Many Requests', async () => {
      const mockDb = createMockKysely();
      const userRepo = createMockUserRepo([]);
      const credRepo = createMockCredentialRepo([]);
      const rateLimiter = new InMemoryRateLimiter({ maxAttempts: 5, windowMs: 60000 });
      const authService = createAuthService({
        db: mockDb,
        userRepo,
        credentialRepo: credRepo,
        rateLimiter,
      });

      const service = createIdentityService({ port: 0, authService });
      const { port } = await service.start();

      try {
        // 5 consecutive failed logins return 401
        for (let i = 0; i < 5; i++) {
          const resp = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              identifier: 'http-ratelimit@example.com',
              password: 'WrongPassword123!',
            }),
          });
          assert.equal(resp.status, 401);
        }

        // 6th attempt should return 429 Too Many Requests
        const blockedResp = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identifier: 'http-ratelimit@example.com',
            password: 'WrongPassword123!',
          }),
        });

        assert.equal(blockedResp.status, 429);
        const body = (await blockedResp.json()) as AuthHttpResponse;
        assert.equal(body.type, 'https://tools.ietf.org/html/rfc7807');
        assert.equal(body.title, 'Too Many Requests');
        assert.equal(body.status, 429);
        assert.equal(body.code, 'RATE_LIMITED');
        assert.equal(body.detail, 'Too many failed login attempts. Please try again later.');
      } finally {
        await service.stop();
      }
    });

    it('does not trust spoofed X-Forwarded-For headers when trustProxy is disabled', async () => {
      const mockDb = createMockKysely();
      const userRepo = createMockUserRepo([]);
      const credRepo = createMockCredentialRepo([]);
      const rateLimiter = new InMemoryRateLimiter({ maxAttempts: 5, windowMs: 60000 });
      const authService = createAuthService({
        db: mockDb,
        userRepo,
        credentialRepo: credRepo,
        rateLimiter,
      });

      // Default identity service: trustProxy is false
      const service = createIdentityService({ port: 0, authService, trustProxy: false });
      const { port } = await service.start();

      try {
        // Attempt 5 failed logins with spoofed X-Forwarded-For headers
        for (let i = 1; i <= 5; i++) {
          const resp = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Forwarded-For': `203.0.113.${i}`,
            },
            body: JSON.stringify({
              identifier: 'spoof-test@example.com',
              password: 'WrongPassword123!',
            }),
          });
          assert.equal(resp.status, 401);
        }

        // 6th attempt with a different spoofed IP header must still be blocked (429)
        // because the underlying socket IP (127.0.0.1) is used, not the spoofed header
        const blockedResp = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': '198.51.100.99',
          },
          body: JSON.stringify({
            identifier: 'spoof-test@example.com',
            password: 'WrongPassword123!',
          }),
        });

        assert.equal(blockedResp.status, 429);
      } finally {
        await service.stop();
      }
    });

    it('trusts X-Forwarded-For headers when trustProxy is explicitly enabled behind API Gateway', async () => {
      const mockDb = createMockKysely();
      const userRepo = createMockUserRepo([]);
      const credRepo = createMockCredentialRepo([]);
      const rateLimiter = new InMemoryRateLimiter({ maxAttempts: 5, windowMs: 60000 });
      const authService = createAuthService({
        db: mockDb,
        userRepo,
        credentialRepo: credRepo,
        rateLimiter,
      });

      // Service configured with trustProxy: true
      const service = createIdentityService({ port: 0, authService, trustProxy: true });
      const { port } = await service.start();

      try {
        // 5 failed logins for client IP 198.51.100.1
        for (let i = 0; i < 5; i++) {
          const resp = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Forwarded-For': '198.51.100.1, 10.0.0.1',
            },
            body: JSON.stringify({
              identifier: 'proxy-test@example.com',
              password: 'WrongPassword123!',
            }),
          });
          assert.equal(resp.status, 401);
        }

        // 6th attempt from 198.51.100.1 should be rate limited
        const blockedResp = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': '198.51.100.1, 10.0.0.1',
          },
          body: JSON.stringify({
            identifier: 'proxy-test@example.com',
            password: 'WrongPassword123!',
          }),
        });
        assert.equal(blockedResp.status, 429);

        // A different client IP from the gateway (198.51.100.2) should NOT be blocked yet
        const otherClientResp = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': '198.51.100.2, 10.0.0.1',
          },
          body: JSON.stringify({
            identifier: 'proxy-test@example.com',
            password: 'WrongPassword123!',
          }),
        });
        assert.equal(otherClientResp.status, 401);
      } finally {
        await service.stop();
      }
    });
  });
});
