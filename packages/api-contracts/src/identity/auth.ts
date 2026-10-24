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
