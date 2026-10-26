import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createReportingCoordinator,
  createReportingWorker,
  type SalesReporter,
  type InventoryReporter,
  type SalesReportFilter,
} from '../dist/index.js';

const STORE_ID = '11111111-1111-4111-8111-111111111111';

describe('ReportingCoordinator - Consolidated Reporting & Worker Lifecycle', () => {
  it('consolidates sales report and inventory health into a unified store summary', async () => {
    let salesCalled = false;
    let inventoryCalled = false;

    const mockSalesReporter: SalesReporter = {
      generateSalesReport: async (filter: SalesReportFilter) => {
        salesCalled = true;
        return {
          storeId: filter.storeId,
          startDate: filter.startDate,
          endDate: filter.endDate,
          totalOrders: 10,
          completedOrders: 8,
          cancelledOrders: 2,
          totalRevenueCents: 500000n,
          averageOrderValueCents: 62500n,
          fulfillmentBreakdown: { pickup: 4, delivery: 6 },
        };
      },
    } as unknown as SalesReporter;

    const mockInventoryReporter: InventoryReporter = {
      generateInventoryHealthReport: async (storeId: string) => {
        inventoryCalled = true;
        return {
          storeId,
          timestamp: new Date(),
          totalProductsMonitored: 50,
          lowStockCount: 3,
          outOfStockCount: 1,
          alerts: [],
        };
      },
    } as unknown as InventoryReporter;

    const coordinator = createReportingCoordinator(mockSalesReporter, mockInventoryReporter);
    const report = await coordinator.generateStoreReport(STORE_ID);

    assert.ok(salesCalled);
    assert.ok(inventoryCalled);
    assert.equal(report.storeId, STORE_ID);
    assert.equal(report.sales.completedOrders, 8);
    assert.equal(report.inventoryHealth.lowStockCount, 3);
  });

  it('runs worker lifecycle with start and stop executing reporting jobs', async () => {
    let storeReportCalled = false;
    let customJobCalled = false;

    const mockCoordinator = {
      generateStoreReport: async (storeId: string) => {
        if (storeId === STORE_ID) {
          storeReportCalled = true;
        }
        return {} as any;
      },
    };

    const worker = createReportingWorker({
      coordinator: mockCoordinator as any,
      storeId: STORE_ID,
      pollingIntervalMs: 20,
      jobHandler: async () => {
        customJobCalled = true;
      },
    });

    const statusBefore = worker.getStatus();
    assert.equal(statusBefore.name, 'reporting-worker');
    assert.equal(statusBefore.status, 'stopped');

    await worker.start();
    const statusRunning = worker.getStatus();
    assert.equal(statusRunning.status, 'running');

    // Wait for at least one job cycle
    await new Promise((resolve) => setTimeout(resolve, 60));
    await worker.stop();

    const statusStopped = worker.getStatus();
    assert.equal(statusStopped.status, 'stopped');

    assert.ok(storeReportCalled);
    assert.ok(customJobCalled);
  });
});
