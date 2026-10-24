import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { Logger } from '@grocery/observability';
import type { DatabaseConfig } from './config.js';
import { redactDatabaseUrl } from './config.js';

const { Pool } = pg;

export interface DatabaseClientOptions {
  readonly logger?: Logger;
}

export interface DatabaseClient<T = unknown> {
  readonly pool: pg.Pool;
  readonly db: Kysely<T>;
  readonly config: DatabaseConfig;
  destroy(): Promise<void>;
  isAlive(): Promise<boolean>;
}

/**
 * Creates a bounded PostgreSQL connection pool and Kysely client instance.
 *
 * CRITICAL LIFECYCLE INVARIANT:
 * Calling this factory does NOT open database connections immediately.
 * Node-pg pools establish connections lazily on the first query or explicit transaction.
 *
 * @param config Validated database configuration
 * @param options Optional logger and client options
 */
export function createDatabaseClient<T = unknown>(
  config: DatabaseConfig,
  options: DatabaseClientOptions = {},
): DatabaseClient<T> {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.maxPoolSize,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
  });

  const dialect = new PostgresDialect({
    pool,
  });

  const db = new Kysely<T>({
    dialect,
  });

  let isDestroyed = false;
  let destroyPromise: Promise<void> | null = null;

  const client: DatabaseClient<T> = {
    pool,
    db,
    config,

    /**
     * Explicit disposal of the Kysely client and underlying pg.Pool.
     * Guaranteed to be race-safe, concurrent-safe, and idempotent.
     */
    async destroy(): Promise<void> {
      if (isDestroyed && destroyPromise) {
        return destroyPromise;
      }
      isDestroyed = true;
      destroyPromise = (async () => {
        if (options.logger) {
          options.logger.info(
            { target: redactDatabaseUrl(config.databaseUrl) },
            'Disposing database client and closing connection pool',
          );
        }
        await db.destroy();
      })();
      return destroyPromise;
    },

    /**
     * Verifies database connectivity via a lightweight ping.
     * Fails closed if pool or database is unreachable.
     */
    async isAlive(): Promise<boolean> {
      if (isDestroyed) {
        return false;
      }
      try {
        const result = await pool.query('SELECT 1 AS alive');
        return Boolean(result.rows[0]?.alive === 1 || result.rows[0]?.alive === '1');
      } catch (err) {
        if (options.logger) {
          options.logger.warn(
            { err, target: redactDatabaseUrl(config.databaseUrl) },
            'Database liveness check failed',
          );
        }
        return false;
      }
    },
  };

  return client;
}
