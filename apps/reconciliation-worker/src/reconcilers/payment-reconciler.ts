import type { Kysely } from 'kysely';
import type { Database, PaymentRow } from '@grocery/database';
import type {
  DatabaseConnection,
  PaymentReconciliationResult,
  PaymentReconcilerOptions,
  ReconciledPayment,
} from '../types.js';

export class PaymentReconciler {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Queries stale payments lingering in PENDING or PROCESSING states beyond threshold.
   */
  async findStalePayments(options?: PaymentReconcilerOptions): Promise<PaymentRow[]> {
    const now = options?.now ?? new Date();
    const olderThanMs = options?.olderThanMs ?? 30 * 60 * 1000; // default 30 min
    const cutoffDate = new Date(now.getTime() - olderThanMs);
    const limit = options?.limit ?? 50;

    let query = this.db
      .selectFrom('payment.payments')
      .selectAll()
      .where('status', 'in', ['PENDING', 'PROCESSING'])
      .where('created_at', '<=', cutoffDate)
      .orderBy('created_at', 'asc')
      .limit(limit);

    if (options?.storeId) {
      query = query.where('store_id', '=', options.storeId);
    }

    return query.execute();
  }

  /**
   * Reconciles a single stale payment to terminal FAILED state within transactional boundary.
   */
  async reconcilePayment(
    payment: PaymentRow,
    trxConnection?: DatabaseConnection,
  ): Promise<ReconciledPayment> {
    const executeInTransaction = async (trx: DatabaseConnection): Promise<ReconciledPayment> => {
      const updated = await trx
        .updateTable('payment.payments')
        .set({
          status: 'FAILED',
          updated_at: new Date(),
        })
        .where('store_id', '=', payment.store_id)
        .where('id', '=', payment.id)
        .where('status', 'in', ['PENDING', 'PROCESSING'])
        .returningAll()
        .executeTakeFirst();

      return {
        id: payment.id,
        storeId: payment.store_id,
        orderId: payment.order_id,
        previousStatus: payment.status,
        amountCents: payment.amount_cents,
      };
    };

    if (trxConnection) {
      return executeInTransaction(trxConnection);
    }

    return this.db.transaction().execute(executeInTransaction);
  }

  /**
   * Finds and reconciles a batch of stale pending payments.
   */
  async reconcileStaleBatch(
    options?: PaymentReconcilerOptions,
  ): Promise<PaymentReconciliationResult> {
    const stalePayments = await this.findStalePayments(options);
    const reconciled: ReconciledPayment[] = [];
    const errors: { paymentId: string; error: string }[] = [];

    for (const payment of stalePayments) {
      try {
        const result = await this.reconcilePayment(payment);
        reconciled.push(result);
      } catch (err) {
        errors.push({
          paymentId: payment.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      totalStaleFound: stalePayments.length,
      reconciled,
      errors,
    };
  }
}

export function createPaymentReconciler(db: Kysely<Database>): PaymentReconciler {
  return new PaymentReconciler(db);
}
