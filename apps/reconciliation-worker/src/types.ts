import type { Kysely, Transaction } from 'kysely';
import type { Database, StockReservationRow, PaymentRow } from '@grocery/database';

export type DatabaseConnection = Kysely<Database> | Transaction<Database>;

export interface ReconciledReservation {
  readonly id: string;
  readonly storeId: string;
  readonly orderId: string;
  readonly releasedItemsCount: number;
}

export interface ReservationReconciliationResult {
  readonly totalExpiredFound: number;
  readonly reconciled: readonly ReconciledReservation[];
  readonly errors: readonly { reservationId: string; error: string }[];
}

export interface ReconciledPayment {
  readonly id: string;
  readonly storeId: string;
  readonly orderId: string;
  readonly previousStatus: string;
  readonly amountCents: number | string | bigint;
}

export interface PaymentReconciliationResult {
  readonly totalStaleFound: number;
  readonly reconciled: readonly ReconciledPayment[];
  readonly errors: readonly { paymentId: string; error: string }[];
}

export interface ReconciliationBatchResult {
  readonly reservations: ReservationReconciliationResult;
  readonly payments: PaymentReconciliationResult;
  readonly durationMs: number;
}

export interface ReservationReconcilerOptions {
  readonly storeId?: string;
  readonly limit?: number;
  readonly now?: Date;
}

export interface PaymentReconcilerOptions {
  readonly storeId?: string;
  readonly limit?: number;
  readonly olderThanMs?: number;
  readonly now?: Date;
}

export interface ReconciliationCoordinatorOptions {
  readonly storeId?: string;
  readonly reservationLimit?: number;
  readonly paymentLimit?: number;
  readonly stalePaymentThresholdMs?: number;
  readonly now?: Date;
}
