import { z } from 'zod';
import { StoreIdSchema } from '../common/identifiers.js';
import { PaginationQuerySchema, createPaginatedResponseSchema } from '../common/pagination.js';

export const ProductStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED'], {
  errorMap: () => ({
    message: "Product status must be 'ACTIVE', 'INACTIVE', or 'ARCHIVED'",
  }),
});

export type ProductStatus = z.infer<typeof ProductStatusSchema>;

export const ProductUnitSchema = z.enum(
  ['PIECE', 'KG', 'GRAM', 'LITRE', 'MILLILITRE', 'PACK', 'DOZEN'],
  {
    errorMap: () => ({
      message:
        "Product unit must be one of: 'PIECE', 'KG', 'GRAM', 'LITRE', 'MILLILITRE', 'PACK', 'DOZEN'",
    }),
  },
);

export type ProductUnit = z.infer<typeof ProductUnitSchema>;

/**
 * Product schema representing a store-scoped product entity.
 */
export const ProductSchema = z.object({
  id: z.string().uuid({ message: 'Product ID must be a valid canonical UUID' }),
  storeId: StoreIdSchema,
  categoryId: z
    .string()
    .uuid({ message: 'Category ID must be a valid canonical UUID' })
    .nullable()
    .optional(),
  name: z
    .string({ required_error: 'Product name is required' })
    .min(1, 'Product name cannot be empty')
    .max(150, 'Product name cannot exceed 150 characters'),
  slug: z
    .string({ required_error: 'Product slug is required' })
    .regex(
      /^[a-z0-9-]+$/,
      'Product slug must contain only lowercase alphanumeric characters and hyphens',
    )
    .min(1, 'Product slug cannot be empty')
    .max(150, 'Product slug cannot exceed 150 characters'),
  sku: z.string().min(1).max(50).nullable().optional(),
  barcode: z.string().min(1).max(50).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  priceCents: z
    .number({ required_error: 'Price in cents/paise is required' })
    .int('Price must be an integer represented in minor units (cents/paise)')
    .nonnegative('Price cannot be negative'),
  currency: z
    .string()
    .length(3, 'Currency must be an ISO 4217 code')
    .regex(/^[A-Z]{3}$/, 'Currency must be uppercase 3-letter code')
    .default('INR'),
  unit: ProductUnitSchema.default('PIECE'),
  isWeightBased: z.boolean().default(false),
  status: ProductStatusSchema.default('ACTIVE'),
  imageUrl: z.string().url('Image URL must be a valid URL').max(500).nullable().optional(),
  createdAt: z.string().datetime({ message: 'createdAt must be an ISO 8601 UTC timestamp string' }),
  updatedAt: z.string().datetime({ message: 'updatedAt must be an ISO 8601 UTC timestamp string' }),
});

export type Product = z.infer<typeof ProductSchema>;

/**
 * Request payload for creating a new store product.
 */
export const CreateProductInputSchema = z.object({
  categoryId: z.string().uuid({ message: 'Category ID must be a valid canonical UUID' }).optional(),
  name: z
    .string({ required_error: 'Product name is required' })
    .min(1, 'Product name cannot be empty')
    .max(150, 'Product name cannot exceed 150 characters'),
  slug: z
    .string()
    .regex(
      /^[a-z0-9-]+$/,
      'Product slug must contain only lowercase alphanumeric characters and hyphens',
    )
    .min(1, 'Product slug cannot be empty')
    .max(150, 'Product slug cannot exceed 150 characters')
    .optional(),
  sku: z.string().min(1).max(50).optional(),
  barcode: z.string().min(1).max(50).optional(),
  description: z.string().max(2000).optional(),
  priceCents: z
    .number({ required_error: 'Price in cents/paise is required' })
    .int('Price must be an integer represented in minor units')
    .nonnegative('Price cannot be negative'),
  currency: z
    .string()
    .length(3)
    .regex(/^[A-Z]{3}$/)
    .default('INR')
    .optional(),
  unit: ProductUnitSchema.default('PIECE').optional(),
  isWeightBased: z.boolean().default(false).optional(),
  imageUrl: z.string().url('Image URL must be a valid URL').max(500).optional(),
});

export type CreateProductInput = z.infer<typeof CreateProductInputSchema>;

/**
 * Request payload for updating an existing store product.
 */
export const UpdateProductInputSchema = z.object({
  categoryId: z
    .string()
    .uuid({ message: 'Category ID must be a valid canonical UUID' })
    .nullable()
    .optional(),
  name: z.string().min(1).max(150).optional(),
  slug: z
    .string()
    .regex(
      /^[a-z0-9-]+$/,
      'Product slug must contain only lowercase alphanumeric characters and hyphens',
    )
    .min(1)
    .max(150)
    .optional(),
  sku: z.string().min(1).max(50).nullable().optional(),
  barcode: z.string().min(1).max(50).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  priceCents: z.number().int().nonnegative().optional(),
  currency: z
    .string()
    .length(3)
    .regex(/^[A-Z]{3}$/)
    .optional(),
  unit: ProductUnitSchema.optional(),
  isWeightBased: z.boolean().optional(),
  status: ProductStatusSchema.optional(),
  imageUrl: z.string().url('Image URL must be a valid URL').max(500).nullable().optional(),
});

export type UpdateProductInput = z.infer<typeof UpdateProductInputSchema>;

/**
 * Query parameters for searching and filtering store products.
 */
export const ProductListQuerySchema = PaginationQuerySchema.extend({
  categoryId: z.string().uuid().optional(),
  status: ProductStatusSchema.optional(),
  search: z.string().max(100).optional(),
});

export type ProductListQuery = z.infer<typeof ProductListQuerySchema>;

/**
 * Single product response schema.
 */
export const ProductResponseSchema = z.object({
  product: ProductSchema,
});

export type ProductResponse = z.infer<typeof ProductResponseSchema>;

/**
 * Paginated product collection response schema.
 */
export const PaginatedProductListResponseSchema = createPaginatedResponseSchema(ProductSchema);

export type PaginatedProductListResponse = z.infer<typeof PaginatedProductListResponseSchema>;
