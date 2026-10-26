export interface ApiClientOptions {
  readonly gatewayUrl: string;
  readonly fetchFn?: typeof fetch;
}

export interface CatalogFilterOptions {
  readonly categoryId?: string;
  readonly search?: string;
  readonly page?: number;
  readonly limit?: number;
}

export interface CreateOrderPayload {
  readonly customerName: string;
  readonly customerPhone: string;
  readonly fulfillmentType: 'PICKUP' | 'DELIVERY';
  readonly deliveryAddress?: string;
  readonly notes?: string;
  readonly items: readonly {
    readonly productId: string;
    readonly quantity: number;
  }[];
}

export class StorefrontApiClient {
  private readonly gatewayUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.gatewayUrl = options.gatewayUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchFn ?? globalThis.fetch;
  }

  async getCatalog(storeId: string, options?: CatalogFilterOptions): Promise<any> {
    const params = new URLSearchParams();
    if (options?.categoryId) params.set('categoryId', options.categoryId);
    if (options?.search) params.set('search', options.search);
    if (options?.page) params.set('page', String(options.page));
    if (options?.limit) params.set('limit', String(options.limit));

    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await this.fetchImpl(`${this.gatewayUrl}/api/v1/catalog/products${qs}`, {
      headers: { 'X-Store-ID': storeId },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch catalog: HTTP ${res.status}`);
    }
    return res.json();
  }

  async getCategories(storeId: string): Promise<any> {
    const res = await this.fetchImpl(`${this.gatewayUrl}/api/v1/catalog/categories`, {
      headers: { 'X-Store-ID': storeId },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch categories: HTTP ${res.status}`);
    }
    return res.json();
  }

  async getProduct(storeId: string, productId: string): Promise<any> {
    const res = await this.fetchImpl(`${this.gatewayUrl}/api/v1/catalog/products/${productId}`, {
      headers: { 'X-Store-ID': storeId },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch product ${productId}: HTTP ${res.status}`);
    }
    return res.json();
  }

  async createOrder(storeId: string, payload: CreateOrderPayload): Promise<any> {
    const res = await this.fetchImpl(`${this.gatewayUrl}/api/v1/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Store-ID': storeId,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`Failed to submit order: HTTP ${res.status}`);
    }
    return res.json();
  }

  async getOrder(storeId: string, orderId: string): Promise<any> {
    const res = await this.fetchImpl(`${this.gatewayUrl}/api/v1/orders/${orderId}`, {
      headers: { 'X-Store-ID': storeId },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch order ${orderId}: HTTP ${res.status}`);
    }
    return res.json();
  }
}

export function createApiClient(options: ApiClientOptions): StorefrontApiClient {
  return new StorefrontApiClient(options);
}
