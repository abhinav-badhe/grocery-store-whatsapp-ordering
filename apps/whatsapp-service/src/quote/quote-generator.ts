import type { ResolvedQuoteItem, ProvisionalQuoteSnapshot } from '@grocery/api-contracts';
import { assertSafePostgresInt } from './money.js';

export interface GenerateQuoteParams {
  readonly storeId: string;
  readonly conversationId: string;
  readonly quoteVersion: number;
  readonly items: readonly ResolvedQuoteItem[];
  readonly currency?: string;
  readonly ttlSeconds?: number;
}

export const DEFAULT_QUOTE_TTL_SECONDS = 900; // 15 minutes provisional baseline

export class QuoteGenerator {
  /**
   * Generates an immutable, non-payable provisional quote snapshot.
   * Disclaims unresolved taxes, delivery charges, and unpriced items.
   */
  static generateProvisionalQuote(params: GenerateQuoteParams): ProvisionalQuoteSnapshot {
    const ttl = params.ttlSeconds ?? DEFAULT_QUOTE_TTL_SECONDS;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();

    let knownSubtotal = 0;
    let hasUnpriced = false;

    for (const item of params.items) {
      if (item.outcome === 'EXACT_MATCH' && item.lineTotalCents !== null) {
        knownSubtotal += item.lineTotalCents;
      } else {
        hasUnpriced = true;
      }
    }

    assertSafePostgresInt(knownSubtotal, 'knownSubtotalMinor');

    const unresolvedCharges: string[] = ['TAX_POLICY_UNRESOLVED', 'DELIVERY_FEE_UNRESOLVED'];
    if (hasUnpriced) {
      unresolvedCharges.push('ITEMS_REQUIRING_CLARIFICATION');
    }

    const disclaimer = hasUnpriced
      ? 'Provisional estimate for available items only. Excludes taxes, delivery fees, and unpriced items requiring shopkeeper confirmation.'
      : 'Provisional estimate only. Taxes and delivery fees require shopkeeper confirmation before payment.';

    return {
      conversationId: params.conversationId,
      storeId: params.storeId,
      quoteVersion: params.quoteVersion,
      isPayable: false, // Strict Subphase 2 invariant
      finalizationStatus: 'PROVISIONAL_PENDING_REVIEW',
      unresolvedCharges,
      hasUnpricedItems: hasUnpriced,
      knownSubtotalMinor: knownSubtotal,
      taxMinor: 0,
      deliveryMinor: 0,
      estimatedTotalMinor: knownSubtotal,
      currency: params.currency ?? 'INR',
      items: [...params.items],
      disclaimer,
      expiresAt,
      createdAt: now.toISOString(),
    };
  }

  /**
   * Formats a clean customer-facing WhatsApp text message summarizing the provisional quote.
   */
  static formatCustomerSummary(snapshot: ProvisionalQuoteSnapshot): string {
    const lines: string[] = ['📋 *Estimated Grocery Quote*', ''];

    for (const it of snapshot.items) {
      if (it.outcome === 'EXACT_MATCH' && it.lineTotalCents !== null) {
        const priceFormatted = (it.lineTotalCents / 100).toFixed(2);
        lines.push(
          `• ${it.productName} (${it.requestedQuantity} ${it.requestedUnit}): ₹${priceFormatted}`,
        );
      } else if (it.outcome === 'OUT_OF_STOCK') {
        lines.push(`• ~${it.productName}~: ❌ Out of stock`);
      } else if (it.outcome === 'INSUFFICIENT_STOCK') {
        lines.push(`• ${it.productName}: ⚠️ Only partial stock available`);
      } else if (it.outcome === 'AMBIGUOUS_OPTIONS') {
        lines.push(`• ${it.productName}: ❓ Multiple options available`);
      } else {
        lines.push(`• ${it.productName}: ⚠️ Needs shopkeeper check`);
      }
    }

    lines.push('');
    const subtotalFormatted = (snapshot.knownSubtotalMinor / 100).toFixed(2);
    lines.push(`*Estimated Subtotal:* ₹${subtotalFormatted}`);
    lines.push(`ℹ️ _${snapshot.disclaimer}_`);
    lines.push('');
    lines.push('Reply *CONFIRM* to send this list to the shopkeeper for review.');

    return lines.join('\n');
  }
}
