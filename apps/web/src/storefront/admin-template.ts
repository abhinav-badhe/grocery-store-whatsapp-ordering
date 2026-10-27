/**
 * Shopkeeper Admin Operations Console Template
 * Conforms strictly to STYLE.md (SaaS UI patterns, compact sidebar, KPI cards, data tables, hairline borders, copy rules)
 */

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
  const pendingCount = data.orders.filter((o) => o.status === 'AWAITING_SHOPKEEPER_REVIEW').length;
  const activeCount = data.orders.filter(
    (o) => o.status === 'CONFIRMED' || o.status === 'PREPARING' || o.status === 'PACKING',
  ).length;
  const lowStockCount = data.inventory.filter((i) => i.available <= i.reorderLevel).length;
  const todayRevenueCents = data.orders
    .filter((o) => o.status !== 'CANCELLED')
    .reduce((sum, o) => sum + o.totalCents, 0);

  const orderRows =
    data.orders.length > 0
      ? data.orders
          .map((order) => {
            const isPending = order.status === 'AWAITING_SHOPKEEPER_REVIEW';
            const statusClass = isPending
              ? 'badge-pending'
              : order.status === 'CONFIRMED'
                ? 'badge-confirmed'
                : 'badge-neutral';
            const actionBtn = isPending
              ? `<button type="button" class="btn-action btn-confirm" onclick="confirmOrder('${order.id}')">Confirm order</button>`
              : order.status === 'CONFIRMED'
                ? `<button type="button" class="btn-action btn-secondary" onclick="generateInvoice('${order.id}')">Generate invoice</button>`
                : `<span class="text-muted">Settled</span>`;

            return `
        <tr id="order-row-${order.id}">
          <td class="font-mono">${order.orderNumber}</td>
          <td>
            <div class="customer-info">
              <span class="customer-name">${order.customerName}</span>
              <span class="customer-phone">${order.customerPhone}</span>
            </div>
          </td>
          <td><span class="badge ${statusClass}">${order.status.replace(/_/g, ' ')}</span></td>
          <td>${order.items.length} items</td>
          <td class="font-mono">₹${(order.totalCents / 100).toFixed(2)}</td>
          <td>${actionBtn}</td>
        </tr>`;
          })
          .join('')
      : `<tr><td colspan="6" class="table-empty">No orders found. New incoming orders will appear here.</td></tr>`;

  const inventoryRows =
    data.inventory.length > 0
      ? data.inventory
          .map((item) => {
            const isLow = item.available <= item.reorderLevel;
            return `
        <tr id="inv-row-${item.productId}">
          <td><strong>${item.productName}</strong></td>
          <td>${item.category}</td>
          <td class="font-mono">${item.onHand} ${item.unit.toLowerCase()}</td>
          <td class="font-mono">${item.reserved} ${item.unit.toLowerCase()}</td>
          <td class="font-mono ${isLow ? 'text-danger' : ''}">${item.available} ${item.unit.toLowerCase()}</td>
          <td>
            <div class="stock-action-group">
              <input type="number" id="intake-qty-${item.productId}" class="stock-input" placeholder="Qty" min="1" value="10" />
              <button type="button" class="btn-action btn-secondary" onclick="addStock('${item.productId}')">Add stock</button>
            </div>
          </td>
        </tr>`;
          })
          .join('')
      : `<tr><td colspan="6" class="table-empty">No inventory records available.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${data.storeName} — Shopkeeper & Admin Operations Console</title>
  <meta name="description" content="Shopkeeper operations console for order review, stock adjustments, and tax invoices." />
  <style>
    /* Design Tokens per STYLE.md §2 and §3 */
    :root {
      --bg: #090d16;
      --surface: #0f172a;
      --surface-elevated: #162032;
      --border: #1e293b;
      --fg: #f8fafc;
      --fg-muted: #94a3b8;
      --primary: #059669; /* Deliberate rich emerald */
      --primary-hover: #047857;
      --primary-light: rgba(5, 150, 105, 0.15);
      --amber: #d97706;
      --amber-light: rgba(217, 119, 6, 0.15);
      --red: #dc2626;
      --red-light: rgba(220, 38, 38, 0.15);
      --radius: 8px; /* Capped at 8-12px per STYLE.md §4.2 */
      --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--font-family);
      font-size: 13px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      display: flex;
      min-height: 100vh;
    }

    /* Fixed Compact Sidebar per STYLE.md §6 Navigation */
    aside.sidebar {
      width: 220px;
      background: var(--surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }

    .sidebar-header {
      padding: 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .sidebar-badge {
      width: 28px;
      height: 28px;
      background: var(--primary);
      color: #ffffff;
      border-radius: var(--radius);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 13px;
    }

    .sidebar-title h1 {
      font-size: 14px;
      font-weight: 600;
      line-height: 1.2;
    }

    .sidebar-title p {
      font-size: 11px;
      color: var(--fg-muted);
    }

    .sidebar-nav {
      padding: 12px 8px;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .nav-item {
      height: 34px;
      padding: 0 12px;
      border-radius: var(--radius);
      color: var(--fg-muted);
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      background: transparent;
      width: 100%;
      text-align: left;
      transition: all 150ms ease;
    }

    .nav-item:hover {
      color: var(--fg);
      background: var(--surface-elevated);
    }

    .nav-item.active {
      color: #ffffff;
      background: var(--primary);
    }

    /* Main Content Area */
    main.content-area {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
    }

    /* Top Bar */
    .top-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
    }

    .page-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--fg);
    }

    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    /* KPI Cards per STYLE.md §6 Dashboards / KPI cards */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }

    .kpi-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
    }

    .kpi-label {
      font-size: 12px;
      color: var(--fg-muted);
      margin-bottom: 6px;
    }

    .kpi-value {
      font-size: 22px;
      font-weight: 700;
      color: var(--fg);
      line-height: 1.1;
    }

    .kpi-sub {
      font-size: 11.5px;
      color: var(--fg-muted);
      margin-top: 4px;
    }

    .kpi-sub.warning {
      color: var(--amber);
    }

    /* Data Tables per STYLE.md §6 Data tables */
    .table-section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin-bottom: 24px;
      overflow: hidden;
    }

    .table-header {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .table-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--fg);
    }

    table.data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    table.data-table th {
      background: var(--surface-elevated);
      color: var(--fg-muted);
      text-align: left;
      padding: 10px 16px;
      font-weight: 500;
      border-bottom: 1px solid var(--border);
      font-size: 12px;
    }

    table.data-table td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      color: var(--fg);
    }

    table.data-table tr:last-child td {
      border-bottom: none;
    }

    .font-mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12.5px;
    }

    .text-muted {
      color: var(--fg-muted);
    }

    .text-danger {
      color: var(--red);
      font-weight: 600;
    }

    .customer-info {
      display: flex;
      flex-direction: column;
    }

    .customer-name {
      font-weight: 500;
    }

    .customer-phone {
      font-size: 11.5px;
      color: var(--fg-muted);
    }

    /* Badges */
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 11.5px;
      font-weight: 500;
    }

    .badge-pending {
      background: var(--amber-light);
      color: var(--amber);
      border: 1px solid rgba(217, 119, 6, 0.3);
    }

    .badge-confirmed {
      background: var(--primary-light);
      color: var(--primary);
      border: 1px solid rgba(5, 150, 105, 0.3);
    }

    .badge-neutral {
      background: var(--surface-elevated);
      color: var(--fg-muted);
      border: 1px solid var(--border);
    }

    /* Buttons */
    .btn-action {
      height: 28px;
      padding: 0 10px;
      border-radius: var(--radius);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all 150ms ease;
    }

    .btn-confirm {
      background: var(--primary);
      color: #ffffff;
      border: none;
    }

    .btn-confirm:hover {
      background: var(--primary-hover);
    }

    .btn-secondary {
      background: var(--surface-elevated);
      color: var(--fg);
      border: 1px solid var(--border);
    }

    .btn-secondary:hover {
      border-color: var(--primary);
      color: var(--primary);
    }

    .stock-action-group {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .stock-input {
      width: 60px;
      height: 28px;
      padding: 0 6px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--fg);
      font-size: 12px;
      outline: none;
    }

    .table-empty {
      text-align: center;
      padding: 30px;
      color: var(--fg-muted);
    }

    /* Modal Backdrop & Dialog per STYLE.md §6 */
    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 20px;
    }

    .modal-backdrop.active {
      display: flex;
    }

    .modal-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      width: 100%;
      max-width: 620px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .modal-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .modal-title {
      font-size: 15px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .btn-close {
      background: transparent;
      border: none;
      color: var(--fg-muted);
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
      padding: 4px;
    }

    .btn-close:hover {
      color: var(--fg);
    }

    .modal-body {
      padding: 20px;
      overflow-y: auto;
      flex: 1;
    }

    .invoice-meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      padding: 12px;
      background: var(--surface-elevated);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      margin-bottom: 16px;
    }

    .invoice-meta-item label {
      display: block;
      font-size: 11px;
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 2px;
    }

    .invoice-meta-item span {
      font-weight: 500;
      color: var(--fg);
    }

    .invoice-items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }

    .invoice-items-table th {
      background: var(--surface-elevated);
      color: var(--fg-muted);
      text-align: left;
      padding: 8px 12px;
      font-size: 11.5px;
      border-bottom: 1px solid var(--border);
    }

    .invoice-items-table td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      font-size: 12.5px;
    }

    .invoice-summary {
      border-top: 1px dashed var(--border);
      padding-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .summary-row {
      display: flex;
      justify-content: space-between;
      font-size: 12.5px;
      color: var(--fg-muted);
    }

    .summary-row.total {
      font-size: 15px;
      font-weight: 700;
      color: var(--fg);
      border-top: 1px solid var(--border);
      padding-top: 8px;
      margin-top: 4px;
    }

    .modal-footer {
      padding: 14px 20px;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    /* Toast Notification */
    .toast-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 1100;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .toast {
      background: var(--surface-elevated);
      border: 1px solid var(--border);
      color: var(--fg);
      padding: 10px 16px;
      border-radius: var(--radius);
      font-size: 12.5px;
      display: flex;
      align-items: center;
      gap: 10px;
      animation: slideIn 200ms ease;
    }

    .toast.success {
      border-left: 3px solid var(--primary);
    }

    .toast.error {
      border-left: 3px solid var(--red);
    }

    @keyframes slideIn {
      from { transform: translateY(10px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  </style>
</head>
<body>
  <!-- Compact Fixed Sidebar per STYLE.md §6 -->
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-badge">${data.storeName.charAt(0)}</div>
      <div class="sidebar-title">
        <h1>${data.storeName}</h1>
        <p>Operations Console</p>
      </div>
    </div>
    <nav class="sidebar-nav">
      <button type="button" class="nav-item active" onclick="switchTab('orders')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
        <span>Orders</span>
      </button>
      <button type="button" class="nav-item" onclick="switchTab('inventory')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
        <span>Inventory</span>
      </button>
      <a href="/" class="nav-item">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
        <span>Storefront view</span>
      </a>
    </nav>
  </aside>

  <!-- Main Content -->
  <main class="content-area">
    <div class="top-toolbar">
      <h2 class="page-title" id="page-heading">Order Management</h2>
      <div class="toolbar-actions">
        <span class="text-muted" style="font-size:12px;">Store ID: ${data.storeId}</span>
      </div>
    </div>

    <!-- KPI Cards -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Pending Review</div>
        <div class="kpi-value" id="kpi-pending">${pendingCount}</div>
        <div class="kpi-sub warning">Requires shopkeeper confirmation</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Active Orders</div>
        <div class="kpi-value" id="kpi-active">${activeCount}</div>
        <div class="kpi-sub">Preparing or in dispatch</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Low Stock Items</div>
        <div class="kpi-value">${lowStockCount}</div>
        <div class="kpi-sub ${lowStockCount > 0 ? 'warning' : ''}">At or below reorder level</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Revenue</div>
        <div class="kpi-value">₹${(todayRevenueCents / 100).toFixed(0)}</div>
        <div class="kpi-sub">From non-cancelled orders</div>
      </div>
    </div>

    <!-- Orders Section -->
    <section class="table-section" id="section-orders">
      <div class="table-header">
        <h3 class="table-title">Order Processing Queue</h3>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Order Number</th>
            <th>Customer</th>
            <th>Status</th>
            <th>Line Items</th>
            <th>Total Amount</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody id="orders-tbody">
          ${orderRows}
        </tbody>
      </table>
    </section>

    <!-- Inventory Section -->
    <section class="table-section" id="section-inventory" style="display:none;">
      <div class="table-header">
        <h3 class="table-title">Stock Balances & Movements Ledger</h3>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Product Name</th>
            <th>Category</th>
            <th>On Hand</th>
            <th>Reserved</th>
            <th>Available</th>
            <th>Stock Inbound</th>
          </tr>
        </thead>
        <tbody id="inventory-tbody">
          ${inventoryRows}
        </tbody>
      </table>
    </section>
  </main>

  <!-- Tax Invoice Viewer Modal per STYLE.md §6 -->
  <div class="modal-backdrop" id="invoice-modal" onclick="if(event.target===this)closeModal('invoice-modal')">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">
          <span>Tax Invoice</span>
          <span class="badge badge-confirmed font-mono" id="modal-inv-num">INV-000</span>
        </div>
        <button type="button" class="btn-close" onclick="closeModal('invoice-modal')" aria-label="Close dialog">&times;</button>
      </div>
      <div class="modal-body">
        <div class="invoice-meta-grid">
          <div class="invoice-meta-item">
            <label>Order Reference</label>
            <span class="font-mono" id="modal-inv-order">-</span>
          </div>
          <div class="invoice-meta-item">
            <label>Issued Date</label>
            <span id="modal-inv-date">-</span>
          </div>
          <div class="invoice-meta-item">
            <label>Customer</label>
            <span id="modal-inv-customer">-</span>
          </div>
          <div class="invoice-meta-item">
            <label>Phone</label>
            <span id="modal-inv-phone">-</span>
          </div>
          <div class="invoice-meta-item" style="grid-column: span 2;">
            <label>Delivery Address</label>
            <span id="modal-inv-address">-</span>
          </div>
        </div>

        <table class="invoice-items-table">
          <thead>
            <tr>
              <th>Item Snapshot</th>
              <th>Qty</th>
              <th style="text-align:right;">Unit Rate</th>
              <th style="text-align:right;">Line Total</th>
            </tr>
          </thead>
          <tbody id="modal-inv-items">
          </tbody>
        </table>

        <div class="invoice-summary">
          <div class="summary-row">
            <span>Subtotal (excl. GST):</span>
            <span class="font-mono" id="modal-inv-subtotal">₹0.00</span>
          </div>
          <div class="summary-row">
            <span>CGST (2.5%):</span>
            <span class="font-mono" id="modal-inv-cgst">₹0.00</span>
          </div>
          <div class="summary-row">
            <span>SGST (2.5%):</span>
            <span class="font-mono" id="modal-inv-sgst">₹0.00</span>
          </div>
          <div class="summary-row total">
            <span>Total Payable:</span>
            <span class="font-mono" id="modal-inv-total">₹0.00</span>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-action btn-secondary" onclick="window.print()">Print invoice</button>
        <button type="button" class="btn-action btn-confirm" onclick="closeModal('invoice-modal')">Close</button>
      </div>
    </div>
  </div>

  <div class="toast-container" id="toast-container"></div>

  <script>
    const STORE_ID = '${data.storeId}';
    let currentOrders = ${JSON.stringify(data.orders)};

    function showToast(message, type = 'success') {
      const container = document.getElementById('toast-container');
      if (!container) return;
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      toast.innerText = message;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 300ms ease';
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }

    function closeModal(id) {
      const modal = document.getElementById(id);
      if (modal) modal.classList.remove('active');
    }

    function openModal(id) {
      const modal = document.getElementById(id);
      if (modal) modal.classList.add('active');
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal('invoice-modal');
      }
    });

    function switchTab(tab) {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      event.currentTarget.classList.add('active');

      if (tab === 'orders') {
        document.getElementById('page-heading').innerText = 'Order Management';
        document.getElementById('section-orders').style.display = 'block';
        document.getElementById('section-inventory').style.display = 'none';
      } else {
        document.getElementById('page-heading').innerText = 'Inventory Balances';
        document.getElementById('section-orders').style.display = 'none';
        document.getElementById('section-inventory').style.display = 'block';
      }
    }

    async function confirmOrder(orderId) {
      const row = document.getElementById('order-row-' + orderId);
      const btn = row ? row.querySelector('.btn-confirm') : null;
      if (btn) {
        btn.disabled = true;
        btn.innerText = 'Confirming...';
      }

      try {
        const res = await fetch('/api/v1/orders/' + orderId + '/confirm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Store-ID': STORE_ID,
          },
          body: JSON.stringify({ userId: 'shopkeeper' }),
        });

        if (res.ok) {
          const data = await res.json();
          const confirmedOrder = data.order;

          const found = currentOrders.find(o => o.id === orderId);
          if (found) {
            found.status = 'CONFIRMED';
          }

          if (row) {
            const badge = row.querySelector('.badge');
            if (badge) {
              badge.className = 'badge badge-confirmed';
              badge.innerText = 'CONFIRMED';
            }
            const lastCell = row.cells[5];
            lastCell.innerHTML = '<button type="button" class="btn-action btn-secondary" onclick="generateInvoice(\\'' + orderId + '\\')">Generate invoice</button>';
          }

          updateKpis();
          showToast('Order ' + (confirmedOrder.orderNumber || '') + ' confirmed and stock reserved.', 'success');
        } else {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.detail || errData.title || 'Failed to confirm order';
          showToast(errMsg, 'error');
          if (btn) {
            btn.disabled = false;
            btn.innerText = 'Confirm order';
          }
        }
      } catch (err) {
        console.error('Error confirming order:', err);
        showToast('Network error while confirming order', 'error');
        if (btn) {
          btn.disabled = false;
          btn.innerText = 'Confirm order';
        }
      }
    }

    async function generateInvoice(orderId) {
      const row = document.getElementById('order-row-' + orderId);
      const btn = row ? row.querySelector('button') : null;
      const originalText = btn ? btn.innerText : 'Generate invoice';
      if (btn) {
        btn.disabled = true;
        btn.innerText = 'Loading...';
      }

      try {
        let res = await fetch('/api/v1/orders/' + orderId + '/invoice', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Store-ID': STORE_ID,
          },
          body: JSON.stringify({ taxRateBasisPoints: 500 }),
        });

        if (!res.ok) {
          res = await fetch('/api/v1/orders/' + orderId + '/invoice', {
            method: 'GET',
            headers: {
              'X-Store-ID': STORE_ID,
            },
          });
        }

        if (res.ok) {
          const data = await res.json();
          displayInvoiceModal(orderId, data.invoice, data.lines);
          if (btn) {
            btn.innerText = 'View invoice';
            btn.disabled = false;
          }
          showToast('Tax invoice ready: ' + data.invoice.invoiceNumber, 'success');
        } else {
          const errData = await res.json().catch(() => ({}));
          const errMsg = errData.detail || errData.title || 'Could not generate invoice. Confirm order first.';
          showToast(errMsg, 'error');
          if (btn) {
            btn.disabled = false;
            btn.innerText = originalText;
          }
        }
      } catch (err) {
        console.error('Error generating invoice:', err);
        showToast('Network error generating invoice', 'error');
        if (btn) {
          btn.disabled = false;
          btn.innerText = originalText;
        }
      }
    }

    function displayInvoiceModal(orderId, invoice, lines) {
      const order = currentOrders.find(o => o.id === orderId) || {};
      document.getElementById('modal-inv-num').innerText = invoice.invoiceNumber;
      document.getElementById('modal-inv-date').innerText = new Date(invoice.createdAt || Date.now()).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      document.getElementById('modal-inv-order').innerText = order.orderNumber || 'ORD-' + orderId.slice(0, 8);
      document.getElementById('modal-inv-customer').innerText = order.customerName || 'Walk-in Customer';
      document.getElementById('modal-inv-phone').innerText = order.customerPhone || 'N/A';
      document.getElementById('modal-inv-address').innerText = order.deliveryAddress || 'Store Pickup';

      const tbody = document.getElementById('modal-inv-items');
      tbody.innerHTML = (lines || []).map(line => \`
        <tr>
          <td><strong>\${line.itemNameSnapshot}</strong></td>
          <td class="font-mono">\${line.quantity} \${line.unitOfMeasureSnapshot || 'unit'}</td>
          <td class="font-mono" style="text-align:right;">₹\${(Number(line.unitPriceMinorSnapshot) / 100).toFixed(2)}</td>
          <td class="font-mono" style="text-align:right;">₹\${(Number(line.lineTotalMinor) / 100).toFixed(2)}</td>
        </tr>
      \`).join('');

      const subtotal = Number(invoice.subtotalMinor) / 100;
      const tax = Number(invoice.taxTotalMinor) / 100;
      const grandTotal = Number(invoice.grandTotalMinor) / 100;

      document.getElementById('modal-inv-subtotal').innerText = '₹' + subtotal.toFixed(2);
      document.getElementById('modal-inv-cgst').innerText = '₹' + (tax / 2).toFixed(2);
      document.getElementById('modal-inv-sgst').innerText = '₹' + (tax / 2).toFixed(2);
      document.getElementById('modal-inv-total').innerText = '₹' + grandTotal.toFixed(2);

      openModal('invoice-modal');
    }

    function updateKpis() {
      const pending = currentOrders.filter(o => o.status === 'AWAITING_SHOPKEEPER_REVIEW').length;
      const active = currentOrders.filter(o => o.status === 'CONFIRMED' || o.status === 'PREPARING' || o.status === 'PACKING').length;
      const elPending = document.getElementById('kpi-pending');
      const elActive = document.getElementById('kpi-active');
      if (elPending) elPending.innerText = pending;
      if (elActive) elActive.innerText = active;
    }

    async function loadLiveOrdersFromBackend() {
      try {
        const res = await fetch('/api/v1/orders?limit=50', {
          headers: { 'X-Store-ID': STORE_ID },
        });
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.data) && json.data.length > 0) {
            json.data.forEach(bo => {
              const idx = currentOrders.findIndex(o => o.id === bo.id);
              const mapped = {
                id: bo.id,
                orderNumber: bo.orderNumber,
                customerName: bo.customerName || 'Customer',
                customerPhone: bo.customerPhone || 'N/A',
                deliveryAddress: bo.deliveryAddress || 'Store Pickup',
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
                paymentStatus: bo.status === 'COMPLETED' ? 'PAID' : 'UNPAID',
              };
              if (idx >= 0) {
                currentOrders[idx] = mapped;
              } else {
                currentOrders.unshift(mapped);
              }
            });
            renderOrdersTable();
            updateKpis();
          }
        }
      } catch (err) {
        // Backend not reachable, retain initialized rows
      }
    }

    function renderOrdersTable() {
      const tbody = document.getElementById('orders-tbody');
      if (!tbody) return;
      if (currentOrders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No orders found.</td></tr>';
        return;
      }
      tbody.innerHTML = currentOrders.map(order => {
        const isPending = order.status === 'AWAITING_SHOPKEEPER_REVIEW';
        const isConfirmed = order.status === 'CONFIRMED';
        const statusClass = isPending ? 'badge-pending' : isConfirmed ? 'badge-confirmed' : 'badge-neutral';
        const actionBtn = isPending
          ? \`<button type="button" class="btn-action btn-confirm" onclick="confirmOrder('\${order.id}')">Confirm order</button>\`
          : (isConfirmed || order.status === 'PREPARING')
          ? \`<button type="button" class="btn-action btn-secondary" onclick="generateInvoice('\${order.id}')">Generate invoice</button>\`
          : \`<span class="text-muted">Settled</span>\`;

        return \`
          <tr id="order-row-\${order.id}">
            <td class="font-mono">\${order.orderNumber}</td>
            <td>
              <div class="customer-info">
                <span class="customer-name">\${order.customerName}</span>
                <span class="customer-phone">\${order.customerPhone}</span>
              </div>
            </td>
            <td><span class="badge \${statusClass}">\${order.status.replace(/_/g, ' ')}</span></td>
            <td>\${order.items.length} items</td>
            <td class="font-mono">₹\${(order.totalCents / 100).toFixed(2)}</td>
            <td>\${actionBtn}</td>
          </tr>
        \`;
      }).join('');
    }

    async function addStock(productId) {
      const input = document.getElementById('intake-qty-' + productId);
      const qty = parseInt(input.value, 10);
      if (isNaN(qty) || qty <= 0) return;

      try {
        const res = await fetch('/api/v1/inventory/' + productId + '/movements', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Store-ID': STORE_ID,
          },
          body: JSON.stringify({
            movementType: 'INBOUND',
            quantity: qty,
            reason: 'RESTOCK',
          }),
        });
        if (res.ok) {
          const row = document.getElementById('inv-row-' + productId);
          if (row) {
            const onHandCell = row.cells[2];
            const availCell = row.cells[4];
            const currentAvail = parseInt(availCell.innerText, 10) || 0;
            availCell.innerText = (currentAvail + qty) + ' units';
            onHandCell.innerText = (currentAvail + qty) + ' units';
          }
          showToast('Added ' + qty + ' units to stock inventory.', 'success');
        }
      } catch (err) {
        console.error('Error adding stock:', err);
        showToast('Failed to add stock', 'error');
      }
    }

    // Auto load backend orders
    loadLiveOrdersFromBackend();
  </script>
</body>
</html>`;
}
