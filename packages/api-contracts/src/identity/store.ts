import { z } from 'zod';
import { StoreIdSchema } from '../common/identifiers.js';

/**
 * Store lifecycle status enumeration.
 */
export const StoreStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED'], {
  errorMap: () => ({
    message: "Store status must be 'ACTIVE', 'INACTIVE', or 'SUSPENDED'",
  }),
});

export type StoreStatus = z.infer<typeof StoreStatusSchema>;

/**
 * Store profile schema representing merchant store metadata.
 */
export const StoreProfileSchema = z.object({
  id: StoreIdSchema,
  name: z
    .string({ required_error: 'Store name is required' })
    .min(2, 'Store name must be at least 2 characters long')
    .max(100, 'Store name cannot exceed 100 characters'),
  code: z
    .string()
    .regex(
      /^[a-z0-9-]+$/,
      'Store code must consist only of lowercase alphanumeric characters and hyphens',
    )
    .min(2, 'Store code must be at least 2 characters long')
    .max(50, 'Store code cannot exceed 50 characters')
    .nullable()
    .optional(),
  currency: z
    .string()
    .length(3, 'Currency must be a 3-letter ISO 4217 code (e.g. INR)')
    .regex(/^[A-Z]{3}$/, 'Currency must be uppercase 3-letter ISO 4217 code')
    .default('INR'),
  timezone: z
    .string()
    .min(1, 'Timezone cannot be empty')
    .max(50, 'Timezone cannot exceed 50 characters')
    .default('Asia/Kolkata'),
  status: StoreStatusSchema.default('ACTIVE'),
  createdAt: z.string().datetime({ message: 'createdAt must be an ISO 8601 UTC timestamp string' }),
  updatedAt: z.string().datetime({ message: 'updatedAt must be an ISO 8601 UTC timestamp string' }),
});

export type StoreProfile = z.infer<typeof StoreProfileSchema>;

/**
 * Request payload for creating a new merchant store.
 */
export const CreateStoreInputSchema = z.object({
  name: z
    .string({ required_error: 'Store name is required' })
    .min(2, 'Store name must be at least 2 characters long')
    .max(100, 'Store name cannot exceed 100 characters'),
  code: z
    .string()
    .regex(
      /^[a-z0-9-]+$/,
      'Store code must consist only of lowercase alphanumeric characters and hyphens',
    )
    .min(2, 'Store code must be at least 2 characters long')
    .max(50, 'Store code cannot exceed 50 characters')
    .optional(),
  currency: z
    .string()
    .length(3, 'Currency must be a 3-letter ISO 4217 code')
    .regex(/^[A-Z]{3}$/, 'Currency must be uppercase 3-letter ISO 4217 code')
    .default('INR'),
  timezone: z.string().min(1).max(50).default('Asia/Kolkata'),
});

export type CreateStoreInput = z.infer<typeof CreateStoreInputSchema>;
