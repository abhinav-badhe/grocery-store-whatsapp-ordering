import type { Kysely } from 'kysely';
import type { Database } from '@grocery/database';
import type { InventoryHealthReport, LowStockAlert } from '../types.js';

export class InventoryReporter {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Evaluates inventory levels and computes low stock & out-of-stock alerts for a store.
   * Multi-tenant boundary enforced via mandatory storeId filtering.
   */
  async generateInventoryHealthReport(storeId: string): Promise<InventoryHealthReport> {
    const balances = await this.db
      .selectFrom('inventory.stock_balances')
      .selectAll()
      .where('store_id', '=', storeId)
      .execute();

    const lowStockAlerts: LowStockAlert[] = [];
    let outOfStockCount = 0;

    // Collect product IDs that need name and unit enrichment
    const candidateProductIds = balances
      .filter((b) => b.reorder_point !== null)
      .map((b) => b.product_id);

    const products =
      candidateProductIds.length > 0
        ? await this.db
            .selectFrom('catalog.products')
            .selectAll()
            .where('store_id', '=', storeId)
            .where('id', 'in', candidateProductIds)
            .execute()
        : [];

    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const balance of balances) {
      const available = Number(balance.available_quantity);
      const onHand = Number(balance.on_hand_quantity);
      const reserved = Number(balance.reserved_quantity);
      const reorderPoint = balance.reorder_point !== null ? Number(balance.reorder_point) : null;

      const isOutOfStock = available <= 0;
      if (isOutOfStock) {
        outOfStockCount++;
      }

      if (reorderPoint !== null && available <= reorderPoint) {
        const product = productMap.get(balance.product_id);
        const shortfall = Math.max(0, reorderPoint - available);

        lowStockAlerts.push({
          storeId,
          productId: balance.product_id,
          productName: product?.name ?? 'Unknown Product',
          sku: balance.sku ?? product?.sku ?? null,
          unit: product?.unit ?? 'PIECE',
          availableQuantity: available,
          onHandQuantity: onHand,
          reservedQuantity: reserved,
          reorderPoint,
          shortfall,
          isOutOfStock,
        });
      }
    }

    return {
      storeId,
      timestamp: new Date(),
      totalProductsMonitored: balances.length,
      lowStockCount: lowStockAlerts.length,
      outOfStockCount,
      alerts: lowStockAlerts,
    };
  }
}

export function createInventoryReporter(db: Kysely<Database>): InventoryReporter {
  return new InventoryReporter(db);
}
