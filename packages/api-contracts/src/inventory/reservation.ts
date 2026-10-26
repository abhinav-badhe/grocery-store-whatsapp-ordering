import { z } from 'zod';
import { StoreIdSchema } from '../common/identifiers.js';

export const StockReservationStatusSchema = z.enum(['ACTIVE', 'FULFILLED', 'RELEASED', 'EXPIRED'], {
  errorMap: () => ({
    message: "Reservation status must be 'ACTIVE', 'FULFILLED', 'RELEASED', or 'EXPIRED'",
  }),
});

export type StockReservationStatus = z.infer<typeof StockReservationStatusSchema>;

export const ReservationItemInputSchema = z.object({
  productId: z.string().uuid({ message: 'Product ID must be a valid canonical UUID' }),
  quantity: z
    .number({ required_error: 'Reservation quantity is required' })
    .positive('Reservation quantity must be strictly positive'),
});

export type ReservationItemInput = z.infer<typeof ReservationItemInputSchema>;

export const ReserveStockInputSchema = z.object({
  orderId: z.string().uuid({ message: 'Order ID must be a valid canonical UUID' }),
  items: z
    .array(ReservationItemInputSchema)
    .min(1, 'At least one item must be specified for inventory reservation'),
  expiresInSeconds: z
    .number()
    .int('expiresInSeconds must be an integer')
    .min(60, 'expiresInSeconds must be at least 60 seconds')
    .max(86400, 'expiresInSeconds cannot exceed 24 hours')
    .default(14400) // 4 hours default per ADR-007 §112
    .optional(),
});

export type ReserveStockInput = z.infer<typeof ReserveStockInputSchema>;

export const ReservationItemSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().positive(),
});

export type ReservationItem = z.infer<typeof ReservationItemSchema>;

export const StockReservationSchema = z.object({
  id: z.string().uuid({ message: 'Reservation ID must be a valid canonical UUID' }),
  storeId: StoreIdSchema,
  orderId: z.string().uuid({ message: 'Order ID must be a valid canonical UUID' }),
  status: StockReservationStatusSchema,
  expiresAt: z.string().datetime({ message: 'expiresAt must be an ISO 8601 UTC timestamp string' }),
  items: z.array(ReservationItemSchema),
  createdAt: z.string().datetime({ message: 'createdAt must be an ISO 8601 UTC timestamp string' }),
  updatedAt: z.string().datetime({ message: 'updatedAt must be an ISO 8601 UTC timestamp string' }),
});

export type StockReservation = z.infer<typeof StockReservationSchema>;

export const StockReservationResponseSchema = z.object({
  reservation: StockReservationSchema,
});

export type StockReservationResponse = z.infer<typeof StockReservationResponseSchema>;
