import { z } from 'zod';
import { CommonEnvSchema } from './common.js';
import { loadConfig } from './loader.js';

/**
 * Validates that a string is a PostgreSQL URI.
 */
function isValidPostgresUri(uri: string): boolean {
  if (!uri || typeof uri !== 'string') {
    return false;
  }
  const trimmed = uri.trim();
  return trimmed.startsWith('postgres://') || trimmed.startsWith('postgresql://');
}

/**
 * Argon2id password hashing parameters schema.
 * Configured strictly in accordance with ADR-003 §5.2.
 *
 * Defaults:
 * - memoryCost: 65536 KiB (64 MiB)
 * - timeCost: 3 iterations
 * - parallelism: 4 lanes/threads
 */
export const Argon2idEnvSchema = z.object({
  ARGON2_MEMORY_COST: z.coerce
    .number({ invalid_type_error: 'ARGON2_MEMORY_COST must be an integer' })
    .int('ARGON2_MEMORY_COST must be an integer')
    .min(1024, 'ARGON2_MEMORY_COST must be at least 1024 KiB (1 MiB)')
    .max(1048576, 'ARGON2_MEMORY_COST cannot exceed 1048576 KiB (1 GiB)')
    .default(65536),
  ARGON2_TIME_COST: z.coerce
    .number({ invalid_type_error: 'ARGON2_TIME_COST must be an integer' })
    .int('ARGON2_TIME_COST must be an integer')
    .min(1, 'ARGON2_TIME_COST must be at least 1')
    .max(100, 'ARGON2_TIME_COST cannot exceed 100')
    .default(3),
  ARGON2_PARALLELISM: z.coerce
    .number({ invalid_type_error: 'ARGON2_PARALLELISM must be an integer' })
    .int('ARGON2_PARALLELISM must be an integer')
    .min(1, 'ARGON2_PARALLELISM must be at least 1')
    .max(64, 'ARGON2_PARALLELISM cannot exceed 64')
    .default(4),
});

export type Argon2idEnv = z.infer<typeof Argon2idEnvSchema>;

/**
 * Internal service token configuration schema.
 * Configured in accordance with ADR-001 §5.2.
 *
 * ALGORITHM-NEUTRAL DESIGN:
 * ADR-001 §10 records HMAC (HS256) vs. Asymmetric (EdDSA/RS256) as an open architectural trade-off.
 * This schema defines algorithm-neutral signing material and token metadata without prematurely
 * locking in a cryptographic implementation.
 */
export const InternalTokenEnvSchema = z.object({
  INTERNAL_TOKEN_TTL_SECONDS: z.coerce
    .number({ invalid_type_error: 'INTERNAL_TOKEN_TTL_SECONDS must be an integer' })
    .int('INTERNAL_TOKEN_TTL_SECONDS must be an integer')
    .min(5, 'INTERNAL_TOKEN_TTL_SECONDS must be at least 5 seconds')
    .max(3600, 'INTERNAL_TOKEN_TTL_SECONDS cannot exceed 3600 seconds')
    .default(60),
  INTERNAL_TOKEN_KID: z
    .string({ required_error: 'INTERNAL_TOKEN_KID is required' })
    .min(1, 'INTERNAL_TOKEN_KID cannot be empty')
    .max(64, 'INTERNAL_TOKEN_KID cannot exceed 64 characters')
    .default('internal-key-2026-1'),
  INTERNAL_TOKEN_ISSUER: z
    .string({ required_error: 'INTERNAL_TOKEN_ISSUER is required' })
    .min(1, 'INTERNAL_TOKEN_ISSUER cannot be empty')
    .default('api-gateway'),
  INTERNAL_TOKEN_AUDIENCE: z
    .string({ required_error: 'INTERNAL_TOKEN_AUDIENCE is required' })
    .min(1, 'INTERNAL_TOKEN_AUDIENCE cannot be empty')
    .default('grocery-internal-service'),
  INTERNAL_TOKEN_SECRET: z
    .string({ required_error: 'INTERNAL_TOKEN_SECRET is required' })
    .min(32, 'INTERNAL_TOKEN_SECRET must be at least 32 characters long'),
});

export type InternalTokenEnv = z.infer<typeof InternalTokenEnvSchema>;

/**
 * Database runtime configuration schema for domain microservices.
 *
 * SEPARATION OF PRIVILEGES INVARIANT:
 * Domain services (such as identity-service) connect using restricted runtime DML roles
 * (e.g. grocery_identity_user). Privileged migration credentials (MIGRATION_DATABASE_URL)
 * are deliberately omitted from service runtime environments.
 */
export const DatabaseEnvSchema = z.object({
  DATABASE_URL: z
    .string({ required_error: 'DATABASE_URL is required' })
    .refine(isValidPostgresUri, {
      message: "DATABASE_URL must start with 'postgres://' or 'postgresql://'",
    }),
  DATABASE_MAX_POOL_SIZE: z.coerce
    .number({ invalid_type_error: 'DATABASE_MAX_POOL_SIZE must be an integer' })
    .int('DATABASE_MAX_POOL_SIZE must be an integer')
    .min(1, 'DATABASE_MAX_POOL_SIZE must be at least 1')
    .max(100, 'DATABASE_MAX_POOL_SIZE cannot exceed 100')
    .default(5),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce
    .number({ invalid_type_error: 'DATABASE_CONNECTION_TIMEOUT_MS must be an integer' })
    .int('DATABASE_CONNECTION_TIMEOUT_MS must be an integer')
    .min(100, 'DATABASE_CONNECTION_TIMEOUT_MS must be at least 100 ms')
    .max(60000, 'DATABASE_CONNECTION_TIMEOUT_MS cannot exceed 60000 ms')
    .default(5000),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce
    .number({ invalid_type_error: 'DATABASE_IDLE_TIMEOUT_MS must be an integer' })
    .int('DATABASE_IDLE_TIMEOUT_MS must be an integer')
    .min(1000, 'DATABASE_IDLE_TIMEOUT_MS must be at least 1000 ms')
    .max(600000, 'DATABASE_IDLE_TIMEOUT_MS cannot exceed 600000 ms')
    .default(30000),
});

export type DatabaseEnv = z.infer<typeof DatabaseEnvSchema>;

/**
 * Combined Identity Service Runtime Environment Schema.
 * Merges common application settings, database pooling, Argon2id parameters, and token settings.
 */
export const IdentityServiceEnvSchema = CommonEnvSchema.merge(DatabaseEnvSchema)
  .merge(Argon2idEnvSchema)
  .merge(InternalTokenEnvSchema);

export type IdentityServiceEnv = z.infer<typeof IdentityServiceEnvSchema>;

/**
 * Loads and validates Identity Service environment configuration.
 *
 * IMPORT-TIME SIDE EFFECT INVARIANT:
 * Executed explicitly during application bootstrap. Importing does not validate or access process.env.
 *
 * @param sourceEnv Environment dictionary (defaults to process.env)
 * @returns Strongly typed, validated Identity Service configuration
 */
export function loadIdentityServiceConfig(
  sourceEnv: Record<string, unknown> = process.env,
): IdentityServiceEnv {
  return loadConfig(IdentityServiceEnvSchema, sourceEnv);
}
