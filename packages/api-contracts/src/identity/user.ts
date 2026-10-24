import { z } from 'zod';
import { PhoneNumberSchema, UserIdSchema } from '../common/identifiers.js';

/**
 * User account status enumeration.
 */
export const UserStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION'], {
  errorMap: () => ({
    message: "User status must be 'ACTIVE', 'SUSPENDED', or 'PENDING_VERIFICATION'",
  }),
});

export type UserStatus = z.infer<typeof UserStatusSchema>;

/**
 * Safe public user representation returned by identity APIs.
 *
 * CRITICAL SECURITY INVARIANT:
 * This schema strictly excludes password hashes, password reset secrets, session secrets,
 * signing keys, salt values, and internal credential metadata.
 */
export const UserResponseSchema = z.object({
  id: UserIdSchema,
  email: z.string().email('Invalid email address format').nullable(),
  phone: PhoneNumberSchema.nullable(),
  fullName: z
    .string({ required_error: 'Full name is required' })
    .min(1, 'Full name cannot be empty')
    .max(100, 'Full name cannot exceed 100 characters'),
  status: UserStatusSchema,
  createdAt: z.string().datetime({ message: 'createdAt must be an ISO 8601 UTC timestamp string' }),
  updatedAt: z.string().datetime({ message: 'updatedAt must be an ISO 8601 UTC timestamp string' }),
});

export type UserResponse = z.infer<typeof UserResponseSchema>;
