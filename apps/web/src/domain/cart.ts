import type { ProductUnit } from '@grocery/api-contracts';

export interface CartItem {
  readonly productId: string;
  readonly productName: string;
  readonly sku: string | null;
  readonly unit: ProductUnit;
  readonly unitPriceCents: bigint;
  readonly quantity: number;
  readonly totalPriceCents: bigint;
}

export interface Cart {
  readonly storeId: string;
  readonly items: readonly CartItem[];
  readonly totalAmountCents: bigint;
  readonly currency: string;
}

/**
 * Calculates item subtotal price in integer cents (paise).
 * Weight-based decimal quantities are rounded cleanly to avoid fractional currency units.
 */
export function calculateItemTotalCents(unitPriceCents: bigint, quantity: number): bigint {
  if (quantity <= 0) {
    return 0n;
  }
  const multiplied = Number(unitPriceCents) * quantity;
  return BigInt(Math.round(multiplied));
}

/**
 * Initializes a new empty cart for a store.
 */
export function createEmptyCart(storeId: string, currency = 'INR'): Cart {
  return {
    storeId,
    items: [],
    totalAmountCents: 0n,
    currency,
  };
}

/**
 * Calculates total amount in cents across all cart items.
 */
export function calculateCartTotal(items: readonly CartItem[]): bigint {
  return items.reduce((acc, item) => acc + item.totalPriceCents, 0n);
}

/**
 * Adds an item to cart or increments quantity if already present.
 */
export function addItemToCart(
  cart: Cart,
  input: {
    readonly productId: string;
    readonly productName: string;
    readonly sku: string | null;
    readonly unit: ProductUnit;
    readonly unitPriceCents: bigint | number;
    readonly quantity: number;
  },
): Cart {
  if (input.quantity <= 0) {
    return cart;
  }

  const unitPrice = BigInt(input.unitPriceCents);
  const existingIndex = cart.items.findIndex((item) => item.productId === input.productId);

  let newItems: CartItem[];

  if (existingIndex >= 0) {
    const existing = cart.items[existingIndex];
    const newQuantity = existing.quantity + input.quantity;
    const updatedItem: CartItem = {
      ...existing,
      quantity: newQuantity,
      totalPriceCents: calculateItemTotalCents(existing.unitPriceCents, newQuantity),
    };

    newItems = [
      ...cart.items.slice(0, existingIndex),
      updatedItem,
      ...cart.items.slice(existingIndex + 1),
    ];
  } else {
    const newItem: CartItem = {
      productId: input.productId,
      productName: input.productName,
      sku: input.sku,
      unit: input.unit,
      unitPriceCents: unitPrice,
      quantity: input.quantity,
      totalPriceCents: calculateItemTotalCents(unitPrice, input.quantity),
    };
    newItems = [...cart.items, newItem];
  }

  return {
    ...cart,
    items: newItems,
    totalAmountCents: calculateCartTotal(newItems),
  };
}

/**
 * Updates quantity of a specific product in the cart. Removes item if quantity <= 0.
 */
export function updateCartItemQuantity(cart: Cart, productId: string, quantity: number): Cart {
  if (quantity <= 0) {
    return removeItemFromCart(cart, productId);
  }

  const existingIndex = cart.items.findIndex((item) => item.productId === productId);
  if (existingIndex < 0) {
    return cart;
  }

  const existing = cart.items[existingIndex];
  const updatedItem: CartItem = {
    ...existing,
    quantity,
    totalPriceCents: calculateItemTotalCents(existing.unitPriceCents, quantity),
  };

  const newItems = [
    ...cart.items.slice(0, existingIndex),
    updatedItem,
    ...cart.items.slice(existingIndex + 1),
  ];

  return {
    ...cart,
    items: newItems,
    totalAmountCents: calculateCartTotal(newItems),
  };
}

/**
 * Removes an item from the cart by product ID.
 */
export function removeItemFromCart(cart: Cart, productId: string): Cart {
  const newItems = cart.items.filter((item) => item.productId !== productId);
  return {
    ...cart,
    items: newItems,
    totalAmountCents: calculateCartTotal(newItems),
  };
}

/**
 * Formats integer cents into standard localized currency string (e.g. ₹150.00).
 */
export function formatMoney(amountCents: bigint | number, currency = 'INR'): string {
  const cents = typeof amountCents === 'bigint' ? Number(amountCents) : amountCents;
  const major = cents / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major);
}
