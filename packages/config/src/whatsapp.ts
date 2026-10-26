import { z } from 'zod';
import { CommonEnvSchema } from './common.js';
import { DatabaseEnvSchema, InternalTokenEnvSchema } from './identity.js';
import { loadConfig } from './loader.js';

/**
 * WhatsApp Conversational Commerce Service Environment Configuration.
 * Combines database access, internal service token verification, and Meta Cloud API webhook secrets.
 */
export const WhatsAppServiceEnvSchema = CommonEnvSchema.merge(DatabaseEnvSchema)
  .merge(InternalTokenEnvSchema)
  .extend({
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
    WHATSAPP_VERIFY_TOKEN: z
      .string({ required_error: 'WHATSAPP_VERIFY_TOKEN is required for webhook handshake' })
      .min(1, 'WHATSAPP_VERIFY_TOKEN cannot be empty')
      .default('grocery-whatsapp-verify-token-secret'),
    WHATSAPP_APP_SECRET: z
      .string({
        required_error: 'WHATSAPP_APP_SECRET is required for X-Hub-Signature-256 validation',
      })
      .min(16, 'WHATSAPP_APP_SECRET must be at least 16 characters')
      .default('grocery-meta-app-secret-32chars!'),
    WHATSAPP_API_TOKEN: z
      .string()
      .min(1, 'WHATSAPP_API_TOKEN cannot be empty')
      .default('mock-whatsapp-system-user-api-token'),
    WHATSAPP_API_BASE_URL: z
      .string()
      .url({ message: 'WHATSAPP_API_BASE_URL must be a valid URL' })
      .default('https://graph.facebook.com/v19.0'),
  });

export type WhatsAppServiceEnv = z.infer<typeof WhatsAppServiceEnvSchema>;

/**
 * Loads and validates WhatsApp Service environment configuration.
 *
 * IMPORT-TIME SIDE EFFECT INVARIANT:
 * Executed explicitly during application bootstrap. Importing does not validate or access process.env.
 */
export function loadWhatsAppServiceConfig(
  sourceEnv: Record<string, unknown> = process.env,
): WhatsAppServiceEnv {
  return loadConfig(WhatsAppServiceEnvSchema, sourceEnv);
}
