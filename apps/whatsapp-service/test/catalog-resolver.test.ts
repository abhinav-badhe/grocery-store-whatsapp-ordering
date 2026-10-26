import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Product, StockBalance, ParsedGroceryItem } from '@grocery/api-contracts';
import {
  CatalogResolver,
  type CatalogLookupClient,
  type InventoryLookupClient,
} from '../dist/index.js';

class MockCatalogClient implements CatalogLookupClient {
  public products: Product[] = [];

  async searchProducts(_storeId: string, searchTerm: string): Promise<Product[]> {
    const term = searchTerm.toLowerCase();
    return this.products.filter(
      (p) => p.name.toLowerCase().includes(term) || term.includes(p.name.toLowerCase()),
    );
  }

  async getProductById(_storeId: string, productId: string): Promise<Product | null> {
    return this.products.find((p) => p.id === productId) ?? null;
  }
}

class MockInventoryClient implements InventoryLookupClient {
  public balances: Map<string, number> = new Map();

  async getStockBalance(storeId: string, productId: string): Promise<StockBalance | null> {
    const avail = this.balances.get(productId);
    if (avail === undefined) {
      return null;
    }
    return {
      id: '00000000-0000-4000-8000-000000000001',
      storeId,
      productId,
      sku: 'SKU-1',
      onHandQuantity: avail,
      reservedQuantity: 0,
      availableQuantity: avail,
      reorderPoint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

describe('Catalog & Stock Resolver (Subphase 2)', () => {
  const storeId = '00000000-0000-4000-8000-000000000001';

  function createItem(overrides: Partial<ParsedGroceryItem>): ParsedGroceryItem {
    return {
      rawText: 'test item',
      brand: null,
      productName: 'test product',
      originalQuantity: 1,
      originalUnit: null,
      normalizedQuantity: 1,
      normalizedUnit: null,
      requestedPackCount: null,
      packageSize: null,
      confidence: 'EXACT',
      ambiguityReasons: [],
      ...overrides,
    };
  }

  it('resolves an exact single product match with sufficient stock', async () => {
    const catalog = new MockCatalogClient();
    const inventory = new MockInventoryClient();
    const resolver = new CatalogResolver({ catalogClient: catalog, inventoryClient: inventory });

    const prod: Product = {
      id: '11111111-1111-4111-8111-111111111111',
      storeId,
      name: 'Basmati Rice',
      slug: 'basmati-rice',
      sku: 'RICE-01',
      priceCents: 12000,
      currency: 'INR',
      unit: 'KG',
      isWeightBased: true,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    catalog.products = [prod];
    inventory.balances.set(prod.id, 10); // 10 kg available

    const item = createItem({
      rawText: '500g Basmati Rice',
      productName: 'Basmati Rice',
      originalQuantity: 500,
      originalUnit: 'g',
      normalizedQuantity: 500,
      normalizedUnit: 'G',
    });

    const [result] = await resolver.resolveItems(storeId, [item]);

    assert.ok(result);
    assert.equal(result.outcome, 'EXACT_MATCH');
    assert.equal(result.matchedProduct?.id, prod.id);
    assert.equal(result.quantityMilliCatalogUnits, '500'); // 500 milli-kg
    assert.equal(result.unitPriceCents, 12000);
    assert.equal(result.lineTotalCents, 6000); // ₹60.00
  });

  it('flags NO_MATCH when catalog search returns zero products', async () => {
    const catalog = new MockCatalogClient();
    const inventory = new MockInventoryClient();
    const resolver = new CatalogResolver({ catalogClient: catalog, inventoryClient: inventory });

    const item = createItem({
      rawText: 'dragon fruit',
      productName: 'Dragon Fruit',
    });

    const [result] = await resolver.resolveItems(storeId, [item]);
    assert.ok(result);
    assert.equal(result.outcome, 'NO_MATCH');
    assert.equal(result.matchedProduct, null);
    assert.equal(result.lineTotalCents, null);
  });

  it('flags AMBIGUOUS_OPTIONS when multiple distinct matching products exist', async () => {
    const catalog = new MockCatalogClient();
    const inventory = new MockInventoryClient();
    const resolver = new CatalogResolver({ catalogClient: catalog, inventoryClient: inventory });

    catalog.products = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        storeId,
        name: 'Amul Butter 100g',
        slug: 'amul-butter-100g',
        sku: 'AMUL-100',
        priceCents: 5600,
        currency: 'INR',
        unit: 'PACK',
        isWeightBased: false,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        storeId,
        name: 'Amul Butter 500g',
        slug: 'amul-butter-500g',
        sku: 'AMUL-500',
        priceCents: 27500,
        currency: 'INR',
        unit: 'PACK',
        isWeightBased: false,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const item = createItem({
      rawText: 'butter',
      productName: 'Butter',
    });

    const [result] = await resolver.resolveItems(storeId, [item]);
    assert.ok(result);
    assert.equal(result.outcome, 'AMBIGUOUS_OPTIONS');
    assert.equal(result.candidates.length, 2);
    assert.equal(result.matchedProduct, null);
    assert.equal(result.lineTotalCents, null);
  });

  it('flags OUT_OF_STOCK when available stock is zero', async () => {
    const catalog = new MockCatalogClient();
    const inventory = new MockInventoryClient();
    const resolver = new CatalogResolver({ catalogClient: catalog, inventoryClient: inventory });

    const prod: Product = {
      id: '11111111-1111-4111-8111-111111111111',
      storeId,
      name: 'Sunflower Oil 1L',
      slug: 'sunflower-oil-1l',
      sku: 'OIL-01',
      priceCents: 15000,
      currency: 'INR',
      unit: 'LITRE',
      isWeightBased: false,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    catalog.products = [prod];
    inventory.balances.set(prod.id, 0); // 0 in stock

    const item = createItem({
      rawText: '1L Sunflower Oil',
      productName: 'Sunflower Oil',
      originalQuantity: 1,
      originalUnit: 'L',
      normalizedQuantity: 1,
      normalizedUnit: 'L',
    });

    const [result] = await resolver.resolveItems(storeId, [item]);
    assert.ok(result);
    assert.equal(result.outcome, 'OUT_OF_STOCK');
    assert.equal(result.lineTotalCents, null);
  });

  it('flags INSUFFICIENT_STOCK when requested quantity exceeds available stock', async () => {
    const catalog = new MockCatalogClient();
    const inventory = new MockInventoryClient();
    const resolver = new CatalogResolver({ catalogClient: catalog, inventoryClient: inventory });

    const prod: Product = {
      id: '11111111-1111-4111-8111-111111111111',
      storeId,
      name: 'Sugar',
      slug: 'sugar',
      sku: 'SUGAR-01',
      priceCents: 4500,
      currency: 'INR',
      unit: 'KG',
      isWeightBased: true,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    catalog.products = [prod];
    inventory.balances.set(prod.id, 2); // only 2kg available

    const item = createItem({
      rawText: '5kg Sugar',
      productName: 'Sugar',
      originalQuantity: 5,
      originalUnit: 'kg',
      normalizedQuantity: 5,
      normalizedUnit: 'KG',
    });

    const [result] = await resolver.resolveItems(storeId, [item]);
    assert.ok(result);
    assert.equal(result.outcome, 'INSUFFICIENT_STOCK');
    assert.equal(result.lineTotalCents, null);
  });

  it('flags FRACTIONAL_NOT_AUTHORIZED when fractional quantity requested on discrete unit', async () => {
    const catalog = new MockCatalogClient();
    const inventory = new MockInventoryClient();
    const resolver = new CatalogResolver({ catalogClient: catalog, inventoryClient: inventory });

    const prod: Product = {
      id: '11111111-1111-4111-8111-111111111111',
      storeId,
      name: 'Bread',
      slug: 'bread',
      sku: 'BREAD-01',
      priceCents: 4000,
      currency: 'INR',
      unit: 'PACK',
      isWeightBased: false,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    catalog.products = [prod];
    inventory.balances.set(prod.id, 10);

    const item = createItem({
      rawText: '0.5 pack bread',
      productName: 'Bread',
      originalQuantity: 0.5,
      originalUnit: 'pack',
      normalizedQuantity: 0.5,
      normalizedUnit: 'PACK',
    });

    const [result] = await resolver.resolveItems(storeId, [item]);
    assert.ok(result);
    assert.equal(result.outcome, 'FRACTIONAL_NOT_AUTHORIZED');
    assert.equal(result.lineTotalCents, null);
  });

  it('flags PACKAGE_SIZE_MISMATCH when continuous weight requested against discrete pack unit', async () => {
    const catalog = new MockCatalogClient();
    const inventory = new MockInventoryClient();
    const resolver = new CatalogResolver({ catalogClient: catalog, inventoryClient: inventory });

    const prod: Product = {
      id: '11111111-1111-4111-8111-111111111111',
      storeId,
      name: 'Aashirvaad Atta 5kg',
      slug: 'aashirvaad-atta-5kg',
      sku: 'ATTA-05',
      priceCents: 25000,
      currency: 'INR',
      unit: 'PACK',
      isWeightBased: false,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    catalog.products = [prod];
    inventory.balances.set(prod.id, 10);

    const item = createItem({
      rawText: '2kg atta',
      productName: 'Aashirvaad Atta 5kg',
      originalQuantity: 2,
      originalUnit: 'kg',
      normalizedQuantity: 2,
      normalizedUnit: 'KG',
    });

    const [result] = await resolver.resolveItems(storeId, [item]);
    assert.ok(result);
    assert.equal(result.outcome, 'PACKAGE_SIZE_MISMATCH');
    assert.equal(result.lineTotalCents, null);
  });
});
