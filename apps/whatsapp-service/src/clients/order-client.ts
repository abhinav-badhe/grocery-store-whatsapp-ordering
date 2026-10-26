import { mintInternalToken } from '@grocery/service-runtime';
import type { Order } from '@grocery/api-contracts';

export interface OrderClientOptions {
  readonly baseUrl: string;
  readonly internalTokenSecret: string;
  readonly expectedIssuer?: string;
  readonly expectedAudience?: string;
}

export interface CreateOrderFromQuoteParams {
  readonly storeId: string;
  readonly customerPhone: string;
  readonly quoteId?: string;
  readonly items: readonly {
    productId: string;
    productName: string;
    quantity: number;
    unitPriceCents: number;
    unit: string;
    sku?: string | null;
  }[];
  readonly notes?: string;
}

export interface OrderLookupClient {
  createOrderFromQuote(params: CreateOrderFromQuoteParams): Promise<Order>;
}

export class HttpOrderLookupClient implements OrderLookupClient {
  constructor(private readonly options: OrderClientOptions) {}

  private getAuthHeaders(storeId: string): Record<string, string> {
    const token = mintInternalToken(
      {
        sub: 'whatsapp-service',
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

    return {
      'x-internal-token': token,
      'x-store-id': storeId,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async createOrderFromQuote(params: CreateOrderFromQuoteParams): Promise<Order> {
    const url = new URL('/api/v1/orders', this.options.baseUrl);

    const body = {
      fulfillmentType: 'DELIVERY',
      customerPhone: params.customerPhone,
      notes: params.notes ?? 'Submitted via WhatsApp Conversational Commerce',
      items: params.items.map((it) => ({
        productId: it.productId,
        productName: it.productName,
        quantity: it.quantity,
        unitPriceCents: it.unitPriceCents,
        unit: it.unit,
        sku: it.sku ?? null,
      })),
    };

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: this.getAuthHeaders(params.storeId),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OrderService failed with status ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as { order: Order };
    return data.order;
  }
}
