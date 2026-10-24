import { z } from 'zod';
import { StoreIdSchema, UserIdSchema } from '../common/identifiers.js';
import { StoreRoleSchema } from './membership.js';

/**
 * Actor persona representation in downstream internal tokens.
 * Indicates the acting persona/channel through which the request originated.
 */
export const ActorPersonaSchema = z.enum(['SHOPKEEPER', 'STAFF', 'CUSTOMER', 'SYSTEM'], {
  errorMap: () => ({
    message: "Actor persona ('act') must be 'SHOPKEEPER', 'STAFF', 'CUSTOMER', or 'SYSTEM'",
  }),
});

export type ActorPersona = z.infer<typeof ActorPersonaSchema>;

/**
 * Validated claims structure for trusted downstream internal tokens (X-Internal-Token).
 * Modeled strictly after ADR-001 §5.2.
 *
 * CRITICAL TENANT AND SECURITY INVARIANTS:
 * 1. Mandatory Tenant Context: 'tid' is required on all tenant-scoped internal tokens.
 *    It must be a canonical RFC 4122 UUIDv4 matching StoreIdSchema.
 * 2. Invariant Timestamps: 'exp' must be strictly later than 'iat'.
 * 3. Scope of Roles: 'roles' are strictly store-scoped roles held by the actor in store 'tid'.
 * 4. DISCLAIMER: This Zod schema validates ONLY the parsed JSON payload structure.
 *    It DOES NOT prove cryptographic authenticity, signature validity, key possession,
 *    or replay protection. Cryptographic verification remains a separate service responsibility.
 */
export const InternalTokenClaimsSchema = z
  .object({
    iss: z
      .string({ required_error: 'Token issuer (iss) is required' })
      .min(1, 'Token issuer (iss) cannot be empty'),
    aud: z
      .string({ required_error: 'Token audience (aud) is required' })
      .min(1, 'Token audience (aud) cannot be empty'),
    sub: UserIdSchema,
    act: ActorPersonaSchema,
    tid: StoreIdSchema,
    roles: z
      .array(StoreRoleSchema)
      .min(1, 'At least one store-scoped role must be present in internal token claims'),
    jti: z
      .string({ required_error: 'Token nonce (jti) is required' })
      .min(8, 'Nonce (jti) must be at least 8 characters long')
      .max(128, 'Nonce (jti) cannot exceed 128 characters'),
    iat: z
      .number({ required_error: 'Issued-at timestamp (iat) is required' })
      .int('Issued-at timestamp (iat) must be an integer')
      .nonnegative('Issued-at timestamp (iat) cannot be negative'),
    nbf: z
      .number()
      .int('Not-before timestamp (nbf) must be an integer')
      .nonnegative('Not-before timestamp (nbf) cannot be negative')
      .optional(),
    exp: z
      .number({ required_error: 'Expiration timestamp (exp) is required' })
      .int('Expiration timestamp (exp) must be an integer')
      .positive('Expiration timestamp (exp) must be a positive integer'),
  })
  .refine((claims) => claims.exp > claims.iat, {
    message: 'Expiration time (exp) must be strictly later than issuance time (iat)',
    path: ['exp'],
  })
  .refine((claims) => claims.nbf === undefined || claims.nbf <= claims.exp, {
    message: 'Not-before time (nbf) cannot be later than expiration time (exp)',
    path: ['nbf'],
  });

export type InternalTokenClaims = z.infer<typeof InternalTokenClaimsSchema>;
