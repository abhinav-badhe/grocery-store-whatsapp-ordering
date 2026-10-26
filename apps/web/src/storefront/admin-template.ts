export interface AdminOrderLineItem {
  readonly id: string;
  readonly productId: string;
  readonly productName: string;
  readonly quantity: number;
  readonly unit: string;
  readonly unitPriceCents: number;
  readonly totalPriceCents: number;
  readonly substitutedWith?: string;
}

export interface AdminOrder {
  readonly id: string;
  readonly orderNumber: string;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly deliveryAddress: string;
  readonly channel: 'WHATSAPP' | 'STOREFRONT';
  readonly status:
    | 'AWAITING_SHOPKEEPER_REVIEW'
    | 'CONFIRMED'
    | 'PREPARING'
    | 'PACKING'
    | 'READY_FOR_PICKUP'
    | 'OUT_FOR_DELIVERY'
    | 'COMPLETED'
    | 'DELIVERED'
    | 'CANCELLED';
  readonly createdAt: string;
  readonly items: AdminOrderLineItem[];
  readonly subtotalCents: number;
  readonly taxCents: number;
  readonly deliveryFeeCents: number;
  readonly totalCents: number;
  readonly paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED';
}

export interface AdminInventoryItem {
  readonly productId: string;
  readonly productName: string;
  readonly category: string;
  readonly unit: string;
  readonly onHand: number;
  readonly reserved: number;
  readonly available: number;
  readonly reorderLevel: number;
  readonly unitPriceCents: number;
}

export interface ShopkeeperPageData {
  readonly storeName: string;
  readonly storeId: string;
  readonly phone: string;
  readonly currency: string;
  readonly orders: readonly AdminOrder[];
  readonly inventory: readonly AdminInventoryItem[];
}

export function renderShopkeeperConsoleHtml(data: ShopkeeperPageData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${data.storeName} — Shopkeeper & Admin Operations Console</title>
  <meta name="description" content="Shopkeeper operations console for order review, inventory stock intake, tax billing, and delivery dispatch." />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b1320;
      --surface: #111c2e;
      --surface-elevated: #16243b;
      --surface-card: #1c2e4a;
      --border: #233756;
      --border-subtle: #1e2f49;
      --fg: #f1f5f9;
      --fg-muted: #94a3b8;
      --fg-subtle: #64748b;
      --primary: #10b981;
      --primary-hover: #059669;
      --primary-muted: rgba(16, 185, 129, 0.15);
      --amber: #f59e0b;
      --amber-muted: rgba(245, 158, 11, 0.15);
      --blue: #3b82f6;
      --blue-muted: rgba(59, 130, 246, 0.15);
      --red: #ef4444;
      --red-muted: rgba(239, 68, 68, 0.15);
      --purple: #8b5cf6;
      --whatsapp: #25D366;
      --font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 14px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--font-family);
      font-size: 13.5px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    /* Top Ops Header */
    header.ops-header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .ops-header-inner {
      max-width: 1400px;
      margin: 0 auto;
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .brand-cluster {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .store-badge {
      background: var(--primary);
      color: #064e3b;
      font-weight: 800;
      font-size: 11px;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .store-title {
      font-size: 16px;
      font-weight: 800;
      letter-spacing: -0.01em;
      color: #fff;
    }
    .env-tag {
      font-size: 11px;
      background: rgba(59, 130, 246, 0.2);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.3);
      padding: 2px 7px;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .btn-view-storefront {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--surface-elevated);
      border: 1px solid var(--border);
      color: var(--fg);
      padding: 7px 14px;
      border-radius: var(--radius-md);
      font-size: 12.5px;
      font-weight: 600;
      text-decoration: none;
      transition: all 150ms ease;
    }
    .btn-view-storefront:hover {
      border-color: var(--primary);
      color: var(--primary);
    }

    /* Live Stat Bar */
    .stat-bar {
      background: var(--surface-elevated);
      border-bottom: 1px solid var(--border);
      padding: 14px 24px;
    }
    .stat-bar-inner {
      max-width: 1400px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .stat-label {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .stat-val-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
    }
    .stat-val {
      font-size: 22px;
      font-weight: 800;
      color: #fff;
      font-family: var(--font-mono);
    }
    .stat-pill {
      font-size: 10.5px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
    }
    .stat-pill.amber { background: var(--amber-muted); color: var(--amber); }
    .stat-pill.green { background: var(--primary-muted); color: var(--primary); }
    .stat-pill.blue { background: var(--blue-muted); color: #60a5fa; }

    /* Navigation Tabs */
    .ops-tabs {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 0 24px;
    }
    .ops-tabs-inner {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      gap: 24px;
    }
    .tab-btn {
      background: transparent;
      border: none;
      color: var(--fg-muted);
      font-size: 13.5px;
      font-weight: 700;
      padding: 14px 0;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      position: relative;
      transition: color 150ms ease;
    }
    .tab-btn:hover { color: var(--fg); }
    .tab-btn.active { color: var(--primary); }
    .tab-btn.active::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--primary);
    }
    .badge-count {
      background: var(--amber);
      color: #000;
      font-size: 10.5px;
      font-weight: 800;
      padding: 1px 6px;
      border-radius: 9999px;
    }

    /* Main Console Workspace */
    main.console-workspace {
      max-width: 1400px;
      margin: 0 auto;
      padding: 24px;
    }

    .tab-content { display: none; }
    .tab-content.active { display: block; }

    /* Table & Section Layout */
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .section-title {
      font-size: 18px;
      font-weight: 800;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .section-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .btn-action-primary {
      background: var(--primary);
      color: #064e3b;
      border: none;
      padding: 8px 16px;
      border-radius: var(--radius-md);
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 150ms ease;
    }
    .btn-action-primary:hover {
      background: #34d399;
      transform: translateY(-1px);
    }

    .btn-action-secondary {
      background: var(--surface-elevated);
      color: var(--fg);
      border: 1px solid var(--border);
      padding: 7px 14px;
      border-radius: var(--radius-md);
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 150ms ease;
    }
    .btn-action-secondary:hover {
      border-color: #64748b;
    }

    /* Orders Grid / Cards */
    .orders-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
      gap: 18px;
    }
    .order-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      transition: border-color 150ms ease;
    }
    .order-card:hover {
      border-color: #3b82f6;
    }
    .order-card-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .order-num {
      font-family: var(--font-mono);
      font-size: 15px;
      font-weight: 800;
      color: #fff;
    }
    .order-meta-sub {
      font-size: 11.5px;
      color: var(--fg-muted);
      margin-top: 2px;
    }

    .status-badge {
      font-size: 11px;
      font-weight: 800;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .status-badge.review { background: var(--amber-muted); color: var(--amber); border: 1px solid rgba(245, 158, 11, 0.4); }
    .status-badge.confirmed { background: var(--blue-muted); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); }
    .status-badge.packing { background: rgba(139, 92, 246, 0.2); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.4); }
    .status-badge.delivery { background: var(--primary-muted); color: var(--primary); border: 1px solid rgba(16, 185, 129, 0.4); }
    .status-badge.delivered { background: rgba(100, 116, 139, 0.2); color: #94a3b8; border: 1px solid rgba(100, 116, 139, 0.3); }

    /* Order Items Table inside Card */
    .order-items-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
    }
    .order-items-table th {
      text-align: left;
      color: var(--fg-subtle);
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 4px 6px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .order-items-table td {
      padding: 8px 6px;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .item-qty-input {
      background: var(--bg);
      border: 1px solid var(--border);
      color: #fff;
      font-family: var(--font-mono);
      font-size: 12px;
      width: 60px;
      padding: 3px 6px;
      border-radius: var(--radius-sm);
      text-align: right;
    }

    .order-footer-totals {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 10px 0 4px;
      font-size: 13px;
    }
    .order-total-amount {
      font-size: 18px;
      font-weight: 800;
      color: #fff;
      font-family: var(--font-mono);
    }

    .order-card-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding-top: 10px;
      border-top: 1px solid var(--border-subtle);
    }
    .btn-step-confirm {
      flex: 1;
      background: #059669;
      color: #fff;
      border: none;
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-size: 12px;
    }
    .btn-step-confirm:hover { background: #10b981; }

    .btn-step-invoice {
      background: var(--surface-card);
      border: 1px solid var(--border);
      color: #60a5fa;
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      font-weight: 700;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .btn-step-invoice:hover { border-color: #60a5fa; }

    .btn-step-whatsapp {
      background: rgba(37, 211, 102, 0.15);
      border: 1px solid rgba(37, 211, 102, 0.4);
      color: var(--whatsapp);
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      font-weight: 700;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .btn-step-whatsapp:hover { background: rgba(37, 211, 102, 0.25); }

    /* Tables (Inventory & Invoices) */
    .data-table-container {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow-x: auto;
    }
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }
    table.data-table th {
      background: var(--surface-elevated);
      color: var(--fg-muted);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }
    table.data-table td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-subtle);
      color: var(--fg);
    }
    table.data-table tr:hover td {
      background: rgba(255,255,255,0.02);
    }
    .mono { font-family: var(--font-mono); }
    .stock-pill {
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: var(--radius-sm);
      display: inline-block;
    }
    .stock-pill.healthy { background: var(--primary-muted); color: var(--primary); }
    .stock-pill.low { background: var(--amber-muted); color: var(--amber); }
    .stock-pill.out { background: var(--red-muted); color: var(--red); }

    /* Quick Intake & Product Modals */
    .admin-modal {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.75);
      backdrop-filter: blur(4px);
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      opacity: 0;
      pointer-events: none;
      transition: all 200ms ease;
    }
    .admin-modal.open {
      opacity: 1;
      pointer-events: auto;
    }
    .modal-box {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      max-width: 520px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .modal-box-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .modal-box-header h3 { font-size: 16px; font-weight: 800; color: #fff; }
    .modal-box-close {
      background: transparent;
      border: none;
      color: var(--fg-muted);
      font-size: 18px;
      cursor: pointer;
    }
    .modal-box-body {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .form-group label {
      font-size: 11.5px;
      font-weight: 700;
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .form-control {
      background: var(--bg);
      border: 1px solid var(--border);
      color: #fff;
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      font-family: inherit;
      font-size: 13px;
    }
    .form-control:focus {
      outline: none;
      border-color: var(--primary);
    }
    .form-row-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .modal-box-footer {
      padding: 14px 20px;
      border-top: 1px solid var(--border);
      background: var(--surface-elevated);
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    /* Printable Tax Invoice Modal */
    .invoice-container {
      background: #ffffff;
      color: #0f172a;
      padding: 28px;
      border-radius: var(--radius-md);
      font-size: 12.5px;
      line-height: 1.4;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .invoice-header-row {
      display: flex;
      justify-content: space-between;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .invoice-items-table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
    }
    .invoice-items-table th {
      border-bottom: 1px solid #cbd5e1;
      text-align: left;
      padding: 6px;
      font-size: 11px;
      color: #475569;
    }
    .invoice-items-table td {
      padding: 8px 6px;
      border-bottom: 1px solid #f1f5f9;
    }
    .invoice-totals {
      border-top: 1px solid #cbd5e1;
      padding-top: 10px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      text-align: right;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <header class="ops-header">
    <div class="ops-header-inner">
      <div class="brand-cluster">
        <span class="store-badge">OPERATOR</span>
        <h1 class="store-title">${data.storeName} — Console</h1>
        <span class="env-tag">TENANT: ${data.storeId.slice(0, 8)}</span>
      </div>
      <div class="header-actions">
        <a href="/" class="btn-view-storefront">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
          <span>Open Customer Storefront</span>
        </a>
      </div>
    </div>
  </header>

  <!-- Live Stat Bar -->
  <section class="stat-bar">
    <div class="stat-bar-inner">
      <div class="stat-card">
        <span class="stat-label">Pending Reviews (ADR-007)</span>
        <div class="stat-val-row">
          <span class="stat-val" id="stat-pending-reviews">2</span>
          <span class="stat-pill amber">Needs Action</span>
        </div>
      </div>
      <div class="stat-card">
        <span class="stat-label">Active Dispatches</span>
        <div class="stat-val-row">
          <span class="stat-val" id="stat-active-orders">4</span>
          <span class="stat-pill blue">Fulfillment</span>
        </div>
      </div>
      <div class="stat-card">
        <span class="stat-label">Today's Revenue</span>
        <div class="stat-val-row">
          <span class="stat-val">₹4,890.00</span>
          <span class="stat-pill green">+18% vs avg</span>
        </div>
      </div>
      <div class="stat-card">
        <span class="stat-label">Low Stock Alerts</span>
        <div class="stat-val-row">
          <span class="stat-val" id="stat-low-stock">1</span>
          <span class="stat-pill amber">Replenish</span>
        </div>
      </div>
    </div>
  </section>

  <!-- Navigation Tabs -->
  <nav class="ops-tabs">
    <div class="ops-tabs-inner">
      <button type="button" class="tab-btn active" onclick="switchTab('orders')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        <span>Live Orders & Review</span>
        <span class="badge-count" id="tab-orders-badge">2</span>
      </button>

      <button type="button" class="tab-btn" onclick="switchTab('inventory')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
        <span>Inventory & Stock Intake</span>
      </button>

      <button type="button" class="tab-btn" onclick="switchTab('catalog')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        <span>Product Catalog</span>
      </button>

      <button type="button" class="tab-btn" onclick="switchTab('billing')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        <span>Invoices & GST Bills</span>
      </button>
    </div>
  </nav>

  <!-- Main Console -->
  <main class="console-workspace">
    <!-- TAB 1: LIVE ORDERS & REVIEW -->
    <div class="tab-content active" id="tab-orders">
      <div class="section-header">
        <div>
          <h2 class="section-title">Order Processing Queue</h2>
          <p style="color:var(--fg-muted); font-size:12px; margin-top:2px;">
            Enforcing ADR-007: Orders remain unreserved until shopkeeper explicit confirmation.
          </p>
        </div>
        <div class="section-actions">
          <button type="button" class="btn-action-secondary" onclick="simulateNewIncomingOrder()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
            <span>+ Simulate WhatsApp Order</span>
          </button>
        </div>
      </div>

      <div class="orders-grid" id="orders-cards-container">
        <!-- Rendered by JS -->
      </div>
    </div>

    <!-- TAB 2: INVENTORY & STOCK INTAKE -->
    <div class="tab-content" id="tab-inventory">
      <div class="section-header">
        <div>
          <h2 class="section-title">Stock Balances & Movements Ledger</h2>
          <p style="color:var(--fg-muted); font-size:12px; margin-top:2px;">
            Pessimistic row locking with deterministic ordering (Spec v2.0 §5).
          </p>
        </div>
        <div class="section-actions">
          <button type="button" class="btn-action-primary" onclick="openModal('modal-stock-intake')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
            <span>+ Log Stock Intake Crate</span>
          </button>
        </div>
      </div>

      <div class="data-table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>SKU / Product</th>
              <th>Category</th>
              <th>Unit</th>
              <th>On-Hand</th>
              <th>Reserved</th>
              <th>Available to Sell</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="inventory-table-body">
            <!-- Rendered by JS -->
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 3: PRODUCT CATALOG -->
    <div class="tab-content" id="tab-catalog">
      <div class="section-header">
        <div>
          <h2 class="section-title">Store Products & Pricing</h2>
          <p style="color:var(--fg-muted); font-size:12px; margin-top:2px;">
            Multi-tenant catalog with minor unit integer pricing (ADR-010).
          </p>
        </div>
        <div class="section-actions">
          <button type="button" class="btn-action-primary" onclick="openModal('modal-add-product')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
            <span>+ Add New Product</span>
          </button>
        </div>
      </div>

      <div class="data-table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Product Name</th>
              <th>Category</th>
              <th>Unit</th>
              <th>Unit Price (INR)</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="catalog-table-body">
            <!-- Rendered by JS -->
          </tbody>
        </table>
      </div>
    </div>

    <!-- TAB 4: BILLING & GST INVOICES -->
    <div class="tab-content" id="tab-billing">
      <div class="section-header">
        <div>
          <h2 class="section-title">Tax Invoices & Billing Register</h2>
          <p style="color:var(--fg-muted); font-size:12px; margin-top:2px;">
            Statutory tax compliance with 5% GST and rounding invariants (ADR-005).
          </p>
        </div>
      </div>

      <div class="data-table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Date</th>
              <th>Customer</th>
              <th>Order ID</th>
              <th>Subtotal</th>
              <th>GST (5%)</th>
              <th>Total Amount</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="invoices-table-body">
            <!-- Rendered by JS -->
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <!-- MODAL: STOCK INTAKE -->
  <div class="admin-modal" id="modal-stock-intake">
    <div class="modal-box">
      <div class="modal-box-header">
        <h3>Record Inbound Stock Intake</h3>
        <button type="button" class="modal-box-close" onclick="closeModal('modal-stock-intake')">✕</button>
      </div>
      <div class="modal-box-body">
        <div class="form-group">
          <label>Select Product</label>
          <select id="intake-product-select" class="form-control">
            <!-- Populated by JS -->
          </select>
        </div>
        <div class="form-row-2">
          <div class="form-group">
            <label>Intake Quantity</label>
            <input type="number" id="intake-qty" class="form-control" value="25" min="1" />
          </div>
          <div class="form-group">
            <label>Batch / Supplier Ref</label>
            <input type="text" id="intake-batch" class="form-control" value="MKT-FARM-CRATE-09" />
          </div>
        </div>
      </div>
      <div class="modal-box-footer">
        <button type="button" class="btn-action-secondary" onclick="closeModal('modal-stock-intake')">Cancel</button>
        <button type="button" class="btn-action-primary" onclick="submitStockIntake()">Log Intake & Update Ledger</button>
      </div>
    </div>
  </div>

  <!-- MODAL: ADD PRODUCT -->
  <div class="admin-modal" id="modal-add-product">
    <div class="modal-box">
      <div class="modal-box-header">
        <h3>Add New Store Product</h3>
        <button type="button" class="modal-box-close" onclick="closeModal('modal-add-product')">✕</button>
      </div>
      <div class="modal-box-body">
        <div class="form-group">
          <label>Product Title</label>
          <input type="text" id="new-prod-name" class="form-control" placeholder="e.g. Fresh Alphonso Mangoes" />
        </div>
        <div class="form-row-2">
          <div class="form-group">
            <label>Category</label>
            <select id="new-prod-category" class="form-control">
              <option value="cat-fresh-produce">Fresh Produce</option>
              <option value="cat-dairy">Dairy & Eggs</option>
              <option value="cat-staples">Grains & Staples</option>
              <option value="cat-beverages">Beverages</option>
            </select>
          </div>
          <div class="form-group">
            <label>Unit</label>
            <select id="new-prod-unit" class="form-control">
              <option value="KG">KG (Kilogram)</option>
              <option value="PACK">PACK</option>
              <option value="LITRE">LITRE</option>
              <option value="PIECE">PIECE</option>
            </select>
          </div>
        </div>
        <div class="form-row-2">
          <div class="form-group">
            <label>Price (₹)</label>
            <input type="number" id="new-prod-price" class="form-control" value="120.00" step="0.50" />
          </div>
          <div class="form-group">
            <label>Initial Stock (On-Hand)</label>
            <input type="number" id="new-prod-stock" class="form-control" value="30" />
          </div>
        </div>
        <div class="form-group">
          <label>Photo URL (Optional)</label>
          <input type="text" id="new-prod-img" class="form-control" placeholder="https://images.unsplash.com/..." />
        </div>
      </div>
      <div class="modal-box-footer">
        <button type="button" class="btn-action-secondary" onclick="closeModal('modal-add-product')">Cancel</button>
        <button type="button" class="btn-action-primary" onclick="submitNewProduct()">Save Product to Catalog</button>
      </div>
    </div>
  </div>

  <!-- MODAL: PRINTABLE TAX INVOICE -->
  <div class="admin-modal" id="modal-invoice-viewer">
    <div class="modal-box" style="max-width: 600px;">
      <div class="modal-box-header">
        <h3>Statutory GST Tax Invoice</h3>
        <button type="button" class="modal-box-close" onclick="closeModal('modal-invoice-viewer')">✕</button>
      </div>
      <div class="modal-box-body" style="background:#fff;">
        <div id="invoice-printable-content" class="invoice-container">
          <!-- Populated by JS -->
        </div>
      </div>
      <div class="modal-box-footer">
        <button type="button" class="btn-action-secondary" onclick="window.print()">Print / Save PDF</button>
        <button type="button" class="btn-action-primary" onclick="dispatchInvoiceWhatsApp()">Send via WhatsApp</button>
      </div>
    </div>
  </div>

  <script>
    const STORE_ID = '${data.storeId}';
    // Live State
    let orders = ${JSON.stringify(data.orders)};
    let inventory = ${JSON.stringify(data.inventory)};
    let activeInvoiceOrder = null;

    // Switch Top Tabs
    function switchTab(tabId) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes(tabId));
      if (activeBtn) activeBtn.classList.add('active');
      const targetContent = document.getElementById('tab-' + tabId);
      if (targetContent) targetContent.classList.add('active');
    }

    function openModal(id) {
      const modal = document.getElementById(id);
      if (modal) modal.classList.add('open');
    }
    function closeModal(id) {
      const modal = document.getElementById(id);
      if (modal) modal.classList.remove('open');
    }

    // Render Orders
    function renderOrders() {
      const container = document.getElementById('orders-cards-container');
      const pendingCount = orders.filter(o => o.status === 'AWAITING_SHOPKEEPER_REVIEW').length;
      document.getElementById('stat-pending-reviews').innerText = pendingCount;
      document.getElementById('tab-orders-badge').innerText = pendingCount;
      document.getElementById('stat-active-orders').innerText = orders.filter(o => o.status !== 'DELIVERED' && o.status !== 'CANCELLED').length;

      container.innerHTML = orders.map(order => {
        let statusBadgeClass = 'review';
        let statusLabel = 'Awaiting Review (ADR-007)';
        if (order.status === 'CONFIRMED') { statusBadgeClass = 'confirmed'; statusLabel = 'Confirmed & Reserved'; }
        if (order.status === 'PREPARING' || order.status === 'PACKING') { statusBadgeClass = 'packing'; statusLabel = 'Preparing / Packing'; }
        if (order.status === 'READY_FOR_PICKUP' || order.status === 'OUT_FOR_DELIVERY') { statusBadgeClass = 'delivery'; statusLabel = 'Ready / Out For Delivery'; }
        if (order.status === 'COMPLETED' || order.status === 'DELIVERED') { statusBadgeClass = 'delivered'; statusLabel = 'Completed & Fulfilled'; }

        const itemsRows = order.items.map((it, idx) => {
          return \`
            <tr>
              <td>
                <div style="font-weight:700;">\${it.productName}</div>
                <div style="font-size:11px; color:var(--fg-muted);">₹\${(it.unitPriceCents / 100).toFixed(2)} / \${it.unit.toLowerCase()}</div>
              </td>
              <td>
                <input type="number" step="0.1" class="item-qty-input" value="\${it.quantity}" onchange="adjustItemWeight('\${order.id}', \${idx}, this.value)" \${order.status !== 'AWAITING_SHOPKEEPER_REVIEW' ? 'disabled' : ''} />
                <span style="font-size:11px; margin-left:3px; color:var(--fg-muted);">\${it.unit.toLowerCase()}</span>
              </td>
              <td class="mono" style="text-align:right; font-weight:700;">₹\${(it.totalPriceCents / 100).toFixed(2)}</td>
            </tr>
          \`;
        }).join('');

        return \`
          <article class="order-card" id="card-\${order.id}">
            <div class="order-card-header">
              <div>
                <div class="order-num">\${order.orderNumber}</div>
                <div class="order-meta-sub">👤 \${order.customerName} (\${order.customerPhone})</div>
                <div class="order-meta-sub">📍 \${order.deliveryAddress}</div>
              </div>
              <span class="status-badge \${statusBadgeClass}">\${statusLabel}</span>
            </div>

            <table class="order-items-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Quantity / Actual Weight</th>
                  <th style="text-align:right;">Total</th>
                </tr>
              </thead>
              <tbody>
                \${itemsRows}
              </tbody>
            </table>

            <div class="order-footer-totals">
              <span style="color:var(--fg-muted);">Order Total:</span>
              <span class="order-total-amount">₹\${(order.totalCents / 100).toFixed(2)}</span>
            </div>

            <div class="order-card-actions">
              \${order.status === 'AWAITING_SHOPKEEPER_REVIEW' ? \`
                <button type="button" class="btn-step-confirm" onclick="confirmAndReserve('\${order.id}')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>Confirm & Lock Stock</span>
                </button>
              \` : ''}

              \${order.status === 'CONFIRMED' ? \`
                <button type="button" class="btn-step-confirm" onclick="advanceOrderStatus('\${order.id}', 'PREPARING')">
                  <span>Mark as Preparing / Packing</span>
                </button>
              \` : ''}

              \${order.status === 'PREPARING' || order.status === 'PACKING' ? \`
                <button type="button" class="btn-step-confirm" onclick="advanceOrderStatus('\${order.id}', 'READY_FOR_PICKUP')">
                  <span>Ready for Pickup / Dispatch</span>
                </button>
              \` : ''}

              \${order.status === 'READY_FOR_PICKUP' || order.status === 'OUT_FOR_DELIVERY' ? \`
                <button type="button" class="btn-step-confirm" onclick="advanceOrderStatus('\${order.id}', 'COMPLETED')">
                  <span>Mark Order Completed / Delivered</span>
                </button>
              \` : ''}

              <button type="button" class="btn-step-invoice" onclick="viewInvoice('\${order.id}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>
                <span>Tax Invoice</span>
              </button>

              <button type="button" class="btn-step-whatsapp" onclick="sendWhatsAppNotification('\${order.id}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2"/></svg>
                <span>WhatsApp</span>
              </button>
            </div>
          </article>
        \`;
      }).join('');
    }

    // Adjust actual weighed quantity (e.g., 1.0 kg requested, weighed 1.15 kg on shopkeeper scale)
    function adjustItemWeight(orderId, itemIndex, newQty) {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;
      const qty = parseFloat(newQty) || 1;
      const item = order.items[itemIndex];
      item.quantity = qty;
      item.totalPriceCents = Math.round(item.unitPriceCents * qty);
      
      const newSubtotal = order.items.reduce((s, it) => s + it.totalPriceCents, 0);
      const tax = Math.round(newSubtotal * 0.05); // 5% GST
      order.subtotalCents = newSubtotal;
      order.taxCents = tax;
      order.totalCents = newSubtotal + tax + order.deliveryFeeCents;
      renderOrders();
    }

    // Confirm & Lock Stock (Enforces ADR-007)
    async function confirmAndReserve(orderId) {
      try {
        const res = await fetch('/api/v1/orders/' + encodeURIComponent(orderId) + '/confirm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Store-ID': STORE_ID,
          },
          body: JSON.stringify({ userId: 'shopkeeper' }),
        });
        if (res.ok) {
          console.log('Order confirmed and inventory locked via backend API');
        }
      } catch (err) {
        console.warn('Backend offline, updated in local session:', err);
      }

      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      // Atomically decrement available stock in inventory
      order.items.forEach(it => {
        const inv = inventory.find(i => i.productId === it.productId);
        if (inv) {
          inv.reserved += it.quantity;
          inv.available = Math.max(0, inv.onHand - inv.reserved);
        }
      });

      order.status = 'CONFIRMED';
      renderOrders();
      renderInventory();
    }

    // Advance lifecycle stages
    async function advanceOrderStatus(orderId, nextStatus) {
      try {
        const res = await fetch('/api/v1/orders/' + encodeURIComponent(orderId) + '/status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Store-ID': STORE_ID,
          },
          body: JSON.stringify({ status: nextStatus, reason: 'Advanced to ' + nextStatus }),
        });
        if (res.ok) {
          console.log('Order advanced to ' + nextStatus + ' via backend API');
        }
      } catch (err) {
        console.warn('Backend offline, updated in local session:', err);
      }

      const order = orders.find(o => o.id === orderId);
      if (!order) return;
      order.status = nextStatus;
      if (nextStatus === 'COMPLETED' || nextStatus === 'DELIVERED') {
        order.paymentStatus = 'PAID';
        // Finalize inventory deduction
        order.items.forEach(it => {
          const inv = inventory.find(i => i.productId === it.productId);
          if (inv) {
            inv.onHand = Math.max(0, inv.onHand - it.quantity);
            inv.reserved = Math.max(0, inv.reserved - it.quantity);
            inv.available = Math.max(0, inv.onHand - inv.reserved);
          }
        });
      }
      renderOrders();
      renderInventory();
    }

    // Render Inventory
    function renderInventory() {
      const tbody = document.getElementById('inventory-table-body');
      const intakeSelect = document.getElementById('intake-product-select');
      const lowStockCount = inventory.filter(i => i.available <= i.reorderLevel).length;
      document.getElementById('stat-low-stock').innerText = lowStockCount;

      intakeSelect.innerHTML = inventory.map(i => \`<option value="\${i.productId}">\${i.productName} (\${i.unit})</option>\`).join('');

      tbody.innerHTML = inventory.map(item => {
        let statusClass = 'healthy';
        let statusText = 'HEALTHY';
        if (item.available === 0) {
          statusClass = 'out';
          statusText = 'OUT OF STOCK';
        } else if (item.available <= item.reorderLevel) {
          statusClass = 'low';
          statusText = 'LOW STOCK';
        }

        return \`
          <tr>
            <td>
              <div style="font-weight:700;">\${item.productName}</div>
              <div class="mono" style="font-size:11px; color:var(--fg-subtle);">\${item.productId}</div>
            </td>
            <td>\${item.category}</td>
            <td><span class="mono">\${item.unit}</span></td>
            <td class="mono">\${item.onHand}</td>
            <td class="mono" style="color:var(--amber);">\${item.reserved}</td>
            <td class="mono" style="font-weight:800; color:var(--primary);">\${item.available}</td>
            <td><span class="stock-pill \${statusClass}">\${statusText}</span></td>
            <td>
              <button type="button" class="btn-action-secondary" style="padding:4px 8px; font-size:11px;" onclick="quickIntake('\${item.productId}')">
                + Intake
              </button>
            </td>
          </tr>
        \`;
      }).join('');
    }

    function quickIntake(prodId) {
      document.getElementById('intake-product-select').value = prodId;
      openModal('modal-stock-intake');
    }

    async function submitStockIntake() {
      const prodId = document.getElementById('intake-product-select').value;
      const qty = parseInt(document.getElementById('intake-qty').value, 10) || 10;
      try {
        await fetch('/api/v1/inventory/stocks/' + encodeURIComponent(prodId) + '/adjust', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Store-ID': STORE_ID,
          },
          body: JSON.stringify({
            deltaQuantity: qty,
            reason: 'INFLOW_PURCHASE',
          }),
        });
      } catch (err) {
        console.warn('Backend stock intake offline, updated locally');
      }
      const item = inventory.find(i => i.productId === prodId);
      if (item) {
        item.onHand += qty;
        item.available = item.onHand - item.reserved;
        renderInventory();
        closeModal('modal-stock-intake');
      }
    }

    // Catalog Rendering
    function renderCatalog() {
      const tbody = document.getElementById('catalog-table-body');
      tbody.innerHTML = inventory.map(item => {
        return \`
          <tr>
            <td><strong>\${item.productName}</strong></td>
            <td>\${item.category}</td>
            <td>\${item.unit}</td>
            <td class="mono">₹\${(item.unitPriceCents / 100).toFixed(2)}</td>
            <td><span class="stat-pill green">ACTIVE</span></td>
            <td>
              <button type="button" class="btn-action-secondary" style="padding:4px 8px; font-size:11px;" onclick="promptEditPrice('\${item.productId}')">
                Edit Price
              </button>
            </td>
          </tr>
        \`;
      }).join('');
    }

    function promptEditPrice(prodId) {
      const item = inventory.find(i => i.productId === prodId);
      if (!item) return;
      const current = (item.unitPriceCents / 100).toFixed(2);
      const res = prompt('Enter new price for ' + item.productName + ' (₹):', current);
      if (res && !isNaN(parseFloat(res))) {
        item.unitPriceCents = Math.round(parseFloat(res) * 100);
        renderCatalog();
        renderInventory();
      }
    }

    function submitNewProduct() {
      const name = document.getElementById('new-prod-name').value.trim();
      if (!name) return;
      const category = document.getElementById('new-prod-category').selectedOptions[0].innerText;
      const unit = document.getElementById('new-prod-unit').value;
      const price = parseFloat(document.getElementById('new-prod-price').value) || 100;
      const stock = parseInt(document.getElementById('new-prod-stock').value, 10) || 20;

      const newId = 'prod-' + name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 15);
      inventory.push({
        productId: newId,
        productName: name,
        category,
        unit,
        onHand: stock,
        reserved: 0,
        available: stock,
        reorderLevel: 5,
        unitPriceCents: Math.round(price * 100),
      });

      renderInventory();
      renderCatalog();
      closeModal('modal-add-product');
    }

    // Billing & Invoice Generation (ADR-005)
    function renderInvoices() {
      const tbody = document.getElementById('invoices-table-body');
      tbody.innerHTML = orders.map((o, idx) => {
        const invNum = 'INV-2026-' + (1000 + idx);
        const subtotal = (o.subtotalCents / 100).toFixed(2);
        const tax = (o.taxCents / 100).toFixed(2);
        const total = (o.totalCents / 100).toFixed(2);
        return \`
          <tr>
            <td class="mono" style="font-weight:700;">\${invNum}</td>
            <td>\${o.createdAt.split('T')[0]}</td>
            <td>\${o.customerName}</td>
            <td class="mono">\${o.orderNumber}</td>
            <td class="mono">₹\${subtotal}</td>
            <td class="mono">₹\${tax}</td>
            <td class="mono" style="font-weight:800;">₹\${total}</td>
            <td><span class="stat-pill \${o.paymentStatus === 'PAID' ? 'green' : 'amber'}">\${o.paymentStatus}</span></td>
            <td>
              <button type="button" class="btn-action-secondary" style="padding:4px 8px; font-size:11px;" onclick="viewInvoice('\${o.id}')">
                View Tax Invoice
              </button>
            </td>
          </tr>
        \`;
      }).join('');
    }

    function viewInvoice(orderId) {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;
      activeInvoiceOrder = order;

      const subtotal = (order.subtotalCents / 100).toFixed(2);
      const tax = (order.taxCents / 100).toFixed(2);
      const cgst = ((order.taxCents / 2) / 100).toFixed(2);
      const sgst = ((order.taxCents / 2) / 100).toFixed(2);
      const delivery = (order.deliveryFeeCents / 100).toFixed(2);
      const total = (order.totalCents / 100).toFixed(2);

      const itemsHtml = order.items.map(it => \`
        <tr>
          <td>\${it.productName}</td>
          <td>\${it.quantity} \${it.unit.toLowerCase()}</td>
          <td style="text-align:right;">₹\${(it.unitPriceCents / 100).toFixed(2)}</td>
          <td style="text-align:right; font-weight:700;">₹\${(it.totalPriceCents / 100).toFixed(2)}</td>
        </tr>
      \`).join('');

      document.getElementById('invoice-printable-content').innerHTML = \`
        <div class="invoice-header-row">
          <div>
            <h2 style="font-size:18px; font-weight:800; margin-bottom:4px;">TAX INVOICE / BILL OF SUPPLY</h2>
            <div style="font-weight:700;">${data.storeName}</div>
            <div style="font-size:11px; color:#64748b;">GSTIN: 27AABCL1234D1Z5 • FSSAI: 11521018000456</div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:700; font-family:monospace;">INV-\${order.orderNumber}</div>
            <div style="font-size:11px; color:#64748b;">Date: \${new Date().toLocaleDateString('en-IN')}</div>
          </div>
        </div>

        <div style="margin-bottom:12px;">
          <div style="font-size:11px; font-weight:700; color:#64748b;">BILLED TO:</div>
          <div style="font-weight:700;">\${order.customerName} (\${order.customerPhone})</div>
          <div style="font-size:11px;">\${order.deliveryAddress}</div>
        </div>

        <table class="invoice-items-table">
          <thead>
            <tr>
              <th>Description of Goods</th>
              <th>Qty</th>
              <th style="text-align:right;">Rate</th>
              <th style="text-align:right;">Amount (INR)</th>
            </tr>
          </thead>
          <tbody>
            \${itemsHtml}
          </tbody>
        </table>

        <div class="invoice-totals">
          <div style="display:flex; justify-content:space-between;">
            <span>Subtotal:</span>
            <span>₹\${subtotal}</span>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:11px; color:#64748b;">
            <span>CGST (2.5%):</span>
            <span>₹\${cgst}</span>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:11px; color:#64748b;">
            <span>SGST (2.5%):</span>
            <span>₹\${sgst}</span>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span>Delivery Charges:</span>
            <span>₹\${delivery}</span>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:15px; font-weight:800; border-top:1px dashed #cbd5e1; padding-top:6px; margin-top:4px;">
            <span>Total Payable:</span>
            <span>₹\${total}</span>
          </div>
        </div>
      \`;

      openModal('modal-invoice-viewer');
    }

    function dispatchInvoiceWhatsApp() {
      if (!activeInvoiceOrder) return;
      sendWhatsAppNotification(activeInvoiceOrder.id);
    }

    function sendWhatsAppNotification(orderId) {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;
      const cleanPhone = order.customerPhone.replace(/[^0-9]/g, '');
      const total = (order.totalCents / 100).toFixed(2);
      
      let text = 'Hello ' + order.customerName + ', your order ' + order.orderNumber + ' with ${data.storeName.replace(/'/g, "\\'")} has been confirmed!\\n';
      text += 'Status: ' + order.status + '\\n';
      text += 'Total Amount: ₹' + total + '\\n';
      text += 'Track your order: http://localhost:3000/';

      const url = 'https://wa.me/' + cleanPhone + '?text=' + encodeURIComponent(text);
      window.open(url, '_blank');
    }

    // Live Inbound Order Placement & Sync
    async function simulateNewIncomingOrder() {
      const sampleProd = inventory[0] || { productId: '11111111-1111-4111-8111-000000000001', productName: 'Fresh Fuji Apples', unitPriceCents: 14000, unit: 'KG' };
      const payload = {
        customerName: 'Pooja Verma',
        customerPhone: '+919820011223',
        fulfillmentType: 'DELIVERY',
        deliveryAddress: 'Flat 12, Ocean View, Carter Road, Bandra West',
        items: [
          {
            productId: sampleProd.productId,
            quantity: 2,
          },
        ],
      };

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
          const bo = data.order;
          orders.unshift({
            id: bo.id,
            orderNumber: bo.orderNumber,
            customerName: bo.customerName || 'Pooja Verma',
            customerPhone: bo.customerPhone || '+919820011223',
            deliveryAddress: bo.deliveryAddress || 'Flat 12, Ocean View, Carter Road',
            channel: 'STOREFRONT',
            status: bo.status,
            createdAt: bo.createdAt,
            items: bo.items.map(it => ({
              id: it.id,
              productId: it.productId,
              productName: it.productName,
              quantity: it.quantity,
              unit: it.unit,
              unitPriceCents: it.unitPriceCents,
              totalPriceCents: it.totalPriceCents,
            })),
            subtotalCents: bo.totalAmountCents,
            taxCents: Math.round(bo.totalAmountCents * 0.05),
            deliveryFeeCents: 0,
            totalCents: bo.totalAmountCents,
            paymentStatus: 'UNPAID',
          });
          renderOrders();
          renderInvoices();
          return;
        }
      } catch (err) {
        console.warn('Backend unavailable, simulating locally');
      }

      const id = '00000000-0000-4000-8000-' + String(Date.now()).padStart(12, '0').slice(-12);
      const num = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
      orders.unshift({
        id,
        orderNumber: num,
        customerName: 'Pooja Verma',
        customerPhone: '+919820011223',
        deliveryAddress: 'Flat 12, Ocean View, Carter Road, Bandra West',
        channel: 'WHATSAPP',
        status: 'AWAITING_SHOPKEEPER_REVIEW',
        createdAt: new Date().toISOString(),
        items: [
          {
            id: '00000000-0000-4000-8000-000000000999',
            productId: sampleProd.productId,
            productName: sampleProd.productName,
            quantity: 2,
            unit: sampleProd.unit,
            unitPriceCents: sampleProd.unitPriceCents,
            totalPriceCents: sampleProd.unitPriceCents * 2,
          },
        ],
        subtotalCents: sampleProd.unitPriceCents * 2,
        taxCents: Math.round(sampleProd.unitPriceCents * 2 * 0.05),
        deliveryFeeCents: 4000,
        totalCents: sampleProd.unitPriceCents * 2 + Math.round(sampleProd.unitPriceCents * 2 * 0.05) + 4000,
        paymentStatus: 'UNPAID',
      });
      renderOrders();
      renderInvoices();
    }

    // Load Live Orders from Backend API Gateway
    async function loadLiveOrdersFromBackend() {
      try {
        const res = await fetch('/api/v1/orders?limit=50', {
          headers: { 'X-Store-ID': STORE_ID },
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.data) && data.data.length > 0) {
            const backendOrders = data.data.map(o => ({
              id: o.id,
              orderNumber: o.orderNumber,
              customerName: o.customerName || 'Customer',
              customerPhone: o.customerPhone || '+919876543210',
              deliveryAddress: o.deliveryAddress || 'Store Pickup',
              channel: 'STOREFRONT',
              status: o.status,
              createdAt: o.createdAt,
              items: o.items.map(it => ({
                id: it.id,
                productId: it.productId,
                productName: it.productName,
                quantity: it.quantity,
                unit: it.unit,
                unitPriceCents: it.unitPriceCents,
                totalPriceCents: it.totalPriceCents,
              })),
              subtotalCents: o.items.reduce((s, it) => s + it.totalPriceCents, 0),
              taxCents: Math.round(o.totalAmountCents * 0.05),
              deliveryFeeCents: 0,
              totalCents: o.totalAmountCents,
              paymentStatus: o.status === 'COMPLETED' ? 'PAID' : 'UNPAID',
            }));
            backendOrders.forEach(bo => {
              const idx = orders.findIndex(o => o.id === bo.id);
              if (idx >= 0) {
                orders[idx] = bo;
              } else {
                orders.unshift(bo);
              }
            });
            renderOrders();
            renderInvoices();
          }
        }
      } catch (err) {
        // Backend not reachable, keep default sample data
      }
    }

    // Initial render
    renderOrders();
    renderInventory();
    renderCatalog();
    renderInvoices();
    loadLiveOrdersFromBackend();
  </script>
</body>
</html>`;
}
