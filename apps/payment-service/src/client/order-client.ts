import { mintInternalToken } from '@grocery/service-runtime';
import type { OrderLookupClient } from '../service/types.js';

export interface PaymentOrderClientOptions {
  readonly baseUrl: string;
  readonly internalTokenSecret: string;
  readonly expectedIssuer?: string;
  readonly expectedAudience?: string;
}

export class HttpOrderLookupClient implements OrderLookupClient {
  constructor(private readonly options: PaymentOrderClientOptions) {}

  async getOrder(
    storeId: string,
    orderId: string,
  ): Promise<{ id: string; totalAmountCents: number; status: string } | null> {
    const url = new URL(`/api/v1/orders/${encodeURIComponent(orderId)}`, this.options.baseUrl);

    const token = mintInternalToken(
      {
        sub: 'payment-service',
        act: 'SYSTEM',
        tid: storeId,
        roles: ['STAFF'],
      },
      {
        secret: this.options.internalTokenSecret,
        issuer: this.options.expectedIssuer,
        audience: this.options.expectedAudience,
        expiresInSeconds: 60,
      },
    );

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-internal-token': token,
        'x-store-id': storeId,
        Accept: 'application/json',
      },
    });

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      throw new Error(`Order service returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as any;
    const order = data.order ?? data;
    return {
      id: order.id,
      totalAmountCents: Number(order.totalAmountCents ?? order.total_amount_cents ?? 0),
      status: order.status,
    };
  }
}
