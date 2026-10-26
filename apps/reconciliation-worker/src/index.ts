import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Kysely } from 'kysely';
import { createDatabaseClient, type Database } from '@grocery/database';
import { createWorker, type WorkerInstance, type WorkerOptions } from '@grocery/service-runtime';
import { createReservationReconciler, createPaymentReconciler } from './reconcilers/index.js';
import {
  createReconciliationCoordinator,
  type ReconciliationCoordinator,
} from './coordinator/index.js';
import type { ReconciliationCoordinatorOptions } from './types.js';

export * from './types.js';
export * from './reconcilers/index.js';
export * from './coordinator/index.js';

export interface ReconciliationWorkerOptions extends Partial<WorkerOptions> {
  readonly db?: Kysely<Database>;
  readonly coordinator?: ReconciliationCoordinator;
  readonly coordinatorOptions?: ReconciliationCoordinatorOptions;
  readonly pollingIntervalMs?: number;
  readonly intervalMs?: number;
}

export function createReconciliationWorker(options?: ReconciliationWorkerOptions): WorkerInstance {
  let coordinator = options?.coordinator;
  if (!coordinator && options?.db) {
    const reservationReconciler = createReservationReconciler(options.db);
    const paymentReconciler = createPaymentReconciler(options.db);
    coordinator = createReconciliationCoordinator(reservationReconciler, paymentReconciler);
  }

  return createWorker({
    workerName: 'reconciliation-worker',
    ...options,
    intervalMs: options?.pollingIntervalMs ?? options?.intervalMs ?? 5000,
    jobHandler: async () => {
      if (coordinator) {
        await coordinator.reconcileAll(options?.coordinatorOptions);
      }
      if (options?.jobHandler) {
        await options.jobHandler();
      }
    },
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let db: Kysely<Database> | undefined;
  if (process.env.DATABASE_URL) {
    const dbClient = createDatabaseClient<Database>({
      databaseUrl: process.env.DATABASE_URL,
      maxPoolSize: Number(process.env.DATABASE_MAX_POOL_SIZE || 5),
      connectionTimeoutMs: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS || 5000),
      idleTimeoutMs: Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 30000),
    });
    db = dbClient.db;
  }
  const worker = createReconciliationWorker({ db });
  worker.start().catch(() => {
    process.exit(1);
  });
}
