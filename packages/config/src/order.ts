import { z } from 'zod';
import { CommonEnvSchema } from './common.js';
import { DatabaseEnvSchema, InternalTokenEnvSchema } from './identity.js';
import { loadConfig } from './loader.js';

/**
 * Combined Order Service Runtime Environment Schema.
 * Merges common application settings, database pooling, and internal service token verification settings.
 */
export const OrderServiceEnvSchema =
  CommonEnvSchema.merge(DatabaseEnvSchema).merge(InternalTokenEnvSchema);

export type OrderServiceEnv = z.infer<typeof OrderServiceEnvSchema>;

/**
 * Loads and validates Order Service environment configuration.
 *
 * IMPORT-TIME SIDE EFFECT INVARIANT:
 * Executed explicitly during application bootstrap. Importing does not validate or access process.env.
 *
 * @param sourceEnv Environment dictionary (defaults to process.env)
 * @returns Strongly typed, validated Order Service configuration
 */
export function loadOrderServiceConfig(
  sourceEnv: Record<string, unknown> = process.env,
): OrderServiceEnv {
  return loadConfig(OrderServiceEnvSchema, sourceEnv);
}
