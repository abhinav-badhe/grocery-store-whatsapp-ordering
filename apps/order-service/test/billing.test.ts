import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InvoiceService, InMemoryInvoiceRepository } from '../dist/index.js';
import { InMemoryStorageService } from '@grocery/service-runtime';
import type { OrderRepository, OrderWithItems } from '../src/persistence/types.js';

class MockOrderRepository implements Partial<OrderRepository> {
  private readonly orders = new Map<string, OrderWithItems>();

  setOrder(order: OrderWithItems) {
    this.orders.set(order.id, order);
  }

  async findById(storeId: string, orderId: string): Promise<OrderWithItems | null> {
    const order = this.orders.get(orderId);
    if (!order || order.store_id !== storeId) return null;
    return order;
  }
}

describe('Billing & Invoice Module (ADR-001, ADR-002, ADR-005, ADR-010)', () => {
  const storeId = '550e8400-e29b-41d4-a716-446655440000';
  const orderId = '660e8400-e29b-41d4-a716-446655440001';

  const sampleConfirmedOrder: OrderWithItems = {
    id: orderId,
    store_id: storeId,
    customer_id: 'usr-1',
    order_number: 'ORD-2026-001',
    status: 'CONFIRMED',
    fulfillment_type: 'PICKUP',
    delivery_address: null,
    customer_phone: '+919876543210',
    customer_name: 'Rahul Sharma',
    total_amount_cents: 20000n, // ₹200.00
    currency: 'INR',
    notes: null,
    idempotency_key: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    items: [
      {
        id: 'item-1',
        order_id: orderId,
        store_id: storeId,
        product_id: 'prod-atta',
        product_name_snapshot: 'Aashirvaad Atta 5kg',
        sku_snapshot: 'AASH-5KG',
        unit_snapshot: 'PACK',
        unit_price_cents: 18000n, // ₹180.00
        quantity: '1',
        total_price_cents: 18000n,
        status: 'CONFIRMED',
        substituted_product_id: null,
        substitution_notes: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'item-2',
        order_id: orderId,
        store_id: storeId,
        product_id: 'prod-tomato',
        product_name_snapshot: 'Fresh Tomato',
        sku_snapshot: 'TOM-KG',
        unit_snapshot: 'KG',
        unit_price_cents: 4000n, // ₹40.00 / kg
        quantity: '0.5', // 500g -> ₹20.00
        total_price_cents: 2000n,
        status: 'CONFIRMED',
        substituted_product_id: null,
        substitution_notes: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  };

  it('rejects invoice generation for orders awaiting shopkeeper review (ADR-007 invariant)', async () => {
    const orderRepo = new MockOrderRepository();
    orderRepo.setOrder({
      ...sampleConfirmedOrder,
      status: 'AWAITING_SHOPKEEPER_REVIEW',
    });

    const invoiceService = new InvoiceService({
      orderRepository: orderRepo as unknown as OrderRepository,
    });

    await assert.rejects(
      () => invoiceService.generateInvoice(storeId, orderId),
      /Cannot generate invoice for order in status AWAITING_SHOPKEEPER_REVIEW/,
    );
  });

  it('generates itemized tax invoice with exact integer paise GST & snapshots (ADR-005 & ADR-010)', async () => {
    const orderRepo = new MockOrderRepository();
    orderRepo.setOrder(sampleConfirmedOrder);
    const storageService = new InMemoryStorageService();

    const invoiceService = new InvoiceService({
      orderRepository: orderRepo as unknown as OrderRepository,
      storageService,
    });

    // 5% GST (500 basis points)
    const result = await invoiceService.generateInvoice(storeId, orderId, {
      taxRateBasisPoints: 500,
    });
    const { invoice, lines } = result;

    assert.ok(invoice.invoiceNumber.startsWith('INV-'));
    assert.equal(lines.length, 2);

    // Item 1: 1 * 18000 = 18000 paise. 5% tax = 900 paise.
    assert.equal(lines[0].lineTotalMinor, 18000n);
    assert.equal(lines[0].taxAmountMinor, 900n);

    // Item 2: 0.5 * 4000 = 2000 paise. 5% tax = 100 paise.
    assert.equal(lines[1].lineTotalMinor, 2000n);
    assert.equal(lines[1].taxAmountMinor, 100n);

    // Subtotal = 18000 + 2000 = 20000 paise (₹200.00)
    assert.equal(invoice.subtotalMinor, 20000n);
    // Tax total = 900 + 100 = 1000 paise (₹10.00)
    assert.equal(invoice.taxTotalMinor, 1000n);
    // Grand total = 21000 paise (₹210.00)
    assert.equal(invoice.grandTotalMinor, 21000n);

    // Verify storage upload
    assert.ok(invoice.storageKey);
    const uploadedFile = await storageService.getFile(invoice.storageKey);
    assert.ok(uploadedFile);
    assert.equal(uploadedFile.contentType, 'application/pdf');

    // Idempotent generation returns same invoice
    const secondCall = await invoiceService.generateInvoice(storeId, orderId);
    assert.equal(secondCall.invoice.id, invoice.id);
  });

  it('issues a credit note balancing the ledger on cancellation (ADR-005 §5)', async () => {
    const orderRepo = new MockOrderRepository();
    orderRepo.setOrder(sampleConfirmedOrder);

    const invoiceService = new InvoiceService({
      orderRepository: orderRepo as unknown as OrderRepository,
    });

    const { invoice } = await invoiceService.generateInvoice(storeId, orderId);
    const creditNote = await invoiceService.issueCreditNote(
      storeId,
      invoice.id,
      'Customer cancelled after confirmation',
    );

    assert.ok(creditNote.creditNoteNumber.startsWith('CRN-'));
    assert.equal(creditNote.amountMinor, invoice.grandTotalMinor);

    const updatedInvoice = await invoiceService.getInvoiceById(storeId, invoice.id);
    assert.equal(updatedInvoice?.invoice.status, 'CANCELLED');
  });
});
