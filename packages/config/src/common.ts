import { z } from 'zod';

/**
 * Explicit boolean environment variable schema.
 *
 * CRITICAL SAFETY INVARIANT:
 * Standard JavaScript Boolean('false') evaluates to true!
 * This helper strictly rejects arbitrary strings and parses truthy/falsy values explicitly:
 * - 'true' or '1' (case-insensitive) -> true
 * - 'false' or '0' (case-insensitive) -> false
 * All other values (e.g. 'yes', 'no', '2', 'invalid') are rejected with a validation error.
 */
export function booleanEnv(defaultValue?: boolean) {
  const schema = z
    .string({ invalid_type_error: 'Must be a string representation of a boolean' })
    .transform((val, ctx) => {
      const normalized = val.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') {
        return true;
      }
      if (normalized === 'false' || normalized === '0') {
        return false;
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Must be a boolean string ('true', 'false', '1', or '0')",
      });
      return z.NEVER;
    });

  if (defaultValue !== undefined) {
    return z.preprocess(
      (val) => (val === undefined ? (defaultValue ? 'true' : 'false') : val),
      schema,
    );
  }

  return schema;
}

/**
 * Port environment variable schema.
 *
 * Validates that PORT is an integer within valid TCP/UDP port bounds (1 to 65535).
 * Defaults to 3000 when undefined.
 * Invalid values (non-numeric, non-finite, negative, zero, or out of range) are strictly rejected.
 */
export function portEnv(defaultPort = 3000) {
  return z.coerce
    .number({ invalid_type_error: 'Port must be a valid number' })
    .int({ message: 'Port must be an integer' })
    .finite({ message: 'Port must be a finite number' })
    .min(1, { message: 'Port must be at least 1' })
    .max(65535, { message: 'Port cannot exceed 65535' })
    .default(defaultPort);
}

/**
 * Standard Common Runtime Environment Schema.
 * Defines the shared configuration attributes shared across all Node.js applications and workers.
 *
 * - NODE_ENV: Target runtime environment ('development', 'test', 'production'). Default: 'development'.
 * - PORT: HTTP server port binding (mandated by Render dynamic port binding). Default: 3000.
 * - LOG_LEVEL: Application log level. Default: 'info'.
 */
export const CommonEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'], {
      errorMap: () => ({ message: "NODE_ENV must be 'development', 'test', or 'production'" }),
    })
    .default('development'),
  PORT: portEnv(3000),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'], {
      errorMap: () => ({
        message:
          "LOG_LEVEL must be 'trace', 'debug', 'info', 'warn', 'error', 'fatal', or 'silent'",
      }),
    })
    .default('info'),
});

export type CommonEnv = z.infer<typeof CommonEnvSchema>;
