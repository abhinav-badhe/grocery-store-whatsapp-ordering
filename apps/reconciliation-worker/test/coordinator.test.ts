import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createReconciliationCoordinator,
  createReconciliationWorker,
  type ReservationReconciler,
  type PaymentReconciler,
} from '../dist/index.js';

describe('ReconciliationCoordinator - End-to-End Periodic Batch Job', () => {
  it('coordinates both reservation and payment reconcilers and measures execution duration', async () => {
    let reservationBatchCalled = false;
    let paymentBatchCalled = false;

    const mockReservationReconciler: ReservationReconciler = {
      findExpiredReservations: async () => [],
      reconcileReservation: async () => ({
        id: 'res-1',
        storeId: 'store-1',
        orderId: 'order-1',
        releasedItemsCount: 2,
      }),
      reconcileExpiredBatch: async () => {
        reservationBatchCalled = true;
        return {
          totalExpiredFound: 1,
          reconciled: [
            { id: 'res-1', storeId: 'store-1', orderId: 'order-1', releasedItemsCount: 2 },
          ],
          errors: [],
        };
      },
    } as unknown as ReservationReconciler;

    const mockPaymentReconciler: PaymentReconciler = {
      findStalePayments: async () => [],
      reconcilePayment: async () => ({
        id: 'pay-1',
        storeId: 'store-1',
        orderId: 'order-1',
        previousStatus: 'PENDING',
        amountCents: 1000n,
      }),
      reconcileStaleBatch: async () => {
        paymentBatchCalled = true;
        return {
          totalStaleFound: 1,
          reconciled: [
            {
              id: 'pay-1',
              storeId: 'store-1',
              orderId: 'order-1',
              previousStatus: 'PENDING',
              amountCents: 1000n,
            },
          ],
          errors: [],
        };
      },
    } as unknown as PaymentReconciler;

    const coordinator = createReconciliationCoordinator(
      mockReservationReconciler,
      mockPaymentReconciler,
    );

    const result = await coordinator.reconcileAll();

    assert.ok(reservationBatchCalled);
    assert.ok(paymentBatchCalled);
    assert.equal(result.reservations.reconciled.length, 1);
    assert.equal(result.payments.reconciled.length, 1);
    assert.ok(result.durationMs >= 0);
  });

  it('runs jobHandler from createReconciliationWorker with injected coordinator', async () => {
    let reconcileAllCalled = false;

    const mockCoordinator = {
      reconcileAll: async () => {
        reconcileAllCalled = true;
        return {
          reservations: { totalExpiredFound: 0, reconciled: [], errors: [] },
          payments: { totalStaleFound: 0, reconciled: [], errors: [] },
          durationMs: 1,
        };
      },
    };

    let customJobCalled = false;
    const worker = createReconciliationWorker({
      coordinator: mockCoordinator as any,
      pollingIntervalMs: 20,
      jobHandler: async () => {
        customJobCalled = true;
      },
    });

    const status = worker.getStatus();
    assert.equal(status.name, 'reconciliation-worker');
    assert.equal(status.status, 'stopped');

    // Start worker, execute one cycle, then stop
    await worker.start();
    // Allow single cycle to execute
    await new Promise((resolve) => setTimeout(resolve, 60));
    await worker.stop();

    assert.ok(reconcileAllCalled);
    assert.ok(customJobCalled);
  });
});
