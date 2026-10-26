import type { StockBalance } from '@grocery/api-contracts';
import { mintInternalToken } from '@grocery/service-runtime';

export interface InventoryClientOptions {
  readonly baseUrl: string;
  readonly internalTokenSecret: string;
  readonly expectedIssuer?: string;
  readonly expectedAudience?: string;
}

export class InventoryClientError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly detail: string,
    public readonly code?: string,
  ) {
    super(`InventoryClient failed with status ${statusCode}: ${detail}`);
    this.name = 'InventoryClientError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface InventoryLookupClient {
  getStockBalance(storeId: string, productId: string): Promise<StockBalance | null>;
}

export class HttpInventoryLookupClient implements InventoryLookupClient {
  constructor(private readonly options: InventoryClientOptions) {}

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

  async getStockBalance(storeId: string, productId: string): Promise<StockBalance | null> {
    const url = new URL(
      `/api/v1/inventory/stocks/${encodeURIComponent(productId)}`,
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
      throw new InventoryClientError(response.status, detail, code);
    }

    const json = (await response.json()) as { stock?: StockBalance };
    return json.stock ?? null;
  }
}
