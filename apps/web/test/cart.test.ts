import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createEmptyCart,
  addItemToCart,
  updateCartItemQuantity,
  removeItemFromCart,
  formatMoney,
  calculateItemTotalCents,
} from '../dist/index.js';

const STORE_ID = '00000000-0000-4000-8000-000000000001';

describe('Web Storefront Cart & Pricing Domain (ADR-010)', () => {
  it('creates an empty cart with zeroed totals and default currency', () => {
    const cart = createEmptyCart(STORE_ID);
    assert.equal(cart.storeId, STORE_ID);
    assert.equal(cart.items.length, 0);
    assert.equal(cart.totalAmountCents, 0n);
    assert.equal(cart.currency, 'INR');
  });

  it('adds piece-based items to cart and computes exact integer price', () => {
    let cart = createEmptyCart(STORE_ID);
    cart = addItemToCart(cart, {
      productId: 'prod-milk',
      productName: 'Organic Whole Milk',
      sku: 'SKU-MILK-1',
      unit: 'LITRE',
      unitPriceCents: 6500n, // ₹65.00
      quantity: 2,
    });

    assert.equal(cart.items.length, 1);
    assert.equal(cart.items[0].quantity, 2);
    assert.equal(cart.items[0].totalPriceCents, 13000n);
    assert.equal(cart.totalAmountCents, 13000n);
  });

  it('adds weight-based items with decimal quantities and rounds cents safely', () => {
    let cart = createEmptyCart(STORE_ID);
    // 1.5 kg of Fuji Apples at ₹140.00 / kg = ₹210.00 (21000 cents)
    cart = addItemToCart(cart, {
      productId: 'prod-apples',
      productName: 'Fuji Apples',
      sku: 'SKU-APPLE-1',
      unit: 'KG',
      unitPriceCents: 14000n,
      quantity: 1.5,
    });

    assert.equal(cart.items.length, 1);
    assert.equal(cart.items[0].quantity, 1.5);
    assert.equal(cart.items[0].totalPriceCents, 21000n);
    assert.equal(cart.totalAmountCents, 21000n);
  });

  it('increments quantity when existing item is added again', () => {
    let cart = createEmptyCart(STORE_ID);
    cart = addItemToCart(cart, {
      productId: 'prod-bread',
      productName: 'Brown Bread',
      sku: 'SKU-BREAD-1',
      unit: 'PACK',
      unitPriceCents: 4000n,
      quantity: 1,
    });

    cart = addItemToCart(cart, {
      productId: 'prod-bread',
      productName: 'Brown Bread',
      sku: 'SKU-BREAD-1',
      unit: 'PACK',
      unitPriceCents: 4000n,
      quantity: 2,
    });

    assert.equal(cart.items.length, 1);
    assert.equal(cart.items[0].quantity, 3);
    assert.equal(cart.items[0].totalPriceCents, 12000n);
    assert.equal(cart.totalAmountCents, 12000n);
  });

  it('updates item quantity and recalculates totals', () => {
    let cart = createEmptyCart(STORE_ID);
    cart = addItemToCart(cart, {
      productId: 'prod-bread',
      productName: 'Brown Bread',
      sku: 'SKU-BREAD-1',
      unit: 'PACK',
      unitPriceCents: 4000n,
      quantity: 3,
    });

    cart = updateCartItemQuantity(cart, 'prod-bread', 5);
    assert.equal(cart.items[0].quantity, 5);
    assert.equal(cart.items[0].totalPriceCents, 20000n);
    assert.equal(cart.totalAmountCents, 20000n);
  });

  it('removes item when quantity is updated to zero or negative', () => {
    let cart = createEmptyCart(STORE_ID);
    cart = addItemToCart(cart, {
      productId: 'prod-bread',
      productName: 'Brown Bread',
      sku: 'SKU-BREAD-1',
      unit: 'PACK',
      unitPriceCents: 4000n,
      quantity: 2,
    });

    cart = updateCartItemQuantity(cart, 'prod-bread', 0);
    assert.equal(cart.items.length, 0);
    assert.equal(cart.totalAmountCents, 0n);
  });

  it('removes item explicitly via removeItemFromCart', () => {
    let cart = createEmptyCart(STORE_ID);
    cart = addItemToCart(cart, {
      productId: 'prod-bread',
      productName: 'Brown Bread',
      sku: 'SKU-BREAD-1',
      unit: 'PACK',
      unitPriceCents: 4000n,
      quantity: 1,
    });
    cart = addItemToCart(cart, {
      productId: 'prod-milk',
      productName: 'Milk',
      sku: 'SKU-MILK-1',
      unit: 'LITRE',
      unitPriceCents: 6000n,
      quantity: 1,
    });

    assert.equal(cart.items.length, 2);
    cart = removeItemFromCart(cart, 'prod-bread');
    assert.equal(cart.items.length, 1);
    assert.equal(cart.items[0].productId, 'prod-milk');
    assert.equal(cart.totalAmountCents, 6000n);
  });

  it('formats money consistently with currency symbol', () => {
    assert.equal(formatMoney(15000n, 'INR'), '₹150.00');
    assert.equal(formatMoney(0n, 'INR'), '₹0.00');
    assert.equal(formatMoney(99n, 'INR'), '₹0.99');
  });
});
