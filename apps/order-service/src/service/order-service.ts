import type { OrderStatus, OrderStatusHistoryRow } from '@grocery/database';
import type {
  OrderRepository,
  OrderWithItems,
  ListOrdersOptions,
  CreateOrderItemParams,
} from '../persistence/types.js';
import type {
  OrderService,
  CreateOrderServiceParams,
  SubstituteItemServiceParams,
  InventoryClient,
  CatalogLookupClient,
} from './types.js';
import {
  OrderNotFoundError,
  InvalidOrderStateTransitionError,
  OrderAlreadyConfirmedError,
  InventoryReservationFailedError,
  ItemSubstitutionError,
} from './errors.js';

const VALID_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  RECEIVED: ['AWAITING_SHOPKEEPER_REVIEW', 'CANCELLED'],
  AWAITING_SHOPKEEPER_REVIEW: [
    'CHANGE_REQUESTED',
    'CONFIRMATION_PENDING_RESERVATION',
    'REJECTED',
    'CANCELLED',
  ],
  CHANGE_REQUESTED: [
    'CONFIRMATION_PENDING_RESERVATION',
    'AWAITING_SHOPKEEPER_REVIEW',
    'REJECTED',
    'CANCELLED',
  ],
  REJECTED: [],
  CONFIRMATION_PENDING_RESERVATION: ['CONFIRMED', 'AWAITING_SHOPKEEPER_REVIEW', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY_FOR_PICKUP', 'DISPATCHED', 'CANCELLED'],
  READY_FOR_PICKUP: ['COMPLETED', 'CANCELLED'],
  DISPATCHED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export class DefaultOrderService implements OrderService {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly inventoryClient?: InventoryClient,
    private readonly catalogClient?: CatalogLookupClient,
  ) {}

  async createOrder(params: CreateOrderServiceParams): Promise<OrderWithItems> {
    const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const resolvedItems: CreateOrderItemParams[] = [];
    for (const item of params.items) {
      let productName = item.productName ?? 'Product';
      let unitPriceCents = item.unitPriceCents ?? 0;
      let sku = item.sku ?? null;
      let unit = item.unit ?? 'PIECE';

      if (this.catalogClient) {
        const productSnapshot = await this.catalogClient.getProduct(params.storeId, item.productId);
        if (productSnapshot) {
          productName = productSnapshot.name;
          unitPriceCents = productSnapshot.priceCents;
          sku = productSnapshot.sku;
          unit = productSnapshot.unit;
        }
      }

      resolvedItems.push({
        productId: item.productId,
        productNameSnapshot: productName,
        skuSnapshot: sku,
        unitSnapshot: unit,
        unitPriceCents,
        quantity: item.quantity,
      });
    }

    return this.orderRepo.createOrder(
      {
        storeId: params.storeId,
        customerId: params.customerId ?? null,
        orderNumber,
        fulfillmentType: params.fulfillmentType,
        deliveryAddress: params.deliveryAddress ?? null,
        customerPhone: params.customerPhone ?? null,
        customerName: params.customerName ?? null,
        notes: params.notes ?? null,
        idempotencyKey: params.idempotencyKey ?? null,
        currency: params.currency ?? 'INR',
      },
      resolvedItems,
    );
  }

  async getOrder(storeId: string, orderId: string): Promise<OrderWithItems> {
    const order = await this.orderRepo.findById(storeId, orderId);
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }
    return order;
  }

  async listOrders(
    storeId: string,
    options?: ListOrdersOptions,
  ): Promise<{ orders: OrderWithItems[]; totalCount: number }> {
    return this.orderRepo.listByStore(storeId, options);
  }

  async confirmOrder(
    storeId: string,
    orderId: string,
    confirmedByUserId: string,
  ): Promise<OrderWithItems> {
    const order = await this.getOrder(storeId, orderId);

    if (order.status !== 'AWAITING_SHOPKEEPER_REVIEW' && order.status !== 'CHANGE_REQUESTED') {
      throw new OrderAlreadyConfirmedError(orderId, order.status);
    }

    // Step 1: Transition to CONFIRMATION_PENDING_RESERVATION
    await this.orderRepo.updateStatus(
      storeId,
      orderId,
      'CONFIRMATION_PENDING_RESERVATION',
      confirmedByUserId,
      'Shopkeeper initiated confirmation; reserving inventory',
    );

    // Step 2: Attempt inventory reservation if client configured
    if (this.inventoryClient) {
      const activeItems = order.items
        .filter((it) => it.status !== 'REMOVED')
        .map((it) => ({
          productId: it.substituted_product_id ?? it.product_id,
          quantity: Number(it.quantity),
        }));

      const reservationResult = await this.inventoryClient.reserveStock(
        storeId,
        orderId,
        activeItems,
      );

      if (!reservationResult.success) {
        // Rollback status to AWAITING_SHOPKEEPER_REVIEW
        await this.orderRepo.updateStatus(
          storeId,
          orderId,
          'AWAITING_SHOPKEEPER_REVIEW',
          confirmedByUserId,
          `Inventory reservation failed: ${reservationResult.errorMessage ?? 'insufficient stock'}`,
        );

        throw new InventoryReservationFailedError(orderId, reservationResult.errorMessage);
      }
    }

    // Step 3: Transition to CONFIRMED
    const confirmedOrder = await this.orderRepo.updateStatus(
      storeId,
      orderId,
      'CONFIRMED',
      confirmedByUserId,
      'Stock successfully reserved; order confirmed',
    );

    if (!confirmedOrder) {
      throw new OrderNotFoundError(orderId);
    }

    return confirmedOrder;
  }

  async substituteItem(params: SubstituteItemServiceParams): Promise<OrderWithItems> {
    const order = await this.getOrder(params.storeId, params.orderId);

    if (order.status !== 'AWAITING_SHOPKEEPER_REVIEW' && order.status !== 'CHANGE_REQUESTED') {
      throw new ItemSubstitutionError(
        params.orderId,
        `Cannot substitute items on an order in status '${order.status}'`,
      );
    }

    const itemExists = order.items.some((it) => it.id === params.itemId);
    if (!itemExists) {
      throw new ItemSubstitutionError(params.orderId, `Item '${params.itemId}' not found in order`);
    }

    const updated = await this.orderRepo.substituteItem(
      params.storeId,
      params.orderId,
      params.itemId,
      params.substitutedProductId,
      params.substitutionNotes,
      params.newQuantity,
    );

    if (!updated) {
      throw new OrderNotFoundError(params.orderId);
    }

    // Advance status to CHANGE_REQUESTED so customer is informed
    if (order.status === 'AWAITING_SHOPKEEPER_REVIEW') {
      await this.orderRepo.updateStatus(
        params.storeId,
        params.orderId,
        'CHANGE_REQUESTED',
        params.substitutedByUserId,
        `Item substituted with alternative product '${params.substitutedProductId}'`,
      );
    }

    return this.getOrder(params.storeId, params.orderId);
  }

  async advanceOrderStatus(
    storeId: string,
    orderId: string,
    toStatus: OrderStatus,
    changedByUserId: string,
    reason?: string,
  ): Promise<OrderWithItems> {
    const order = await this.getOrder(storeId, orderId);

    const allowed = VALID_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new InvalidOrderStateTransitionError(orderId, order.status, toStatus);
    }

    // If completing the order, fulfill stock with inventory client
    if (toStatus === 'COMPLETED' && this.inventoryClient) {
      await this.inventoryClient.fulfillStock(storeId, orderId);
    }

    const updated = await this.orderRepo.updateStatus(
      storeId,
      orderId,
      toStatus,
      changedByUserId,
      reason ?? `Transitioned from ${order.status} to ${toStatus}`,
    );

    if (!updated) {
      throw new OrderNotFoundError(orderId);
    }

    return updated;
  }

  async cancelOrder(
    storeId: string,
    orderId: string,
    cancelledByUserId: string,
    reason: string,
  ): Promise<OrderWithItems> {
    const order = await this.getOrder(storeId, orderId);

    const allowed = VALID_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes('CANCELLED')) {
      throw new InvalidOrderStateTransitionError(orderId, order.status, 'CANCELLED');
    }

    // If order held active inventory reservation, release it
    const heldStock = [
      'CONFIRMATION_PENDING_RESERVATION',
      'CONFIRMED',
      'PREPARING',
      'READY_FOR_PICKUP',
      'DISPATCHED',
    ].includes(order.status);

    if (heldStock && this.inventoryClient) {
      await this.inventoryClient.releaseStock(storeId, orderId);
    }

    const updated = await this.orderRepo.updateStatus(
      storeId,
      orderId,
      'CANCELLED',
      cancelledByUserId,
      reason,
    );

    if (!updated) {
      throw new OrderNotFoundError(orderId);
    }

    return updated;
  }

  async getOrderHistory(storeId: string, orderId: string): Promise<OrderStatusHistoryRow[]> {
    await this.getOrder(storeId, orderId);
    return this.orderRepo.getStatusHistory(storeId, orderId);
  }
}

export function createOrderServiceInstance(
  orderRepo: OrderRepository,
  inventoryClient?: InventoryClient,
  catalogClient?: CatalogLookupClient,
): OrderService {
  return new DefaultOrderService(orderRepo, inventoryClient, catalogClient);
}
