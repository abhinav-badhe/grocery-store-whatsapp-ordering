import { sanitizeErrorMessage } from '@grocery/observability';

/**
 * Base database error class for @grocery/database.
 */
export class DatabaseError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'DATABASE_ERROR') {
    super(sanitizeErrorMessage(message));
    this.name = this.constructor.name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when database configuration validation fails.
 * Guarantees zero credential exposure in error messages.
 */
export class DatabaseConfigError extends DatabaseError {
  constructor(message: string) {
    super(message, 'DATABASE_CONFIG_ERROR');
  }
}

/**
 * Thrown when a tenant identifier is missing, empty, or fails RFC 4122 UUIDv4 syntax.
 * Prevents unvalidated tenant context from reaching SQL execution.
 */
export class InvalidTenantContextError extends DatabaseError {
  constructor(message = 'Invalid tenant identifier: must be a canonical RFC 4122 UUIDv4') {
    super(message, 'INVALID_TENANT_CONTEXT');
  }
}

/**
 * Base error for migration failures.
 */
export class MigrationError extends DatabaseError {
  constructor(message: string, code = 'MIGRATION_ERROR') {
    super(message, code);
  }
}

/**
 * Thrown when migration discovery encounters duplicate versions, malformed filenames,
 * empty files, or invalid migration definitions.
 */
export class MigrationDiscoveryError extends MigrationError {
  constructor(message: string) {
    super(message, 'MIGRATION_DISCOVERY_ERROR');
  }
}

/**
 * Thrown when an already-applied migration has had its SQL content, checksum, or name altered.
 */
export class MigrationChecksumMismatchError extends MigrationError {
  public readonly version: string;
  public readonly recordedChecksum: string;
  public readonly currentChecksum: string;

  constructor(version: string, recordedChecksum: string, currentChecksum: string) {
    super(
      `Migration checksum mismatch for version '${version}'. Recorded checksum: ${recordedChecksum}, current file checksum: ${currentChecksum}. Historical migrations must never be altered.`,
      'MIGRATION_CHECKSUM_MISMATCH',
    );
    this.version = version;
    this.recordedChecksum = recordedChecksum;
    this.currentChecksum = currentChecksum;
  }
}

/**
 * Thrown when another migration runner holds the PostgreSQL advisory lock.
 */
export class ConcurrentMigrationError extends MigrationError {
  constructor(
    message = 'Another migration process is currently running (advisory lock held). Aborting to prevent race condition.',
  ) {
    super(message, 'CONCURRENT_MIGRATION_LOCKED');
  }
}

/**
 * Thrown when a migration statement fails during execution.
 */
export class MigrationExecutionError extends MigrationError {
  public readonly version: string;
  public readonly statementIndex?: number;

  constructor(version: string, message: string, statementIndex?: number) {
    super(
      `Failed to execute migration '${version}'${statementIndex !== undefined ? ` at statement ${statementIndex}` : ''}: ${sanitizeErrorMessage(message)}`,
      'MIGRATION_EXECUTION_FAILED',
    );
    this.version = version;
    this.statementIndex = statementIndex;
  }
}
