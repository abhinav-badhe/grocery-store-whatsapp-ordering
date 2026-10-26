import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { type ResolvedQuoteItem, ProvisionalQuoteSnapshotSchema } from '@grocery/api-contracts';
import { QuoteGenerator, DEFAULT_QUOTE_TTL_SECONDS } from '../dist/index.js';

describe('Quote Generator (Subphase 2)', () => {
  const storeId = '00000000-0000-4000-8000-000000000001';
  const conversationId = '22222222-2222-4222-8222-222222222222';

  it('generates a provisional quote with isPayable = false and unpriced items flag', () => {
    const items: ResolvedQuoteItem[] = [
      {
        rawText: '500g Basmati Rice',
        productName: 'Basmati Rice',
        requestedQuantity: 500,
        requestedUnit: 'g',
        outcome: 'EXACT_MATCH',
        matchedProduct: {
          id: '11111111-1111-4111-8111-111111111111',
          storeId,
          name: 'Basmati Rice',
          sku: 'RICE-01',
          priceCents: 12000,
          currency: 'INR',
          unit: 'KG',
          isWeightBased: true,
          availableQuantity: 10,
        },
        candidates: [],
        quantityMilliCatalogUnits: '500',
        unitPriceCents: 12000,
        lineTotalCents: 6000,
        notes: null,
      },
      {
        rawText: '1L Sunflower Oil',
        productName: 'Sunflower Oil',
        requestedQuantity: 1,
        requestedUnit: 'L',
        outcome: 'OUT_OF_STOCK',
        matchedProduct: null,
        candidates: [],
        quantityMilliCatalogUnits: null,
        unitPriceCents: 15000,
        lineTotalCents: null,
        notes: 'Out of stock',
      },
    ];

    const snapshot = QuoteGenerator.generateProvisionalQuote({
      storeId,
      conversationId,
      quoteVersion: 1,
      items,
      ttlSeconds: 600,
    });

    assert.equal(snapshot.isPayable, false);
    assert.equal(snapshot.finalizationStatus, 'PROVISIONAL_PENDING_REVIEW');
    assert.equal(snapshot.hasUnpricedItems, true);
    assert.equal(snapshot.knownSubtotalMinor, 6000); // Only the priced item
    assert.equal(snapshot.taxMinor, 0);
    assert.equal(snapshot.deliveryMinor, 0);
    assert.equal(snapshot.estimatedTotalMinor, 6000);
    assert.ok(snapshot.unresolvedCharges.includes('TAX_POLICY_UNRESOLVED'));
    assert.ok(snapshot.unresolvedCharges.includes('DELIVERY_FEE_UNRESOLVED'));
    assert.ok(snapshot.unresolvedCharges.includes('ITEMS_REQUIRING_CLARIFICATION'));
    assert.ok(snapshot.disclaimer.includes('Provisional estimate'));
  });

  it('formats a clean WhatsApp customer summary text', () => {
    const items: ResolvedQuoteItem[] = [
      {
        rawText: '500g Basmati Rice',
        productName: 'Basmati Rice',
        requestedQuantity: 500,
        requestedUnit: 'g',
        outcome: 'EXACT_MATCH',
        matchedProduct: null,
        candidates: [],
        quantityMilliCatalogUnits: '500',
        unitPriceCents: 12000,
        lineTotalCents: 6000,
        notes: null,
      },
    ];

    const snapshot = QuoteGenerator.generateProvisionalQuote({
      storeId,
      conversationId,
      quoteVersion: 1,
      items,
    });

    const summary = QuoteGenerator.formatCustomerSummary(snapshot);
    assert.ok(summary.includes('Estimated Grocery Quote'));
    assert.ok(summary.includes('Basmati Rice'));
    assert.ok(summary.includes('₹60.00'));
    assert.ok(summary.includes('CONFIRM'));
  });

  it('strictly rejects any quote snapshot configured with isPayable: true', () => {
    const validSnapshot = QuoteGenerator.generateProvisionalQuote({
      storeId,
      conversationId,
      quoteVersion: 1,
      items: [],
    });

    assert.equal(validSnapshot.isPayable, false);

    // Attempting to pass isPayable: true must throw validation error
    const forgedSnapshot = {
      ...validSnapshot,
      isPayable: true,
    };

    assert.throws(() => {
      ProvisionalQuoteSnapshotSchema.parse(forgedSnapshot);
    });
  });
});
