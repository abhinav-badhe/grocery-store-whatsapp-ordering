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
  createRefreshTokenRepository,
  hashRefreshToken,
  generateRefreshToken,
  DuplicateTokenHashError,
  ForeignKeyConstraintError,
  IdentityPersistenceError,
} from '../dist/index.js';

interface MockKyselyOptions {
  onExecuteQuery?: (
    sql: string,
    parameters: readonly unknown[],
  ) =>
    | { rows: unknown[]; numAffectedRows?: bigint; numUpdatedRows?: bigint }
    | Promise<{ rows: unknown[]; numAffectedRows?: bigint; numUpdatedRows?: bigint }>;
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
          numAffectedRows: result.numAffectedRows ?? result.numUpdatedRows,
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

describe('Refresh Token Persistence & Rotation Foundation', () => {
  describe('Cryptographic Token Hashing & Generation', () => {
    it('computes deterministic lowercase 64-character SHA-256 hash', () => {
      const rawToken = 'test-token-secret-12345';
      const hash1 = hashRefreshToken(rawToken);
      const hash2 = hashRefreshToken(rawToken);

      assert.equal(hash1, hash2);
      assert.equal(hash1.length, 64);
      assert.match(hash1, /^[a-f0-9]{64}$/);
    });

    it('generates random url-safe token and matching SHA-256 hash', () => {
      const token1 = generateRefreshToken();
      const token2 = generateRefreshToken();

      assert.notEqual(token1.rawToken, token2.rawToken);
      assert.notEqual(token1.tokenHash, token2.tokenHash);
      assert.equal(token1.tokenHash, hashRefreshToken(token1.rawToken));
      assert.equal(token2.tokenHash, hashRefreshToken(token2.rawToken));
    });

    it('rejects empty, non-string, or whitespace-only tokens with IdentityPersistenceError', () => {
      assert.throws(
        () => hashRefreshToken(''),
        (err) => err instanceof IdentityPersistenceError,
      );
      assert.throws(
        () => hashRefreshToken('   '),
        (err) => err instanceof IdentityPersistenceError,
      );
      assert.throws(
        () => hashRefreshToken(null as unknown as string),
        (err) => err instanceof IdentityPersistenceError,
      );
    });
  });

  describe('Token Lookup & Query Qualification', () => {
    it('findByTokenHash queries schema-qualified identity.refresh_tokens with normalized hash', async () => {
      let capturedSql = '';
      let capturedParams: readonly unknown[] = [];

      const rawToken = 'sample-opaque-token';
      const tokenHash = hashRefreshToken(rawToken);

      const mockDb = createMockKysely({
        onExecuteQuery: (sql, params) => {
          capturedSql = sql;
          capturedParams = params;
          return {
            rows: [
              {
                id: '00000000-0000-4000-8000-000000000001',
                user_id: '10000000-0000-4000-8000-000000000001',
                family_id: '20000000-0000-4000-8000-000000000001',
                token_hash: tokenHash,
                status: 'ACTIVE',
                consumed_at: null,
                revoked_at: null,
                revoked_reason: null,
                replaced_by_token_id: null,
                expires_at: new Date(Date.now() + 86400000),
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        },
      });

      const repo = createRefreshTokenRepository(mockDb);
      const token = await repo.findByTokenHash(`  ${tokenHash.toUpperCase()}  `);

      assert.ok(token);
      assert.equal(token.token_hash, tokenHash);
      assert.ok(capturedSql.includes('from "identity"."refresh_tokens"'));
      assert.ok(capturedSql.includes('"token_hash" = $1'));
      assert.equal(capturedParams[0], tokenHash);
    });

    it('findByTokenHash returns null without executing SQL if hash format is invalid', async () => {
      let queryExecuted = false;
      const mockDb = createMockKysely({
        onExecuteQuery: () => {
          queryExecuted = true;
          return { rows: [] };
        },
      });

      const repo = createRefreshTokenRepository(mockDb);
      const token = await repo.findByTokenHash('invalid-short-hash');
      assert.equal(token, null);
      assert.equal(queryExecuted, false);
    });
  });

  describe('Token Creation', () => {
    it('creates a refresh token record with schema-qualified insert', async () => {
      let capturedSql = '';
      let capturedParams: readonly unknown[] = [];
      const tokenHash = hashRefreshToken('raw-secret');

      const mockDb = createMockKysely({
        onExecuteQuery: (sql, params) => {
          capturedSql = sql;
          capturedParams = params;
          return {
            rows: [
              {
                id: '00000000-0000-4000-8000-000000000001',
                user_id: '10000000-0000-4000-8000-000000000001',
                family_id: '20000000-0000-4000-8000-000000000001',
                token_hash: tokenHash,
                status: 'ACTIVE',
                consumed_at: null,
                revoked_at: null,
                revoked_reason: null,
                replaced_by_token_id: null,
                expires_at: new Date(Date.now() + 86400000),
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        },
      });

      const repo = createRefreshTokenRepository(mockDb);
      const result = await repo.create({
        user_id: '10000000-0000-4000-8000-000000000001',
        family_id: '20000000-0000-4000-8000-000000000001',
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 86400000),
      });

      assert.equal(result.token_hash, tokenHash);
      assert.ok(capturedSql.includes('insert into "identity"."refresh_tokens"'));
      assert.ok(capturedParams.includes(tokenHash));
    });

    it('rejects creation if token hash is not 64 hex characters', async () => {
      const mockDb = createMockKysely();
      const repo = createRefreshTokenRepository(mockDb);

      await assert.rejects(
        repo.create({
          user_id: '10000000-0000-4000-8000-000000000001',
          family_id: '20000000-0000-4000-8000-000000000001',
          token_hash: 'bad-hash',
          expires_at: new Date(Date.now() + 86400000),
        }),
        {
          name: 'IdentityPersistenceError',
          code: 'INVALID_TOKEN_HASH',
        },
      );
    });
  });

  describe('Atomic Rotation & State Transitions', () => {
    it('successfully rotates an ACTIVE token: consumes old token, inserts new token in same family, and acquires row lock', async () => {
      const queries: string[] = [];
      let transactionBegan = false;
      let transactionCommitted = false;

      const oldHash = hashRefreshToken('old-secret');
      const newHash = hashRefreshToken('new-secret');
      const newExpiresAt = new Date(Date.now() + 86400000);
      const familyId = '20000000-0000-4000-8000-000000000001';
      const userId = '10000000-0000-4000-8000-000000000001';

      const mockDb = createMockKysely({
        onBeginTransaction: () => {
          transactionBegan = true;
        },
        onCommitTransaction: () => {
          transactionCommitted = true;
        },
        onExecuteQuery: (sql) => {
          queries.push(sql);

          // 1. SELECT ... FOR UPDATE
          if (sql.includes('select') && sql.includes('"token_hash" = $1')) {
            assert.ok(
              sql.toLowerCase().includes('for update'),
              'Query must request exclusive row lock',
            );
            return {
              rows: [
                {
                  id: '00000000-0000-4000-8000-000000000001',
                  user_id: userId,
                  family_id: familyId,
                  token_hash: oldHash,
                  status: 'ACTIVE',
                  consumed_at: null,
                  revoked_at: null,
                  revoked_reason: null,
                  replaced_by_token_id: null,
                  expires_at: new Date(Date.now() + 3600000), // active for 1 more hour
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }

          // 2. INSERT new token
          if (sql.includes('insert into "identity"."refresh_tokens"')) {
            return {
              rows: [
                {
                  id: '00000000-0000-4000-8000-000000000002',
                  user_id: userId,
                  family_id: familyId,
                  token_hash: newHash,
                  status: 'ACTIVE',
                  consumed_at: null,
                  revoked_at: null,
                  revoked_reason: null,
                  replaced_by_token_id: null,
                  expires_at: newExpiresAt,
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }

          // 3. UPDATE old token to CONSUMED
          if (sql.includes('update "identity"."refresh_tokens"') && sql.includes('"status" = $1')) {
            return {
              rows: [
                {
                  id: '00000000-0000-4000-8000-000000000001',
                  user_id: userId,
                  family_id: familyId,
                  token_hash: oldHash,
                  status: 'CONSUMED',
                  consumed_at: new Date(),
                  revoked_at: null,
                  revoked_reason: null,
                  replaced_by_token_id: '00000000-0000-4000-8000-000000000002',
                  expires_at: new Date(Date.now() + 3600000),
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }

          return { rows: [] };
        },
      });

      const repo = createRefreshTokenRepository(mockDb);
      const result = await repo.rotate({
        oldTokenHash: oldHash,
        newTokenHash: newHash,
        newExpiresAt,
      });

      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.oldToken.status, 'CONSUMED');
        assert.equal(result.oldToken.replaced_by_token_id, '00000000-0000-4000-8000-000000000002');
        assert.equal(result.newToken.status, 'ACTIVE');
        assert.equal(result.newToken.family_id, familyId);
        assert.equal(result.newToken.token_hash, newHash);
      }

      assert.equal(transactionBegan, true);
      assert.equal(transactionCommitted, true);
      assert.equal(queries.length, 3);
    });

    it('returns TOKEN_NOT_FOUND when presenting token hash does not exist', async () => {
      const mockDb = createMockKysely({
        onExecuteQuery: () => ({ rows: [] }),
      });

      const repo = createRefreshTokenRepository(mockDb);
      const result = await repo.rotate({
        oldTokenHash: hashRefreshToken('missing-token'),
        newTokenHash: hashRefreshToken('new-token'),
        newExpiresAt: new Date(Date.now() + 86400000),
      });

      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.reason, 'TOKEN_NOT_FOUND');
      }
    });

    it('returns TOKEN_REVOKED when presenting token is already revoked', async () => {
      const tokenHash = hashRefreshToken('revoked-token');
      const mockDb = createMockKysely({
        onExecuteQuery: () => ({
          rows: [
            {
              id: '00000000-0000-4000-8000-000000000001',
              user_id: '10000000-0000-4000-8000-000000000001',
              family_id: '20000000-0000-4000-8000-000000000001',
              token_hash: tokenHash,
              status: 'REVOKED',
              consumed_at: null,
              revoked_at: new Date(),
              revoked_reason: 'LOGOUT',
              replaced_by_token_id: null,
              expires_at: new Date(Date.now() + 86400000),
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        }),
      });

      const repo = createRefreshTokenRepository(mockDb);
      const result = await repo.rotate({
        oldTokenHash: tokenHash,
        newTokenHash: hashRefreshToken('new-token'),
        newExpiresAt: new Date(Date.now() + 86400000),
      });

      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.reason, 'TOKEN_REVOKED');
      }
    });

    it('returns TOKEN_EXPIRED when presenting token has passed its expires_at', async () => {
      const tokenHash = hashRefreshToken('expired-token');
      const mockDb = createMockKysely({
        onExecuteQuery: () => ({
          rows: [
            {
              id: '00000000-0000-4000-8000-000000000001',
              user_id: '10000000-0000-4000-8000-000000000001',
              family_id: '20000000-0000-4000-8000-000000000001',
              token_hash: tokenHash,
              status: 'ACTIVE',
              consumed_at: null,
              revoked_at: null,
              revoked_reason: null,
              replaced_by_token_id: null,
              expires_at: new Date(Date.now() - 10000), // expired 10s ago
              family_expires_at: new Date(Date.now() + 864000000), // family still active
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        }),
      });

      const repo = createRefreshTokenRepository(mockDb);
      const result = await repo.rotate({
        oldTokenHash: tokenHash,
        newTokenHash: hashRefreshToken('new-token'),
        newExpiresAt: new Date(Date.now() + 86400000),
      });

      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.reason, 'TOKEN_EXPIRED');
      }
    });

    it('returns TOKEN_EXPIRED when presenting token has passed its family_expires_at, even if idle expires_at is active', async () => {
      const tokenHash = hashRefreshToken('active-token-expired-family');
      const mockDb = createMockKysely({
        onExecuteQuery: () => ({
          rows: [
            {
              id: '00000000-0000-4000-8000-000000000001',
              user_id: '10000000-0000-4000-8000-000000000001',
              family_id: '20000000-0000-4000-8000-000000000001',
              token_hash: tokenHash,
              status: 'ACTIVE',
              consumed_at: null,
              revoked_at: null,
              revoked_reason: null,
              replaced_by_token_id: null,
              expires_at: new Date(Date.now() + 86400000), // idle expires in 24 hours
              family_expires_at: new Date(Date.now() - 5000), // 30-day family ceiling elapsed 5s ago
              created_at: new Date(Date.now() - 30 * 86400000),
              updated_at: new Date(),
            },
          ],
        }),
      });

      const repo = createRefreshTokenRepository(mockDb);
      const result = await repo.rotate({
        oldTokenHash: tokenHash,
        newTokenHash: hashRefreshToken('new-token'),
        newExpiresAt: new Date(Date.now() + 86400000),
      });

      // CRITICAL INVARIANT (Finding H-1): Rotation must fail with TOKEN_EXPIRED once 30-day absolute ceiling is reached
      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.reason, 'TOKEN_EXPIRED');
      }
    });

    it('clamps replacement token expires_at to family_expires_at when newExpiresAt would exceed the family ceiling', async () => {
      const oldHash = hashRefreshToken('old-token-near-family-end');
      const newHash = hashRefreshToken('new-token-clamped');
      const familyExpiresAt = new Date(Date.now() + 3600000); // exactly 1 hour remaining in family lifetime
      const requestedExpiresAt = new Date(Date.now() + 7 * 86400000); // requesting 7 days
      let _capturedFamilyExpiresAt: Date | null = null;

      const mockDb = createMockKysely({
        onExecuteQuery: (sql, params) => {
          if (sql.includes('select') && sql.includes('"token_hash" = $1')) {
            return {
              rows: [
                {
                  id: '00000000-0000-4000-8000-000000000001',
                  user_id: '10000000-0000-4000-8000-000000000001',
                  family_id: '20000000-0000-4000-8000-000000000001',
                  token_hash: oldHash,
                  status: 'ACTIVE',
                  consumed_at: null,
                  revoked_at: null,
                  revoked_reason: null,
                  replaced_by_token_id: null,
                  expires_at: new Date(Date.now() + 1800000),
                  family_expires_at: familyExpiresAt,
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }
          if (sql.includes('insert into "identity"."refresh_tokens"')) {
            // Find expires_at and family_expires_at in parameters
            for (const param of params) {
              if (param instanceof Date) {
                if (param.getTime() === familyExpiresAt.getTime()) {
                  _capturedFamilyExpiresAt = param;
                }
              }
            }
            return {
              rows: [
                {
                  id: '00000000-0000-4000-8000-000000000002',
                  user_id: '10000000-0000-4000-8000-000000000001',
                  family_id: '20000000-0000-4000-8000-000000000001',
                  token_hash: newHash,
                  status: 'ACTIVE',
                  consumed_at: null,
                  revoked_at: null,
                  revoked_reason: null,
                  replaced_by_token_id: null,
                  expires_at: familyExpiresAt, // Clamped to 1 hour!
                  family_expires_at: familyExpiresAt, // Preserved!
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }
          if (sql.includes('update "identity"."refresh_tokens"')) {
            return {
              rows: [
                {
                  id: '00000000-0000-4000-8000-000000000001',
                  status: 'CONSUMED',
                  replaced_by_token_id: '00000000-0000-4000-8000-000000000002',
                  family_expires_at: familyExpiresAt,
                },
              ],
            };
          }
          return { rows: [] };
        },
      });

      const repo = createRefreshTokenRepository(mockDb);
      const result = await repo.rotate({
        oldTokenHash: oldHash,
        newTokenHash: newHash,
        newExpiresAt: requestedExpiresAt,
      });

      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(
          new Date(result.newToken.expires_at).getTime(),
          familyExpiresAt.getTime(),
          'Replacement token expires_at must be clamped to family_expires_at',
        );
        assert.equal(
          new Date(result.newToken.family_expires_at).getTime(),
          familyExpiresAt.getTime(),
          'Replacement token must preserve immutable family_expires_at',
        );
      }
    });
  });

  describe('Reuse Detection & Family Revocation', () => {
    it('detects reuse when a CONSUMED token is presented and revokes the whole family', async () => {
      const queries: string[] = [];
      const tokenHash = hashRefreshToken('consumed-token');
      const familyId = '20000000-0000-4000-8000-000000000001';

      const mockDb = createMockKysely({
        onExecuteQuery: (sql) => {
          queries.push(sql);

          // 1. SELECT ... FOR UPDATE returns CONSUMED token
          if (sql.includes('select') && sql.includes('"token_hash" = $1')) {
            return {
              rows: [
                {
                  id: '00000000-0000-4000-8000-000000000001',
                  user_id: '10000000-0000-4000-8000-000000000001',
                  family_id: familyId,
                  token_hash: tokenHash,
                  status: 'CONSUMED',
                  consumed_at: new Date(Date.now() - 60000),
                  revoked_at: null,
                  revoked_reason: null,
                  replaced_by_token_id: '00000000-0000-4000-8000-000000000002',
                  expires_at: new Date(Date.now() + 86400000),
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }

          // 2. Family-wide revocation UPDATE
          if (sql.includes('update "identity"."refresh_tokens"') && sql.includes('"family_id"')) {
            return {
              rows: [],
              numUpdatedRows: 2n, // Old consumed token and replacement token revoked
            };
          }

          return { rows: [] };
        },
      });

      const repo = createRefreshTokenRepository(mockDb);
      const result = await repo.rotate({
        oldTokenHash: tokenHash,
        newTokenHash: hashRefreshToken('attacker-token'),
        newExpiresAt: new Date(Date.now() + 86400000),
      });

      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.reason, 'REUSE_DETECTED');
        assert.equal(result.familyId, familyId);
        assert.equal(result.revokedCount, 2);
      }

      assert.equal(queries.length, 2);
      const familyRevokeQuery = queries[1]!;
      assert.ok(familyRevokeQuery.includes('update "identity"."refresh_tokens"'));
      assert.ok(familyRevokeQuery.includes('"family_id" = $5'));
    });
  });

  describe('Transaction Rollback on Failure', () => {
    it('rolls back transaction if replacement token insertion fails during rotation', async () => {
      let rollbackCalled = false;
      const oldHash = hashRefreshToken('old-secret');
      const newHash = hashRefreshToken('new-secret');

      const mockDb = createMockKysely({
        onRollbackTransaction: () => {
          rollbackCalled = true;
        },
        onExecuteQuery: (sql) => {
          // 1. SELECT returns active token
          if (sql.includes('select') && sql.includes('"token_hash" = $1')) {
            return {
              rows: [
                {
                  id: '00000000-0000-4000-8000-000000000001',
                  user_id: '10000000-0000-4000-8000-000000000001',
                  family_id: '20000000-0000-4000-8000-000000000001',
                  token_hash: oldHash,
                  status: 'ACTIVE',
                  consumed_at: null,
                  revoked_at: null,
                  revoked_reason: null,
                  replaced_by_token_id: null,
                  expires_at: new Date(Date.now() + 86400000),
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }

          // 2. INSERT fails with foreign key or constraint violation
          if (sql.includes('insert into "identity"."refresh_tokens"')) {
            const err = new Error('Database connection dropped during insert');
            throw err;
          }

          return { rows: [] };
        },
      });

      const repo = createRefreshTokenRepository(mockDb);
      await assert.rejects(
        repo.rotate({
          oldTokenHash: oldHash,
          newTokenHash: newHash,
          newExpiresAt: new Date(Date.now() + 86400000),
        }),
        {
          name: 'DatabaseOperationError',
        },
      );

      assert.equal(rollbackCalled, true);
    });
  });

  describe('Session Management & Revocation', () => {
    it('revokeFamily revokes all non-revoked tokens for the family', async () => {
      let capturedSql = '';
      const mockDb = createMockKysely({
        onExecuteQuery: (sql) => {
          capturedSql = sql;
          return { rows: [], numUpdatedRows: 3n };
        },
      });

      const repo = createRefreshTokenRepository(mockDb);
      const count = await repo.revokeFamily(
        '20000000-0000-4000-8000-000000000001',
        'SECURITY_BREACH',
      );

      assert.equal(count, 3);
      assert.ok(capturedSql.includes('update "identity"."refresh_tokens"'));
      assert.ok(capturedSql.includes('"family_id"'));
      assert.ok(capturedSql.includes('"status" !='));
    });

    it('revokeToken marks single token as revoked', async () => {
      const mockDb = createMockKysely({
        onExecuteQuery: () => ({
          rows: [
            {
              id: '00000000-0000-4000-8000-000000000001',
              user_id: '10000000-0000-4000-8000-000000000001',
              family_id: '20000000-0000-4000-8000-000000000001',
              token_hash: hashRefreshToken('tok'),
              status: 'REVOKED',
              consumed_at: null,
              revoked_at: new Date(),
              revoked_reason: 'LOGOUT',
              replaced_by_token_id: null,
              expires_at: new Date(Date.now() + 86400000),
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        }),
      });

      const repo = createRefreshTokenRepository(mockDb);
      const row = await repo.revokeToken('00000000-0000-4000-8000-000000000001', 'LOGOUT');
      assert.ok(row);
      assert.equal(row.status, 'REVOKED');
      assert.equal(row.revoked_reason, 'LOGOUT');
    });

    it('revokeAllForUser revokes all non-revoked sessions for user', async () => {
      let capturedSql = '';
      const mockDb = createMockKysely({
        onExecuteQuery: (sql) => {
          capturedSql = sql;
          return { rows: [], numUpdatedRows: 4n };
        },
      });

      const repo = createRefreshTokenRepository(mockDb);
      const count = await repo.revokeAllForUser(
        '10000000-0000-4000-8000-000000000001',
        'PASSWORD_RESET',
      );

      assert.equal(count, 4);
      assert.ok(capturedSql.includes('update "identity"."refresh_tokens"'));
      assert.ok(capturedSql.includes('"user_id"'));
    });

    it('listActiveByUser filters by user_id, ACTIVE status, and unexpired expires_at', async () => {
      let capturedSql = '';
      const mockDb = createMockKysely({
        onExecuteQuery: (sql) => {
          capturedSql = sql;
          return {
            rows: [
              {
                id: '00000000-0000-4000-8000-000000000001',
                user_id: '10000000-0000-4000-8000-000000000001',
                family_id: '20000000-0000-4000-8000-000000000001',
                token_hash: hashRefreshToken('active'),
                status: 'ACTIVE',
                consumed_at: null,
                revoked_at: null,
                revoked_reason: null,
                replaced_by_token_id: null,
                expires_at: new Date(Date.now() + 86400000),
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        },
      });

      const repo = createRefreshTokenRepository(mockDb);
      const sessions = await repo.listActiveByUser('10000000-0000-4000-8000-000000000001');

      assert.equal(sessions.length, 1);
      assert.ok(capturedSql.includes('from "identity"."refresh_tokens"'));
      assert.ok(capturedSql.includes('"user_id" = $1'));
      assert.ok(capturedSql.includes('"status" = $2'));
      assert.ok(capturedSql.includes('"expires_at" > $3'));
      assert.ok(capturedSql.includes('order by "created_at" desc'));
    });
  });

  describe('PostgreSQL Error Mapping', () => {
    it('maps unique constraint violation on refresh_tokens_hash_unique_idx to DuplicateTokenHashError', async () => {
      const mockDb = createMockKysely({
        onExecuteQuery: () => {
          const pgErr = {
            code: '23505',
            constraint: 'refresh_tokens_hash_unique_idx',
            message:
              'duplicate key value violates unique constraint "refresh_tokens_hash_unique_idx"',
          };
          throw pgErr;
        },
      });

      const repo = createRefreshTokenRepository(mockDb);
      await assert.rejects(
        repo.create({
          user_id: '10000000-0000-4000-8000-000000000001',
          family_id: '20000000-0000-4000-8000-000000000001',
          token_hash: hashRefreshToken('colliding-secret'),
          expires_at: new Date(Date.now() + 86400000),
        }),
        (err) => {
          assert.ok(err instanceof DuplicateTokenHashError);
          assert.equal(err.code, 'DUPLICATE_TOKEN_HASH');
          return true;
        },
      );
    });

    it('maps foreign key violation to ForeignKeyConstraintError', async () => {
      const mockDb = createMockKysely({
        onExecuteQuery: () => {
          const pgErr = {
            code: '23503',
            constraint: 'refresh_tokens_user_id_fkey',
            message: 'insert or update on table "refresh_tokens" violates foreign key constraint',
          };
          throw pgErr;
        },
      });

      const repo = createRefreshTokenRepository(mockDb);
      await assert.rejects(
        repo.create({
          user_id: '10000000-0000-4000-8000-000000000001',
          family_id: '20000000-0000-4000-8000-000000000001',
          token_hash: hashRefreshToken('orphan-token'),
          expires_at: new Date(Date.now() + 86400000),
        }),
        (err) => {
          assert.ok(err instanceof ForeignKeyConstraintError);
          assert.equal(err.code, 'FOREIGN_KEY_VIOLATION');
          return true;
        },
      );
    });
  });
});
