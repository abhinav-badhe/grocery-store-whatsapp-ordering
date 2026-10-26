import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Kysely } from 'kysely';
import { createDatabaseClient, type Database } from '@grocery/database';
import { createWorker, type WorkerInstance, type WorkerOptions } from '@grocery/service-runtime';
import { createSalesReporter, createInventoryReporter } from './reporters/index.js';
import { createReportingCoordinator, type ReportingCoordinator } from './coordinator/index.js';

export * from './types.js';
export * from './reporters/index.js';
export * from './coordinator/index.js';

export interface ReportingWorkerInstanceOptions extends Partial<WorkerOptions> {
  readonly db?: Kysely<Database>;
  readonly coordinator?: ReportingCoordinator;
  readonly storeId?: string;
  readonly pollingIntervalMs?: number;
  readonly intervalMs?: number;
}

export function createReportingWorker(options?: ReportingWorkerInstanceOptions): WorkerInstance {
  let coordinator = options?.coordinator;
  if (!coordinator && options?.db) {
    const salesReporter = createSalesReporter(options.db);
    const inventoryReporter = createInventoryReporter(options.db);
    coordinator = createReportingCoordinator(salesReporter, inventoryReporter);
  }

  return createWorker({
    workerName: 'reporting-worker',
    ...options,
    intervalMs: options?.pollingIntervalMs ?? options?.intervalMs ?? 10000,
    jobHandler: async () => {
      if (coordinator && options?.storeId) {
        await coordinator.generateStoreReport(options.storeId);
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
  const worker = createReportingWorker({ db });
  worker.start().catch(() => {
    process.exit(1);
  });
}
