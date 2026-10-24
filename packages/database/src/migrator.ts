import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { Logger } from '@grocery/observability';
import {
  ConcurrentMigrationError,
  MigrationChecksumMismatchError,
  MigrationDiscoveryError,
  MigrationError,
  MigrationExecutionError,
} from './errors.js';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Strict regex for versioned migration filenames.
 * Requires at least 4 digits, an underscore, and an alphanumeric/hyphen/underscore name.
 * Example: '0001_bootstrap.sql' -> version '0001', name 'bootstrap'.
 */
const MIGRATION_FILENAME_REGEX = /^(\d{4,})_([a-zA-Z0-9_-]+)\.sql$/;

/**
 * Exact regex for non-transactional directive comments in the SQL file header.
 * Directive must appear on its own line: '-- no-transaction' or '-- grocery-no-transaction'.
 */
const NO_TRANSACTION_DIRECTIVE_REGEX = /^--\s*(?:grocery-)?no-transaction\s*$/i;

export interface MigrationFile {
  readonly version: string;
  readonly name: string;
  readonly filename: string;
  readonly filepath: string;
  readonly content: string;
  readonly checksum: string;
  readonly isTransactional: boolean;
}

export interface AppliedMigrationRecord {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
  readonly applied_at: Date;
  readonly execution_time_ms: number;
}

export interface MigrationReport {
  readonly applied: readonly MigrationFile[];
  readonly alreadyAppliedCount: number;
  readonly totalExecutionTimeMs: number;
}

export interface MigrationStatusReport {
  readonly applied: readonly AppliedMigrationRecord[];
  readonly pending: readonly MigrationFile[];
}

export interface MigrationOptions {
  readonly migrationsDir?: string;
  readonly logger?: Logger;
  /**
   * Optional custom client interface to allow testing without real PostgreSQL.
   */
  readonly client?: MigrationDatabaseClient;
}

/**
 * Minimal query interface required by the migration runner.
 * Compatible with pg.PoolClient and mock adapters.
 */
export interface MigrationDatabaseClient {
  query<R = Record<string, unknown>>(
    queryText: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
  release?(): void;
}

/**
 * Resolves the default migrations directory.
 * Compatible with both development TypeScript and compiled dist/ execution.
 */
export function getDefaultMigrationsDir(): string {
  const localDir = path.resolve(__dirname, 'migrations');
  if (fs.existsSync(localDir)) {
    return localDir;
  }
  // Fallback for tests or custom build layouts
  const srcDir = path.resolve(process.cwd(), 'packages', 'database', 'src', 'migrations');
  if (fs.existsSync(srcDir)) {
    return srcDir;
  }
  return localDir;
}

/**
 * Computes a deterministic SHA-256 hex checksum of migration SQL content.
 * Normalizes CRLF line endings to LF before hashing to ensure cross-platform consistency.
 */
export function computeMigrationChecksum(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Inspects SQL content header for the exact '-- no-transaction' or '-- grocery-no-transaction' directive.
 * Only lines preceding the first executable SQL statement are considered part of the header.
 */
export function isMigrationTransactional(content: string): boolean {
  const lines = content.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('--')) {
      if (NO_TRANSACTION_DIRECTIVE_REGEX.test(line)) {
        return false;
      }
    } else if (line.length > 0) {
      // First non-comment line reached; stop searching header
      break;
    }
  }
  return true;
}

/**
 * Discovers and validates all .sql migration files in the specified directory.
 * Returns files in stable, ascending natural numeric sort order.
 *
 * VALIDATION POLICY (FAIL-CLOSED):
 * 1. Filename format: Must strictly match '<version>_<name>.sql' with >=4 numeric digits (e.g. '0001_bootstrap.sql').
 * 2. Uniqueness: Duplicate version numbers across files immediately throw MigrationDiscoveryError.
 * 3. File content: Empty files or files containing zero executable SQL statements throw MigrationDiscoveryError.
 */
export function loadMigrationFiles(dirPath: string): MigrationFile[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const sqlEntries = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.sql'));

  // Sort files deterministically using natural numeric sort
  sqlEntries.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  );

  const seenVersions = new Map<string, string>();
  const migrationFiles: MigrationFile[] = [];

  for (const entry of sqlEntries) {
    const filename = entry.name;
    const match = filename.match(MIGRATION_FILENAME_REGEX);

    if (!match) {
      throw new MigrationDiscoveryError(
        `Malformed migration filename '${filename}'. Filenames must match '<version>_<name>.sql' with at least 4 digits (e.g. '0001_bootstrap.sql').`,
      );
    }

    const version = match[1]!;
    const name = match[2]!;

    if (seenVersions.has(version)) {
      throw new MigrationDiscoveryError(
        `Duplicate migration version '${version}' detected: files '${seenVersions.get(version)}' and '${filename}' share the same version prefix.`,
      );
    }
    seenVersions.set(version, filename);

    const filepath = path.join(dirPath, filename);
    const content = fs.readFileSync(filepath, 'utf8');

    if (content.trim().length === 0) {
      throw new MigrationDiscoveryError(`Migration file '${filename}' is completely empty.`);
    }

    // Ensure the migration has at least one executable statement (not only SQL comments/blank lines)
    const hasExecutableSql = content
      .split('\n')
      .some((line) => line.trim().length > 0 && !line.trim().startsWith('--'));

    if (!hasExecutableSql) {
      throw new MigrationDiscoveryError(
        `Migration file '${filename}' contains no executable SQL statements.`,
      );
    }

    const checksum = computeMigrationChecksum(content);
    const isTransactional = isMigrationTransactional(content);

    migrationFiles.push({
      version,
      name,
      filename,
      filepath,
      content,
      checksum,
      isTransactional,
    });
  }

  return migrationFiles;
}

/**
 * Ensures the schema_migrations ledger table exists.
 */
export async function ensureLedgerTable(client: MigrationDatabaseClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      execution_time_ms INTEGER NOT NULL
    );
  `);
}

/**
 * Fetches all applied migration records from the ledger.
 */
export async function getAppliedMigrations(
  client: MigrationDatabaseClient,
): Promise<AppliedMigrationRecord[]> {
  await ensureLedgerTable(client);
  const result = await client.query<AppliedMigrationRecord>(`
    SELECT version, name, checksum, applied_at, execution_time_ms
    FROM public.schema_migrations
    ORDER BY version ASC;
  `);
  return result.rows;
}

/**
 * Executes migrations against PostgreSQL using an explicit migration role connection.
 *
 * SAFETY INVARIANTS:
 * 1. Single Connection Advisory Locking: Acquires and releases a session-level advisory lock
 *    on the exact same physical client connection. Never multiplexes across pooled connections.
 * 2. Fail-Closed Locking: If lock acquisition fails, immediately aborts before reading ledger or files.
 * 3. Verified Ledger Integrity: Validates both checksum and name of already-applied migrations.
 *    Any modified historical migration halts execution with MigrationChecksumMismatchError.
 * 4. Atomic Transactional DDL: Transactional migrations execute SQL and ledger insertion inside BEGIN ... COMMIT.
 * 5. Documented Non-Transactional DDL: Non-transactional migrations execute without a transaction block.
 *    Failure during non-transactional execution risks partial execution that cannot automatically roll back.
 * 6. Guaranteed Unlock: Releases advisory lock in a finally block, verifying that unlock returned true.
 */
export async function runMigrations(
  poolOrUrl: pg.Pool | string,
  options: MigrationOptions = {},
): Promise<MigrationReport> {
  const migrationsDir = options.migrationsDir ?? getDefaultMigrationsDir();
  const files = loadMigrationFiles(migrationsDir);

  if (files.length === 0) {
    if (options.logger) {
      options.logger.info({ dir: migrationsDir }, 'No migration files found to apply');
    }
    return { applied: [], alreadyAppliedCount: 0, totalExecutionTimeMs: 0 };
  }

  // If a custom client was passed (e.g. for unit testing), use it directly
  if (options.client) {
    return await executeMigrationsWithClient(options.client, files, options);
  }

  // Otherwise acquire a dedicated single client from pool for the entire migration lifecycle
  const pool =
    typeof poolOrUrl === 'string' ? new Pool({ connectionString: poolOrUrl }) : poolOrUrl;
  const isDedicatedPool = typeof poolOrUrl === 'string';

  let client: pg.PoolClient | undefined;
  try {
    client = await pool.connect();
    return await executeMigrationsWithClient(client, files, options);
  } finally {
    if (client) {
      client.release();
    }
    if (isDedicatedPool) {
      await pool.end();
    }
  }
}

/**
 * Core migration execution logic using an acquired physical database client.
 */
async function executeMigrationsWithClient(
  client: MigrationDatabaseClient,
  files: MigrationFile[],
  options: MigrationOptions,
): Promise<MigrationReport> {
  // 1. Acquire advisory lock on this exact session connection
  const lockResult = await client.query<{ acquired: boolean }>(
    `SELECT pg_try_advisory_lock(hashtext('grocery_migrations'), 1) AS acquired;`,
  );
  const lockAcquired = Boolean(lockResult.rows[0]?.acquired);
  if (!lockAcquired) {
    throw new ConcurrentMigrationError();
  }

  const startTime = Date.now();
  const applied: MigrationFile[] = [];
  let report: MigrationReport | undefined;
  let migrationError: unknown = null;

  try {
    // 2. Ensure ledger table and fetch applied migrations
    const appliedRecords = await getAppliedMigrations(client);
    const appliedMap = new Map(appliedRecords.map((r) => [r.version, r]));

    // 3. Verify historical checksum and name integrity
    for (const file of files) {
      const record = appliedMap.get(file.version);
      if (record) {
        if (record.name !== file.name) {
          throw new MigrationError(
            `Migration version '${file.version}' name mismatch: recorded in ledger as '${record.name}', but disk file is '${file.name}'.`,
          );
        }
        if (record.checksum !== file.checksum) {
          throw new MigrationChecksumMismatchError(file.version, record.checksum, file.checksum);
        }
      }
    }

    // 4. Identify pending migrations
    const pending = files.filter((f) => !appliedMap.has(f.version));
    if (options.logger) {
      options.logger.info(
        {
          totalFiles: files.length,
          alreadyApplied: appliedRecords.length,
          pendingCount: pending.length,
        },
        'Migration plan calculated',
      );
    }

    // 5. Apply each pending migration sequentially on the locked connection
    for (const file of pending) {
      const fileStartTime = Date.now();

      if (options.logger) {
        options.logger.info(
          { version: file.version, name: file.name, transactional: file.isTransactional },
          `Applying migration: ${file.filename}`,
        );
      }

      if (file.isTransactional) {
        await client.query('BEGIN;');
        try {
          await client.query(file.content);
          const executionTimeMs = Date.now() - fileStartTime;
          await client.query(
            `INSERT INTO public.schema_migrations (version, name, checksum, execution_time_ms)
             VALUES ($1, $2, $3, $4);`,
            [file.version, file.name, file.checksum, executionTimeMs],
          );
          await client.query('COMMIT;');
        } catch (err) {
          await client.query('ROLLBACK;');
          const message = err instanceof Error ? err.message : String(err);
          throw new MigrationExecutionError(file.version, message);
        }
      } else {
        // Non-transactional DDL (e.g. CREATE INDEX CONCURRENTLY)
        // Note: statements executed here cannot automatically roll back if subsequent statements fail.
        try {
          await client.query(file.content);
          const executionTimeMs = Date.now() - fileStartTime;
          await client.query(
            `INSERT INTO public.schema_migrations (version, name, checksum, execution_time_ms)
             VALUES ($1, $2, $3, $4);`,
            [file.version, file.name, file.checksum, executionTimeMs],
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new MigrationExecutionError(file.version, message);
        }
      }

      applied.push(file);
    }

    report = {
      applied,
      alreadyAppliedCount: appliedRecords.length,
      totalExecutionTimeMs: Date.now() - startTime,
    };
  } catch (err) {
    migrationError = err;
  }

  // 6. Release advisory lock and verify successful release
  let unlockError: unknown = null;
  try {
    const unlockResult = await client.query<{ pg_advisory_unlock: boolean }>(
      `SELECT pg_advisory_unlock(hashtext('grocery_migrations'), 1) AS pg_advisory_unlock;`,
    );
    const wasUnlocked = Boolean(unlockResult.rows[0]?.pg_advisory_unlock);
    if (!wasUnlocked) {
      unlockError = new MigrationError(
        'Failed to release PostgreSQL advisory lock: lock was not held by this session.',
      );
    }
  } catch (err) {
    unlockError = err;
  }

  // If migration failed, propagate the primary migration failure
  if (migrationError) {
    if (unlockError && options.logger) {
      options.logger.error(
        { err: unlockError },
        'Failed to release advisory lock following migration failure',
      );
    }
    throw migrationError;
  }

  // If migrations succeeded but unlocking failed, fail closed
  if (unlockError) {
    throw unlockError;
  }

  return report!;
}

/**
 * Returns the current migration status (applied vs pending) without modifying database state.
 */
export async function getMigrationStatus(
  poolOrClient: pg.Pool | MigrationDatabaseClient,
  options: MigrationOptions = {},
): Promise<MigrationStatusReport> {
  const migrationsDir = options.migrationsDir ?? getDefaultMigrationsDir();
  const files = loadMigrationFiles(migrationsDir);

  const client =
    'query' in poolOrClient &&
    typeof poolOrClient.query === 'function' &&
    !('connect' in poolOrClient)
      ? (poolOrClient as MigrationDatabaseClient)
      : options.client;

  if (client) {
    const applied = await getAppliedMigrations(client);
    const appliedSet = new Set(applied.map((r) => r.version));
    const pending = files.filter((f) => !appliedSet.has(f.version));
    return { applied, pending };
  }

  const pool = poolOrClient as pg.Pool;
  const poolClient = await pool.connect();
  try {
    const applied = await getAppliedMigrations(poolClient);
    const appliedSet = new Set(applied.map((r) => r.version));
    const pending = files.filter((f) => !appliedSet.has(f.version));
    return { applied, pending };
  } finally {
    poolClient.release();
  }
}
