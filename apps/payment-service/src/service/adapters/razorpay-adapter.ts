import crypto from 'node:crypto';
import type { PaymentProviderAdapter } from '../types.js';

export class RazorpayPaymentProviderAdapter implements PaymentProviderAdapter {
  public readonly provider = 'RAZORPAY' as const;

  constructor(
    private readonly keyId?: string,
    private readonly keySecret?: string,
    private readonly webhookSecret?: string,
  ) {}

  async createOrder(
    _storeId: string,
    amountCents: number,
    currency: string,
    receiptId: string,
  ): Promise<{ providerOrderId: string }> {
    // In production, would call https://api.razorpay.com/v1/orders
    return {
      providerOrderId: `order_rzp_${receiptId.slice(0, 8)}_${amountCents}`,
    };
  }

  verifyWebhookSignature(payload: string, signature: string, secret?: string): boolean {
    const key = secret ?? this.webhookSecret;
    if (!key || !signature) {
      return false;
    }

    const expected = crypto.createHmac('sha256', key).update(payload).digest('hex');
    try {
      const sigBuf = Buffer.from(signature, 'utf8');
      const expBuf = Buffer.from(expected, 'utf8');
      if (sigBuf.length !== expBuf.length) {
        return false;
      }
      return crypto.timingSafeEqual(sigBuf, expBuf);
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
      providerRefundId: `rfnd_rzp_${providerPaymentId.slice(0, 8)}_${Date.now().toString(36)}`,
    };
  }
}
