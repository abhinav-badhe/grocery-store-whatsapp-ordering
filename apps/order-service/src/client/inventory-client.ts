import { mintInternalToken } from '@grocery/service-runtime';
import type { InventoryClient, InventoryReservationResult } from '../service/types.js';

export interface HttpInventoryClientOptions {
  readonly baseUrl: string;
  readonly internalTokenSecret: string;
  readonly expectedIssuer?: string;
  readonly expectedAudience?: string;
}

export class HttpInventoryClient implements InventoryClient {
  constructor(private readonly options: HttpInventoryClientOptions) {}

  private getAuthHeaders(storeId: string): Record<string, string> {
    const token = mintInternalToken(
      {
        sub: 'order-service',
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

  async reserveStock(
    storeId: string,
    orderId: string,
    items: readonly { productId: string; quantity: number }[],
  ): Promise<InventoryReservationResult> {
    const url = new URL('/api/v1/inventory/reservations', this.options.baseUrl);

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: this.getAuthHeaders(storeId),
        body: JSON.stringify({
          orderId,
          items,
          expiresInSeconds: 14400, // 4 hours per ADR-007
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          errorMessage: `Inventory service returned HTTP ${response.status}: ${errorBody}`,
        };
      }

      const data = (await response.json()) as { reservation?: { id: string } };
      return {
        success: true,
        reservationId: data.reservation?.id,
      };
    } catch (err) {
      return {
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async releaseStock(storeId: string, orderId: string): Promise<void> {
    const url = new URL(
      `/api/v1/inventory/reservations/order/${encodeURIComponent(orderId)}/release`,
      this.options.baseUrl,
    );

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: this.getAuthHeaders(storeId),
    });

    if (!response.ok && response.status !== 404) {
      const errorBody = await response.text();
      throw new Error(`Inventory release failed with HTTP ${response.status}: ${errorBody}`);
    }
  }

  async fulfillStock(storeId: string, orderId: string): Promise<void> {
    const url = new URL(
      `/api/v1/inventory/reservations/order/${encodeURIComponent(orderId)}/fulfill`,
      this.options.baseUrl,
    );

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: this.getAuthHeaders(storeId),
    });

    if (!response.ok && response.status !== 404) {
      const errorBody = await response.text();
      throw new Error(`Inventory fulfillment failed with HTTP ${response.status}: ${errorBody}`);
    }
  }
}
