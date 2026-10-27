import type { z } from 'zod';
import { CommonEnvSchema } from './common.js';
import { DatabaseEnvSchema, InternalTokenEnvSchema } from './identity.js';
import { loadConfig } from './loader.js';

/**
 * Combined Catalog Service Runtime Environment Schema.
 * Merges common application settings, database pooling, and internal service token verification settings.
 */
export const CatalogServiceEnvSchema =
  CommonEnvSchema.merge(DatabaseEnvSchema).merge(InternalTokenEnvSchema);

export type CatalogServiceEnv = z.infer<typeof CatalogServiceEnvSchema>;

/**
 * Loads and validates Catalog Service environment configuration.
 *
 * IMPORT-TIME SIDE EFFECT INVARIANT:
 * Executed explicitly during application bootstrap. Importing does not validate or access process.env.
 *
 * @param sourceEnv Environment dictionary (defaults to process.env)
 * @returns Strongly typed, validated Catalog Service configuration
 */
export function loadCatalogServiceConfig(
  sourceEnv: Record<string, unknown> = process.env,
): CatalogServiceEnv {
  return loadConfig(CatalogServiceEnvSchema, sourceEnv);
}
