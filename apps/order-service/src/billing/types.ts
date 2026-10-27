/**
 * Billing Domain Types & Invariants
 * Conforms to ADR-001, ADR-002, ADR-005, and ADR-010
 */

export interface InvoiceLineSnapshot {
  readonly id: string;
  readonly invoiceId: string;
  readonly storeId: string;
  readonly productId: string;
  readonly itemNameSnapshot: string;
  readonly skuSnapshot?: string | null;
  readonly unitOfMeasureSnapshot: string;
  readonly unitPriceMinorSnapshot: bigint;
  readonly quantity: number;
  readonly taxRateBasisPoints: number; // e.g. 500 for 5% GST
  readonly taxAmountMinor: bigint;
  readonly lineTotalMinor: bigint;
}

export interface Invoice {
  readonly id: string;
  readonly storeId: string;
  readonly orderId: string;
  readonly invoiceNumber: string;
  readonly subtotalMinor: bigint;
  readonly taxTotalMinor: bigint;
  readonly grandTotalMinor: bigint;
  readonly currency: string;
  readonly status: 'ISSUED' | 'PAID' | 'CANCELLED' | 'REFUNDED';
  readonly storageKey?: string | null;
  readonly createdAt: string;
}

export interface CreditNote {
  readonly id: string;
  readonly storeId: string;
  readonly invoiceId: string;
  readonly creditNoteNumber: string;
  readonly reason: string;
  readonly amountMinor: bigint;
  readonly createdAt: string;
}

export interface InvoiceSequence {
  readonly storeId: string;
  readonly fiscalYear: string;
  readonly currentSequence: number;
  readonly updatedAt: string;
}

export interface CreateInvoiceInput {
  readonly storeId: string;
  readonly orderId: string;
  readonly taxRateBasisPoints?: number; // Default 500 (5%)
}
