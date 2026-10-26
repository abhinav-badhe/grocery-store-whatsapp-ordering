import type { ReservationReconciler } from '../reconcilers/reservation-reconciler.js';
import type { PaymentReconciler } from '../reconcilers/payment-reconciler.js';
import type { ReconciliationBatchResult, ReconciliationCoordinatorOptions } from '../types.js';

export class ReconciliationCoordinator {
  constructor(
    private readonly reservationReconciler: ReservationReconciler,
    private readonly paymentReconciler: PaymentReconciler,
  ) {}

  /**
   * Runs end-to-end reconciliation across all expired stock reservations and stale payments.
   */
  async reconcileAll(
    options?: ReconciliationCoordinatorOptions,
  ): Promise<ReconciliationBatchResult> {
    const startTime = Date.now();

    const reservationResult = await this.reservationReconciler.reconcileExpiredBatch({
      storeId: options?.storeId,
      limit: options?.reservationLimit,
      now: options?.now,
    });

    const paymentResult = await this.paymentReconciler.reconcileStaleBatch({
      storeId: options?.storeId,
      limit: options?.paymentLimit,
      olderThanMs: options?.stalePaymentThresholdMs,
      now: options?.now,
    });

    const durationMs = Date.now() - startTime;

    return {
      reservations: reservationResult,
      payments: paymentResult,
      durationMs,
    };
  }
}

export function createReconciliationCoordinator(
  reservationReconciler: ReservationReconciler,
  paymentReconciler: PaymentReconciler,
): ReconciliationCoordinator {
  return new ReconciliationCoordinator(reservationReconciler, paymentReconciler);
}
