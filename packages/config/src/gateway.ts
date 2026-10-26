import { z } from 'zod';
import { CommonEnvSchema } from './common.js';
import { loadConfig } from './loader.js';

export const GatewayEnvSchema = CommonEnvSchema.extend({
  INTERNAL_TOKEN_SECRET: z
    .string({ required_error: 'INTERNAL_TOKEN_SECRET is required' })
    .min(32, { message: 'INTERNAL_TOKEN_SECRET must be at least 32 characters' })
    .default('default-internal-token-secret-for-development-32chars!'),
  IDENTITY_SERVICE_URL: z
    .string()
    .url({ message: 'IDENTITY_SERVICE_URL must be a valid URL' })
    .default('http://127.0.0.1:3001'),
  CATALOG_SERVICE_URL: z
    .string()
    .url({ message: 'CATALOG_SERVICE_URL must be a valid URL' })
    .default('http://127.0.0.1:3002'),
  INVENTORY_SERVICE_URL: z
    .string()
    .url({ message: 'INVENTORY_SERVICE_URL must be a valid URL' })
    .default('http://127.0.0.1:3003'),
  ORDER_SERVICE_URL: z
    .string()
    .url({ message: 'ORDER_SERVICE_URL must be a valid URL' })
    .default('http://127.0.0.1:3004'),
  PAYMENT_SERVICE_URL: z
    .string()
    .url({ message: 'PAYMENT_SERVICE_URL must be a valid URL' })
    .default('http://127.0.0.1:3005'),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://127.0.0.1:3000'),
  RATE_LIMIT_WINDOW_MS: z.coerce
    .number({ invalid_type_error: 'RATE_LIMIT_WINDOW_MS must be an integer' })
    .int('RATE_LIMIT_WINDOW_MS must be an integer')
    .positive('RATE_LIMIT_WINDOW_MS must be positive')
    .default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce
    .number({ invalid_type_error: 'RATE_LIMIT_MAX_REQUESTS must be an integer' })
    .int('RATE_LIMIT_MAX_REQUESTS must be an integer')
    .positive('RATE_LIMIT_MAX_REQUESTS must be positive')
    .default(100),
});

export type GatewayEnv = z.infer<typeof GatewayEnvSchema>;

export function loadGatewayConfig(sourceEnv: Record<string, unknown> = process.env): GatewayEnv {
  return loadConfig(GatewayEnvSchema, sourceEnv);
}
