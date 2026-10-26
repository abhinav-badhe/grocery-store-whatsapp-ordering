import { z } from 'zod';
import { StoreIdSchema } from '../common/identifiers.js';

export const PaymentStatusSchema = z.enum(
  ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED'],
  {
    errorMap: () => ({
      message:
        "PaymentStatus must be one of: 'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED'",
    }),
  },
);

export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const PaymentMethodSchema = z.enum(['UPI', 'CARD', 'NETBANKING', 'WALLET', 'COD', 'OTHER'], {
  errorMap: () => ({
    message: "PaymentMethod must be one of: 'UPI', 'CARD', 'NETBANKING', 'WALLET', 'COD', 'OTHER'",
  }),
});

export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const PaymentProviderSchema = z.enum(['RAZORPAY', 'STRIPE', 'CASH_ON_DELIVERY', 'MOCK'], {
  errorMap: () => ({
    message: "PaymentProvider must be one of: 'RAZORPAY', 'STRIPE', 'CASH_ON_DELIVERY', 'MOCK'",
  }),
});

export type PaymentProvider = z.infer<typeof PaymentProviderSchema>;

export const WebhookStatusSchema = z.enum(['RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED'], {
  errorMap: () => ({
    message: "WebhookStatus must be one of: 'RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED'",
  }),
});

export type WebhookStatus = z.infer<typeof WebhookStatusSchema>;

export const RefundStatusSchema = z.enum(['PENDING', 'SUCCEEDED', 'FAILED'], {
  errorMap: () => ({
    message: "RefundStatus must be one of: 'PENDING', 'SUCCEEDED', 'FAILED'",
  }),
});

export type RefundStatus = z.infer<typeof RefundStatusSchema>;

export const PaymentSchema = z.object({
  id: z.string().uuid({ message: 'Payment ID must be a valid canonical UUID' }),
  storeId: StoreIdSchema,
  orderId: z.string().uuid({ message: 'Order ID must be a valid canonical UUID' }),
  paymentMethod: PaymentMethodSchema,
  provider: PaymentProviderSchema,
  providerOrderId: z.string().nullable().optional(),
  providerPaymentId: z.string().nullable().optional(),
  amountCents: z.number().int().positive({ message: 'amountCents must be strictly positive' }),
  currency: z
    .string()
    .length(3)
    .regex(/^[A-Z]{3}$/)
    .default('INR'),
  status: PaymentStatusSchema,
  idempotencyKey: z.string().nullable().optional(),
  createdAt: z.string().datetime({ message: 'createdAt must be an ISO 8601 UTC timestamp string' }),
  updatedAt: z.string().datetime({ message: 'updatedAt must be an ISO 8601 UTC timestamp string' }),
});

export type Payment = z.infer<typeof PaymentSchema>;

export const CreatePaymentInputSchema = z.object({
  orderId: z.string().uuid({ message: 'Order ID must be a valid canonical UUID' }),
  paymentMethod: PaymentMethodSchema.default('UPI'),
  provider: PaymentProviderSchema.default('MOCK'),
  amountCents: z.number().int().positive().optional(),
  idempotencyKey: z.string().max(100).optional(),
});

export type CreatePaymentInput = z.infer<typeof CreatePaymentInputSchema>;

export const RefundSchema = z.object({
  id: z.string().uuid({ message: 'Refund ID must be a valid canonical UUID' }),
  paymentId: z.string().uuid({ message: 'Payment ID must be a valid canonical UUID' }),
  storeId: StoreIdSchema,
  amountCents: z.number().int().positive({ message: 'amountCents must be strictly positive' }),
  reason: z.string().nullable().optional(),
  providerRefundId: z.string().nullable().optional(),
  status: RefundStatusSchema,
  createdAt: z.string().datetime({ message: 'createdAt must be an ISO 8601 UTC timestamp string' }),
  updatedAt: z.string().datetime({ message: 'updatedAt must be an ISO 8601 UTC timestamp string' }),
});

export type Refund = z.infer<typeof RefundSchema>;

export const CreateRefundInputSchema = z.object({
  amountCents: z.number().int().positive().optional(),
  reason: z.string().max(255).optional(),
});

export type CreateRefundInput = z.infer<typeof CreateRefundInputSchema>;

export const PaymentResponseSchema = z.object({
  payment: PaymentSchema,
});

export type PaymentResponse = z.infer<typeof PaymentResponseSchema>;

export const RefundResponseSchema = z.object({
  refund: RefundSchema,
});

export type RefundResponse = z.infer<typeof RefundResponseSchema>;
