import { z } from 'zod';
import { StoreIdSchema } from '../common/identifiers.js';

export const StockMovementReasonSchema = z.enum(
  [
    'INFLOW_PURCHASE',
    'RESERVATION_HOLD',
    'RESERVATION_RELEASE',
    'FULFILLMENT_OUTFLOW',
    'MANUAL_CORRECTION',
    'SHRINKAGE_DAMAGE',
  ],
  {
    errorMap: () => ({
      message:
        "Movement reason must be one of: 'INFLOW_PURCHASE', 'RESERVATION_HOLD', 'RESERVATION_RELEASE', 'FULFILLMENT_OUTFLOW', 'MANUAL_CORRECTION', 'SHRINKAGE_DAMAGE'",
    }),
  },
);

export type StockMovementReason = z.infer<typeof StockMovementReasonSchema>;

/**
 * Stock balance schema representing store-scoped item inventory levels.
 */
export const StockBalanceSchema = z.object({
  id: z.string().uuid({ message: 'Stock balance ID must be a valid canonical UUID' }),
  storeId: StoreIdSchema,
  productId: z.string().uuid({ message: 'Product ID must be a valid canonical UUID' }),
  sku: z.string().nullable().optional(),
  onHandQuantity: z.number().nonnegative('On-hand quantity cannot be negative'),
  reservedQuantity: z.number().nonnegative('Reserved quantity cannot be negative'),
  availableQuantity: z.number().nonnegative('Available quantity cannot be negative'),
  reorderPoint: z.number().nonnegative().nullable().optional(),
  createdAt: z.string().datetime({ message: 'createdAt must be an ISO 8601 UTC timestamp string' }),
  updatedAt: z.string().datetime({ message: 'updatedAt must be an ISO 8601 UTC timestamp string' }),
});

export type StockBalance = z.infer<typeof StockBalanceSchema>;

/**
 * Payload for explicitly setting stock quantity and reorder point.
 */
export const UpdateStockInputSchema = z.object({
  onHandQuantity: z
    .number({ required_error: 'onHandQuantity is required' })
    .nonnegative('onHandQuantity cannot be negative'),
  reorderPoint: z.number().nonnegative().nullable().optional(),
});

export type UpdateStockInput = z.infer<typeof UpdateStockInputSchema>;

/**
 * Payload for auditing manual stock adjustments (intake, shrinkage, correction).
 */
export const AdjustStockInputSchema = z.object({
  deltaQuantity: z.number({ required_error: 'deltaQuantity is required' }),
  reason: z.enum(['INFLOW_PURCHASE', 'MANUAL_CORRECTION', 'SHRINKAGE_DAMAGE'], {
    errorMap: () => ({
      message:
        "Adjustment reason must be 'INFLOW_PURCHASE', 'MANUAL_CORRECTION', or 'SHRINKAGE_DAMAGE'",
    }),
  }),
  referenceId: z.string().max(100).optional(),
});

export type AdjustStockInput = z.infer<typeof AdjustStockInputSchema>;

export const StockBalanceResponseSchema = z.object({
  stock: StockBalanceSchema,
});

export type StockBalanceResponse = z.infer<typeof StockBalanceResponseSchema>;

export const StockBalanceListResponseSchema = z.object({
  stocks: z.array(StockBalanceSchema),
});

export type StockBalanceListResponse = z.infer<typeof StockBalanceListResponseSchema>;
