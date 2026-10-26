import { z } from 'zod';
import { StoreIdSchema } from '../common/identifiers.js';

export const CategoryStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED'], {
  errorMap: () => ({
    message: "Category status must be 'ACTIVE', 'INACTIVE', or 'ARCHIVED'",
  }),
});

export type CategoryStatus = z.infer<typeof CategoryStatusSchema>;

/**
 * Category schema representing a store-scoped category entity.
 */
export const CategorySchema = z.object({
  id: z.string().uuid({ message: 'Category ID must be a valid canonical UUID' }),
  storeId: StoreIdSchema,
  name: z
    .string({ required_error: 'Category name is required' })
    .min(1, 'Category name cannot be empty')
    .max(100, 'Category name cannot exceed 100 characters'),
  slug: z
    .string({ required_error: 'Category slug is required' })
    .regex(
      /^[a-z0-9-]+$/,
      'Category slug must contain only lowercase alphanumeric characters and hyphens',
    )
    .min(1, 'Category slug cannot be empty')
    .max(100, 'Category slug cannot exceed 100 characters'),
  description: z
    .string()
    .max(1000, 'Description cannot exceed 1000 characters')
    .nullable()
    .optional(),
  parentId: z.string().uuid({ message: 'Parent ID must be a valid UUID' }).nullable().optional(),
  sortOrder: z.number().int('Sort order must be an integer').default(0),
  status: CategoryStatusSchema.default('ACTIVE'),
  createdAt: z.string().datetime({ message: 'createdAt must be an ISO 8601 UTC timestamp string' }),
  updatedAt: z.string().datetime({ message: 'updatedAt must be an ISO 8601 UTC timestamp string' }),
});

export type Category = z.infer<typeof CategorySchema>;

/**
 * Request payload for creating a new store category.
 */
export const CreateCategoryInputSchema = z.object({
  name: z
    .string({ required_error: 'Category name is required' })
    .min(1, 'Category name cannot be empty')
    .max(100, 'Category name cannot exceed 100 characters'),
  slug: z
    .string()
    .regex(
      /^[a-z0-9-]+$/,
      'Category slug must contain only lowercase alphanumeric characters and hyphens',
    )
    .min(1, 'Category slug cannot be empty')
    .max(100, 'Category slug cannot exceed 100 characters')
    .optional(),
  description: z.string().max(1000).optional(),
  parentId: z.string().uuid({ message: 'Parent ID must be a valid UUID' }).optional(),
  sortOrder: z.number().int().optional(),
});

export type CreateCategoryInput = z.infer<typeof CreateCategoryInputSchema>;

/**
 * Request payload for updating an existing store category.
 */
export const UpdateCategoryInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z
    .string()
    .regex(
      /^[a-z0-9-]+$/,
      'Category slug must contain only lowercase alphanumeric characters and hyphens',
    )
    .min(1)
    .max(100)
    .optional(),
  description: z.string().max(1000).nullable().optional(),
  parentId: z.string().uuid({ message: 'Parent ID must be a valid UUID' }).nullable().optional(),
  sortOrder: z.number().int().optional(),
  status: CategoryStatusSchema.optional(),
});

export type UpdateCategoryInput = z.infer<typeof UpdateCategoryInputSchema>;

/**
 * Single category response schema.
 */
export const CategoryResponseSchema = z.object({
  category: CategorySchema,
});

export type CategoryResponse = z.infer<typeof CategoryResponseSchema>;

/**
 * List of categories response schema.
 */
export const CategoryListResponseSchema = z.object({
  categories: z.array(CategorySchema),
});

export type CategoryListResponse = z.infer<typeof CategoryListResponseSchema>;
