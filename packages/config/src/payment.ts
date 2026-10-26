import { z } from 'zod';
import { CommonEnvSchema } from './common.js';
import { DatabaseEnvSchema, InternalTokenEnvSchema } from './identity.js';
import { loadConfig } from './loader.js';

export const PaymentProviderEnvSchema = z.object({
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

/**
 * Combined Payment Service Runtime Environment Schema.
 * Merges common application settings, database pooling, internal service token verification,
 * and gateway credentials.
 */
export const PaymentServiceEnvSchema = CommonEnvSchema.merge(DatabaseEnvSchema)
  .merge(InternalTokenEnvSchema)
  .merge(PaymentProviderEnvSchema);

export type PaymentServiceEnv = z.infer<typeof PaymentServiceEnvSchema>;

/**
 * Loads and validates Payment Service environment configuration.
 *
 * IMPORT-TIME SIDE EFFECT INVARIANT:
 * Executed explicitly during application bootstrap. Importing does not validate or access process.env.
 *
 * @param sourceEnv Environment dictionary (defaults to process.env)
 * @returns Strongly typed, validated Payment Service configuration
 */
export function loadPaymentServiceConfig(
  sourceEnv: Record<string, unknown> = process.env,
): PaymentServiceEnv {
  return loadConfig(PaymentServiceEnvSchema, sourceEnv);
}
