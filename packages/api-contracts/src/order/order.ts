import { z } from 'zod';
import { StoreIdSchema, UserIdSchema } from '../common/identifiers.js';
import { PaginationQuerySchema, createPaginatedResponseSchema } from '../common/pagination.js';

export const OrderStatusSchema = z.enum(
  [
    'RECEIVED',
    'AWAITING_SHOPKEEPER_REVIEW',
    'CHANGE_REQUESTED',
    'REJECTED',
    'CONFIRMATION_PENDING_RESERVATION',
    'CONFIRMED',
    'PREPARING',
    'READY_FOR_PICKUP',
    'DISPATCHED',
    'COMPLETED',
    'CANCELLED',
  ],
  {
    errorMap: () => ({
      message:
        "OrderStatus must be one of: 'RECEIVED', 'AWAITING_SHOPKEEPER_REVIEW', 'CHANGE_REQUESTED', 'REJECTED', 'CONFIRMATION_PENDING_RESERVATION', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'DISPATCHED', 'COMPLETED', 'CANCELLED'",
    }),
  },
);

export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const FulfillmentTypeSchema = z.enum(['PICKUP', 'DELIVERY'], {
  errorMap: () => ({
    message: "FulfillmentType must be 'PICKUP' or 'DELIVERY'",
  }),
});

export type FulfillmentType = z.infer<typeof FulfillmentTypeSchema>;

export const OrderItemStatusSchema = z.enum(['PENDING', 'CONFIRMED', 'SUBSTITUTED', 'REMOVED'], {
  errorMap: () => ({
    message: "OrderItemStatus must be 'PENDING', 'CONFIRMED', 'SUBSTITUTED', or 'REMOVED'",
  }),
});

export type OrderItemStatus = z.infer<typeof OrderItemStatusSchema>;

/**
 * Line item schema with immutable price snapshots.
 */
export const OrderItemSchema = z.object({
  id: z.string().uuid({ message: 'Order item ID must be a valid canonical UUID' }),
  productId: z.string().uuid({ message: 'Product ID must be a valid canonical UUID' }),
  productName: z.string().min(1),
  sku: z.string().nullable().optional(),
  unit: z.string().default('PIECE'),
  unitPriceCents: z.number().int().nonnegative(),
  quantity: z.number().positive(),
  totalPriceCents: z.number().int().nonnegative(),
  status: OrderItemStatusSchema.default('PENDING'),
  substitutedProductId: z.string().uuid().nullable().optional(),
  substitutionNotes: z.string().nullable().optional(),
});

export type OrderItem = z.infer<typeof OrderItemSchema>;

/**
 * Complete order schema with items.
 */
export const OrderSchema = z.object({
  id: z.string().uuid({ message: 'Order ID must be a valid canonical UUID' }),
  storeId: StoreIdSchema,
  customerId: UserIdSchema.nullable().optional(),
  orderNumber: z.string().min(1),
  status: OrderStatusSchema,
  fulfillmentType: FulfillmentTypeSchema,
  deliveryAddress: z.string().nullable().optional(),
  customerPhone: z.string().nullable().optional(),
  customerName: z.string().nullable().optional(),
  totalAmountCents: z.number().int().nonnegative(),
  currency: z
    .string()
    .length(3)
    .regex(/^[A-Z]{3}$/)
    .default('INR'),
  notes: z.string().nullable().optional(),
  items: z.array(OrderItemSchema),
  createdAt: z.string().datetime({ message: 'createdAt must be an ISO 8601 UTC timestamp string' }),
  updatedAt: z.string().datetime({ message: 'updatedAt must be an ISO 8601 UTC timestamp string' }),
});

export type Order = z.infer<typeof OrderSchema>;

export const CreateOrderItemInputSchema = z.object({
  productId: z.string().uuid({ message: 'Product ID must be a valid canonical UUID' }),
  quantity: z.number().positive('Quantity must be strictly positive'),
});

export type CreateOrderItemInput = z.infer<typeof CreateOrderItemInputSchema>;

export const CreateOrderInputSchema = z.object({
  customerId: UserIdSchema.optional(),
  fulfillmentType: FulfillmentTypeSchema.default('PICKUP'),
  deliveryAddress: z.string().max(500).optional(),
  customerPhone: z.string().max(20).optional(),
  customerName: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
  idempotencyKey: z.string().max(100).optional(),
  items: z.array(CreateOrderItemInputSchema).min(1, 'Order must contain at least one item'),
});

export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;

export const SubstituteItemInputSchema = z.object({
  substitutedProductId: z
    .string()
    .uuid({ message: 'Substituted product ID must be a valid canonical UUID' }),
  newQuantity: z.number().positive().optional(),
  notes: z.string().max(500).optional(),
});

export type SubstituteItemInput = z.infer<typeof SubstituteItemInputSchema>;

export const UpdateOrderStatusInputSchema = z.object({
  status: OrderStatusSchema,
  reason: z.string().max(255).optional(),
});

export type UpdateOrderStatusInput = z.infer<typeof UpdateOrderStatusInputSchema>;

export const OrderResponseSchema = z.object({
  order: OrderSchema,
});

export type OrderResponse = z.infer<typeof OrderResponseSchema>;

export const OrderListQuerySchema = PaginationQuerySchema.extend({
  status: OrderStatusSchema.optional(),
  customerId: UserIdSchema.optional(),
});

export type OrderListQuery = z.infer<typeof OrderListQuerySchema>;

export const PaginatedOrderListResponseSchema = createPaginatedResponseSchema(OrderSchema);

export type PaginatedOrderListResponse = z.infer<typeof PaginatedOrderListResponseSchema>;
