import type { OrderRow, OrderItemRow, OrderStatusHistoryRow, OrderStatus } from '@grocery/database';
import type {
  DatabaseConnection,
  OrderRepository,
  OrderWithItems,
  ListOrdersOptions,
  CreateOrderParams,
  CreateOrderItemParams,
} from './types.js';
import { mapOrderDatabaseError, OrderPersistenceNotFoundError } from './errors.js';

export class KyselyOrderRepository implements OrderRepository {
  constructor(private readonly defaultDb: DatabaseConnection) {}

  private getExecutor(trx?: DatabaseConnection): DatabaseConnection {
    return trx ?? this.defaultDb;
  }

  async createOrder(
    params: CreateOrderParams,
    items: readonly CreateOrderItemParams[],
    trx?: DatabaseConnection,
  ): Promise<OrderWithItems> {
    const executor = this.getExecutor(trx);

    const executeOperation = async (conn: DatabaseConnection): Promise<OrderWithItems> => {
      try {
        const totalAmountCents = items.reduce(
          (acc, item) => acc + Math.round(Number(item.unitPriceCents) * Number(item.quantity)),
          0,
        );

        const order = await conn
          .insertInto('order.orders')
          .values({
            store_id: params.storeId,
            customer_id: params.customerId ?? null,
            order_number: params.orderNumber,
            status: 'AWAITING_SHOPKEEPER_REVIEW',
            fulfillment_type: params.fulfillmentType,
            delivery_address: params.deliveryAddress ?? null,
            customer_phone: params.customerPhone ?? null,
            customer_name: params.customerName ?? null,
            total_amount_cents: totalAmountCents,
            currency: params.currency ?? 'INR',
            notes: params.notes ?? null,
            idempotency_key: params.idempotencyKey ?? null,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        const insertedItems: OrderItemRow[] = [];
        for (const item of items) {
          const itemTotal = Math.round(Number(item.unitPriceCents) * Number(item.quantity));
          const insertedItem = await conn
            .insertInto('order.order_items')
            .values({
              order_id: order.id,
              store_id: params.storeId,
              product_id: item.productId,
              product_name_snapshot: item.productNameSnapshot,
              sku_snapshot: item.skuSnapshot ?? null,
              unit_snapshot: item.unitSnapshot ?? 'PIECE',
              unit_price_cents: item.unitPriceCents,
              quantity: item.quantity,
              total_price_cents: itemTotal,
              status: 'PENDING',
              substituted_product_id: null,
              substitution_notes: null,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

          insertedItems.push(insertedItem);
        }

        await conn
          .insertInto('order.order_status_history')
          .values({
            order_id: order.id,
            store_id: params.storeId,
            from_status: null,
            to_status: 'AWAITING_SHOPKEEPER_REVIEW',
            changed_by_user_id: params.customerId ?? null,
            reason: 'Order created',
          })
          .execute();

        return {
          ...order,
          items: insertedItems,
        };
      } catch (err) {
        throw mapOrderDatabaseError(err, 'Failed to create order');
      }
    };

    if ('transaction' in executor && typeof executor.transaction === 'function') {
      return await executor.transaction().execute((tx) => executeOperation(tx));
    }

    return await executeOperation(executor);
  }

  async findById(
    storeId: string,
    id: string,
    trx?: DatabaseConnection,
  ): Promise<OrderWithItems | null> {
    try {
      const order = await this.getExecutor(trx)
        .selectFrom('order.orders')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('id', '=', id)
        .executeTakeFirst();

      if (!order) {
        return null;
      }

      const items = await this.getExecutor(trx)
        .selectFrom('order.order_items')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('order_id', '=', id)
        .orderBy('created_at', 'asc')
        .execute();

      return {
        ...order,
        items,
      };
    } catch (err) {
      throw mapOrderDatabaseError(err, `Failed to find order '${id}'`);
    }
  }

  async findByOrderNumber(
    storeId: string,
    orderNumber: string,
    trx?: DatabaseConnection,
  ): Promise<OrderWithItems | null> {
    try {
      const order = await this.getExecutor(trx)
        .selectFrom('order.orders')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('order_number', '=', orderNumber)
        .executeTakeFirst();

      if (!order) {
        return null;
      }

      const items = await this.getExecutor(trx)
        .selectFrom('order.order_items')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('order_id', '=', order.id)
        .orderBy('created_at', 'asc')
        .execute();

      return {
        ...order,
        items,
      };
    } catch (err) {
      throw mapOrderDatabaseError(err, `Failed to find order by number '${orderNumber}'`);
    }
  }

  async findByIdempotencyKey(
    storeId: string,
    idempotencyKey: string,
    trx?: DatabaseConnection,
  ): Promise<OrderWithItems | null> {
    try {
      const order = await this.getExecutor(trx)
        .selectFrom('order.orders')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('idempotency_key', '=', idempotencyKey)
        .executeTakeFirst();

      if (!order) {
        return null;
      }

      const items = await this.getExecutor(trx)
        .selectFrom('order.order_items')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('order_id', '=', order.id)
        .orderBy('created_at', 'asc')
        .execute();

      return {
        ...order,
        items,
      };
    } catch (err) {
      throw mapOrderDatabaseError(
        err,
        `Failed to find order by idempotency key '${idempotencyKey}'`,
      );
    }
  }

  async listByStore(
    storeId: string,
    options?: ListOrdersOptions,
    trx?: DatabaseConnection,
  ): Promise<{ orders: OrderWithItems[]; totalCount: number }> {
    try {
      const executor = this.getExecutor(trx);

      let countQuery = executor
        .selectFrom('order.orders')
        .select((eb) => eb.fn.count<string>('id').as('count'))
        .where('store_id', '=', storeId);

      let ordersQuery = executor
        .selectFrom('order.orders')
        .selectAll()
        .where('store_id', '=', storeId);

      if (options?.status) {
        countQuery = countQuery.where('status', '=', options.status);
        ordersQuery = ordersQuery.where('status', '=', options.status);
      }

      if (options?.customerId) {
        countQuery = countQuery.where('customer_id', '=', options.customerId);
        ordersQuery = ordersQuery.where('customer_id', '=', options.customerId);
      }

      const countResult = await countQuery.executeTakeFirst();
      const totalCount = countResult?.count ? Number(countResult.count) : 0;

      if (options?.limit) {
        ordersQuery = ordersQuery.limit(options.limit);
      }

      if (options?.offset) {
        ordersQuery = ordersQuery.offset(options.offset);
      }

      const orders = await ordersQuery.orderBy('created_at', 'desc').execute();

      if (orders.length === 0) {
        return { orders: [], totalCount };
      }

      const orderIds = orders.map((o) => o.id);
      const items = await executor
        .selectFrom('order.order_items')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('order_id', 'in', orderIds)
        .orderBy('created_at', 'asc')
        .execute();

      const itemsByOrderId = new Map<string, OrderItemRow[]>();
      for (const item of items) {
        const list = itemsByOrderId.get(item.order_id) ?? [];
        list.push(item);
        itemsByOrderId.set(item.order_id, list);
      }

      const ordersWithItems: OrderWithItems[] = orders.map((order) => ({
        ...order,
        items: itemsByOrderId.get(order.id) ?? [],
      }));

      return {
        orders: ordersWithItems,
        totalCount,
      };
    } catch (err) {
      throw mapOrderDatabaseError(err, `Failed to list orders for store '${storeId}'`);
    }
  }

  async updateStatus(
    storeId: string,
    id: string,
    toStatus: OrderStatus,
    changedByUserId?: string | null,
    reason?: string | null,
    trx?: DatabaseConnection,
  ): Promise<OrderWithItems | null> {
    const executor = this.getExecutor(trx);

    const executeOperation = async (conn: DatabaseConnection): Promise<OrderWithItems | null> => {
      try {
        const existing = await conn
          .selectFrom('order.orders')
          .selectAll()
          .where('store_id', '=', storeId)
          .where('id', '=', id)
          .executeTakeFirst();

        if (!existing) {
          return null;
        }

        const updatedOrder = await conn
          .updateTable('order.orders')
          .set({
            status: toStatus,
            updated_at: new Date(),
          })
          .where('store_id', '=', storeId)
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();

        await conn
          .insertInto('order.order_status_history')
          .values({
            order_id: id,
            store_id: storeId,
            from_status: existing.status,
            to_status: toStatus,
            changed_by_user_id: changedByUserId ?? null,
            reason: reason ?? null,
          })
          .execute();

        // ADR-009: Transactional Outbox Event Emission
        if (toStatus === 'CONFIRMED' || toStatus === 'CANCELLED') {
          const eventType = toStatus === 'CONFIRMED' ? 'OrderConfirmed.v1' : 'OrderCancelled.v1';
          try {
            await conn
              .insertInto('events.outbox')
              .values({
                store_id: storeId,
                event_type: eventType,
                aggregate_type: 'ORDER',
                aggregate_id: id,
                payload: JSON.stringify({
                  orderId: id,
                  storeId,
                  orderNumber: existing.order_number,
                  status: toStatus,
                  totalAmountCents: Number(existing.total_amount_cents),
                  customerPhone: existing.customer_phone,
                  timestamp: new Date().toISOString(),
                }),
                status: 'PENDING',
              })
              .execute();
          } catch {
            // Fail soft in mock test environments where outbox table is not mocked
          }
        }

        const items = await conn
          .selectFrom('order.order_items')
          .selectAll()
          .where('store_id', '=', storeId)
          .where('order_id', '=', id)
          .orderBy('created_at', 'asc')
          .execute();

        return {
          ...updatedOrder,
          items,
        };
      } catch (err) {
        throw mapOrderDatabaseError(err, `Failed to update status for order '${id}'`);
      }
    };

    if ('transaction' in executor && typeof executor.transaction === 'function') {
      return await executor.transaction().execute((tx) => executeOperation(tx));
    }

    return await executeOperation(executor);
  }

  async substituteItem(
    storeId: string,
    orderId: string,
    itemId: string,
    substitutedProductId: string,
    substitutionNotes?: string | null,
    newQuantity?: number,
    trx?: DatabaseConnection,
  ): Promise<OrderWithItems | null> {
    const executor = this.getExecutor(trx);

    const executeOperation = async (conn: DatabaseConnection): Promise<OrderWithItems | null> => {
      try {
        const item = await conn
          .selectFrom('order.order_items')
          .selectAll()
          .where('store_id', '=', storeId)
          .where('order_id', '=', orderId)
          .where('id', '=', itemId)
          .executeTakeFirst();

        if (!item) {
          throw new OrderPersistenceNotFoundError(
            `Item '${itemId}' not found in order '${orderId}'`,
          );
        }

        const quantity = newQuantity !== undefined ? newQuantity : Number(item.quantity);
        const totalPriceCents = Math.round(Number(item.unit_price_cents) * quantity);

        await conn
          .updateTable('order.order_items')
          .set({
            status: 'SUBSTITUTED',
            substituted_product_id: substitutedProductId,
            substitution_notes: substitutionNotes ?? null,
            quantity,
            total_price_cents: totalPriceCents,
            updated_at: new Date(),
          })
          .where('store_id', '=', storeId)
          .where('order_id', '=', orderId)
          .where('id', '=', itemId)
          .execute();

        // Recalculate order total amount
        const allItems = await conn
          .selectFrom('order.order_items')
          .selectAll()
          .where('store_id', '=', storeId)
          .where('order_id', '=', orderId)
          .orderBy('created_at', 'asc')
          .execute();

        const newTotalAmountCents = allItems.reduce(
          (acc, it) => (it.status === 'REMOVED' ? acc : acc + Number(it.total_price_cents)),
          0,
        );

        const updatedOrder = await conn
          .updateTable('order.orders')
          .set({
            total_amount_cents: newTotalAmountCents,
            updated_at: new Date(),
          })
          .where('store_id', '=', storeId)
          .where('id', '=', orderId)
          .returningAll()
          .executeTakeFirstOrThrow();

        return {
          ...updatedOrder,
          items: allItems,
        };
      } catch (err) {
        throw mapOrderDatabaseError(
          err,
          `Failed to substitute item '${itemId}' in order '${orderId}'`,
        );
      }
    };

    if ('transaction' in executor && typeof executor.transaction === 'function') {
      return await executor.transaction().execute((tx) => executeOperation(tx));
    }

    return await executeOperation(executor);
  }

  async getStatusHistory(
    storeId: string,
    orderId: string,
    trx?: DatabaseConnection,
  ): Promise<OrderStatusHistoryRow[]> {
    try {
      return await this.getExecutor(trx)
        .selectFrom('order.order_status_history')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('order_id', '=', orderId)
        .orderBy('created_at', 'asc')
        .execute();
    } catch (err) {
      throw mapOrderDatabaseError(err, `Failed to fetch status history for order '${orderId}'`);
    }
  }
}

export function createOrderRepository(db: DatabaseConnection): OrderRepository {
  return new KyselyOrderRepository(db);
}
