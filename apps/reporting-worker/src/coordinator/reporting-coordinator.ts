import type { SalesReporter } from '../reporters/sales-reporter.js';
import type { InventoryReporter } from '../reporters/inventory-reporter.js';
import type { ConsolidatedStoreReport } from '../types.js';

export class ReportingCoordinator {
  constructor(
    private readonly salesReporter: SalesReporter,
    private readonly inventoryReporter: InventoryReporter,
  ) {}

  /**
   * Generates a consolidated store summary covering daily sales and inventory health.
   */
  async generateStoreReport(
    storeId: string,
    options?: { date?: Date },
  ): Promise<ConsolidatedStoreReport> {
    const reportDate = options?.date ?? new Date();

    // Default window: full day of reportDate
    const startDate = new Date(reportDate);
    startDate.setUTCHours(0, 0, 0, 0);

    const endDate = new Date(reportDate);
    endDate.setUTCHours(23, 59, 59, 999);

    const [sales, inventoryHealth] = await Promise.all([
      this.salesReporter.generateSalesReport({
        storeId,
        startDate,
        endDate,
      }),
      this.inventoryReporter.generateInventoryHealthReport(storeId),
    ]);

    return {
      storeId,
      generatedAt: new Date(),
      sales,
      inventoryHealth,
    };
  }
}

export function createReportingCoordinator(
  salesReporter: SalesReporter,
  inventoryReporter: InventoryReporter,
): ReportingCoordinator {
  return new ReportingCoordinator(salesReporter, inventoryReporter);
}
