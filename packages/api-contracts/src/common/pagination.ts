import { z } from 'zod';

/**
 * Standard Offset-based Pagination Query Parameters.
 *
 * NOTE: The platform standardizes initially on offset-based pagination (page & limit)
 * with bounded limits (1 to 100) to prevent denial-of-service memory exhaustion.
 */
export const PaginationQuerySchema = z.object({
  page: z.coerce
    .number({ invalid_type_error: 'Page must be a valid number' })
    .int({ message: 'Page must be an integer' })
    .finite({ message: 'Page must be finite' })
    .min(1, { message: 'Page must be at least 1' })
    .default(1),
  limit: z.coerce
    .number({ invalid_type_error: 'Limit must be a valid number' })
    .int({ message: 'Limit must be an integer' })
    .finite({ message: 'Limit must be finite' })
    .min(1, { message: 'Limit must be at least 1' })
    .max(100, { message: 'Limit cannot exceed 100 items' })
    .default(20),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/**
 * Pagination Metadata Schema returned with paginated collections.
 */
export const PaginationMetaSchema = z.object({
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(100),
  total_items: z.number().int().nonnegative(),
  total_pages: z.number().int().nonnegative(),
  has_next: z.boolean(),
  has_prev: z.boolean(),
});

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

/**
 * Helper to construct a generic Paginated Response Schema for any item schema.
 */
export function createPaginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    pagination: PaginationMetaSchema,
  });
}
