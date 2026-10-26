import type { Product } from '@grocery/api-contracts';
import { mintInternalToken } from '@grocery/service-runtime';

export interface CatalogClientOptions {
  readonly baseUrl: string;
  readonly internalTokenSecret: string;
  readonly expectedIssuer?: string;
  readonly expectedAudience?: string;
}

export class CatalogClientError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly detail: string,
    public readonly code?: string,
  ) {
    super(`CatalogClient failed with status ${statusCode}: ${detail}`);
    this.name = 'CatalogClientError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface CatalogLookupClient {
  searchProducts(storeId: string, searchTerm: string, limit?: number): Promise<Product[]>;
  getProductById(storeId: string, productId: string): Promise<Product | null>;
}

export class HttpCatalogLookupClient implements CatalogLookupClient {
  constructor(private readonly options: CatalogClientOptions) {}

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
      Accept: 'application/json',
    };
  }

  async searchProducts(storeId: string, searchTerm: string, limit = 10): Promise<Product[]> {
    const url = new URL('/api/v1/catalog/products', this.options.baseUrl);
    url.searchParams.set('search', searchTerm);
    url.searchParams.set('status', 'ACTIVE');
    url.searchParams.set('limit', String(limit));

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: this.getAuthHeaders(storeId),
    });

    if (!response.ok) {
      let detail = `HTTP ${response.status} ${response.statusText}`;
      let code: string | undefined;
      try {
        const body = (await response.json()) as Record<string, any>;
        detail = body.detail ?? detail;
        code = body.code;
      } catch {
        // Keep fallback detail
      }
      throw new CatalogClientError(response.status, detail, code);
    }

    const json = (await response.json()) as { data?: Product[] };
    return json.data ?? [];
  }

  async getProductById(storeId: string, productId: string): Promise<Product | null> {
    const url = new URL(
      `/api/v1/catalog/products/${encodeURIComponent(productId)}`,
      this.options.baseUrl,
    );

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: this.getAuthHeaders(storeId),
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      let detail = `HTTP ${response.status} ${response.statusText}`;
      let code: string | undefined;
      try {
        const body = (await response.json()) as Record<string, any>;
        detail = body.detail ?? detail;
        code = body.code;
      } catch {
        // Keep fallback detail
      }
      throw new CatalogClientError(response.status, detail, code);
    }

    const json = (await response.json()) as { product?: Product };
    return json.product ?? null;
  }
}
