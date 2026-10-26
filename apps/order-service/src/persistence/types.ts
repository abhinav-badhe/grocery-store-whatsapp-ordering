import type { Kysely, Transaction } from 'kysely';
import type {
  Database,
  OrderRow,
  OrderItemRow,
  OrderStatusHistoryRow,
  OrderStatus,
  FulfillmentType,
} from '@grocery/database';

export type DatabaseConnection = Kysely<Database> | Transaction<Database>;

export interface OrderWithItems extends OrderRow {
  readonly items: readonly OrderItemRow[];
}

export interface ListOrdersOptions {
  readonly status?: OrderStatus;
  readonly customerId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface CreateOrderItemParams {
  readonly productId: string;
  readonly productNameSnapshot: string;
  readonly skuSnapshot?: string | null;
  readonly unitSnapshot?: string;
  readonly unitPriceCents: number;
  readonly quantity: number;
}

export interface CreateOrderParams {
  readonly storeId: string;
  readonly customerId?: string | null;
  readonly orderNumber: string;
  readonly fulfillmentType: FulfillmentType;
  readonly deliveryAddress?: string | null;
  readonly customerPhone?: string | null;
  readonly customerName?: string | null;
  readonly notes?: string | null;
  readonly idempotencyKey?: string | null;
  readonly currency?: string;
}

export interface OrderRepository {
  createOrder(
    params: CreateOrderParams,
    items: readonly CreateOrderItemParams[],
    trx?: DatabaseConnection,
  ): Promise<OrderWithItems>;

  findById(storeId: string, id: string, trx?: DatabaseConnection): Promise<OrderWithItems | null>;

  findByOrderNumber(
    storeId: string,
    orderNumber: string,
    trx?: DatabaseConnection,
  ): Promise<OrderWithItems | null>;

  findByIdempotencyKey(
    storeId: string,
    idempotencyKey: string,
    trx?: DatabaseConnection,
  ): Promise<OrderWithItems | null>;

  listByStore(
    storeId: string,
    options?: ListOrdersOptions,
    trx?: DatabaseConnection,
  ): Promise<{ orders: OrderWithItems[]; totalCount: number }>;

  updateStatus(
    storeId: string,
    id: string,
    toStatus: OrderStatus,
    changedByUserId?: string | null,
    reason?: string | null,
    trx?: DatabaseConnection,
  ): Promise<OrderWithItems | null>;

  substituteItem(
    storeId: string,
    orderId: string,
    itemId: string,
    substitutedProductId: string,
    substitutionNotes?: string | null,
    newQuantity?: number,
    trx?: DatabaseConnection,
  ): Promise<OrderWithItems | null>;

  getStatusHistory(
    storeId: string,
    orderId: string,
    trx?: DatabaseConnection,
  ): Promise<OrderStatusHistoryRow[]>;
}
