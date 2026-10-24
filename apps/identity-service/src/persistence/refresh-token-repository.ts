import crypto from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database, RefreshTokenRow, NewRefreshToken } from '@grocery/database';
import type {
  DatabaseConnection,
  RefreshTokenRepository,
  RotateTokenParams,
  RotateTokenResult,
} from './types.js';
import { IdentityPersistenceError, mapDatabaseError } from './errors.js';

const TOKEN_HASH_REGEX = /^[a-f0-9]{64}$/i;

/**
 * Computes deterministic SHA-256 hex digest of a raw refresh-token secret.
 * Raw refresh-tokens must NEVER be logged or persisted directly.
 */
export function hashRefreshToken(rawToken: string): string {
  if (typeof rawToken !== 'string' || rawToken.trim().length === 0) {
    throw new IdentityPersistenceError(
      'Refresh token must be a non-empty string',
      'INVALID_REFRESH_TOKEN',
    );
  }
  return crypto.createHash('sha256').update(rawToken).digest('hex').toLowerCase();
}

/**
 * Generates a cryptographically strong, URL-safe random refresh token and its SHA-256 hash.
 */
export function generateRefreshToken(): { readonly rawToken: string; readonly tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashRefreshToken(rawToken);
  return { rawToken, tokenHash };
}

/**
 * Kysely-backed implementation of RefreshTokenRepository.
 * Manages durable refresh token sessions under the schema-qualified identity.refresh_tokens table.
 */
export class KyselyRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly defaultDb: DatabaseConnection) {}

  private getExecutor(trx?: DatabaseConnection): DatabaseConnection {
    return trx ?? this.defaultDb;
  }

  async findById(id: string, trx?: DatabaseConnection): Promise<RefreshTokenRow | null> {
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('identity.refresh_tokens')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapDatabaseError(err, `Failed to find refresh token by id '${id}'`);
    }
  }

  async findByTokenHash(
    tokenHash: string,
    trx?: DatabaseConnection,
  ): Promise<RefreshTokenRow | null> {
    const normalizedHash = tokenHash.trim().toLowerCase();
    if (!TOKEN_HASH_REGEX.test(normalizedHash)) {
      return null;
    }
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('identity.refresh_tokens')
        .selectAll()
        .where('token_hash', '=', normalizedHash)
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapDatabaseError(err, 'Failed to find refresh token by hash');
    }
  }

  async create(token: NewRefreshToken, trx?: DatabaseConnection): Promise<RefreshTokenRow> {
    const normalizedHash = token.token_hash.trim().toLowerCase();
    if (!TOKEN_HASH_REGEX.test(normalizedHash)) {
      throw new IdentityPersistenceError(
        'Token hash must be a 64-character lowercase hexadecimal string',
        'INVALID_TOKEN_HASH',
      );
    }
    try {
      const row = await this.getExecutor(trx)
        .insertInto('identity.refresh_tokens')
        .values({
          ...token,
          token_hash: normalizedHash,
          status: token.status ?? 'ACTIVE',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return row;
    } catch (err) {
      throw mapDatabaseError(err, 'Failed to create refresh token record');
    }
  }

  async rotate(params: RotateTokenParams, trx?: DatabaseConnection): Promise<RotateTokenResult> {
    const oldHash = params.oldTokenHash.trim().toLowerCase();
    const newHash = params.newTokenHash.trim().toLowerCase();

    if (!TOKEN_HASH_REGEX.test(oldHash) || !TOKEN_HASH_REGEX.test(newHash)) {
      throw new IdentityPersistenceError(
        'Token hashes must be 64-character hexadecimal strings',
        'INVALID_TOKEN_HASH',
      );
    }
    if (!(params.newExpiresAt instanceof Date) || isNaN(params.newExpiresAt.getTime())) {
      throw new IdentityPersistenceError(
        'New expiration must be a valid Date object',
        'INVALID_EXPIRATION',
      );
    }

    const executeOperation = async (executor: DatabaseConnection): Promise<RotateTokenResult> => {
      // 1. Row-lock the presenting token to prevent concurrent rotation race conditions
      const existingToken = await executor
        .selectFrom('identity.refresh_tokens')
        .selectAll()
        .where('token_hash', '=', oldHash)
        .forUpdate()
        .executeTakeFirst();

      if (!existingToken) {
        return { success: false, reason: 'TOKEN_NOT_FOUND' };
      }

      const now = new Date();

      // 2. Revoked token presented
      if (existingToken.status === 'REVOKED') {
        return { success: false, reason: 'TOKEN_REVOKED', token: existingToken };
      }

      // 3. Expired token presented
      const expiresAt = new Date(existingToken.expires_at);
      if (expiresAt.getTime() <= now.getTime()) {
        return { success: false, reason: 'TOKEN_EXPIRED', token: existingToken };
      }

      // 4. Token Reuse Detection
      // If status is CONSUMED, this token was already rotated previously.
      // Immediate response: Invalidate all tokens within this token family.
      if (existingToken.status === 'CONSUMED') {
        const updateResult = await executor
          .updateTable('identity.refresh_tokens')
          .set({
            status: 'REVOKED',
            revoked_at: now,
            revoked_reason: 'REUSE_DETECTED',
            updated_at: now,
          })
          .where('family_id', '=', existingToken.family_id)
          .where('status', '!=', 'REVOKED')
          .executeTakeFirst();

        const revokedCount = Number(updateResult.numUpdatedRows ?? 0);
        return {
          success: false,
          reason: 'REUSE_DETECTED',
          familyId: existingToken.family_id,
          revokedCount,
        };
      }

      // 5. Active token: Execute atomic rotation
      // Step A: Insert new active token in the same family
      const newToken = await executor
        .insertInto('identity.refresh_tokens')
        .values({
          user_id: existingToken.user_id,
          family_id: existingToken.family_id,
          token_hash: newHash,
          status: 'ACTIVE',
          expires_at: params.newExpiresAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Step B: Mark old token as CONSUMED with link to replacement token
      const oldToken = await executor
        .updateTable('identity.refresh_tokens')
        .set({
          status: 'CONSUMED',
          consumed_at: now,
          replaced_by_token_id: newToken.id,
          updated_at: now,
        })
        .where('id', '=', existingToken.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        success: true,
        oldToken,
        newToken,
      };
    };

    try {
      if (trx) {
        return await executeOperation(trx);
      }

      if (
        'transaction' in this.defaultDb &&
        typeof (this.defaultDb as Kysely<Database>).transaction === 'function'
      ) {
        return await (this.defaultDb as Kysely<Database>).transaction().execute(async (tx) => {
          return await executeOperation(tx);
        });
      }

      return await executeOperation(this.defaultDb);
    } catch (err) {
      throw mapDatabaseError(err, 'Failed to rotate refresh token session');
    }
  }

  async revokeFamily(
    familyId: string,
    reason = 'EXPLICIT_REVOCATION',
    trx?: DatabaseConnection,
  ): Promise<number> {
    try {
      const now = new Date();
      const result = await this.getExecutor(trx)
        .updateTable('identity.refresh_tokens')
        .set({
          status: 'REVOKED',
          revoked_at: now,
          revoked_reason: reason,
          updated_at: now,
        })
        .where('family_id', '=', familyId)
        .where('status', '!=', 'REVOKED')
        .executeTakeFirst();
      return Number(result.numUpdatedRows ?? 0);
    } catch (err) {
      throw mapDatabaseError(err, `Failed to revoke token family '${familyId}'`);
    }
  }

  async revokeToken(
    id: string,
    reason = 'LOGOUT',
    trx?: DatabaseConnection,
  ): Promise<RefreshTokenRow | null> {
    try {
      const now = new Date();
      const row = await this.getExecutor(trx)
        .updateTable('identity.refresh_tokens')
        .set({
          status: 'REVOKED',
          revoked_at: now,
          revoked_reason: reason,
          updated_at: now,
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapDatabaseError(err, `Failed to revoke token '${id}'`);
    }
  }

  async revokeAllForUser(
    userId: string,
    reason = 'USER_SECURITY_RESET',
    trx?: DatabaseConnection,
  ): Promise<number> {
    try {
      const now = new Date();
      const result = await this.getExecutor(trx)
        .updateTable('identity.refresh_tokens')
        .set({
          status: 'REVOKED',
          revoked_at: now,
          revoked_reason: reason,
          updated_at: now,
        })
        .where('user_id', '=', userId)
        .where('status', '!=', 'REVOKED')
        .executeTakeFirst();
      return Number(result.numUpdatedRows ?? 0);
    } catch (err) {
      throw mapDatabaseError(err, `Failed to revoke tokens for user '${userId}'`);
    }
  }

  async listActiveByUser(userId: string, trx?: DatabaseConnection): Promise<RefreshTokenRow[]> {
    try {
      const now = new Date();
      const rows = await this.getExecutor(trx)
        .selectFrom('identity.refresh_tokens')
        .selectAll()
        .where('user_id', '=', userId)
        .where('status', '=', 'ACTIVE')
        .where('expires_at', '>', now)
        .orderBy('created_at', 'desc')
        .execute();
      return rows;
    } catch (err) {
      throw mapDatabaseError(err, `Failed to list active sessions for user '${userId}'`);
    }
  }
}

export function createRefreshTokenRepository(db: DatabaseConnection): RefreshTokenRepository {
  return new KyselyRefreshTokenRepository(db);
}
