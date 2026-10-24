import { sql, type Kysely, type Transaction } from 'kysely';
import { InvalidTenantContextError } from './errors.js';

/**
 * Canonical RFC 4122 UUIDv4 regex.
 * Format: 8-4-4-4-12 hex characters with '4' at version nibble and 8/9/a/b at variant nibble.
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates whether a store ID is a canonical RFC 4122 UUIDv4.
 *
 * CANONICAL FORMAT INVARIANT:
 * Requires exact 36-character length without leading, trailing, or internal whitespace.
 * Rejects non-string types, empty strings, malformed lengths, and non-v4 UUIDs.
 */
export function isValidTenantId(storeId: unknown): storeId is string {
  if (typeof storeId !== 'string') {
    return false;
  }
  if (storeId.length !== 36) {
    return false;
  }
  return UUID_V4_REGEX.test(storeId);
}

/**
 * Asserts that a store ID is a canonical RFC 4122 UUIDv4.
 * Fails closed with InvalidTenantContextError on any deviation.
 */
export function assertValidTenantId(storeId: unknown): asserts storeId is string {
  if (!isValidTenantId(storeId)) {
    const preview =
      typeof storeId === 'string'
        ? storeId.replace(/[^a-zA-Z0-9_\-.]/g, '').slice(0, 36)
        : typeof storeId;
    throw new InvalidTenantContextError(
      `Invalid tenant identifier '${preview}': must be a canonical RFC 4122 UUIDv4. Default tenants are strictly prohibited.`,
    );
  }
}

/**
 * Executes a callback within a single explicit transaction block with transaction-local tenant context.
 *
 * SAFETY INVARIANTS:
 * 1. Strict Tenant Validation: Rejects missing, non-UUID, or malformed tenant identifiers before database execution.
 * 2. Transaction Boundary: Acquires a single connection from the pool and opens an explicit BEGIN ... COMMIT/ROLLBACK block.
 * 3. Local GUC Scope: Executes `SELECT set_config('app.current_store_id', $1, true)`.
 *    The third argument (is_local = true) guarantees PostgreSQL discards the setting automatically upon COMMIT or ROLLBACK.
 * 4. Zero Pool Contamination: When the connection is returned to the pool (or PgBouncer), no residual tenant state remains.
 *
 * NOTE ON RLS PROOF:
 * While this helper establishes the correct transaction-local GUC variable, Row-Level Security
 * enforcement is proven only when tested against an active PostgreSQL 16 engine with active RLS policies.
 *
 * @param db Kysely database instance
 * @param storeId Canonical RFC 4122 UUIDv4 store identifier
 * @param callback Tenant-scoped operational logic
 */
export async function withTenantTransaction<T, R>(
  db: Kysely<T>,
  storeId: string,
  callback: (trx: Transaction<T>) => Promise<R>,
): Promise<R> {
  assertValidTenantId(storeId);

  return await db.transaction().execute(async (trx) => {
    // Set transaction-local setting; discarded upon COMMIT or ROLLBACK
    await sql`SELECT set_config('app.current_store_id', ${storeId}, true)`.execute(trx);
    return await callback(trx);
  });
}
