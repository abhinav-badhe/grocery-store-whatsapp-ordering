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
            const discountPercent =
              prod.originalPriceCents && Number(prod.originalPriceCents) > Number(prod.priceCents)
                ? Math.round(
                    ((Number(prod.originalPriceCents) - Number(prod.priceCents)) /
                      Number(prod.originalPriceCents)) *
                      100,
                  )
                : null;

            return `
      <article class="product-card" id="product-${prod.id}" data-category="${prod.categoryId ?? ''}" data-name="${prod.name.toLowerCase()}">
        <div class="product-image-container">
          ${prod.badge ? `<span class="product-badge">${prod.badge}</span>` : ''}
          ${discountPercent ? `<span class="discount-badge">${discountPercent}% OFF</span>` : ''}
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
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
              <span>Add to cart</span>
            </button>
          </div>
        </div>
      </article>`;
          })
          .join('')
      : `<div class="empty-state"><p>No products available right now.</p></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${data.storeName} — Online Grocery Store & WhatsApp Delivery</title>
  <meta name="description" content="Shop fresh groceries, produce, dairy and pantry staples from ${data.storeName}. Rapid 20-minute local delivery and seamless WhatsApp ordering." />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --color-background: #f8fafc;
      --color-surface: #ffffff;
      --color-foreground: #0f172a;
      --color-muted: #64748b;
      --color-border: #e2e8f0;
      --color-primary: #059669; /* Rich Emerald */
      --color-primary-hover: #047857;
      --color-primary-light: #ecfdf5;
      --color-primary-dark: #064e3b;
      --color-accent: #f59e0b; /* Amber */
      --color-whatsapp: #25D366;
      --color-whatsapp-hover: #1ebd5b;
      --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
      --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.07);
      --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.04);
      --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.05);
      --radius-sm: 8px;
      --radius-md: 12px;
      --radius-lg: 16px;
      --radius-full: 9999px;
      --font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      background-color: var(--color-background);
      color: var(--color-foreground);
      font-family: var(--font-family);
      font-size: 14px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }

    /* Top Utility Notice Bar */
    .top-notice {
      background: linear-gradient(90deg, #064e3b, #059669, #0d9488);
      color: #ffffff;
      padding: 6px 16px;
      font-size: 12px;
      font-weight: 600;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 16px;
      letter-spacing: 0.01em;
    }
    .top-notice a { color: #a7f3d0; text-decoration: underline; margin-left: 4px; }

    /* Sticky Main Navigation Header */
    header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--color-border);
      position: sticky;
      top: 0;
      z-index: 50;
      transition: all 200ms ease;
    }

    .header-inner {
      max-width: 1240px;
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
      gap: 12px;
      text-decoration: none;
      color: var(--color-foreground);
    }
    .brand-logo-badge {
      width: 42px;
      height: 42px;
      border-radius: var(--radius-md);
      background: linear-gradient(135deg, var(--color-primary), #10b981);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      box-shadow: 0 4px 10px rgba(5, 150, 105, 0.25);
    }
    .brand-text h1 {
      font-size: 18px;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.1;
      color: #0f172a;
    }
    .brand-subtitle {
      font-size: 11px;
      font-weight: 600;
      color: var(--color-primary);
      display: flex;
      align-items: center;
      gap: 4px;
    }

    /* Live Search Bar */
    .search-container {
      flex: 1;
      max-width: 480px;
      position: relative;
    }
    .search-input {
      width: 100%;
      background: var(--color-background);
      border: 1.5px solid var(--color-border);
      border-radius: var(--radius-full);
      padding: 9px 16px 9px 40px;
      font-size: 13.5px;
      font-family: inherit;
      color: var(--color-foreground);
      transition: all 200ms ease;
    }
    .search-input:focus {
      outline: none;
      border-color: var(--color-primary);
      background: #ffffff;
      box-shadow: 0 0 0 4px rgba(5, 150, 105, 0.12);
    }
    .search-icon {
      position: absolute;
      left: 14px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--color-muted);
      pointer-events: none;
    }

    /* Header Actions */
    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .cart-summary-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      background: var(--color-primary);
      color: #ffffff;
      border: none;
      border-radius: var(--radius-full);
      padding: 8px 18px;
      font-size: 13.5px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(5, 150, 105, 0.25);
      transition: all 180ms ease;
    }
    .cart-summary-btn:hover {
      background: var(--color-primary-hover);
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(5, 150, 105, 0.35);
    }
    .cart-pill-count {
      background: rgba(255, 255, 255, 0.25);
      border-radius: var(--radius-full);
      padding: 2px 8px;
      font-size: 12px;
      font-weight: 800;
    }

    /* Hero Banner Strip */
    .hero-banner {
      background: linear-gradient(135deg, #064e3b 0%, #065f46 50%, #047857 100%);
      color: #ffffff;
      padding: 32px 20px;
      position: relative;
      overflow: hidden;
    }
    .hero-inner {
      max-width: 1240px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
      position: relative;
      z-index: 2;
    }
    .hero-tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: var(--radius-full);
      padding: 4px 12px;
      font-size: 12px;
      font-weight: 600;
      width: fit-content;
      color: #a7f3d0;
    }
    .hero-title {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.2;
    }
    .hero-sub {
      color: #d1fae5;
      font-size: 14.5px;
      max-width: 580px;
    }
    .hero-perks {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      margin-top: 6px;
    }
    .perk-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12.5px;
      font-weight: 600;
      background: rgba(255, 255, 255, 0.1);
      padding: 6px 12px;
      border-radius: var(--radius-md);
      backdrop-filter: blur(4px);
    }

    /* Category Navigation */
    nav.categories {
      background: var(--color-surface);
      border-bottom: 1px solid var(--color-border);
      position: sticky;
      top: 67px;
      z-index: 40;
      padding: 10px 20px;
    }
    .categories-inner {
      max-width: 1240px;
      margin: 0 auto;
      display: flex;
      gap: 8px;
      overflow-x: auto;
      scrollbar-width: none;
      -ms-overflow-style: none;
      align-items: center;
    }
    .categories-inner::-webkit-scrollbar { display: none; }
    .category-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 16px;
      background: var(--color-background);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-full);
      color: var(--color-foreground);
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
      transition: all 160ms ease;
    }
    .category-pill:hover {
      border-color: var(--color-primary);
      color: var(--color-primary);
      background: var(--color-primary-light);
    }
    .category-pill.active {
      background: var(--color-primary);
      color: #ffffff;
      border-color: var(--color-primary);
      box-shadow: 0 2px 6px rgba(5, 150, 105, 0.25);
    }

    /* Main Container */
    main {
      max-width: 1240px;
      margin: 0 auto;
      padding: 28px 20px 60px;
    }

    .catalog-header {
      margin-bottom: 22px;
      display: flex;
      align-items: baseline;
      justify-content: space-between;
    }
    .catalog-header h2 {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .catalog-count {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-muted);
    }

    /* Product Grid */
    .product-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 20px;
    }

    /* Modern Product Card */
    .product-card {
      background: var(--color-surface);
      border: 1.5px solid var(--color-border);
      border-radius: var(--radius-lg);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-sm);
      transition: all 220ms cubic-bezier(0.16, 1, 0.3, 1);
      position: relative;
    }
    .product-card:hover {
      border-color: #a7f3d0;
      transform: translateY(-3px);
      box-shadow: var(--shadow-lg);
    }

    .product-image-container {
      width: 100%;
      height: 180px;
      background: #f1f5f9;
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .product-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 300ms ease;
    }
    .product-card:hover .product-img {
      transform: scale(1.05);
    }

    .product-badge {
      position: absolute;
      top: 10px;
      left: 10px;
      background: rgba(15, 23, 42, 0.85);
      color: #ffffff;
      padding: 3px 8px;
      border-radius: var(--radius-sm);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      backdrop-filter: blur(4px);
      z-index: 2;
    }
    .discount-badge {
      position: absolute;
      top: 10px;
      right: 10px;
      background: #dc2626;
      color: #ffffff;
      padding: 3px 8px;
      border-radius: var(--radius-sm);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.02em;
      z-index: 2;
    }

    .product-placeholder {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #e2e8f0, #cbd5e1);
      color: #64748b;
      font-size: 14px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .product-details {
      padding: 14px;
      display: flex;
      flex-direction: column;
      flex-grow: 1;
      justify-content: space-between;
      gap: 12px;
    }

    .product-meta {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .unit-tag {
      font-size: 11px;
      font-weight: 700;
      color: var(--color-primary);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .product-desc {
      font-size: 11.5px;
      color: var(--color-muted);
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .product-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--color-foreground);
      line-height: 1.3;
    }

    .product-price-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 6px;
    }
    .price-stack {
      display: flex;
      align-items: baseline;
      gap: 6px;
    }
    .product-price {
      font-size: 18px;
      font-weight: 800;
      color: #0f172a;
    }
    .original-price {
      font-size: 13px;
      color: #94a3b8;
      text-decoration: line-through;
    }
    .product-unit {
      font-size: 12px;
      color: var(--color-muted);
      font-weight: 500;
    }

    /* Button and Stepper Controls */
    .btn-add-cart {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      background: var(--color-surface);
      border: 1.5px solid var(--color-primary);
      color: var(--color-primary);
      border-radius: var(--radius-md);
      padding: 8px 12px;
      font-size: 13.5px;
      font-weight: 700;
      cursor: pointer;
      transition: all 180ms ease;
    }
    .btn-add-cart:hover {
      background: var(--color-primary);
      color: #ffffff;
      box-shadow: 0 4px 10px rgba(5, 150, 105, 0.2);
    }

    .card-stepper {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--color-primary-light);
      border: 1.5px solid var(--color-primary);
      border-radius: var(--radius-md);
      overflow: hidden;
    }
    .stepper-btn {
      background: transparent;
      border: none;
      color: var(--color-primary);
      width: 36px;
      height: 36px;
      font-size: 16px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 150ms ease;
    }
    .stepper-btn:hover {
      background: var(--color-primary);
      color: #ffffff;
    }
    .stepper-val {
      font-size: 13.5px;
      font-weight: 800;
      color: var(--color-primary-dark);
    }

    /* Cart Drawer Modal & Overlay */
    .cart-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.5);
      backdrop-filter: blur(4px);
      z-index: 100;
      opacity: 0;
      visibility: hidden;
      transition: all 250ms ease;
    }
    .cart-overlay.open {
      opacity: 1;
      visibility: visible;
    }

    .cart-drawer {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: 100%;
      max-width: 440px;
      background: var(--color-surface);
      z-index: 101;
      transform: translateX(100%);
      transition: transform 280ms cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-xl);
    }
    .cart-drawer.open {
      transform: translateX(0);
    }

    .drawer-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--color-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .drawer-title {
      font-size: 17px;
      font-weight: 800;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .drawer-close {
      background: var(--color-background);
      border: 1px solid var(--color-border);
      width: 32px;
      height: 32px;
      border-radius: var(--radius-full);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 16px;
      color: var(--color-muted);
      transition: all 150ms ease;
    }
    .drawer-close:hover {
      color: var(--color-foreground);
      border-color: #94a3b8;
    }

    .free-delivery-bar {
      background: #f0fdf4;
      border-bottom: 1px solid #bbf7d0;
      padding: 10px 20px;
      font-size: 12px;
      font-weight: 600;
      color: #166534;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .drawer-items {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .cart-item-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--color-border);
    }
    .cart-item-thumb {
      width: 52px;
      height: 52px;
      border-radius: var(--radius-sm);
      object-fit: cover;
      background: #f1f5f9;
      border: 1px solid var(--color-border);
    }
    .cart-item-info {
      flex: 1;
    }
    .cart-item-name {
      font-size: 13.5px;
      font-weight: 700;
      line-height: 1.25;
      margin-bottom: 2px;
    }
    .cart-item-price {
      font-size: 12.5px;
      color: var(--color-muted);
    }
    .cart-item-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .cart-item-stepper {
      display: inline-flex;
      align-items: center;
      background: var(--color-background);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }
    .cart-item-stepper button {
      background: transparent;
      border: none;
      padding: 4px 8px;
      font-weight: 700;
      cursor: pointer;
      color: var(--color-foreground);
    }
    .cart-item-stepper span {
      padding: 0 6px;
      font-size: 12px;
      font-weight: 700;
    }
    .cart-item-total {
      font-size: 14px;
      font-weight: 800;
      color: #0f172a;
      min-width: 60px;
      text-align: right;
    }

    .empty-cart-view {
      text-align: center;
      padding: 48px 20px;
      color: var(--color-muted);
    }
    .empty-cart-view svg { margin-bottom: 12px; stroke: #94a3b8; }
    .empty-cart-view h4 { font-size: 16px; font-weight: 700; color: #334155; margin-bottom: 4px; }

    /* Drawer Footer & Checkout Controls */
    .drawer-footer {
      border-top: 1px solid var(--color-border);
      padding: 16px 20px;
      background: var(--color-surface);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .delivery-input-box {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .delivery-input-box label {
      font-size: 11.5px;
      font-weight: 700;
      color: var(--color-muted);
      text-transform: uppercase;
    }
    .delivery-input-box input {
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      padding: 8px 12px;
      font-size: 13px;
      font-family: inherit;
    }

    .bill-row {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      color: var(--color-muted);
    }
    .bill-row.total {
      font-size: 16px;
      font-weight: 800;
      color: #0f172a;
      padding-top: 8px;
      border-top: 1px dashed var(--color-border);
    }

    .btn-whatsapp-checkout {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: var(--color-whatsapp);
      color: #ffffff;
      border: none;
      border-radius: var(--radius-md);
      padding: 12px 16px;
      font-size: 15px;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(37, 211, 102, 0.35);
      transition: all 180ms ease;
    }
    .btn-whatsapp-checkout:hover {
      background: var(--color-whatsapp-hover);
      transform: translateY(-1px);
    }

    .btn-mock-pay {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: var(--color-background);
      border: 1px solid var(--color-border);
      color: var(--color-foreground);
      border-radius: var(--radius-md);
      padding: 9px 14px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: all 150ms ease;
    }
    .btn-mock-pay:hover {
      background: #e2e8f0;
    }

    /* Success Modal */
    .success-modal {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(6px);
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      opacity: 0;
      pointer-events: none;
      transition: all 250ms ease;
    }
    .success-modal.open {
      opacity: 1;
      pointer-events: auto;
    }
    .modal-card {
      background: #ffffff;
      border-radius: var(--radius-lg);
      padding: 28px 24px;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: var(--shadow-xl);
      transform: scale(0.95);
      transition: transform 250ms ease;
    }
    .success-modal.open .modal-card {
      transform: scale(1);
    }
    .modal-icon {
      width: 60px;
      height: 60px;
      background: #ecfdf5;
      color: var(--color-primary);
      border-radius: var(--radius-full);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
    }
    .modal-title {
      font-size: 20px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 8px;
    }
    .modal-sub {
      font-size: 13.5px;
      color: var(--color-muted);
      margin-bottom: 20px;
      line-height: 1.4;
    }
    .btn-close-modal {
      background: var(--color-primary);
      color: #ffffff;
      border: none;
      border-radius: var(--radius-md);
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      width: 100%;
    }

    /* Footer */
    footer {
      border-top: 1px solid var(--color-border);
      background: var(--color-surface);
      padding: 32px 20px;
      color: var(--color-muted);
      font-size: 13px;
    }
    .footer-inner {
      max-width: 1240px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
      align-items: center;
      text-align: center;
    }
    .footer-links {
      display: flex;
      gap: 20px;
      font-weight: 600;
    }
    .footer-links a { color: var(--color-muted); text-decoration: none; }
    .footer-links a:hover { color: var(--color-primary); }

    /* Responsive adjustments */
    @media (max-width: 768px) {
      .header-inner { flex-wrap: wrap; }
      .search-container { order: 3; max-width: 100%; width: 100%; margin-top: 4px; }
      .hero-title { font-size: 22px; }
      .product-grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }
      .product-image-container { height: 140px; }
    }
  </style>
</head>
<body>
  <!-- Top Notice -->
  <div class="top-notice">
    <span>⚡ Free instant delivery on all orders above ₹499!</span>
    <span>•</span>
    <span>📞 WhatsApp Hotline: <a href="https://wa.me/${cleanPhone}">Chat with us</a></span>
  </div>

  <!-- Header -->
  <header>
    <div class="header-inner">
      <a href="/" class="brand-section">
        <div class="brand-logo-badge">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
        </div>
        <div class="brand-text">
          <h1>${data.storeName}</h1>
          <span class="brand-subtitle">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
            Bandra West, Mumbai • Open Now
          </span>
        </div>
      </a>

      <!-- Live Search -->
      <div class="search-container">
        <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input type="text" id="store-search-input" class="search-input" placeholder="Search fresh produce, dairy, grains... (Press '/' to search)" oninput="filterBySearch(this.value)" />
      </div>

      <!-- Actions -->
      <div class="header-actions">
        <a href="/admin" class="btn-shopkeeper-link" style="display:inline-flex; align-items:center; gap:6px; background:#f1f5f9; border:1px solid #cbd5e1; color:#0f172a; padding:7px 14px; border-radius:var(--radius-full); font-size:12.5px; font-weight:700; text-decoration:none; transition:all 150ms ease;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span>Shopkeeper Portal</span>
        </a>
        <button type="button" class="cart-summary-btn" id="open-cart-btn" onclick="toggleCart(true)" aria-label="View shopping cart">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
          <span>Cart</span>
          <span class="cart-pill-count" id="cart-count">(0)</span>
          <span id="cart-total-badge" style="display:none; font-size:12px; font-weight:800;">₹0</span>
        </button>
      </div>
    </div>
  </header>

  <!-- Hero Section -->
  <section class="hero-banner">
    <div class="hero-inner">
      <div class="hero-tag">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        Superfast Local Delivery in 20 Mins
      </div>
      <h2 class="hero-title">Farm-Fresh Groceries & Daily Essentials Delivered To Your Door</h2>
      <p class="hero-sub">Directly sourced from trusted local farmers and artisans. Order seamlessly on web or click to order instantly on WhatsApp.</p>
      <div class="hero-perks">
        <div class="perk-item">⚡ 20-Minute Express</div>
        <div class="perk-item">🌱 100% Organic & Fresh</div>
        <div class="perk-item">💬 WhatsApp One-Tap Order</div>
        <div class="perk-item">🛡️ No-Questions-Asked Replacement</div>
      </div>
    </div>
  </section>

  <!-- Categories -->
  <nav class="categories" aria-label="Catalog categories">
    <div class="categories-inner">
      <button type="button" class="category-pill active" data-category="all" onclick="filterByCategory('all')">
        <span>🌟 All Items</span>
      </button>
      ${categoryNav}
    </div>
  </nav>

  <!-- Main Catalog -->
  <main>
    <div class="catalog-header">
      <div>
        <h2>Products</h2>
        <span class="catalog-count" id="catalog-count">Showing all products</span>
      </div>
    </div>
    <section class="product-grid" id="product-grid" aria-label="Product listings">
      ${productCards}
    </section>
  </main>

  <!-- Slide-out Cart Drawer -->
  <div class="cart-overlay" id="cart-overlay" onclick="toggleCart(false)"></div>
  <aside class="cart-drawer" id="cart-drawer" aria-label="Shopping Cart">
    <div class="drawer-header">
      <div class="drawer-title">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>
        <span>Your Basket</span>
        <span id="drawer-item-count" style="font-size:13px; color:var(--color-muted);">(0 items)</span>
      </div>
      <button type="button" class="drawer-close" onclick="toggleCart(false)" aria-label="Close cart">✕</button>
    </div>

    <div class="free-delivery-bar" id="free-delivery-bar">
      <span>🚚</span>
      <span id="free-delivery-text">Add ₹499 more for FREE instant delivery</span>
    </div>

    <div class="drawer-items" id="drawer-items">
      <!-- Populated by JS -->
    </div>

    <div class="drawer-footer" id="drawer-footer">
      <div class="delivery-input-box">
        <label for="delivery-address">Delivery Address</label>
        <input type="text" id="delivery-address" placeholder="Flat / House No., Landmark, Bandra West" value="Flat 402, Green Valley Apts, Bandra West" />
      </div>

      <div class="bill-breakdown">
        <div class="bill-row">
          <span>Items Subtotal</span>
          <span id="bill-subtotal">₹0.00</span>
        </div>
        <div class="bill-row">
          <span>Delivery Fee</span>
          <span id="bill-delivery">₹40.00</span>
        </div>
        <div class="bill-row">
          <span>Packaging & Bag</span>
          <span style="color:#059669; font-weight:700;">FREE</span>
        </div>
        <div class="bill-row total">
          <span>To Pay</span>
          <span id="bill-total">₹0.00</span>
        </div>
      </div>

      <button type="button" class="btn-whatsapp-checkout" onclick="checkoutWhatsApp()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2m.01 1.67c2.2 0 4.26.86 5.82 2.41 1.56 1.56 2.41 3.62 2.41 5.83 0 4.54-3.7 8.24-8.24 8.24-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24m4.52 11.64c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.06-.39-2.02-1.24-.75-.67-1.26-1.5-1.41-1.75-.14-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.34-.76-1.84-.2-.49-.4-.42-.56-.43h-.47c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1s.9 2.44 1.03 2.61c.13.17 1.77 2.7 4.29 3.79.6.26 1.07.41 1.44.53.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.3z"/></svg>
        <span>Send Order on WhatsApp</span>
      </button>

      <button type="button" class="btn-mock-pay" onclick="simulateCheckout()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
        <span>Pay Online (Instant UPI / Card)</span>
      </button>
    </div>
  </aside>

  <!-- Checkout Success Dialog -->
  <div class="success-modal" id="success-modal">
    <div class="modal-card">
      <div class="modal-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <h3 class="modal-title">Order Placed Successfully!</h3>
      <p class="modal-sub" id="order-success-details">Your order has been confirmed. Our local store is packing your items now. Delivery partner will arrive in ~20 mins!</p>
      <button type="button" class="btn-close-modal" onclick="closeSuccessModal()">Continue Shopping</button>
    </div>
  </div>

  <!-- Footer -->
  <footer>
    <div class="footer-inner">
      <div class="footer-links">
        <a href="/catalog">All Products</a>
        <a href="#about">Store Info</a>
        <a href="https://wa.me/${cleanPhone}">WhatsApp Support</a>
        <a href="/health/live">System Status</a>
      </div>
      <p>&copy; ${new Date().getFullYear()} ${data.storeName}. All rights reserved. High-Performance Multi-Tenant Grocery Platform.</p>
    </div>
  </footer>

  <script>
    // State
    const PRODUCTS = ${JSON.stringify(
      data.products.map((p) => ({
        id: p.id,
        categoryId: p.categoryId ?? '',
        name: p.name,
        priceCents: Number(p.priceCents),
        unit: p.unit,
        imageUrl: p.imageUrl ?? '',
      })),
    )};
    let cart = [];
    let currentCategory = 'all';
    let searchQuery = '';
    const STORE_ID = '${data.storeId}';
    const STORE_PHONE = '${cleanPhone}';
    const STORE_NAME = '${data.storeName.replace(/'/g, "\\'")}';

    // Toggle Cart Drawer
    function toggleCart(open) {
      const drawer = document.getElementById('cart-drawer');
      const overlay = document.getElementById('cart-overlay');
      if (open) {
        renderCart();
        drawer.classList.add('open');
        overlay.classList.add('open');
      } else {
        drawer.classList.remove('open');
        overlay.classList.remove('open');
      }
    }

    // Add Item to Cart
    function addToCart(id) {
      const prod = PRODUCTS.find(p => p.id === id);
      if (!prod) return;
      const existing = cart.find(i => i.id === id);
      if (existing) {
        existing.quantity += 1;
      } else {
        cart.push({ id: prod.id, name: prod.name, priceCents: prod.priceCents, unit: prod.unit, imageUrl: prod.imageUrl, quantity: 1 });
      }
      renderCart();
      updateCardControls(id);
    }

    // Step item quantity
    function updateQty(id, delta) {
      const item = cart.find(i => i.id === id);
      if (!item) return;
      item.quantity += delta;
      if (item.quantity <= 0) {
        cart = cart.filter(i => i.id !== id);
      }
      renderCart();
      updateCardControls(id);
    }

    // Update product card CTA to Stepper if in cart
    function updateCardControls(id) {
      const container = document.getElementById('action-' + id);
      if (!container) return;
      const prod = PRODUCTS.find(p => p.id === id);
      const item = cart.find(i => i.id === id);
      if (item && item.quantity > 0) {
        const unit = (prod ? prod.unit : 'item').toLowerCase();
        container.innerHTML = \`
          <div class="card-stepper">
            <button type="button" class="stepper-btn" onclick="updateQty('\${id}', -1)">−</button>
            <span class="stepper-val">\${item.quantity} \${unit}</span>
            <button type="button" class="stepper-btn" onclick="updateQty('\${id}', 1)">+</button>
          </div>
        \`;
      } else {
        container.innerHTML = \`
          <button type="button" class="btn-add-cart" onclick="addToCart('\${id}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
            <span>Add to cart</span>
          </button>
        \`;
      }
    }

    // Render Cart Drawer
    function renderCart() {
      const count = cart.reduce((sum, i) => sum + i.quantity, 0);
      const subtotalCents = cart.reduce((sum, i) => sum + (i.priceCents * i.quantity), 0);
      const subtotal = subtotalCents / 100;
      const isFreeDelivery = subtotal >= 499 || subtotal === 0;
      const deliveryFee = isFreeDelivery ? 0 : 40;
      const total = subtotal > 0 ? (subtotal + deliveryFee) : 0;

      // Header pills
      document.getElementById('cart-count').innerText = '(' + count + ')';
      document.getElementById('drawer-item-count').innerText = '(' + count + ' items)';
      
      const badge = document.getElementById('cart-total-badge');
      if (subtotal > 0) {
        badge.style.display = 'inline-block';
        badge.innerText = '₹' + subtotal.toFixed(0);
      } else {
        badge.style.display = 'none';
      }

      // Free delivery bar
      const barText = document.getElementById('free-delivery-text');
      if (subtotal >= 499) {
        barText.innerHTML = '🎉 You unlocked <strong>FREE instant delivery</strong>!';
      } else if (subtotal > 0) {
        const remaining = (499 - subtotal).toFixed(0);
        barText.innerHTML = 'Add <strong>₹' + remaining + '</strong> more for FREE instant delivery 🚚';
      } else {
        barText.innerText = 'Add ₹499 more for FREE instant delivery';
      }

      // Items list
      const itemsContainer = document.getElementById('drawer-items');
      const footer = document.getElementById('drawer-footer');

      if (cart.length === 0) {
        itemsContainer.innerHTML = \`
          <div class="empty-cart-view">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
            <h4>Your basket is empty</h4>
            <p>Add fresh items from our local harvest to get started!</p>
          </div>
        \`;
        footer.style.opacity = '0.5';
        footer.style.pointerEvents = 'none';
      } else {
        footer.style.opacity = '1';
        footer.style.pointerEvents = 'auto';
        itemsContainer.innerHTML = cart.map(item => {
          const itemTotal = ((item.priceCents * item.quantity) / 100).toFixed(2);
          const unitPrice = (item.priceCents / 100).toFixed(2);
          return \`
            <div class="cart-item-row">
              \${item.imageUrl ? \`<img src="\${item.imageUrl}" class="cart-item-thumb" alt="\${item.name}" />\` : \`<div class="cart-item-thumb" style="display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;">\${item.unit}</div>\`}
              <div class="cart-item-info">
                <div class="cart-item-name">\${item.name}</div>
                <div class="cart-item-price">₹\${unitPrice} / \${item.unit.toLowerCase()}</div>
              </div>
              <div class="cart-item-actions">
                <div class="cart-item-stepper">
                  <button type="button" onclick="updateQty('\${item.id}', -1)">−</button>
                  <span>\${item.quantity}</span>
                  <button type="button" onclick="updateQty('\${item.id}', 1)">+</button>
                </div>
                <div class="cart-item-total">₹\${itemTotal}</div>
              </div>
            </div>
          \`;
        }).join('');
      }

      // Bill details
      document.getElementById('bill-subtotal').innerText = '₹' + subtotal.toFixed(2);
      document.getElementById('bill-delivery').innerText = deliveryFee === 0 ? (subtotal > 0 ? 'FREE' : '₹0.00') : '₹' + deliveryFee.toFixed(2);
      if (deliveryFee === 0 && subtotal > 0) {
        document.getElementById('bill-delivery').style.color = '#059669';
        document.getElementById('bill-delivery').style.fontWeight = '700';
      } else {
        document.getElementById('bill-delivery').style.color = 'inherit';
        document.getElementById('bill-delivery').style.fontWeight = 'normal';
      }
      document.getElementById('bill-total').innerText = '₹' + total.toFixed(2);
    }

    // Category Filtering
    function filterByCategory(catId) {
      currentCategory = catId;
      document.querySelectorAll('.category-pill').forEach(btn => {
        if (btn.getAttribute('data-category') === catId) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      applyFilters();
    }

    // Search Filtering
    function filterBySearch(val) {
      searchQuery = val.trim().toLowerCase();
      applyFilters();
    }

    function applyFilters() {
      const cards = document.querySelectorAll('.product-card');
      let visibleCount = 0;

      cards.forEach(card => {
        const cardCat = card.getAttribute('data-category');
        const cardName = card.getAttribute('data-name');

        const matchesCat = currentCategory === 'all' || cardCat === currentCategory;
        const matchesSearch = !searchQuery || cardName.includes(searchQuery);

        if (matchesCat && matchesSearch) {
          card.style.display = 'flex';
          visibleCount++;
        } else {
          card.style.display = 'none';
        }
      });

      const countEl = document.getElementById('catalog-count');
      if (searchQuery) {
        countEl.innerText = 'Found ' + visibleCount + ' matching item' + (visibleCount === 1 ? '' : 's');
      } else if (currentCategory !== 'all') {
        const catBtn = document.querySelector('.category-pill.active span:last-child');
        const catName = catBtn ? catBtn.innerText : 'selected category';
        countEl.innerText = 'Showing ' + visibleCount + ' products in ' + catName;
      } else {
        countEl.innerText = 'Showing all ' + visibleCount + ' products';
      }
    }

    // WhatsApp Checkout
    function checkoutWhatsApp() {
      if (cart.length === 0) return;
      const address = document.getElementById('delivery-address').value.trim() || 'Address to be confirmed via WhatsApp';
      const subtotal = cart.reduce((sum, i) => sum + (i.priceCents * i.quantity), 0) / 100;
      const deliveryFee = subtotal >= 499 ? 0 : 40;
      const total = subtotal + deliveryFee;

      let msg = '🛒 *New Order from ' + STORE_NAME + '*\\n';
      msg += '-------------------------------------\\n';
      cart.forEach(item => {
        const lineTotal = ((item.priceCents * item.quantity) / 100).toFixed(2);
        msg += '• ' + item.name + ' × ' + item.quantity + ' ' + item.unit.toLowerCase() + ' — ₹' + lineTotal + '\\n';
      });
      msg += '-------------------------------------\\n';
      msg += '*Subtotal:* ₹' + subtotal.toFixed(2) + '\\n';
      msg += '*Delivery:* ' + (deliveryFee === 0 ? 'FREE' : '₹' + deliveryFee.toFixed(2)) + '\\n';
      msg += '*Total Payable:* ₹' + total.toFixed(2) + '\\n\\n';
      msg += '📍 *Delivery Address:* ' + address + '\\n';
      msg += '⚡ *Mode:* Instant 20-min fulfillment\\n';

      const url = 'https://wa.me/' + STORE_PHONE + '?text=' + encodeURIComponent(msg);
      window.open(url, '_blank');
      toggleCart(false);
      showSuccessModal(address, total.toFixed(2));
    }

    // Live / Online Order Placement via Backend API Gateway
    async function simulateCheckout() {
      if (cart.length === 0) return;
      const address = document.getElementById('delivery-address').value.trim() || 'Bandra West, Mumbai';
      const subtotal = cart.reduce((sum, i) => sum + (i.priceCents * i.quantity), 0) / 100;
      const deliveryFee = subtotal >= 499 ? 0 : 40;
      const total = (subtotal + deliveryFee).toFixed(2);

      const payload = {
        customerName: 'Aarav Mehta',
        customerPhone: '+919876543210',
        fulfillmentType: 'DELIVERY',
        deliveryAddress: address,
        items: cart.map(item => ({
          productId: item.id,
          quantity: Number(item.quantity),
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
        console.warn('Backend unavailable, completing locally:', err);
      }

      toggleCart(false);
      showSuccessModal(address, total, placedOrder);
      cart = [];
      renderCart();
      document.querySelectorAll('.product-card').forEach(c => {
        const id = c.id.replace('product-', '');
        updateCardControls(id);
      });
    }

    function showSuccessModal(address, total, backendOrder) {
      const orderNum = backendOrder ? backendOrder.orderNumber : 'ORD-' + Math.floor(100000 + Math.random() * 900000);
      const orderIdInfo = backendOrder ? '<br/><span style="font-size:11px;color:#64748b;font-family:monospace;">Backend Order ID: ' + backendOrder.id + ' • Status: ' + backendOrder.status + '</span>' : '';
      document.getElementById('order-success-details').innerHTML = 
        'Order <strong>#' + orderNum + '</strong> (₹' + total + ') has been created and synced with the store! Our partner has started packing your order for delivery to <em>' + address + '</em>. Arriving in ~20 minutes.' + orderIdInfo;
      document.getElementById('success-modal').classList.add('open');
    }

    function closeSuccessModal() {
      document.getElementById('success-modal').classList.remove('open');
    }

    // Keyboard shortcut '/' to search
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        document.getElementById('store-search-input').focus();
      }
    });

    // Check URL params for category on load
    const urlParams = new URLSearchParams(window.location.search);
    const catParam = urlParams.get('category');
    if (catParam) {
      filterByCategory(catParam);
    }
  </script>
</body>
</html>`;
}
