import { z } from 'zod';
import { createTenantEventEnvelopeSchema, createPlatformEventEnvelopeSchema } from './envelope.js';

/**
 * Order Confirmed Event Payload (order.confirmed.v1).
 * Published by apps/order-service when the shopkeeper approves the order.
 *
 * SAFETY INVARIANTS:
 * - total_amount_minor must be a safe, non-negative integer minor unit (e.g. paise).
 * - currency must be an uppercase 3-letter code conforming to the shape of ISO 4217 codes.
 * - confirmed_at must be an ISO 8601 UTC timestamp terminating in 'Z'.
 */
export const OrderConfirmedPayloadSchema = z.object({
  order_id: z.string().min(1, { message: 'Order ID cannot be empty' }),
  store_id: z.string().uuid({ message: 'Store ID must be a valid UUIDv4' }),
  customer_id: z.string().min(1, { message: 'Customer ID cannot be empty' }),
  total_amount_minor: z
    .number({ invalid_type_error: 'Amount must be a number' })
    .int({ message: 'Amount must be an integer represented in minor units' })
    .finite({ message: 'Amount must be a finite number' })
    .safe({ message: 'Amount must be a safe integer within JavaScript limits' })
    .nonnegative({ message: 'Total amount cannot be negative' }),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, {
      message:
        'Currency must be an uppercase 3-letter code formatted like an ISO 4217 code (e.g. INR)',
    })
    .default('INR'),
  confirmed_at: z.string().datetime({ message: 'confirmed_at must be an ISO 8601 UTC timestamp' }),
});

export type OrderConfirmedPayload = z.infer<typeof OrderConfirmedPayloadSchema>;
export const OrderConfirmedEventSchema = createTenantEventEnvelopeSchema(
  OrderConfirmedPayloadSchema,
);
export type OrderConfirmedEvent = z.infer<typeof OrderConfirmedEventSchema>;

/**
 * Inventory Reserved Item Schema.
 * Aligns with ADR-010 §2 & §5.2 controlled units of measure and 3-decimal quantity precision.
 */
export const ReservedItemSchema = z.object({
  sku: z.string().min(1, { message: 'SKU cannot be empty' }),
  quantity: z
    .number({ invalid_type_error: 'Quantity must be a number' })
    .finite({ message: 'Quantity must be a finite number' })
    .positive({ message: 'Quantity must be greater than zero' })
    .refine((val) => Math.abs(val * 1000 - Math.round(val * 1000)) < 1e-9, {
      message: 'Quantity cannot exceed 3 decimal places',
    }),
  unit: z.enum(['KG', 'G', 'L', 'ML', 'PIECE', 'PACK']),
});

export type ReservedItem = z.infer<typeof ReservedItemSchema>;

/**
 * Inventory Reserved Event Payload (inventory.reserved.v1).
 * Published by apps/inventory-service following atomic reservation.
 */
export const InventoryReservedPayloadSchema = z.object({
  reservation_id: z.string().min(1, { message: 'Reservation ID cannot be empty' }),
  order_id: z.string().min(1, { message: 'Order ID cannot be empty' }),
  store_id: z.string().uuid({ message: 'Store ID must be a valid UUIDv4' }),
  items: z
    .array(ReservedItemSchema)
    .min(1, { message: 'Reservation must contain at least one item' }),
  expires_at: z.string().datetime({ message: 'expires_at must be an ISO 8601 UTC timestamp' }),
});

export type InventoryReservedPayload = z.infer<typeof InventoryReservedPayloadSchema>;
export const InventoryReservedEventSchema = createTenantEventEnvelopeSchema(
  InventoryReservedPayloadSchema,
);
export type InventoryReservedEvent = z.infer<typeof InventoryReservedEventSchema>;

/**
 * Payment Completed Event Payload (payment.completed.v1).
 * Published by apps/payment-service upon verified provider webhook.
 */
export const PaymentCompletedPayloadSchema = z.object({
  payment_attempt_id: z.string().min(1, { message: 'Payment attempt ID cannot be empty' }),
  order_id: z.string().min(1, { message: 'Order ID cannot be empty' }),
  store_id: z.string().uuid({ message: 'Store ID must be a valid UUIDv4' }),
  amount_minor: z
    .number({ invalid_type_error: 'Amount must be a number' })
    .int({ message: 'Amount must be an integer represented in minor units' })
    .finite({ message: 'Amount must be a finite number' })
    .safe({ message: 'Amount must be a safe integer within JavaScript limits' })
    .positive({ message: 'Amount must be greater than zero' }),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, {
      message:
        'Currency must be an uppercase 3-letter code formatted like an ISO 4217 code (e.g. INR)',
    })
    .default('INR'),

  provider: z.string().min(1, { message: 'Payment provider cannot be empty' }),
  completed_at: z.string().datetime({ message: 'completed_at must be an ISO 8601 UTC timestamp' }),
});

export type PaymentCompletedPayload = z.infer<typeof PaymentCompletedPayloadSchema>;
export const PaymentCompletedEventSchema = createTenantEventEnvelopeSchema(
  PaymentCompletedPayloadSchema,
);
export type PaymentCompletedEvent = z.infer<typeof PaymentCompletedEventSchema>;

/**
 * Platform Maintenance Scheduled Payload (platform.maintenance.scheduled.v1).
 * Representative platform-level event; does NOT belong to any specific store (store_id omitted).
 */
export const PlatformMaintenanceScheduledPayloadSchema = z.object({
  maintenance_id: z.string().min(1, { message: 'Maintenance ID cannot be empty' }),
  scheduled_start: z
    .string()
    .datetime({ message: 'scheduled_start must be an ISO 8601 UTC timestamp' }),
  scheduled_end: z
    .string()
    .datetime({ message: 'scheduled_end must be an ISO 8601 UTC timestamp' }),
  description: z.string().min(1, { message: 'Description cannot be empty' }),
});

export type PlatformMaintenanceScheduledPayload = z.infer<
  typeof PlatformMaintenanceScheduledPayloadSchema
>;
export const PlatformMaintenanceScheduledEventSchema = createPlatformEventEnvelopeSchema(
  PlatformMaintenanceScheduledPayloadSchema,
);
export type PlatformMaintenanceScheduledEvent = z.infer<
  typeof PlatformMaintenanceScheduledEventSchema
>;
