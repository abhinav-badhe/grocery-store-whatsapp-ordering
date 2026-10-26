import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDecimalToMilliUnits,
  convertRequestedToMilliCatalogUnits,
  calculateLineTotalMinor,
  assertSafePostgresInt,
  POSTGRES_INT_MAX,
  ArithmeticOverflowError,
  InvalidQuantityFormatError,
} from '../dist/index.js';

describe('Exact Money & Quantity Arithmetic (Subphase 2)', () => {
  describe('parseDecimalToMilliUnits', () => {
    it('correctly parses integer and decimal strings up to 3 decimal places', () => {
      assert.equal(parseDecimalToMilliUnits('1'), 1000n);
      assert.equal(parseDecimalToMilliUnits('1.5'), 1500n);
      assert.equal(parseDecimalToMilliUnits('0.25'), 250n);
      assert.equal(parseDecimalToMilliUnits('0.125'), 125n);
      assert.equal(parseDecimalToMilliUnits('500'), 500000n);
      assert.equal(parseDecimalToMilliUnits('  2.750  '), 2750n);
    });

    it('rejects numbers with more than 3 decimal places', () => {
      assert.throws(() => parseDecimalToMilliUnits('1.5555'), InvalidQuantityFormatError);
    });

    it('rejects scientific notation, negative numbers, and non-numeric strings', () => {
      assert.throws(() => parseDecimalToMilliUnits('1e3'), InvalidQuantityFormatError);
      assert.throws(() => parseDecimalToMilliUnits('-1.5'), InvalidQuantityFormatError);
      assert.throws(() => parseDecimalToMilliUnits('abc'), InvalidQuantityFormatError);
      assert.throws(() => parseDecimalToMilliUnits(''), InvalidQuantityFormatError);
      assert.throws(() => parseDecimalToMilliUnits('0'), InvalidQuantityFormatError);
    });
  });

  describe('convertRequestedToMilliCatalogUnits', () => {
    it('converts weight dimensions correctly (KG <-> GRAM)', () => {
      // 500g of product priced in KG -> 500 milli-catalog-units (0.500 KG)
      assert.equal(convertRequestedToMilliCatalogUnits(500, 'GRAM', 'KG'), 500n);
      assert.equal(convertRequestedToMilliCatalogUnits(500, 'g', 'KG'), 500n);
      assert.equal(convertRequestedToMilliCatalogUnits(1.5, 'KG', 'KG'), 1500n);

      // 2kg of product priced in GRAM -> 2,000,000 milli-catalog-units (2,000 grams)
      assert.equal(convertRequestedToMilliCatalogUnits(2, 'KG', 'GRAM'), 2000000n);
      assert.equal(convertRequestedToMilliCatalogUnits(500, 'GRAM', 'GRAM'), 500000n);

      // Sub-gram precision (e.g. 250.5 grams) cannot be represented in whole grams for KG catalog unit
      // Must reject and return null rather than silently truncating to 250n
      assert.equal(convertRequestedToMilliCatalogUnits(250.5, 'GRAM', 'KG'), null);
      assert.equal(convertRequestedToMilliCatalogUnits(0.5, 'GRAM', 'KG'), null);
    });

    it('converts volume dimensions correctly (LITRE <-> MILLILITRE)', () => {
      // 250ml of product priced in LITRE -> 250 milli-catalog-units (0.250 L)
      assert.equal(convertRequestedToMilliCatalogUnits(250, 'MILLILITRE', 'LITRE'), 250n);
      assert.equal(convertRequestedToMilliCatalogUnits(250, 'ml', 'LITRE'), 250n);
      assert.equal(convertRequestedToMilliCatalogUnits(1.5, 'LITRE', 'LITRE'), 1500n);

      // 1.5L of product priced in MILLILITRE -> 1,500,000 milli-catalog-units (1,500 ml)
      assert.equal(convertRequestedToMilliCatalogUnits(1.5, 'LITRE', 'MILLILITRE'), 1500000n);
      assert.equal(convertRequestedToMilliCatalogUnits(250, 'MILLILITRE', 'MILLILITRE'), 250000n);

      // Sub-millilitre precision (e.g. 250.5 ml) cannot be represented in whole ml for LITRE catalog unit
      // Must reject and return null rather than silently truncating to 250n
      assert.equal(convertRequestedToMilliCatalogUnits(250.5, 'MILLILITRE', 'LITRE'), null);
      assert.equal(convertRequestedToMilliCatalogUnits(0.5, 'MILLILITRE', 'LITRE'), null);
    });

    it('handles discrete count units (PIECE, PACK, DOZEN)', () => {
      assert.equal(convertRequestedToMilliCatalogUnits(3, 'PIECE', 'PIECE'), 3000n);
      assert.equal(convertRequestedToMilliCatalogUnits(2, 'PACK', 'PACK'), 2000n);
      assert.equal(convertRequestedToMilliCatalogUnits(1, 'DOZEN', 'DOZEN'), 1000n);

      // Fractional discrete pieces or packs fail closed
      assert.equal(convertRequestedToMilliCatalogUnits(1.5, 'PIECE', 'PIECE'), null);
      assert.equal(convertRequestedToMilliCatalogUnits(0.5, 'PACK', 'PACK'), null);

      // Clean half-dozen conversion (6 pieces = 0.5 dozen = 500 milli-dozen)
      assert.equal(convertRequestedToMilliCatalogUnits(6, 'PIECE', 'DOZEN'), 500n);
      assert.equal(convertRequestedToMilliCatalogUnits(12, 'PIECE', 'DOZEN'), 1000n);

      // Indivisible pieces (e.g. 5 eggs) fail closed pending owner pricing policy
      assert.equal(convertRequestedToMilliCatalogUnits(5, 'PIECE', 'DOZEN'), null);
    });

    it('fails closed for incompatible dimensions', () => {
      assert.equal(convertRequestedToMilliCatalogUnits(500, 'GRAM', 'PIECE'), null);
      assert.equal(convertRequestedToMilliCatalogUnits(1, 'LITRE', 'PACK'), null);
      assert.equal(convertRequestedToMilliCatalogUnits(2, 'PIECE', 'KG'), null);
    });
  });

  describe('calculateLineTotalMinor & Half-Up Rounding', () => {
    it('calculates exact line total for weight-based products without precision loss', () => {
      // 500g of Basmati Rice @ ₹120.00 (12000 paise/kg) -> ₹60.00 (6000 paise)
      const total1 = calculateLineTotalMinor(12000, 500n);
      assert.equal(total1, 6000);

      // 1.5kg @ ₹120.00/kg -> ₹180.00 (18000 paise)
      const total2 = calculateLineTotalMinor(12000, 1500n);
      assert.equal(total2, 18000);
    });

    it('applies deterministic half-up rounding for odd fractional quantities', () => {
      // 333g @ ₹10.00 (1000 paise/kg) -> 333 paise (333.5 rounds to 333 paise)
      const total = calculateLineTotalMinor(1000, 333n);
      assert.equal(total, 333);
    });

    it('calculates volume-based line totals accurately', () => {
      // 1.5L @ ₹66.00 (6600 paise/L) -> ₹99.00 (9900 paise)
      const total = calculateLineTotalMinor(6600, 1500n);
      assert.equal(total, 9900);

      // 250ml @ ₹66.00 (6600 paise/L) -> ₹16.50 (1650 paise)
      const total2 = calculateLineTotalMinor(6600, 250n);
      assert.equal(total2, 1650);
    });
  });

  describe('assertSafePostgresInt Bounds Checking', () => {
    it('accepts valid integers within PostgreSQL 32-bit INT range', () => {
      assert.equal(assertSafePostgresInt(0, 'subtotal'), 0);
      assert.equal(assertSafePostgresInt(10000, 'subtotal'), 10000);
      assert.equal(assertSafePostgresInt(POSTGRES_INT_MAX, 'subtotal'), POSTGRES_INT_MAX);
    });

    it('throws ArithmeticOverflowError on overflow or negative values', () => {
      assert.throws(
        () => assertSafePostgresInt(POSTGRES_INT_MAX + 1, 'subtotal'),
        ArithmeticOverflowError,
      );
      assert.throws(() => assertSafePostgresInt(-1, 'subtotal'), ArithmeticOverflowError);
    });
  });
});
