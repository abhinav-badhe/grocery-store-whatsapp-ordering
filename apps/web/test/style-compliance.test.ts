import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderStorefrontHtml } from '../dist/storefront/ui-template.js';
import { renderShopkeeperConsoleHtml } from '../dist/storefront/admin-template.js';

describe('Frontend UI Style Guide Compliance (STYLE.md)', () => {
  const mockStoreData = {
    storeName: 'FreshMart Organics',
    storeId: '550e8400-e29b-41d4-a716-446655440000',
    phone: '+919876543210',
    address: '123 MG Road, Bengaluru',
    categories: [
      { id: 'cat-produce', name: 'Fresh Produce' },
      { id: 'cat-dairy', name: 'Dairy & Eggs' },
    ],
    products: [
      {
        id: 'prod-tomato',
        name: 'Organic Tomatoes',
        priceCents: 4500,
        unit: 'KG',
      },
    ],
  };

  const mockAdminData = {
    storeName: 'FreshMart Organics',
    storeId: '550e8400-e29b-41d4-a716-446655440000',
    phone: '+919876543210',
    currency: 'INR',
    orders: [
      {
        id: 'ord-1',
        orderNumber: 'ORD-2026-001',
        customerName: 'Rahul Sharma',
        customerPhone: '+919876543210',
        deliveryAddress: 'Flat 402, Green Heights',
        channel: 'STOREFRONT' as const,
        status: 'AWAITING_SHOPKEEPER_REVIEW' as const,
        createdAt: new Date().toISOString(),
        items: [
          {
            id: 'item-1',
            productId: 'prod-tomato',
            productName: 'Organic Tomatoes',
            quantity: 1,
            unit: 'KG',
            unitPriceCents: 4500,
            totalPriceCents: 4500,
          },
        ],
        subtotalCents: 4500,
        taxCents: 225,
        deliveryFeeCents: 0,
        totalCents: 4725,
        paymentStatus: 'UNPAID' as const,
      },
    ],
    inventory: [
      {
        productId: 'prod-tomato',
        productName: 'Organic Tomatoes',
        category: 'Produce',
        unit: 'KG',
        onHand: 50,
        reserved: 5,
        available: 45,
        reorderLevel: 10,
        unitPriceCents: 4500,
      },
    ],
  };

  it('prohibits marketing fluff, slogans, and filler adjectives in product UI (§5)', () => {
    const storefrontHtml = renderStorefrontHtml(mockStoreData);
    const adminHtml = renderShopkeeperConsoleHtml(mockAdminData);

    const forbiddenWords = [
      'Rapid 20-minute local delivery',
      'Empower your team',
      'seamless',
      'innovative',
      'cutting-edge',
      'revolutionary',
      'effortless',
    ];

    for (const word of forbiddenWords) {
      assert.equal(
        storefrontHtml.toLowerCase().includes(word.toLowerCase()),
        false,
        `Storefront HTML should not contain marketing slogan/filler '${word}'`,
      );
      assert.equal(
        adminHtml.toLowerCase().includes(word.toLowerCase()),
        false,
        `Admin HTML should not contain marketing slogan/filler '${word}'`,
      );
    }
  });

  it('enforces capped radius (8-12px) and hairline border elevation without diffuse heavy shadows (§4.2)', () => {
    const storefrontHtml = renderStorefrontHtml(mockStoreData);
    const adminHtml = renderShopkeeperConsoleHtml(mockAdminData);

    // No heavy drop shadows
    assert.equal(storefrontHtml.includes('shadow-2xl'), false);
    assert.equal(storefrontHtml.includes('0 20px 25px'), false);
    assert.equal(adminHtml.includes('0 20px 25px'), false);

    // Uses hairline border and radius token
    assert.ok(storefrontHtml.includes('--radius: 8px'));
    assert.ok(adminHtml.includes('--radius: 8px'));
    assert.ok(storefrontHtml.includes('1px solid var(--color-border)'));
    assert.ok(adminHtml.includes('1px solid var(--border)'));
  });

  it('strictly adheres to color token rules with deliberate primary emerald hue and no purple gradients (§4.3)', () => {
    const storefrontHtml = renderStorefrontHtml(mockStoreData);
    const adminHtml = renderShopkeeperConsoleHtml(mockAdminData);

    // No default purple-to-blue gradient
    assert.equal(storefrontHtml.includes('from-purple-500'), false);
    assert.equal(adminHtml.includes('from-purple-500'), false);

    // Uses deliberate emerald primary token
    assert.ok(storefrontHtml.includes('#059669'));
    assert.ok(adminHtml.includes('#059669'));
  });

  it('implements SaaS compact layout patterns: fixed sidebar and KPI cards (§6)', () => {
    const adminHtml = renderShopkeeperConsoleHtml(mockAdminData);

    // Fixed compact sidebar
    assert.ok(adminHtml.includes('<aside class="sidebar">'));
    assert.ok(adminHtml.includes('class="kpi-grid"'));
    assert.ok(adminHtml.includes('class="kpi-card"'));
    assert.ok(adminHtml.includes('class="kpi-label"'));
    assert.ok(adminHtml.includes('class="kpi-value"'));

    // Data table with dense rows
    assert.ok(adminHtml.includes('class="data-table"'));
  });

  it('names actions with exact active verbs (§5)', () => {
    const storefrontHtml = renderStorefrontHtml(mockStoreData);
    const adminHtml = renderShopkeeperConsoleHtml(mockAdminData);

    assert.ok(storefrontHtml.includes('Add to cart'));
    assert.ok(storefrontHtml.includes('Submit Order'));
    assert.ok(adminHtml.includes('Confirm order'));
    assert.ok(adminHtml.includes('Add stock'));
  });
});
