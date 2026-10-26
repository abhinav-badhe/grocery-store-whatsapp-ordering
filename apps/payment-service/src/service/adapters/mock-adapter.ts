import crypto from 'node:crypto';
import type { PaymentProviderAdapter } from '../types.js';

export class MockPaymentProviderAdapter implements PaymentProviderAdapter {
  public readonly provider = 'MOCK' as const;

  async createOrder(
    _storeId: string,
    _amountCents: number,
    _currency: string,
    receiptId: string,
  ): Promise<{ providerOrderId: string }> {
    return {
      providerOrderId: `mock_ord_${receiptId}_${Date.now().toString(36)}`,
    };
  }

  verifyWebhookSignature(
    payload: string,
    signature: string,
    secret = 'mock_webhook_secret',
  ): boolean {
    if (!signature || signature.length === 0) return false;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'));
    } catch {
      return false;
    }
  }

  async processRefund(
    providerPaymentId: string,
    _amountCents: number,
    _reason?: string,
  ): Promise<{ providerRefundId: string }> {
    return {
      providerRefundId: `mock_rfnd_${providerPaymentId}_${Date.now().toString(36)}`,
    };
  }
}
