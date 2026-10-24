import { z } from 'zod';

/**
 * Tenant / Store Identifier Schema.
 * In accordance with ADR-002, store identifiers are strictly canonical RFC 4122 UUIDv4 strings.
 *
 * IMPORTANT ARCHITECTURAL CONSTRAINT:
 * A client-supplied tenant identifier is purely an input parameter (DATA), NEVER proof of authorization.
 * All downstream services must independently authorize the caller's permission to access the specified store.
 */
export const StoreIdSchema = z
  .string()
  .uuid({ message: 'Store ID must be a valid canonical UUIDv4' });

export type StoreId = z.infer<typeof StoreIdSchema>;

/**
 * Request Correlation Identifier Schema.
 * Used for distributed tracing across edge and private microservices.
 */
export const CorrelationIdSchema = z
  .string()
  .uuid({ message: 'Correlation ID must be a valid UUID' });

export type CorrelationId = z.infer<typeof CorrelationIdSchema>;

/**
 * Client Idempotency Key Schema.
 * Scoped by (tenant_id, user_id, operation, idempotency_key).
 */
export const IdempotencyKeySchema = z
  .string()
  .min(1, { message: 'Idempotency key cannot be empty' })
  .max(128, { message: 'Idempotency key cannot exceed 128 characters' });

export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

/**
 * User Identifier Schema.
 */
export const UserIdSchema = z
  .string()
  .min(1, { message: 'User ID cannot be empty' })
  .max(64, { message: 'User ID cannot exceed 64 characters' });

export type UserId = z.infer<typeof UserIdSchema>;

/**
 * Order Identifier Schema.
 */
export const OrderIdSchema = z
  .string()
  .min(1, { message: 'Order ID cannot be empty' })
  .max(64, { message: 'Order ID cannot exceed 64 characters' });

export type OrderId = z.infer<typeof OrderIdSchema>;

/**
 * E.164 Phone Number Schema for WhatsApp identity linking.
 */
export const PhoneNumberSchema = z.string().regex(/^\+[1-9]\d{1,14}$/, {
  message: 'Phone number must be in valid E.164 international format (e.g. +919876543210)',
});

export type PhoneNumber = z.infer<typeof PhoneNumberSchema>;
