import type {
  ParsedGroceryItem,
  ResolvedQuoteItem,
  CatalogCandidateProduct,
  CatalogMatchOutcome,
} from '@grocery/api-contracts';
import type { CatalogLookupClient } from '../clients/catalog-client.js';
import type { InventoryLookupClient } from '../clients/inventory-client.js';
import {
  convertRequestedToMilliCatalogUnits,
  calculateLineTotalMinor,
  parseDecimalToMilliUnits,
} from '../quote/money.js';

export interface CatalogResolverOptions {
  readonly catalogClient: CatalogLookupClient;
  readonly inventoryClient: InventoryLookupClient;
}

export class CatalogResolver {
  constructor(private readonly options: CatalogResolverOptions) {}

  /**
   * Resolves a batch of parsed grocery items against a store's catalog and inventory.
   * Fails closed: never guesses brands, package sizes, or prices.
   */
  async resolveItems(
    storeId: string,
    items: readonly ParsedGroceryItem[],
  ): Promise<ResolvedQuoteItem[]> {
    const resolved: ResolvedQuoteItem[] = [];

    for (const item of items) {
      const resolvedItem = await this.resolveSingleItem(storeId, item);
      resolved.push(resolvedItem);
    }

    return resolved;
  }

  private async resolveSingleItem(
    storeId: string,
    item: ParsedGroceryItem,
  ): Promise<ResolvedQuoteItem> {
    const searchTerm = item.brand ? `${item.brand} ${item.productName}` : item.productName;

    let products = await this.options.catalogClient.searchProducts(storeId, searchTerm, 5);

    // Fallback: if search with brand returned 0 results, try product name alone
    if (products.length === 0 && item.brand) {
      products = await this.options.catalogClient.searchProducts(storeId, item.productName, 5);
    }

    if (products.length === 0) {
      return {
        rawText: item.rawText,
        productName: item.productName,
        requestedQuantity: item.normalizedQuantity ?? item.originalQuantity,
        requestedUnit: item.normalizedUnit ?? item.originalUnit,
        outcome: 'NO_MATCH',
        matchedProduct: null,
        candidates: [],
        quantityMilliCatalogUnits: null,
        unitPriceCents: null,
        lineTotalCents: null,
        notes: `No matching product found for '${item.productName}' in store catalog`,
      };
    }

    // Enrich products with real-time stock balances
    const candidateList: CatalogCandidateProduct[] = [];
    for (const prod of products) {
      const stock = await this.options.inventoryClient.getStockBalance(storeId, prod.id);
      candidateList.push({
        id: prod.id,
        storeId: prod.storeId,
        name: prod.name,
        sku: prod.sku ?? null,
        priceCents: prod.priceCents,
        currency: prod.currency,
        unit: prod.unit,
        isWeightBased: prod.isWeightBased,
        availableQuantity: stock ? Number(stock.availableQuantity) : 0,
      });
    }

    // If customer specified a requested pack size or discrete pack, but product name has multiple sizes
    if (candidateList.length > 1) {
      // Check if one candidate is an exact case-insensitive name match
      const exactNameMatches = candidateList.filter(
        (c) =>
          c.name.toLowerCase() === item.productName.toLowerCase() ||
          c.name.toLowerCase() === searchTerm.toLowerCase(),
      );

      if (exactNameMatches.length === 1 && exactNameMatches[0]) {
        return this.evaluateCandidate(item, exactNameMatches[0], candidateList);
      }

      return {
        rawText: item.rawText,
        productName: item.productName,
        requestedQuantity: item.normalizedQuantity ?? item.originalQuantity,
        requestedUnit: item.normalizedUnit ?? item.originalUnit,
        outcome: 'AMBIGUOUS_OPTIONS',
        matchedProduct: null,
        candidates: candidateList,
        quantityMilliCatalogUnits: null,
        unitPriceCents: null,
        lineTotalCents: null,
        notes: `Found ${candidateList.length} matching options for '${item.productName}'. Clarification needed.`,
      };
    }

    const candidate = candidateList[0];
    if (!candidate) {
      return {
        rawText: item.rawText,
        productName: item.productName,
        requestedQuantity: item.normalizedQuantity ?? item.originalQuantity,
        requestedUnit: item.normalizedUnit ?? item.originalUnit,
        outcome: 'NO_MATCH',
        matchedProduct: null,
        candidates: [],
        quantityMilliCatalogUnits: null,
        unitPriceCents: null,
        lineTotalCents: null,
        notes: `Product '${item.productName}' could not be resolved`,
      };
    }

    return this.evaluateCandidate(item, candidate, candidateList);
  }

  private evaluateCandidate(
    item: ParsedGroceryItem,
    candidate: CatalogCandidateProduct,
    candidates: CatalogCandidateProduct[],
  ): ResolvedQuoteItem {
    const rawQty = item.normalizedQuantity ?? item.originalQuantity ?? 1;
    const rawUnit = item.normalizedUnit ?? item.originalUnit ?? candidate.unit;

    // Check unit compatibility and convert to integer milli-catalog-units
    const milliUnits = convertRequestedToMilliCatalogUnits(rawQty, rawUnit, candidate.unit);

    if (milliUnits === null) {
      // Determine reason for failure
      let outcome: CatalogMatchOutcome = 'UNIT_INCOMPATIBLE';
      let note = `Requested unit '${rawUnit}' is incompatible with catalog unit '${candidate.unit}'`;

      if (['PACK', 'PIECE', 'DOZEN'].includes(candidate.unit)) {
        if (!Number.isInteger(rawQty)) {
          outcome = 'FRACTIONAL_NOT_AUTHORIZED';
          note = `Fractional sale is not authorized for indivisible unit '${candidate.unit}'`;
        } else if (['KG', 'GRAM', 'LITRE', 'MILLILITRE'].includes(rawUnit.toUpperCase())) {
          outcome = 'PACKAGE_SIZE_MISMATCH';
          note = `Cannot sell measure quantity '${rawQty} ${rawUnit}' against fixed packaged unit '${candidate.unit}' without verified package size`;
        }
      }

      return {
        rawText: item.rawText,
        productName: item.productName,
        requestedQuantity: rawQty,
        requestedUnit: rawUnit,
        outcome,
        matchedProduct: candidate,
        candidates,
        quantityMilliCatalogUnits: null,
        unitPriceCents: candidate.priceCents,
        lineTotalCents: null,
        notes: note,
      };
    }

    // Check stock availability
    if (candidate.availableQuantity <= 0) {
      return {
        rawText: item.rawText,
        productName: item.productName,
        requestedQuantity: rawQty,
        requestedUnit: rawUnit,
        outcome: 'OUT_OF_STOCK',
        matchedProduct: candidate,
        candidates,
        quantityMilliCatalogUnits: milliUnits.toString(),
        unitPriceCents: candidate.priceCents,
        lineTotalCents: null,
        notes: `'${candidate.name}' is currently out of stock`,
      };
    }

    // Convert candidate available stock to milli-catalog-units for exact integer comparison
    const availableMilliUnits = parseDecimalToMilliUnits(candidate.availableQuantity.toFixed(3));
    if (milliUnits > availableMilliUnits) {
      return {
        rawText: item.rawText,
        productName: item.productName,
        requestedQuantity: rawQty,
        requestedUnit: rawUnit,
        outcome: 'INSUFFICIENT_STOCK',
        matchedProduct: candidate,
        candidates,
        quantityMilliCatalogUnits: milliUnits.toString(),
        unitPriceCents: candidate.priceCents,
        lineTotalCents: null,
        notes: `Requested quantity exceeds available stock (${candidate.availableQuantity} ${candidate.unit} available)`,
      };
    }

    // Calculate line total in currency minor units (paise)
    const lineTotal = calculateLineTotalMinor(candidate.priceCents, milliUnits);

    return {
      rawText: item.rawText,
      productName: item.productName,
      requestedQuantity: rawQty,
      requestedUnit: rawUnit,
      outcome: 'EXACT_MATCH',
      matchedProduct: candidate,
      candidates,
      quantityMilliCatalogUnits: milliUnits.toString(),
      unitPriceCents: candidate.priceCents,
      lineTotalCents: lineTotal,
      notes: null,
    };
  }
}
