import type { Kysely, Transaction } from 'kysely';
import type { Database } from '@grocery/database';

export type DatabaseConnection = Kysely<Database> | Transaction<Database>;

export interface SalesReportFilter {
  readonly storeId: string;
  readonly startDate: Date;
  readonly endDate: Date;
}

export interface SalesReport {
  readonly storeId: string;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly totalOrders: number;
  readonly completedOrders: number;
  readonly cancelledOrders: number;
  readonly totalRevenueCents: bigint;
  readonly averageOrderValueCents: bigint;
  readonly fulfillmentBreakdown: {
    readonly pickup: number;
    readonly delivery: number;
  };
}

export interface LowStockAlert {
  readonly storeId: string;
  readonly productId: string;
  readonly productName: string;
  readonly sku: string | null;
  readonly unit: string;
  readonly availableQuantity: number;
  readonly onHandQuantity: number;
  readonly reservedQuantity: number;
  readonly reorderPoint: number;
  readonly shortfall: number;
  readonly isOutOfStock: boolean;
}

export interface InventoryHealthReport {
  readonly storeId: string;
  readonly timestamp: Date;
  readonly totalProductsMonitored: number;
  readonly lowStockCount: number;
  readonly outOfStockCount: number;
  readonly alerts: readonly LowStockAlert[];
}

export interface ConsolidatedStoreReport {
  readonly storeId: string;
  readonly generatedAt: Date;
  readonly sales: SalesReport;
  readonly inventoryHealth: InventoryHealthReport;
}

export interface ReportingWorkerOptions {
  readonly storeId?: string;
  readonly pollingIntervalMs?: number;
  readonly intervalMs?: number;
}
