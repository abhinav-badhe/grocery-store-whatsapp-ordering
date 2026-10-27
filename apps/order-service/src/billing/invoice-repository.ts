/**
 * Billing & Invoice Repository
 * Conforms to ADR-002, ADR-005, and ADR-010
 */

import { Invoice, InvoiceLineSnapshot, CreditNote } from './types.js';

export interface InvoiceRepositoryPort {
  createInvoice(invoice: Invoice, lines: InvoiceLineSnapshot[]): Promise<Invoice>;
  getNextInvoiceNumber(storeId: string, fiscalYear: string): Promise<string>;
  findById(storeId: string, invoiceId: string): Promise<{ invoice: Invoice; lines: InvoiceLineSnapshot[] } | null>;
  findByOrderId(storeId: string, orderId: string): Promise<{ invoice: Invoice; lines: InvoiceLineSnapshot[] } | null>;
  createCreditNote(creditNote: CreditNote): Promise<CreditNote>;
  updateStatus(storeId: string, invoiceId: string, status: Invoice['status']): Promise<void>;
}

export class InMemoryInvoiceRepository implements InvoiceRepositoryPort {
  private readonly invoices = new Map<string, Invoice>();
  private readonly lines = new Map<string, InvoiceLineSnapshot[]>();
  private readonly sequences = new Map<string, number>();
  private readonly creditNotes = new Map<string, CreditNote>();

  async getNextInvoiceNumber(storeId: string, fiscalYear: string): Promise<string> {
    const key = `${storeId}:${fiscalYear}`;
    const nextSeq = (this.sequences.get(key) ?? 0) + 1;
    this.sequences.set(key, nextSeq);
    return `INV-${fiscalYear}-${String(nextSeq).padStart(5, '0')}`;
  }

  async createInvoice(invoice: Invoice, lines: InvoiceLineSnapshot[]): Promise<Invoice> {
    this.invoices.set(invoice.id, invoice);
    this.lines.set(invoice.id, [...lines]);
    return invoice;
  }

  async findById(storeId: string, invoiceId: string): Promise<{ invoice: Invoice; lines: InvoiceLineSnapshot[] } | null> {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice || invoice.storeId !== storeId) {
      return null;
    }
    const lines = this.lines.get(invoiceId) ?? [];
    return { invoice, lines };
  }

  async findByOrderId(storeId: string, orderId: string): Promise<{ invoice: Invoice; lines: InvoiceLineSnapshot[] } | null> {
    for (const invoice of this.invoices.values()) {
      if (invoice.storeId === storeId && invoice.orderId === orderId) {
        const lines = this.lines.get(invoice.id) ?? [];
        return { invoice, lines };
      }
    }
    return null;
  }

  async createCreditNote(creditNote: CreditNote): Promise<CreditNote> {
    this.creditNotes.set(creditNote.id, creditNote);
    return creditNote;
  }

  async updateStatus(storeId: string, invoiceId: string, status: Invoice['status']): Promise<void> {
    const invoice = this.invoices.get(invoiceId);
    if (invoice && invoice.storeId === storeId) {
      (this.invoices as any).set(invoiceId, { ...invoice, status });
    }
  }
}
