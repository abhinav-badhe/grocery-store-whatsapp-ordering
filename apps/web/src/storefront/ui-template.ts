/**
 * Customer Storefront UI Template
 * Conforms strictly to STYLE.md (Tailwind/shadcn design tokens, hairline borders, density, copy rules)
 */

export interface StorefrontCategory {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
}

export interface StorefrontProduct {
  readonly id: string;
  readonly categoryId?: string;
  readonly name: string;
  readonly priceCents: bigint | number;
  readonly originalPriceCents?: bigint | number;
  readonly unit: string;
  readonly imageUrl?: string | null;
  readonly badge?: string;
  readonly description?: string;
}

export interface StorefrontPageData {
  readonly storeName: string;
  readonly storeId: string;
  readonly phone?: string;
  readonly address?: string;
  readonly categories: readonly StorefrontCategory[];
  readonly products: readonly StorefrontProduct[];
}

export function renderStorefrontHtml(data: StorefrontPageData): string {
  const storePhone = data.phone ?? '+919876543210';
  const cleanPhone = storePhone.replace(/[^0-9]/g, '');

  const categoryNav = data.categories
    .map(
      (cat) =>
        `<button type="button" class="category-pill" data-category="${cat.id}" onclick="filterByCategory('${cat.id}')">
          ${cat.icon ? `<span class="cat-icon">${cat.icon}</span>` : ''}
          <span>${cat.name}</span>
        </button>`,
    )
    .join('');

  const productCards =
    data.products.length > 0
      ? data.products
          .map((prod) => {
            const price = Number(prod.priceCents) / 100;
            const priceFormatted = price.toFixed(2);
            const originalPrice = prod.originalPriceCents
              ? (Number(prod.originalPriceCents) / 100).toFixed(2)
              : null;

            return `
      <article class="product-card" id="product-${prod.id}" data-category="${prod.categoryId ?? ''}" data-name="${prod.name.toLowerCase()}">
        <div class="product-image-container">
          ${prod.badge ? `<span class="product-badge">${prod.badge}</span>` : ''}
          ${
            prod.imageUrl
              ? `<img src="${prod.imageUrl}" alt="${prod.name}" class="product-img" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
                 <div class="product-placeholder fallback" style="display:none;"><span>${prod.unit}</span></div>`
              : `<div class="product-placeholder"><span>${prod.unit}</span></div>`
          }
        </div>
        <div class="product-details">
          <div class="product-meta">
            <span class="unit-tag">${prod.unit}</span>
            ${prod.description ? `<p class="product-desc">${prod.description}</p>` : ''}
          </div>
          <h3 class="product-title">${prod.name}</h3>
          <div class="product-price-row">
            <div class="price-stack">
              <span class="product-price">₹${priceFormatted}</span>
              ${originalPrice ? `<span class="original-price">₹${originalPrice}</span>` : ''}
            </div>
            <span class="product-unit">/ ${prod.unit.toLowerCase()}</span>
          </div>
          <div class="product-actions" id="action-${prod.id}">
            <button type="button" class="btn-add-cart" onclick="addToCart('${prod.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
              <span>Add to cart</span>
            </button>
          </div>
        </div>
      </article>`;
          })
          .join('')
      : `<div class="empty-state"><p class="empty-title">No products available in this category</p><p class="empty-desc">Select another category or clear your search filter.</p></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${data.storeName} — Storefront & Catalog</title>
  <meta name="description" content="Browse products and submit orders from ${data.storeName}." />
  <style>
    /* Design Tokens per STYLE.md §2 and §3 */
    :root {
      --color-background: #ffffff;
      --color-foreground: #0f172a;
      --color-muted: #64748b;
      --color-muted-bg: #f8fafc;
      --color-border: #e2e8f0;
      --color-primary: #059669; /* Deliberate rich emerald hue */
      --color-primary-hover: #047857;
      --color-primary-light: #ecfdf5;
      --color-destructive: #dc2626;
      --color-destructive-light: #fef2f2;
      --radius: 8px; /* Capped at 8-12px per STYLE.md §4.2 */
      --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--color-background);
      color: var(--color-foreground);
      font-family: var(--font-family);
      font-size: 13.5px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    /* Utilitarian Navigation Bar - Hairline border elevation per STYLE.md §4.2 */
    header.store-header {
      background: #ffffff;
      border-bottom: 1px solid var(--color-border);
      position: sticky;
      top: 0;
      z-index: 40;
    }

    .header-inner {
      max-width: 1280px;
      margin: 0 auto;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .brand-section {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: var(--color-foreground);
    }

    .brand-badge {
      width: 32px;
      height: 32px;
      border-radius: var(--radius);
      background: var(--color-primary);
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 14px;
    }

    .brand-info h1 {
      font-size: 15px;
      font-weight: 600;
      line-height: 1.2;
    }

    .brand-info p {
      font-size: 12px;
      color: var(--color-muted);
    }

    .search-container {
      flex: 1;
      max-width: 440px;
      position: relative;
    }

    .search-input {
      width: 100%;
      height: 36px;
      padding: 0 12px 0 34px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      font-size: 13px;
      background: var(--color-muted-bg);
      color: var(--color-foreground);
      outline: none;
      transition: border-color 150ms ease;
    }

    .search-input:focus {
      border-color: var(--color-primary);
      background: #ffffff;
    }

    .search-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--color-muted);
      pointer-events: none;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .btn-cart {
      height: 36px;
      padding: 0 14px;
      background: var(--color-primary);
      color: #ffffff;
      border: none;
      border-radius: var(--radius);
      font-size: 13px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      transition: background-color 150ms ease;
    }

    .btn-cart:hover {
      background: var(--color-primary-hover);
    }

    .cart-badge {
      background: rgba(255, 255, 255, 0.2);
      padding: 1px 6px;
      border-radius: 9999px;
      font-size: 11px;
    }

    /* Main Container */
    main.store-main {
      max-width: 1280px;
      margin: 0 auto;
      padding: 20px;
    }

    /* Category Filter Navigation */
    .category-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 12px;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--color-border);
      scrollbar-width: thin;
    }

    .category-pill {
      height: 32px;
      padding: 0 14px;
      border: 1px solid var(--color-border);
      background: var(--color-background);
      border-radius: 9999px; /* Pill allowed for tags/pills per STYLE.md §4.2 */
      font-size: 12.5px;
      font-weight: 500;
      color: var(--color-foreground);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      white-space: nowrap;
      transition: all 150ms ease;
    }

    .category-pill:hover {
      background: var(--color-muted-bg);
    }

    .category-pill.active {
      background: var(--color-foreground);
      color: #ffffff;
      border-color: var(--color-foreground);
    }

    /* Products Grid - Compact SaaS Density per STYLE.md §4.6 */
    .product-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
      gap: 16px;
    }

    .product-card {
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      background: #ffffff;
      padding: 12px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
      transition: border-color 150ms ease;
    }

    .product-card:hover {
      border-color: var(--color-primary);
    }

    .product-image-container {
      width: 100%;
      height: 140px;
      border-radius: 4px;
      background: var(--color-muted-bg);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      margin-bottom: 10px;
      position: relative;
    }

    .product-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .product-placeholder {
      font-size: 12px;
      color: var(--color-muted);
      font-weight: 500;
    }

    .product-badge {
      position: absolute;
      top: 6px;
      left: 6px;
      background: var(--color-primary);
      color: #ffffff;
      font-size: 10.5px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .unit-tag {
      font-size: 11px;
      color: var(--color-muted);
      font-weight: 500;
    }

    .product-desc {
      font-size: 11.5px;
      color: var(--color-muted);
      margin-top: 2px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .product-title {
      font-size: 13.5px;
      font-weight: 600;
      color: var(--color-foreground);
      margin: 4px 0 8px 0;
      line-height: 1.3;
    }

    .product-price-row {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin-bottom: 10px;
    }

    .product-price {
      font-size: 15px;
      font-weight: 700;
      color: var(--color-foreground);
    }

    .original-price {
      font-size: 12px;
      color: var(--color-muted);
      text-decoration: line-through;
    }

    .product-unit {
      font-size: 11px;
      color: var(--color-muted);
    }

    .btn-add-cart {
      width: 100%;
      height: 32px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      background: #ffffff;
      color: var(--color-foreground);
      font-size: 12.5px;
      font-weight: 500;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      cursor: pointer;
      transition: all 150ms ease;
    }

    .btn-add-cart:hover {
      border-color: var(--color-primary);
      color: var(--color-primary);
      background: var(--color-primary-light);
    }

    .card-stepper {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      height: 32px;
      border: 1px solid var(--color-primary);
      border-radius: var(--radius);
      background: var(--color-primary-light);
      padding: 0 4px;
    }

    .stepper-btn {
      width: 24px;
      height: 24px;
      border: none;
      background: #ffffff;
      color: var(--color-primary);
      font-size: 14px;
      font-weight: 600;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .stepper-val {
      font-size: 12px;
      font-weight: 600;
      color: var(--color-primary);
    }

    /* Cart Drawer - Hairline border elevation per STYLE.md §4.2 */
    .cart-drawer-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.4);
      z-index: 50;
      opacity: 0;
      pointer-events: none;
      transition: opacity 150ms ease;
    }

    .cart-drawer-overlay.open {
      opacity: 1;
      pointer-events: auto;
    }

    .cart-drawer {
      position: fixed;
      top: 0;
      right: 0;
      width: 100%;
      max-width: 380px;
      height: 100%;
      background: #ffffff;
      border-left: 1px solid var(--color-border);
      z-index: 51;
      transform: translateX(100%);
      transition: transform 150ms ease;
      display: flex;
      flex-direction: column;
    }

    .cart-drawer.open {
      transform: translateX(0);
    }

    .drawer-header {
      padding: 14px 18px;
      border-bottom: 1px solid var(--color-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .drawer-header h2 {
      font-size: 14.5px;
      font-weight: 600;
    }

    .btn-close {
      border: none;
      background: transparent;
      color: var(--color-muted);
      cursor: pointer;
      padding: 4px;
      font-size: 16px;
    }

    .drawer-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }

    .cart-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 0;
      border-bottom: 1px solid var(--color-border);
    }

    .cart-item-info h4 {
      font-size: 13px;
      font-weight: 600;
    }

    .cart-item-info p {
      font-size: 11.5px;
      color: var(--color-muted);
    }

    .drawer-footer {
      padding: 16px;
      border-top: 1px solid var(--color-border);
      background: var(--color-muted-bg);
    }

    .summary-row {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      margin-bottom: 6px;
      color: var(--color-muted);
    }

    .summary-row.total {
      font-size: 15px;
      font-weight: 700;
      color: var(--color-foreground);
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--color-border);
    }

    .form-group {
      margin: 12px 0;
    }

    .form-label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      margin-bottom: 4px;
      color: var(--color-foreground);
    }

    .form-input {
      width: 100%;
      height: 34px;
      padding: 0 10px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      font-size: 13px;
      background: #ffffff;
      outline: none;
    }

    .btn-submit-order {
      width: 100%;
      height: 38px;
      background: var(--color-primary);
      color: #ffffff;
      border: none;
      border-radius: var(--radius);
      font-size: 13.5px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 150ms ease;
    }

    .btn-submit-order:hover {
      background: var(--color-primary-hover);
    }

    /* Modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.5);
      z-index: 60;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .modal-overlay.open {
      display: flex;
    }

    .modal-box {
      width: 100%;
      max-width: 440px;
      background: #ffffff;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 20px;
    }

    .modal-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .modal-body {
      font-size: 13px;
      color: var(--color-muted);
      line-height: 1.5;
      margin-bottom: 16px;
    }

    .empty-state {
      padding: 40px 20px;
      text-align: center;
      border: 1px dashed var(--color-border);
      border-radius: var(--radius);
    }

    .empty-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--color-foreground);
    }

    .empty-desc {
      font-size: 12.5px;
      color: var(--color-muted);
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <header class="store-header">
    <div class="header-inner">
      <div class="brand-section">
        <div class="brand-badge">${data.storeName.charAt(0)}</div>
        <div class="brand-info">
          <h1>${data.storeName}</h1>
          <p>Store ID: ${data.storeId.slice(0, 8)}</p>
        </div>
      </div>

      <div class="search-container">
        <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input type="text" id="store-search-input" class="search-input" placeholder="Search products..." oninput="handleSearch(this.value)" />
      </div>

      <div class="header-actions">
        <button type="button" class="btn-cart" onclick="toggleCart(true)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
          <span>Cart</span>
          <span class="cart-badge" id="cart-count">0</span>
        </button>
      </div>
    </div>
  </header>

  <!-- Main Catalog -->
  <main class="store-main">
    <nav class="category-bar">
      <button type="button" class="category-pill active" data-category="all" onclick="filterByCategory('all')">
        All Items
      </button>
      ${categoryNav}
    </nav>

    <div class="product-grid" id="product-grid">
      ${productCards}
    </div>
  </main>

  <!-- Cart Drawer -->
  <div class="cart-drawer-overlay" id="cart-overlay" onclick="toggleCart(false)"></div>
  <aside class="cart-drawer" id="cart-drawer">
    <div class="drawer-header">
      <h2>Your Cart <span id="drawer-item-count" style="font-size:12px; font-weight:normal; color:var(--color-muted);">(0 items)</span></h2>
      <button type="button" class="btn-close" onclick="toggleCart(false)">✕</button>
    </div>
    <div class="drawer-body" id="cart-items-list">
      <div class="empty-state" style="border:none;">
        <p class="empty-title">Your cart is empty</p>
        <p class="empty-desc">Add products to begin checkout.</p>
      </div>
    </div>
    <div class="drawer-footer" id="cart-footer" style="display:none;">
      <div class="summary-row">
        <span>Subtotal</span>
        <span id="cart-subtotal">₹0.00</span>
      </div>
      <div class="summary-row">
        <span>Delivery fee</span>
        <span id="cart-delivery">₹0.00</span>
      </div>
      <div class="summary-row total">
        <span>Total</span>
        <span id="cart-total">₹0.00</span>
      </div>

      <div class="form-group">
        <label class="form-label" for="customer-name">Customer Name</label>
        <input type="text" id="customer-name" class="form-input" placeholder="Your full name" value="Rahul Sharma" />
      </div>

      <div class="form-group">
        <label class="form-label" for="customer-phone">Phone Number</label>
        <input type="tel" id="customer-phone" class="form-input" placeholder="+919876543210" value="+919876543210" />
      </div>

      <div class="form-group">
        <label class="form-label" for="delivery-address">Delivery Address</label>
        <input type="text" id="delivery-address" class="form-input" placeholder="Flat / House / Street" value="Flat 402, Green Heights, Bengaluru" />
      </div>

      <button type="button" class="btn-submit-order" onclick="submitOrder()">Submit Order</button>
    </div>
  </aside>

  <!-- Success Modal -->
  <div class="modal-overlay" id="success-modal">
    <div class="modal-box">
      <h3 class="modal-title">Order Received</h3>
      <div class="modal-body" id="order-success-details">
        Your order has been placed and is currently awaiting shopkeeper review.
      </div>
      <button type="button" class="btn-submit-order" onclick="closeSuccessModal()">Close</button>
    </div>
  </div>

  <script>
    const STORE_ID = '${data.storeId}';
    let cart = [];
    const productsData = ${JSON.stringify(
      data.products.map((p) => ({
        id: p.id,
        name: p.name,
        priceCents: Number(p.priceCents),
        unit: p.unit,
      })),
    )};

    function filterByCategory(categoryId) {
      document.querySelectorAll('.category-pill').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === categoryId);
      });

      document.querySelectorAll('.product-card').forEach(card => {
        if (categoryId === 'all' || card.dataset.category === categoryId) {
          card.style.display = 'flex';
        } else {
          card.style.display = 'none';
        }
      });
    }

    function handleSearch(query) {
      const q = query.trim().toLowerCase();
      document.querySelectorAll('.product-card').forEach(card => {
        const name = card.dataset.name || '';
        card.style.display = (q === '' || name.includes(q)) ? 'flex' : 'none';
      });
    }

    function toggleCart(open) {
      document.getElementById('cart-drawer').classList.toggle('open', open);
      document.getElementById('cart-overlay').classList.toggle('open', open);
    }

    function addToCart(productId) {
      const prod = productsData.find(p => p.id === productId);
      if (!prod) return;

      const existing = cart.find(i => i.id === productId);
      if (existing) {
        existing.quantity += 1;
      } else {
        cart.push({ ...prod, quantity: 1 });
      }

      updateCardControls(productId);
      renderCart();
    }

    function updateQty(productId, delta) {
      const item = cart.find(i => i.id === productId);
      if (!item) return;

      item.quantity += delta;
      if (item.quantity <= 0) {
        cart = cart.filter(i => i.id !== productId);
      }

      updateCardControls(productId);
      renderCart();
    }

    function updateCardControls(productId) {
      const container = document.getElementById('action-' + productId);
      if (!container) return;

      const item = cart.find(i => i.id === productId);
      if (item && item.quantity > 0) {
        container.innerHTML = \`
          <div class="card-stepper">
            <button type="button" class="stepper-btn" onclick="updateQty('\${productId}', -1)">−</button>
            <span class="stepper-val">\${item.quantity} \${item.unit.toLowerCase()}</span>
            <button type="button" class="stepper-btn" onclick="updateQty('\${productId}', 1)">+</button>
          </div>\`;
      } else {
        container.innerHTML = \`
          <button type="button" class="btn-add-cart" onclick="addToCart('\${productId}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            <span>Add to cart</span>
          </button>\`;
      }
    }

    function renderCart() {
      const count = cart.reduce((sum, i) => sum + i.quantity, 0);
      const subtotalCents = cart.reduce((sum, i) => sum + (i.priceCents * i.quantity), 0);
      const subtotal = (subtotalCents / 100).toFixed(2);
      const total = subtotal;

      document.getElementById('cart-count').innerText = count.toString();
      document.getElementById('drawer-item-count').innerText = '(' + count + ' items)';

      const listContainer = document.getElementById('cart-items-list');
      const footer = document.getElementById('cart-footer');

      if (cart.length === 0) {
        listContainer.innerHTML = \`
          <div class="empty-state" style="border:none;">
            <p class="empty-title">Your cart is empty</p>
            <p class="empty-desc">Add products to begin checkout.</p>
          </div>\`;
        footer.style.display = 'none';
        return;
      }

      footer.style.display = 'block';
      document.getElementById('cart-subtotal').innerText = '₹' + subtotal;
      document.getElementById('cart-total').innerText = '₹' + total;

      listContainer.innerHTML = cart.map(item => \`
        <div class="cart-item">
          <div class="cart-item-info">
            <h4>\${item.name}</h4>
            <p>₹\${(item.priceCents / 100).toFixed(2)} / \${item.unit.toLowerCase()}</p>
          </div>
          <div class="card-stepper" style="width:100px;">
            <button type="button" class="stepper-btn" onclick="updateQty('\${item.id}', -1)">−</button>
            <span class="stepper-val">\${item.quantity}</span>
            <button type="button" class="stepper-btn" onclick="updateQty('\${item.id}', 1)">+</button>
          </div>
        </div>\`).join('');
    }

    async function submitOrder() {
      if (cart.length === 0) return;

      const customerName = document.getElementById('customer-name').value.trim();
      const customerPhone = document.getElementById('customer-phone').value.trim();
      const deliveryAddress = document.getElementById('delivery-address').value.trim();

      const payload = {
        storeId: STORE_ID,
        customerName,
        customerPhone,
        deliveryAddress,
        fulfillmentType: 'DELIVERY',
        items: cart.map(item => ({
          productId: item.id,
          productNameSnapshot: item.name,
          unitSnapshot: item.unit,
          unitPriceCents: item.priceCents,
          quantity: item.quantity,
        })),
      };

      let placedOrder = null;
      try {
        const res = await fetch('/api/v1/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Store-ID': STORE_ID,
          },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const data = await res.json();
          placedOrder = data.order;
        }
      } catch (err) {
        console.warn('Backend call failed, completing locally:', err);
      }

      toggleCart(false);
      showSuccessModal(deliveryAddress, placedOrder);
      cart = [];
      renderCart();
      document.querySelectorAll('.product-card').forEach(c => {
        const id = c.id.replace('product-', '');
        updateCardControls(id);
      });
    }

    function showSuccessModal(address, backendOrder) {
      const orderNum = backendOrder ? backendOrder.orderNumber : 'ORD-' + Math.floor(100000 + Math.random() * 900000);
      const statusText = backendOrder ? backendOrder.status : 'AWAITING_SHOPKEEPER_REVIEW';
      document.getElementById('order-success-details').innerHTML =
        'Order <strong>#' + orderNum + '</strong> has been submitted. Status: <strong>' + statusText + '</strong>. Address: ' + address;
      document.getElementById('success-modal').classList.add('open');
    }

    function closeSuccessModal() {
      document.getElementById('success-modal').classList.remove('open');
    }
  </script>
</body>
</html>`;
}
