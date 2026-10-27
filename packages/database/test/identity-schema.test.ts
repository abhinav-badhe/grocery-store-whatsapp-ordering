import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getDefaultMigrationsDir,
  loadMigrationFiles,
  computeMigrationChecksum,
  isMigrationTransactional,
  runMigrations,
  createDatabaseClient,
  type Database,
  type MigrationDatabaseClient,
  type UsersTable,
  type UserCredentialsTable,
  type StoresTable,
  type StoreMembershipsTable,
  type RefreshTokensTable,
} from '../dist/index.js';

describe('Identity Schema Migration: File Discovery & Invariants', () => {
  const migrationsDir = getDefaultMigrationsDir();
  const files = loadMigrationFiles(migrationsDir);

  it('discovers 0002_identity_schema.sql and 0003_identity_sessions.sql in natural numeric order', () => {
    assert.ok(files.length >= 3, `Expected at least 3 migrations, found ${files.length}`);
    const bootstrap = files[0]!;
    const identity = files[1]!;
    const sessions = files[2]!;

    assert.equal(bootstrap.version, '0001');
    assert.equal(bootstrap.name, 'bootstrap');

    assert.equal(identity.version, '0002');
    assert.equal(identity.name, 'identity_schema');
    assert.equal(identity.filename, '0002_identity_schema.sql');
    assert.equal(identity.isTransactional, true);
    assert.equal(isMigrationTransactional(identity.content), true);
    assert.equal(identity.checksum.length, 64);

    assert.equal(sessions.version, '0003');
    assert.equal(sessions.name, 'identity_sessions');
    assert.equal(sessions.filename, '0003_identity_sessions.sql');
    assert.equal(sessions.isTransactional, true);
    assert.equal(isMigrationTransactional(sessions.content), true);
    assert.equal(sessions.checksum.length, 64);
  });

  it('validates 0002_identity_schema.sql content against architecture specifications', () => {
    const identityMigration = files.find((f) => f.version === '0002');
    assert.ok(identityMigration, '0002 migration must exist');
    const sql = identityMigration.content;

    // 1. Schema creation
    assert.ok(sql.includes('CREATE SCHEMA IF NOT EXISTS identity;'));

    // 2. identity.users
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS identity.users'));
    assert.ok(sql.includes('id UUID PRIMARY KEY DEFAULT gen_random_uuid()'));
    assert.ok(sql.includes('email VARCHAR(255) NULL'));
    assert.ok(sql.includes('phone VARCHAR(20) NULL'));
    assert.ok(sql.includes('full_name VARCHAR(100) NOT NULL'));
    assert.ok(sql.includes("status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE'"));
    assert.ok(
      sql.includes(
        'CONSTRAINT users_contact_identifier_check CHECK (email IS NOT NULL OR phone IS NOT NULL)',
      ),
    );
    assert.ok(
      sql.includes(
        "CONSTRAINT users_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION'))",
      ),
    );
    assert.ok(
      sql.includes(
        "CONSTRAINT users_phone_format_check CHECK (phone IS NULL OR phone ~ '^\\+[1-9]\\d{1,14}$')",
      ),
    );
    assert.ok(
      sql.includes(
        'CONSTRAINT users_full_name_length_check CHECK (char_length(TRIM(full_name)) >= 1 AND char_length(full_name) <= 100)',
      ),
    );
    assert.ok(
      sql.includes(
        'CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON identity.users (LOWER(TRIM(email))) WHERE email IS NOT NULL;',
      ),
    );
    assert.ok(
      sql.includes(
        'CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique_idx ON identity.users (phone) WHERE phone IS NOT NULL;',
      ),
    );

    // 3. identity.user_credentials
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS identity.user_credentials'));
    assert.ok(
      sql.includes('user_id UUID PRIMARY KEY REFERENCES identity.users(id) ON DELETE RESTRICT'),
    );
    assert.ok(sql.includes('password_hash VARCHAR(255) NOT NULL'));
    assert.ok(sql.includes("algorithm VARCHAR(32) NOT NULL DEFAULT 'argon2id'"));
    assert.ok(
      sql.includes("CONSTRAINT user_credentials_algorithm_check CHECK (algorithm IN ('argon2id'))"),
    );
    assert.ok(
      sql.includes(
        'CONSTRAINT user_credentials_password_hash_length_check CHECK (char_length(password_hash) >= 10)',
      ),
    );

    // 4. identity.stores
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS identity.stores'));
    assert.ok(sql.includes('name VARCHAR(100) NOT NULL'));
    assert.ok(sql.includes('code VARCHAR(50) NULL'));
    assert.ok(sql.includes("currency VARCHAR(3) NOT NULL DEFAULT 'INR'"));
    assert.ok(sql.includes("timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata'"));
    assert.ok(sql.includes("status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE'"));
    assert.ok(
      sql.includes(
        'CONSTRAINT stores_name_length_check CHECK (char_length(TRIM(name)) >= 2 AND char_length(name) <= 100)',
      ),
    );
    assert.ok(
      sql.includes(
        "CONSTRAINT stores_code_format_check CHECK (code IS NULL OR code ~ '^[a-z0-9-]+$')",
      ),
    );
    assert.ok(
      sql.includes("CONSTRAINT stores_currency_format_check CHECK (currency ~ '^[A-Z]{3}$')"),
    );
    assert.ok(
      sql.includes(
        "CONSTRAINT stores_status_check CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED'))",
      ),
    );
    assert.ok(
      sql.includes(
        'CREATE UNIQUE INDEX IF NOT EXISTS stores_code_unique_idx ON identity.stores (code) WHERE code IS NOT NULL;',
      ),
    );

    // 5. identity.store_memberships
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS identity.store_memberships'));
    assert.ok(
      sql.includes('user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT'),
    );
    assert.ok(
      sql.includes('store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT'),
    );
    assert.ok(
      sql.includes('CONSTRAINT store_memberships_user_store_unique UNIQUE (user_id, store_id)'),
    );
    assert.ok(
      sql.includes(
        "CONSTRAINT store_memberships_role_check CHECK (role IN ('OWNER', 'MANAGER', 'STAFF'))",
      ),
    );
    assert.ok(
      sql.includes(
        "CONSTRAINT store_memberships_status_check CHECK (status IN ('ACTIVE', 'INVITED', 'SUSPENDED'))",
      ),
    );
    assert.ok(
      sql.includes(
        'CREATE INDEX IF NOT EXISTS store_memberships_user_id_idx ON identity.store_memberships (user_id);',
      ),
    );
    assert.ok(
      sql.includes(
        'CREATE INDEX IF NOT EXISTS store_memberships_store_id_idx ON identity.store_memberships (store_id);',
      ),
    );

    // 6. Privilege configuration
    assert.ok(
      sql.includes(
        "IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grocery_identity_user') THEN",
      ),
    );
    assert.ok(sql.includes('GRANT USAGE ON SCHEMA identity TO grocery_identity_user;'));
    assert.ok(
      sql.includes(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity TO grocery_identity_user;',
      ),
    );
    assert.ok(
      sql.includes(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA identity GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO grocery_identity_user;',
      ),
    );
    assert.ok(sql.includes("RAISE NOTICE 'Role grocery_identity_user does not exist in cluster."));
  });

  it('validates 0003_identity_sessions.sql content against architecture specifications', () => {
    const sessionsMigration = files.find((f) => f.version === '0003');
    assert.ok(sessionsMigration, '0003 migration must exist');
    const sql = sessionsMigration.content;

    // 1. Table creation & columns
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS identity.refresh_tokens'));
    assert.ok(sql.includes('id UUID PRIMARY KEY DEFAULT gen_random_uuid()'));
    assert.ok(
      sql.includes('user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE'),
    );
    assert.ok(sql.includes('family_id UUID NOT NULL'));
    assert.ok(sql.includes('token_hash VARCHAR(64) NOT NULL'));
    assert.ok(sql.includes("status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'"));
    assert.ok(sql.includes('consumed_at TIMESTAMPTZ NULL'));
    assert.ok(sql.includes('revoked_at TIMESTAMPTZ NULL'));
    assert.ok(sql.includes('revoked_reason VARCHAR(50) NULL'));
    assert.ok(
      sql.includes(
        'replaced_by_token_id UUID NULL REFERENCES identity.refresh_tokens(id) ON DELETE SET NULL',
      ),
    );
    assert.ok(sql.includes('expires_at TIMESTAMPTZ NOT NULL'));
    assert.ok(sql.includes('created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()'));
    assert.ok(sql.includes('updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()'));

    // 2. Constraints
    assert.ok(
      sql.includes(
        "CONSTRAINT refresh_tokens_status_check CHECK (status IN ('ACTIVE', 'CONSUMED', 'REVOKED'))",
      ),
    );
    assert.ok(
      sql.includes(
        'CONSTRAINT refresh_tokens_hash_length_check CHECK (char_length(token_hash) = 64)',
      ),
    );

    // 3. Indexes
    assert.ok(
      sql.includes(
        'CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_hash_unique_idx ON identity.refresh_tokens (token_hash)',
      ),
    );
    assert.ok(
      sql.includes(
        'CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx ON identity.refresh_tokens (family_id)',
      ),
    );
    assert.ok(
      sql.includes(
        'CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON identity.refresh_tokens (user_id)',
      ),
    );
    assert.ok(
      sql.includes(
        "CREATE INDEX IF NOT EXISTS refresh_tokens_expires_at_idx ON identity.refresh_tokens (expires_at) WHERE status = 'ACTIVE'",
      ),
    );

    // 4. Permissions
    assert.ok(
      sql.includes(
        "IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grocery_identity_user') THEN",
      ),
    );
  });

  it('guarantees checksum remains identical across OS line endings', () => {
    for (const filename of ['0002_identity_schema.sql', '0003_identity_sessions.sql']) {
      const rawSql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
      const unixChecksum = computeMigrationChecksum(rawSql.replace(/\r\n/g, '\n'));
      const windowsChecksum = computeMigrationChecksum(
        rawSql.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'),
      );
      assert.equal(unixChecksum, windowsChecksum);
    }
  });
});

describe('Identity Schema: Kysely TypeScript Interfaces', () => {
  it('correctly compiles strongly typed table interfaces without runtime dependencies', () => {
    // Verify TypeScript interface structures through mock variable assignment
    const mockUser: UsersTable = {
      id: 'a0000000-0000-4000-8000-000000000001' as unknown as UsersTable['id'],
      email: 'user@example.com',
      phone: '+919876543210',
      full_name: 'Aditi Rao',
      status: 'ACTIVE' as unknown as UsersTable['status'],
      created_at: new Date() as unknown as UsersTable['created_at'],
      updated_at: new Date() as unknown as UsersTable['updated_at'],
    };
    assert.equal(mockUser.full_name, 'Aditi Rao');

    const mockCred: UserCredentialsTable = {
      user_id: 'a0000000-0000-4000-8000-000000000001',
      password_hash: '$argon2id$v=19$m=65536,t=3,p=4$fakehash',
      algorithm: 'argon2id' as unknown as UserCredentialsTable['algorithm'],
      created_at: new Date() as unknown as UserCredentialsTable['created_at'],
      updated_at: new Date() as unknown as UserCredentialsTable['updated_at'],
    };
    assert.equal(mockCred.user_id, 'a0000000-0000-4000-8000-000000000001');

    const mockStore: StoresTable = {
      id: 'b0000000-0000-4000-8000-000000000001' as unknown as StoresTable['id'],
      name: 'Super Kirana',
      code: 'super-kirana',
      currency: 'INR' as unknown as StoresTable['currency'],
      timezone: 'Asia/Kolkata' as unknown as StoresTable['timezone'],
      status: 'ACTIVE' as unknown as StoresTable['status'],
      created_at: new Date() as unknown as StoresTable['created_at'],
      updated_at: new Date() as unknown as StoresTable['updated_at'],
    };
    assert.equal(mockStore.name, 'Super Kirana');

    const mockMembership: StoreMembershipsTable = {
      id: 'c0000000-0000-4000-8000-000000000001' as unknown as StoreMembershipsTable['id'],
      user_id: 'a0000000-0000-4000-8000-000000000001',
      store_id: 'b0000000-0000-4000-8000-000000000001',
      role: 'OWNER',
      status: 'ACTIVE' as unknown as StoreMembershipsTable['status'],
      created_at: new Date() as unknown as StoreMembershipsTable['created_at'],
      updated_at: new Date() as unknown as StoreMembershipsTable['updated_at'],
    };
    assert.equal(mockMembership.role, 'OWNER');

    const mockRefreshToken: RefreshTokensTable = {
      id: 'd0000000-0000-4000-8000-000000000001' as unknown as RefreshTokensTable['id'],
      user_id: 'a0000000-0000-4000-8000-000000000001',
      family_id: 'e0000000-0000-4000-8000-000000000001',
      token_hash: 'a'.repeat(64),
      status: 'ACTIVE' as unknown as RefreshTokensTable['status'],
      consumed_at: null,
      revoked_at: null,
      revoked_reason: null,
      replaced_by_token_id: null,
      expires_at: new Date(),
      family_expires_at: new Date() as unknown as RefreshTokensTable['family_expires_at'],
      created_at: new Date() as unknown as RefreshTokensTable['created_at'],
      updated_at: new Date() as unknown as RefreshTokensTable['updated_at'],
    };
    assert.equal(mockRefreshToken.family_id, 'e0000000-0000-4000-8000-000000000001');
  });

  it('instantiates typed DatabaseClient<Database> without opening connections', async () => {
    const client = createDatabaseClient<Database>({
      databaseUrl: 'postgresql://grocery_identity_user:secret@localhost:5432/grocery_identity',
      maxPoolSize: 2,
      connectionTimeoutMs: 1000,
      idleTimeoutMs: 5000,
    });

    assert.ok(client.db);
    assert.ok(client.pool);
    // Cleanup pool without opening connections
    await client.destroy();
  });
});

describe('Identity Schema: Mock Migration Execution', () => {
  it('executes 0001, 0002, 0003, and 0004 migrations transactionally with advisory lock', async () => {
    const executedQueries: string[] = [];
    const ledger: Array<{ version: string; name: string; checksum: string }> = [];

    const mockClient: MigrationDatabaseClient = {
      async query<R = Record<string, unknown>>(
        queryText: string,
        values?: readonly unknown[],
      ): Promise<{ rows: R[] }> {
        executedQueries.push(queryText.trim());

        // Advisory lock
        if (queryText.includes('pg_try_advisory_lock')) {
          return { rows: [{ acquired: true }] as unknown as R[] };
        }
        if (queryText.includes('pg_advisory_unlock')) {
          return { rows: [{ pg_advisory_unlock: true }] as unknown as R[] };
        }

        // Ledger table check / query
        if (queryText.includes('CREATE TABLE IF NOT EXISTS public.schema_migrations')) {
          return { rows: [] };
        }
        if (queryText.includes('FROM public.schema_migrations')) {
          return {
            rows: ledger.map((l) => ({
              version: l.version,
              name: l.name,
              checksum: l.checksum,
              applied_at: new Date(),
              execution_time_ms: 10,
            })) as unknown as R[],
          };
        }

        // Ledger insert
        if (queryText.includes('INSERT INTO public.schema_migrations')) {
          if (values) {
            ledger.push({
              version: String(values[0]),
              name: String(values[1]),
              checksum: String(values[2]),
            });
          }
          return { rows: [] };
        }

        // Migration DDL execution
        return { rows: [] };
      },
    };

    const report = await runMigrations('postgres://mock:mock@localhost:5432/mock', {
      client: mockClient,
    });

    assert.equal(report.applied.length, 11);
    assert.equal(report.applied[0]!.version, '0001');
    assert.equal(report.applied[1]!.version, '0002');
    assert.equal(report.applied[2]!.version, '0003');
    assert.equal(report.applied[3]!.version, '0004');
    assert.equal(report.applied[4]!.version, '0005');
    assert.equal(report.applied[5]!.version, '0006');
    assert.equal(report.applied[6]!.version, '0007');
    assert.equal(report.applied[7]!.version, '0008');
    assert.equal(report.applied[8]!.version, '0009');
    assert.equal(report.applied[9]!.version, '0010');
    assert.equal(report.applied[10]!.version, '0011');
    assert.equal(report.alreadyAppliedCount, 0);

    // Verify atomic transaction wrapping for each migration
    const beginCount = executedQueries.filter((q) => q === 'BEGIN;').length;
    const commitCount = executedQueries.filter((q) => q === 'COMMIT;').length;
    assert.equal(beginCount, 11);
    assert.equal(commitCount, 11);
  });
});
