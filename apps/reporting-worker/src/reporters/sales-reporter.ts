import type { Kysely } from 'kysely';
import type { Database } from '@grocery/database';
import type { SalesReport, SalesReportFilter } from '../types.js';

export class SalesReporter {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Aggregates sales metrics for a specified store across a date range.
   * Multi-tenant boundary enforced via mandatory storeId filtering.
   */
  async generateSalesReport(filter: SalesReportFilter): Promise<SalesReport> {
    const orders = await this.db
      .selectFrom('order.orders')
      .selectAll()
      .where('store_id', '=', filter.storeId)
      .where('created_at', '>=', filter.startDate)
      .where('created_at', '<=', filter.endDate)
      .execute();

    let completedOrders = 0;
    let cancelledOrders = 0;
    let totalRevenueCents = 0n;
    let pickupCount = 0;
    let deliveryCount = 0;

    for (const order of orders) {
      if (order.status === 'COMPLETED') {
        completedOrders++;
        totalRevenueCents += BigInt(order.total_amount_cents);
      } else if (order.status === 'CANCELLED' || order.status === 'REJECTED') {
        cancelledOrders++;
      }

      if (order.fulfillment_type === 'DELIVERY') {
        deliveryCount++;
      } else {
        pickupCount++;
      }
    }

    const averageOrderValueCents =
      completedOrders > 0 ? totalRevenueCents / BigInt(completedOrders) : 0n;

    return {
      storeId: filter.storeId,
      startDate: filter.startDate,
      endDate: filter.endDate,
      totalOrders: orders.length,
      completedOrders,
      cancelledOrders,
      totalRevenueCents,
      averageOrderValueCents,
      fulfillmentBreakdown: {
        pickup: pickupCount,
        delivery: deliveryCount,
      },
    };
  }
}

export function createSalesReporter(db: Kysely<Database>): SalesReporter {
  return new SalesReporter(db);
}
