/**
 * Billing & Invoice Service
 * Conforms to ADR-001 (Co-located Billing), ADR-005 (GST & Rounding), and ADR-010 (Minor Units)
 */

import crypto from 'node:crypto';
import { Invoice, InvoiceLineSnapshot, CreditNote } from './types.js';
import { InvoiceRepositoryPort, InMemoryInvoiceRepository } from './invoice-repository.js';
import type { OrderRepository } from '../persistence/types.js';
import type { OrderItemRow } from '@grocery/database';
import { StorageServicePort } from '@grocery/service-runtime';

export interface InvoiceServiceOptions {
  readonly invoiceRepository?: InvoiceRepositoryPort;
  readonly orderRepository: OrderRepository;
  readonly storageService?: StorageServicePort;
}

export class InvoiceService {
  private readonly invoiceRepo: InvoiceRepositoryPort;
  private readonly orderRepo: OrderRepository;
  private readonly storage?: StorageServicePort;

  constructor(options: InvoiceServiceOptions) {
    this.invoiceRepo = options.invoiceRepository ?? new InMemoryInvoiceRepository();
    this.orderRepo = options.orderRepository;
    this.storage = options.storageService;
  }

  async generateInvoice(
    storeId: string,
    orderId: string,
    options?: { taxRateBasisPoints?: number },
  ): Promise<{ invoice: Invoice; lines: InvoiceLineSnapshot[] }> {
    // 1. Check if invoice already issued for this order (idempotent lookup)
    const existing = await this.invoiceRepo.findByOrderId(storeId, orderId);
    if (existing) {
      return existing;
    }

    // 2. Fetch order and verify tenant ownership
    const order = await this.orderRepo.findById(storeId, orderId);
    if (!order) {
      throw new Error(`Order not found or access denied: ${orderId}`);
    }

    const unconfirmedStatuses = ['RECEIVED', 'AWAITING_SHOPKEEPER_REVIEW', 'CHANGE_REQUESTED', 'REJECTED'];
    if (unconfirmedStatuses.includes(order.status)) {
      throw new Error(`Cannot generate invoice for order in status ${order.status}. Order must be confirmed first.`);
    }

    // 3. Compute item snapshots & GST breakdown in integer paise (ADR-005 & ADR-010)
    const taxRateBps = options?.taxRateBasisPoints ?? 500; // 5% default GST
    const invoiceId = crypto.randomUUID();
    const currentYear = new Date().getFullYear().toString();
    const invoiceNumber = await this.invoiceRepo.getNextInvoiceNumber(storeId, currentYear);

    let subtotalMinor = 0n;
    let taxTotalMinor = 0n;

    const lines: InvoiceLineSnapshot[] = order.items.map((item: OrderItemRow) => {
      const quantityNum = Number(item.quantity);
      const unitPriceMinor = BigInt(item.unit_price_cents);
      const lineTotal = BigInt(Math.round(quantityNum * Number(unitPriceMinor)));
      const taxAmount = BigInt(Math.round((Number(lineTotal) * taxRateBps) / 10000));

      subtotalMinor += lineTotal;
      taxTotalMinor += taxAmount;

      return {
        id: crypto.randomUUID(),
        invoiceId,
        storeId,
        productId: item.product_id,
        itemNameSnapshot: item.product_name_snapshot ?? (item as any).product_name ?? 'Grocery Item',
        skuSnapshot: item.sku_snapshot ?? (item as any).sku ?? null,
        unitOfMeasureSnapshot: item.unit_snapshot ?? (item as any).unit ?? 'UNIT',
        unitPriceMinorSnapshot: unitPriceMinor,
        quantity: quantityNum,
        taxRateBasisPoints: taxRateBps,
        taxAmountMinor: taxAmount,
        lineTotalMinor: lineTotal,
      };
    });

    const grandTotalMinor = subtotalMinor + taxTotalMinor;

    const invoice: Invoice = {
      id: invoiceId,
      storeId,
      orderId,
      invoiceNumber,
      subtotalMinor,
      taxTotalMinor,
      grandTotalMinor,
      currency: order.currency ?? 'INR',
      status: 'ISSUED',
      storageKey: `stores/${storeId}/invoices/${currentYear}/${invoiceId}.pdf`,
      createdAt: new Date().toISOString(),
    };

    // 4. Optionally upload PDF buffer to object storage (ADR-008)
    if (this.storage) {
      const mockPdfBuffer = Buffer.from(
        `%PDF-1.4\n% INVOICE: ${invoiceNumber}\nTotal: INR ${(Number(grandTotalMinor) / 100).toFixed(2)}\n`,
      );
      await this.storage.uploadBuffer({
        storeId,
        fileKey: invoice.storageKey!,
        buffer: mockPdfBuffer,
        contentType: 'application/pdf',
      });
    }

    // 5. Persist invoice and line snapshots
    await this.invoiceRepo.createInvoice(invoice, lines);

    return { invoice, lines };
  }

  async getInvoiceByOrderId(
    storeId: string,
    orderId: string,
  ): Promise<{ invoice: Invoice; lines: InvoiceLineSnapshot[] } | null> {
    return this.invoiceRepo.findByOrderId(storeId, orderId);
  }

  async getInvoiceById(
    storeId: string,
    invoiceId: string,
  ): Promise<{ invoice: Invoice; lines: InvoiceLineSnapshot[] } | null> {
    return this.invoiceRepo.findById(storeId, invoiceId);
  }

  async issueCreditNote(storeId: string, invoiceId: string, reason: string): Promise<CreditNote> {
    const existing = await this.invoiceRepo.findById(storeId, invoiceId);
    if (!existing) {
      throw new Error(`Invoice not found: ${invoiceId}`);
    }

    await this.invoiceRepo.updateStatus(storeId, invoiceId, 'CANCELLED');

    const creditNote: CreditNote = {
      id: crypto.randomUUID(),
      storeId,
      invoiceId,
      creditNoteNumber: `CRN-${existing.invoice.invoiceNumber.replace(/^INV-/, '')}`,
      reason,
      amountMinor: existing.invoice.grandTotalMinor,
      createdAt: new Date().toISOString(),
    };

    return this.invoiceRepo.createCreditNote(creditNote);
  }
}
