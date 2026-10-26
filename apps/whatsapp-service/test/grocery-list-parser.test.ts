import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DeterministicGroceryParser } from '../dist/index.js';
import { ParsedGroceryItemSchema, GroceryListParseResultSchema } from '@grocery/api-contracts';

describe('Deterministic Grocery List Parser', () => {
  const parser = new DeterministicGroceryParser();

  it('correctly parses the 8 canonical items from the product directive', () => {
    const rawMessage = `
Hi, here is my grocery order:
1. 1kg sugar
2. 2 packs of 500g butter
3. amul taaza milk 500ml
4. large sandwich bread
5. Hair and Care shampoo 200 gms
6. Lux soap 2 bars
7. Tata salt 1kg
8. Aashirvaad atta 5kg
Thank you!
    `.trim();

    const result = parser.parse(rawMessage);

    // Schema validation
    assert.doesNotThrow(() => GroceryListParseResultSchema.parse(result));
    assert.equal(result.items.length, 8);
    assert.equal(result.hasAmbiguity, true); // items 4 (bread) and 5 (shampoo) trigger ambiguity/incompatibility

    // Item 1: 1kg sugar
    const item1 = result.items[0]!;
    assert.equal(item1.rawText, '1kg sugar');
    assert.equal(item1.brand, null);
    assert.equal(item1.productName, 'sugar');
    assert.equal(item1.originalQuantity, 1);
    assert.equal(item1.originalUnit, 'KG');
    assert.equal(item1.normalizedQuantity, 1);
    assert.equal(item1.normalizedUnit, 'KG');
    assert.equal(item1.requestedPackCount, null);
    assert.equal(item1.packageSize, null);
    assert.equal(item1.confidence, 'EXACT');

    // Item 2: 2 packs of 500g butter (Strict separation of pack count vs package size)
    const item2 = result.items[1]!;
    assert.equal(item2.rawText, '2 packs of 500g butter');
    assert.equal(item2.brand, null);
    assert.equal(item2.productName, 'butter');
    assert.equal(item2.originalQuantity, 2);
    assert.equal(item2.originalUnit, 'PACK');
    assert.equal(item2.requestedPackCount, 2);
    assert.deepEqual(item2.packageSize, { amount: 500, unit: 'G' });
    // Total: 2 * 500g = 1000g = 1.0 KG
    assert.equal(item2.normalizedQuantity, 1.0);
    assert.equal(item2.normalizedUnit, 'KG');
    assert.equal(item2.confidence, 'EXACT');

    // Item 3: amul taaza milk 500ml
    const item3 = result.items[2]!;
    assert.equal(item3.rawText, 'amul taaza milk 500ml');
    assert.equal(item3.brand, 'Amul');
    assert.equal(item3.productName, 'taaza milk');
    assert.equal(item3.originalQuantity, 500);
    assert.equal(item3.originalUnit, 'ML');
    assert.equal(item3.normalizedQuantity, 500);
    assert.equal(item3.normalizedUnit, 'ML');
    assert.equal(item3.confidence, 'EXACT');

    // Item 4: large sandwich bread (Ambiguous: no quantity specified)
    const item4 = result.items[3]!;
    assert.equal(item4.rawText, 'large sandwich bread');
    assert.equal(item4.brand, null);
    assert.equal(item4.productName, 'large sandwich bread');
    assert.equal(item4.originalQuantity, null);
    assert.equal(item4.confidence, 'AMBIGUOUS');
    assert.ok(item4.ambiguityReasons.length > 0);
    assert.match(item4.ambiguityReasons[0]!, /No explicit quantity or unit/);

    // Item 5: Hair and Care shampoo 200 gms (Incompatible: shampoo is liquid, mass unit gms requested)
    const item5 = result.items[4]!;
    assert.equal(item5.rawText, 'Hair and Care shampoo 200 gms');
    assert.equal(item5.brand, 'Hair and Care');
    assert.equal(item5.productName, 'shampoo');
    assert.equal(item5.originalQuantity, 200);
    assert.equal(item5.originalUnit, 'G');
    // Dimension invariant: mass normalized ONLY to mass (never converted to ML!)
    assert.equal(item5.normalizedQuantity, 200);
    assert.equal(item5.normalizedUnit, 'G');
    assert.equal(item5.confidence, 'INCOMPATIBLE');
    assert.ok(item5.ambiguityReasons.some((r) => r.includes('typically a liquid')));

    // Item 6: Lux soap 2 bars
    const item6 = result.items[5]!;
    assert.equal(item6.rawText, 'Lux soap 2 bars');
    assert.equal(item6.brand, 'Lux');
    assert.equal(item6.productName, 'soap');
    assert.equal(item6.originalQuantity, 2);
    assert.equal(item6.originalUnit, 'PIECE');
    assert.equal(item6.requestedPackCount, 2);
    assert.equal(item6.normalizedQuantity, 2);
    assert.equal(item6.normalizedUnit, 'PIECE');
    assert.equal(item6.confidence, 'EXACT');

    // Item 7: Tata salt 1kg
    const item7 = result.items[6]!;
    assert.equal(item7.rawText, 'Tata salt 1kg');
    assert.equal(item7.brand, 'Tata');
    assert.equal(item7.productName, 'salt');
    assert.equal(item7.originalQuantity, 1);
    assert.equal(item7.originalUnit, 'KG');
    assert.equal(item7.normalizedQuantity, 1);
    assert.equal(item7.normalizedUnit, 'KG');
    assert.equal(item7.confidence, 'EXACT');

    // Item 8: Aashirvaad atta 5kg
    const item8 = result.items[7]!;
    assert.equal(item8.rawText, 'Aashirvaad atta 5kg');
    assert.equal(item8.brand, 'Aashirvaad');
    assert.equal(item8.productName, 'atta');
    assert.equal(item8.originalQuantity, 5);
    assert.equal(item8.originalUnit, 'KG');
    assert.equal(item8.normalizedQuantity, 5);
    assert.equal(item8.normalizedUnit, 'KG');
    assert.equal(item8.confidence, 'EXACT');
  });

  describe('Quantity Semantics & Pack Count vs Package Size Invariants', () => {
    it('distinguishes pack count from individual pack size in "3 packets of 1kg sugar"', () => {
      const item = parser.parseSingleItemLine('3 packets of 1kg sugar');
      assert.equal(item.requestedPackCount, 3);
      assert.deepEqual(item.packageSize, { amount: 1, unit: 'KG' });
      assert.equal(item.normalizedQuantity, 3);
      assert.equal(item.normalizedUnit, 'KG');
      assert.equal(item.confidence, 'EXACT');
    });

    it('handles inverted format "500g x 2 butter"', () => {
      const item = parser.parseSingleItemLine('500g x 2 butter');
      assert.equal(item.requestedPackCount, 2);
      assert.deepEqual(item.packageSize, { amount: 500, unit: 'G' });
      assert.equal(item.normalizedQuantity, 1.0);
      assert.equal(item.normalizedUnit, 'KG');
      assert.equal(item.confidence, 'EXACT');
    });

    it('preserves customer raw text byte-for-byte in all cases', () => {
      const input = '   2   packs of   500g   butter   ';
      const item = parser.parseSingleItemLine(input);
      assert.equal(item.rawText, input);
    });
  });

  describe('Dimension Normalization & Incompatibility Detection', () => {
    it('normalizes mass strictly to mass (G to KG when >= 1000g)', () => {
      const item = parser.parseSingleItemLine('1500g rice');
      assert.equal(item.normalizedQuantity, 1.5);
      assert.equal(item.normalizedUnit, 'KG');
      assert.equal(item.confidence, 'EXACT');
    });

    it('keeps mass in G when < 1000g', () => {
      const item = parser.parseSingleItemLine('250g paneer');
      assert.equal(item.normalizedQuantity, 250);
      assert.equal(item.normalizedUnit, 'G');
      assert.equal(item.confidence, 'EXACT');
    });

    it('normalizes volume strictly to volume (ML to L when >= 1000ml)', () => {
      const item = parser.parseSingleItemLine('2000ml juice');
      assert.equal(item.normalizedQuantity, 2);
      assert.equal(item.normalizedUnit, 'L');
      assert.equal(item.confidence, 'EXACT');
    });

    it('flags solid goods requested in volume units as INCOMPATIBLE without silent conversion', () => {
      const item = parser.parseSingleItemLine('sugar 500 ml');
      assert.equal(item.confidence, 'INCOMPATIBLE');
      assert.equal(item.normalizedQuantity, 500);
      assert.equal(item.normalizedUnit, 'ML'); // Preserved in volume, NOT converted to grams!
      assert.ok(item.ambiguityReasons.some((r) => r.includes('typically a dry good')));
    });

    it('flags liquid goods requested in mass units as INCOMPATIBLE without silent conversion', () => {
      const item = parser.parseSingleItemLine('cooking oil 1kg');
      assert.equal(item.confidence, 'INCOMPATIBLE');
      assert.equal(item.normalizedQuantity, 1);
      assert.equal(item.normalizedUnit, 'KG'); // Preserved in mass, NOT converted to litres!
      assert.ok(item.ambiguityReasons.some((r) => r.includes('typically a liquid')));
    });
  });

  describe('List Formatting & Delimiter Handling', () => {
    it('handles comma-separated grocery lists on a single line', () => {
      const result = parser.parse('1kg sugar, amul milk 500ml, 2 bars of soap');
      assert.equal(result.items.length, 3);
      assert.equal(result.items[0]!.productName, 'sugar');
      assert.equal(result.items[1]!.productName, 'milk');
      assert.equal(result.items[2]!.productName, 'soap');
    });

    it('handles bulleted and hyphenated lists', () => {
      const result = parser.parse(`
- 1kg sugar
* 500ml milk
• 2 packs of 500g butter
      `);
      assert.equal(result.items.length, 3);
      assert.equal(result.items[0]!.productName, 'sugar');
      assert.equal(result.items[1]!.productName, 'milk');
      assert.equal(result.items[2]!.productName, 'butter');
    });

    it('ignores empty input or non-grocery conversation gracefully', () => {
      const emptyResult = parser.parse('');
      assert.equal(emptyResult.items.length, 0);

      const greetingOnlyResult = parser.parse('Hello, good morning! How are you?');
      assert.equal(greetingOnlyResult.items.length, 0);
    });
  });

  describe('Contract Strictness', () => {
    it('ensures all output strictly adheres to Zod ParsedGroceryItemSchema', () => {
      const result = parser.parse('1kg sugar, 2 packs of 500g butter, large sandwich bread');
      for (const item of result.items) {
        const validated = ParsedGroceryItemSchema.safeParse(item);
        assert.equal(validated.success, true);
      }
    });
  });
});
