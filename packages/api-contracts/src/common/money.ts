import { z } from 'zod';

/**
 * Monetary Value Schema.
 * In accordance with ADR-005, monetary amounts are ALWAYS represented as integer minor units
 * (e.g., paise: 100 paise = 1.00 INR; cents: 100 cents = $1.00 USD) to prevent floating-point errors.
 *
 * SAFETY INVARIANTS:
 * - Amount must be an integer, finite, and within safe JavaScript integer limits (Number.isSafeInteger).
 *   Unsafe integers (exceeding Number.MAX_SAFE_INTEGER) or fractional minor units are strictly rejected.
 * - Currency format: Enforces a 3-letter uppercase alphabetic format (/^[A-Z]{3}$/) conforming to the
 *   shape of ISO 4217 codes.
 *   LIMITATION: This regex validates code format only and does NOT verify that the code corresponds
 *   to an active currency in the ISO 4217 registry (e.g., 'ZZZ' satisfies the format).
 *   UNRESOLVED DECISION: The project architecture (ADR-005 §5.2, §12) establishes 'INR' as the default
 *   currency but leaves the formal multi-currency tenant allowlist as an open business decision.
 *   Restricting to an arbitrary allowlist at this contract layer would be premature; domain services
 *   must enforce tenant-level currency eligibility.
 * - Display formatting and decimal conversions belong strictly to presentation layers, not this contract.
 */
export const MoneySchema = z.object({
  amount_minor: z
    .number({ invalid_type_error: 'Amount must be a number' })
    .int({ message: 'Amount must be an integer represented in minor units (e.g. paise)' })
    .finite({ message: 'Amount must be a finite number' })
    .safe({ message: 'Amount must be a safe integer within JavaScript limits' }),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, {
      message:
        'Currency must be an uppercase 3-letter code formatted like an ISO 4217 code (e.g. INR)',
    })
    .default('INR'),
});

export type Money = z.infer<typeof MoneySchema>;

/**
 * Canonical Units of Measure.
 * In accordance with ADR-010 §2 & §5.2, inventory and catalog stock balances standardize strictly
 * on these controlled canonical units: PIECE, PACK, KG, G, L, ML.
 * Free-form unit strings and ad-hoc conversions are strictly prohibited.
 */
export const CanonicalUnitSchema = z.enum(['KG', 'G', 'L', 'ML', 'PIECE', 'PACK']);

export type CanonicalUnit = z.infer<typeof CanonicalUnitSchema>;

/**
 * Product Quantity Schema.
 * Supports fractional quantities up to 3 decimal places (e.g., 0.500 KG or 1.250 L) for weighed/measured goods.
 *
 * PRECISION LIMITATIONS & FLOATING-POINT HANDLING:
 * JavaScript IEEE 754 double-precision floating-point numbers can introduce minor precision drift
 * during arithmetic (e.g., 1.001 * 1000 = 1000.9999999999999).
 * To avoid falsely rejecting valid 3-decimal numbers or silently corrupting quantities,
 * we use an epsilon tolerance check (< 1e-9) against the rounded 3-decimal target.
 * Invalid values with > 3 decimal places (e.g. 1.0005) or non-finite values are rejected, never silently rounded.
 */
export const QuantitySchema = z
  .number({ invalid_type_error: 'Quantity must be a number' })
  .finite({ message: 'Quantity must be a finite number' })
  .positive({ message: 'Quantity must be greater than zero' })
  .refine((val) => Math.abs(val * 1000 - Math.round(val * 1000)) < 1e-9, {
    message: 'Quantity cannot exceed 3 decimal places',
  });

export type Quantity = z.infer<typeof QuantitySchema>;
