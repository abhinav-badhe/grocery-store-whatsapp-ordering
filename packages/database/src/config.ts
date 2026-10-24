import { z } from 'zod';
import { sanitizeErrorMessage } from '@grocery/observability';
import { DatabaseConfigError } from './errors.js';

/**
 * Redacts username, password, and sensitive query tokens from database URLs.
 */
export function redactDatabaseUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    return '[INVALID_URL]';
  }
  return url
    .replace(/:\/\/([^:\s@]+)(?::([^@\s]+))?@/g, (_match, _user, pass) =>
      pass ? '://[REDACTED]:[REDACTED]@' : '://[REDACTED]@',
    )
    .replace(/([?&](?:password|pass|secret|token|key|api_key)=)[^&\s]+/gi, '$1[REDACTED]');
}

/**
 * Validates whether a string is a well-formed PostgreSQL connection URI.
 */
function isValidPostgresUri(uri: string): boolean {
  if (!uri || typeof uri !== 'string') {
    return false;
  }
  const trimmed = uri.trim();
  return trimmed.startsWith('postgres://') || trimmed.startsWith('postgresql://');
}

/**
 * Database Configuration Schema.
 * Defines connection pooling and timeout parameters for PostgreSQL.
 */
const DatabaseConfigSchema = z.object({
  databaseUrl: z.string({ required_error: 'databaseUrl is required' }).refine(isValidPostgresUri, {
    message: "databaseUrl must start with 'postgres://' or 'postgresql://'",
  }),
  maxPoolSize: z.coerce
    .number({ invalid_type_error: 'maxPoolSize must be an integer' })
    .int('maxPoolSize must be an integer')
    .min(1, 'maxPoolSize must be at least 1')
    .max(100, 'maxPoolSize cannot exceed 100')
    .default(5),
  connectionTimeoutMs: z.coerce
    .number({ invalid_type_error: 'connectionTimeoutMs must be an integer' })
    .int('connectionTimeoutMs must be an integer')
    .min(100, 'connectionTimeoutMs must be at least 100 ms')
    .max(60000, 'connectionTimeoutMs cannot exceed 60000 ms')
    .default(5000),
  idleTimeoutMs: z.coerce
    .number({ invalid_type_error: 'idleTimeoutMs must be an integer' })
    .int('idleTimeoutMs must be an integer')
    .min(1000, 'idleTimeoutMs must be at least 1000 ms')
    .max(600000, 'idleTimeoutMs cannot exceed 600000 ms')
    .default(30000),
  migrationDatabaseUrl: z
    .string()
    .optional()
    .refine((val) => val === undefined || isValidPostgresUri(val), {
      message: "migrationDatabaseUrl must start with 'postgres://' or 'postgresql://'",
    }),
});

export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;

export interface DatabaseConfigInput {
  databaseUrl: string;
  maxPoolSize?: number | string;
  connectionTimeoutMs?: number | string;
  idleTimeoutMs?: number | string;
  migrationDatabaseUrl?: string;
}

/**
 * Validates raw database configuration input with fail-closed credential protection.
 */
export function validateDatabaseConfig(input: unknown): DatabaseConfig {
  if (!input || typeof input !== 'object') {
    throw new DatabaseConfigError('Database configuration must be a non-null object');
  }

  const result = DatabaseConfigSchema.safeParse(input);
  if (!result.success) {
    const issueMessages = result.error.issues.map((issue) => {
      const field = issue.path.join('.') || 'config';
      return `${field}: ${sanitizeErrorMessage(redactDatabaseUrl(issue.message))}`;
    });
    throw new DatabaseConfigError(
      `Database configuration validation failed: ${issueMessages.join('; ')}`,
    );
  }

  return result.data;
}

/**
 * Loads and validates database configuration from environment variables.
 */
export function loadDatabaseConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  const rawInput: DatabaseConfigInput = {
    databaseUrl: env.DATABASE_URL ?? '',
    maxPoolSize: env.DATABASE_MAX_POOL_SIZE !== undefined ? env.DATABASE_MAX_POOL_SIZE : undefined,
    connectionTimeoutMs:
      env.DATABASE_CONNECTION_TIMEOUT_MS !== undefined
        ? env.DATABASE_CONNECTION_TIMEOUT_MS
        : undefined,
    idleTimeoutMs:
      env.DATABASE_IDLE_TIMEOUT_MS !== undefined ? env.DATABASE_IDLE_TIMEOUT_MS : undefined,
    migrationDatabaseUrl: env.MIGRATION_DATABASE_URL || undefined,
  };

  return validateDatabaseConfig(rawInput);
}
