import type { OrderStatus, FulfillmentType, OrderStatusHistoryRow } from '@grocery/database';
import type { OrderWithItems, ListOrdersOptions } from '../persistence/types.js';

export interface CreateOrderItemInput {
  readonly productId: string;
  readonly quantity: number;
  readonly productName?: string;
  readonly unitPriceCents?: number;
  readonly sku?: string | null;
  readonly unit?: string;
}

export interface CreateOrderServiceParams {
  readonly storeId: string;
  readonly customerId?: string | null;
  readonly fulfillmentType: FulfillmentType;
  readonly deliveryAddress?: string | null;
  readonly customerPhone?: string | null;
  readonly customerName?: string | null;
  readonly notes?: string | null;
  readonly idempotencyKey?: string | null;
  readonly currency?: string;
  readonly items: readonly CreateOrderItemInput[];
}

export interface SubstituteItemServiceParams {
  readonly storeId: string;
  readonly orderId: string;
  readonly itemId: string;
  readonly substitutedProductId: string;
  readonly substitutionNotes?: string | null;
  readonly newQuantity?: number;
  readonly substitutedByUserId?: string | null;
}

export interface InventoryReservationResult {
  readonly success: boolean;
  readonly reservationId?: string;
  readonly errorMessage?: string;
}

export interface InventoryClient {
  reserveStock(
    storeId: string,
    orderId: string,
    items: readonly { productId: string; quantity: number }[],
  ): Promise<InventoryReservationResult>;

  releaseStock(storeId: string, orderId: string): Promise<void>;

  fulfillStock(storeId: string, orderId: string): Promise<void>;
}

export interface CatalogProductSnapshot {
  readonly id: string;
  readonly name: string;
  readonly sku: string | null;
  readonly unit: string;
  readonly priceCents: number;
  readonly isActive: boolean;
}

export interface CatalogLookupClient {
  getProduct(storeId: string, productId: string): Promise<CatalogProductSnapshot | null>;
}

export interface OrderService {
  createOrder(params: CreateOrderServiceParams): Promise<OrderWithItems>;

  getOrder(storeId: string, orderId: string): Promise<OrderWithItems>;

  listOrders(
    storeId: string,
    options?: ListOrdersOptions,
  ): Promise<{ orders: OrderWithItems[]; totalCount: number }>;

  confirmOrder(
    storeId: string,
    orderId: string,
    confirmedByUserId: string,
  ): Promise<OrderWithItems>;

  substituteItem(params: SubstituteItemServiceParams): Promise<OrderWithItems>;

  advanceOrderStatus(
    storeId: string,
    orderId: string,
    toStatus: OrderStatus,
    changedByUserId: string,
    reason?: string,
  ): Promise<OrderWithItems>;

  cancelOrder(
    storeId: string,
    orderId: string,
    cancelledByUserId: string,
    reason: string,
  ): Promise<OrderWithItems>;

  getOrderHistory(storeId: string, orderId: string): Promise<OrderStatusHistoryRow[]>;
}
