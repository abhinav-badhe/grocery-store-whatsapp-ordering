import { z } from 'zod';
import { PhoneNumberSchema } from '../common/identifiers.js';
import { UserResponseSchema } from './user.js';

/**
 * Normalized email schema.
 * Trims leading/trailing whitespace and converts domain and address to lowercase.
 */
export const NormalizedEmailSchema = z.preprocess(
  (val) => (typeof val === 'string' ? val.trim().toLowerCase() : val),
  z
    .string({ required_error: 'Email address is required' })
    .email('Invalid email address format')
    .max(255, 'Email cannot exceed 255 characters'),
);

export type NormalizedEmail = z.infer<typeof NormalizedEmailSchema>;

/**
 * Password input schema.
 *
 * CRITICAL SECURITY INVARIANT:
 * Passwords MUST NOT be normalized, trimmed, or altered in content.
 * Bounded to 8-128 characters to enforce entropy while mitigating DoS via oversized Argon2 payloads.
 */
export const PasswordInputSchema = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters long')
  .max(128, 'Password cannot exceed 128 characters');

export type PasswordInput = z.infer<typeof PasswordInputSchema>;

/**
 * User registration request schema.
 * Supports registration via email, E.164 phone number, or both.
 * Fails closed if neither email nor phone number is provided.
 */
export const RegisterInputSchema = z
  .object({
    fullName: z
      .string({ required_error: 'Full name is required' })
      .min(1, 'Full name cannot be empty')
      .max(100, 'Full name cannot exceed 100 characters'),
    email: NormalizedEmailSchema.optional(),
    phone: PhoneNumberSchema.optional(),
    password: PasswordInputSchema,
  })
  .refine((data) => Boolean(data.email || data.phone), {
    message: 'At least one contact identifier (email or phone) must be provided for registration',
    path: ['email'],
  });

export type RegisterInput = z.infer<typeof RegisterInputSchema>;

/**
 * User login request schema.
 * Accepts either an email address or an E.164 normalized phone number as the primary identifier.
 */
export const LoginInputSchema = z
  .object({
    identifier: z
      .string({ required_error: 'Login identifier is required' })
      .min(1, 'Login identifier cannot be empty')
      .max(255, 'Login identifier cannot exceed 255 characters'),
    password: PasswordInputSchema,
  })
  .refine(
    (data) => {
      const trimmed = data.identifier.trim();
      const isEmail = z.string().email().safeParse(trimmed).success;
      const isPhone = /^\+[1-9]\d{1,14}$/.test(trimmed);
      return isEmail || isPhone;
    },
    {
      message:
        'Login identifier must be a valid email address or an E.164 phone number (e.g. +919876543210)',
      path: ['identifier'],
    },
  );

export type LoginInput = z.infer<typeof LoginInputSchema>;

/**
 * Authentication response schema.
 * Returns safe public user details upon successful authentication or session establishment.
 *
 * POLICY ON TOKEN FIELDS:
 * Transport-layer token mechanics (e.g. HttpOnly refresh cookies vs response headers) are handled
 * at the HTTP boundary according to ADR-003. This schema defines the shared core payload.
 */
export const AuthResponseSchema = z.object({
  user: UserResponseSchema,
});

export type AuthResponse = z.infer<typeof AuthResponseSchema>;

/**
 * Proposed public access token response schema (TARGET CONTRACT FOR FUTURE IMPLEMENTATION).
 *
 * IMPLEMENTATION STATUS & CURRENT BEHAVIOR (Step 2.4.5G):
 * - Current POST /api/v1/auth/login and POST /api/v1/auth/register endpoints return AuthResponseSchema ({ user }).
 * - Session issuance, JWT minting, and cookie transport have NOT yet been implemented.
 * - Current routes DO NOT return accessToken, tokenType, or expiresIn.
 * - This schema defines the proposed target response shape once asymmetric Ed25519 session issuance
 *   is implemented in Phase 2 upon owner approval.
 *
 * Target response shape for POST /api/v1/auth/login and POST /api/v1/auth/register upon successful session issuance.
 *
 * CRITICAL TOKEN INVARIANTS (ADR-003 / ADR-011):
 * 1. The short-lived Ed25519 access token is returned in the JSON body and held exclusively in browser memory.
 * 2. The high-entropy refresh token is NEVER included in this body; it is delivered via HttpOnly, Secure cookie.
 * 3. expiresIn indicates access token validity in seconds (recommended 900s / 15m).
 */
export const TokenResponseSchema = z.object({
  accessToken: z
    .string({ required_error: 'Access token is required' })
    .min(1, 'Access token cannot be empty'),
  tokenType: z.literal('Bearer').default('Bearer'),
  expiresIn: z
    .number({ required_error: 'Token expiration duration is required' })
    .int('Token expiration must be an integer')
    .positive('Token expiration must be a positive integer in seconds'),
  user: UserResponseSchema,
});

export type TokenResponse = z.infer<typeof TokenResponseSchema>;

/**
 * Proposed public token refresh response schema (TARGET CONTRACT FOR FUTURE IMPLEMENTATION).
 *
 * IMPLEMENTATION STATUS & CURRENT BEHAVIOR (Step 2.4.5G):
 * - Token refresh endpoints (/api/v1/auth/refresh) have NOT yet been implemented.
 * - This schema defines the proposed target response shape for POST /api/v1/auth/refresh once
 *   refresh-token cookie handling and rotation are implemented in Phase 2 upon owner approval.
 *
 * Target response shape for POST /api/v1/auth/refresh when refreshing an access token using the HttpOnly cookie.
 *
 * CRITICAL ROTATION INVARIANTS (ADR-003 / ADR-011):
 * 1. Client sends the refresh token cookie with single-flight mutex protection.
 * 2. Gateway/identity-service rotates the refresh token cookie and issues a new memory-only access token.
 */
export const RefreshTokenResponseSchema = z.object({
  accessToken: z
    .string({ required_error: 'Access token is required' })
    .min(1, 'Access token cannot be empty'),
  tokenType: z.literal('Bearer').default('Bearer'),
  expiresIn: z
    .number({ required_error: 'Token expiration duration is required' })
    .int('Token expiration must be an integer')
    .positive('Token expiration must be a positive integer in seconds'),
});

export type RefreshTokenResponse = z.infer<typeof RefreshTokenResponseSchema>;

/**
 * Proposed session termination response schema (TARGET CONTRACT FOR FUTURE IMPLEMENTATION).
 * Target shape for POST /api/v1/auth/logout upon clearing the session cookie and revoking the active token family.
 * Endpoints have not yet been implemented.
 */
export const LogoutResponseSchema = z.object({
  success: z.boolean({ required_error: 'Logout success status is required' }),
});

export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;

/**
 * Proposed current authenticated user profile response schema (TARGET CONTRACT FOR FUTURE IMPLEMENTATION).
 * Target shape for GET /api/v1/auth/me to fetch session user identity when authorized via Bearer access token.
 * Endpoints have not yet been implemented.
 */
export const CurrentUserResponseSchema = z.object({
  user: UserResponseSchema,
});

export type CurrentUserResponse = z.infer<typeof CurrentUserResponseSchema>;
