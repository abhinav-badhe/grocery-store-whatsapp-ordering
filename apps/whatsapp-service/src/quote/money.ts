/**
 * Exact integer milliscale quantity arithmetic and currency minor-unit calculation.
 * Eliminates floating-point rounding errors and enforces PostgreSQL 32-bit INT bounds.
 */

export const POSTGRES_INT_MAX = 2_147_483_647; // Maximum 32-bit signed integer in PostgreSQL

export class ArithmeticOverflowError extends Error {
  constructor(
    public readonly fieldName: string,
    public readonly value: number | bigint,
  ) {
    super(
      `Value for '${fieldName}' (${value.toString()}) exceeds PostgreSQL 32-bit INT limit (${POSTGRES_INT_MAX})`,
    );
    this.name = 'ArithmeticOverflowError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidQuantityFormatError extends Error {
  constructor(
    public readonly rawValue: string,
    public readonly reason: string,
  ) {
    super(`Invalid quantity format '${rawValue}': ${reason}`);
    this.name = 'InvalidQuantityFormatError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Parses a clean decimal string into a BigInt scaled by 1,000 (milliscale).
 * Supports up to 3 decimal places. Rejects negative numbers, scientific notation, and excessive precision.
 * e.g., "1.5" -> 1500n, "0.25" -> 250n, "500" -> 500000n.
 */
export function parseDecimalToMilliUnits(qtyStr: string): bigint {
  const trimmed = qtyStr.trim();
  if (!trimmed || trimmed.length === 0) {
    throw new InvalidQuantityFormatError(qtyStr, 'Quantity string cannot be empty');
  }

  // Reject scientific notation, signs, or non-numeric characters
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new InvalidQuantityFormatError(
      qtyStr,
      'Quantity must be a positive decimal number without signs or exponential notation',
    );
  }

  const [intPart, fracPart = ''] = trimmed.split('.');

  if (fracPart.length > 3) {
    throw new InvalidQuantityFormatError(
      qtyStr,
      `Quantity precision exceeds maximum supported 3 decimal places (${fracPart.length} provided)`,
    );
  }

  const paddedFrac = fracPart.padEnd(3, '0');
  const milliUnits = BigInt(intPart) * 1000n + BigInt(paddedFrac);

  if (milliUnits <= 0n) {
    throw new InvalidQuantityFormatError(qtyStr, 'Quantity must be strictly positive');
  }

  return milliUnits;
}

/**
 * Converts a customer's requested quantity into milli-catalog-units based on unit compatibility.
 *
 * 1.000 catalog units is represented by exactly 1000n milli-catalog-units.
 * Returns null if the requested unit cannot be safely converted to the catalog unit.
 */
export function convertRequestedToMilliCatalogUnits(
  requestedQuantity: number,
  requestedUnit: string | null | undefined,
  catalogUnit: string,
): bigint | null {
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    return null;
  }

  const reqUnit = requestedUnit ? requestedUnit.trim().toUpperCase() : catalogUnit.toUpperCase();
  const catUnit = catalogUnit.trim().toUpperCase();

  // 1. Weight Dimension: KG <-> GRAM
  if (catUnit === 'KG') {
    if (reqUnit === 'KG') {
      return parseDecimalToMilliUnits(requestedQuantity.toFixed(3));
    }
    if (reqUnit === 'GRAM' || reqUnit === 'G' || reqUnit === 'GM') {
      // Requested in grams. 1 KG = 1,000 grams.
      // Therefore, X grams = X milli-KG.
      // e.g. 500 grams = 500n milli-KG (0.500 KG).
      const gramsMilli = parseDecimalToMilliUnits(requestedQuantity.toFixed(3));
      // Never silently truncate sub-gram precision (e.g. 250.5g)
      if (gramsMilli % 1000n !== 0n) {
        return null;
      }
      return gramsMilli / 1000n;
    }
    return null;
  }

  if (catUnit === 'GRAM') {
    if (reqUnit === 'GRAM' || reqUnit === 'G' || reqUnit === 'GM') {
      // 1 catalog unit = 1 gram = 1000n milli-catalog-units.
      return parseDecimalToMilliUnits(requestedQuantity.toFixed(3));
    }
    if (reqUnit === 'KG') {
      // 1 KG = 1000 grams.
      const kgMilli = parseDecimalToMilliUnits(requestedQuantity.toFixed(3));
      // kgMilli is in milli-KG (grams). In milli-catalog-units (milli-grams): multiply by 1000n.
      return kgMilli * 1000n;
    }
    return null;
  }

  // 2. Volume Dimension: LITRE <-> MILLILITRE
  if (catUnit === 'LITRE') {
    if (reqUnit === 'LITRE' || reqUnit === 'L') {
      return parseDecimalToMilliUnits(requestedQuantity.toFixed(3));
    }
    if (reqUnit === 'MILLILITRE' || reqUnit === 'ML') {
      // Requested in ml. 1 L = 1000 ml.
      // Therefore, X ml = X milli-L.
      const mlMilli = parseDecimalToMilliUnits(requestedQuantity.toFixed(3));
      // Never silently truncate sub-millilitre precision (e.g. 250.5ml)
      if (mlMilli % 1000n !== 0n) {
        return null;
      }
      return mlMilli / 1000n;
    }
    return null;
  }

  if (catUnit === 'MILLILITRE') {
    if (reqUnit === 'MILLILITRE' || reqUnit === 'ML') {
      return parseDecimalToMilliUnits(requestedQuantity.toFixed(3));
    }
    if (reqUnit === 'LITRE' || reqUnit === 'L') {
      const lMilli = parseDecimalToMilliUnits(requestedQuantity.toFixed(3));
      return lMilli * 1000n;
    }
    return null;
  }

  // 3. Discrete Count Dimension: PIECE, PACK, DOZEN
  if (catUnit === 'PIECE') {
    if (reqUnit === 'PIECE' || reqUnit === 'PCS' || reqUnit === 'PC') {
      // Piece count must be integer
      if (!Number.isInteger(requestedQuantity)) {
        return null; // Fractional pieces not permitted
      }
      return BigInt(Math.round(requestedQuantity)) * 1000n;
    }
    return null;
  }

  if (catUnit === 'PACK') {
    if (reqUnit === 'PACK' || reqUnit === 'PACKS' || reqUnit === 'PKT') {
      if (!Number.isInteger(requestedQuantity)) {
        return null; // Fractional packs not permitted
      }
      return BigInt(Math.round(requestedQuantity)) * 1000n;
    }
    return null;
  }

  if (catUnit === 'DOZEN') {
    if (reqUnit === 'DOZEN' || reqUnit === 'DOZ') {
      // Allow exact whole or half dozens (e.g., 0.5, 1, 2)
      return parseDecimalToMilliUnits(requestedQuantity.toFixed(3));
    }
    if (reqUnit === 'PIECE' || reqUnit === 'PCS' || reqUnit === 'PC') {
      // 12 pieces = 1 dozen = 1000n milli-dozen.
      // Only permit multiples that cleanly divide into 12 (e.g. 6 pieces = 500n, 12 = 1000n)
      if (!Number.isInteger(requestedQuantity)) {
        return null;
      }
      const pieces = BigInt(Math.round(requestedQuantity));
      const totalMilli = pieces * 1000n;
      if (totalMilli % 12n !== 0n) {
        // Indivisible pieces (e.g. 5 eggs) require owner commercial rounding policy. Return null for ambiguity.
        return null;
      }
      return totalMilli / 12n;
    }
    return null;
  }

  return null;
}

/**
 * Computes line total in currency minor units (paise) with deterministic half-up rounding.
 * Formula: round_half_up(unitPriceCents * quantityMilliCatalogUnits / 1000)
 */
export function calculateLineTotalMinor(
  unitPriceCents: number,
  quantityMilliCatalogUnits: bigint,
): number {
  if (unitPriceCents < 0) {
    throw new Error('Unit price cannot be negative');
  }
  if (quantityMilliCatalogUnits <= 0n) {
    return 0;
  }

  // Half-up rounding: add 500n (half of 1000n divisor) before integer division
  const product = BigInt(unitPriceCents) * quantityMilliCatalogUnits;
  const lineTotal = (product + 500n) / 1000n;

  return assertSafePostgresInt(Number(lineTotal), 'lineTotalCents');
}

/**
 * Asserts that a calculated integer fits inside PostgreSQL's 32-bit signed INT column.
 */
export function assertSafePostgresInt(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > POSTGRES_INT_MAX) {
    throw new ArithmeticOverflowError(fieldName, value);
  }
  return value;
}
