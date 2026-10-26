import { z } from 'zod';
import { CommonEnvSchema } from './common.js';
import { DatabaseEnvSchema, InternalTokenEnvSchema } from './identity.js';
import { loadConfig } from './loader.js';

/**
 * Combined Inventory Service Runtime Environment Schema.
 * Merges common application settings, database pooling, and internal service token verification settings.
 */
export const InventoryServiceEnvSchema =
  CommonEnvSchema.merge(DatabaseEnvSchema).merge(InternalTokenEnvSchema);

export type InventoryServiceEnv = z.infer<typeof InventoryServiceEnvSchema>;

/**
 * Loads and validates Inventory Service environment configuration.
 *
 * IMPORT-TIME SIDE EFFECT INVARIANT:
 * Executed explicitly during application bootstrap. Importing does not validate or access process.env.
 *
 * @param sourceEnv Environment dictionary (defaults to process.env)
 * @returns Strongly typed, validated Inventory Service configuration
 */
export function loadInventoryServiceConfig(
  sourceEnv: Record<string, unknown> = process.env,
): InventoryServiceEnv {
  return loadConfig(InventoryServiceEnvSchema, sourceEnv);
}
