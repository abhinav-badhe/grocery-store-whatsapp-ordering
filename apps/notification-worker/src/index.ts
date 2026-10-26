import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Kysely } from 'kysely';
import { createDatabaseClient, type Database } from '@grocery/database';
import { createWorker, type WorkerInstance, type WorkerOptions } from '@grocery/service-runtime';
import { createOutboxRepository, createNotificationLogRepository } from './persistence/index.js';
import { createNotificationDispatcher, type NotificationDispatcher } from './dispatcher/index.js';

export * from './persistence/index.js';
export * from './channels/index.js';
export * from './dispatcher/index.js';

export interface NotificationWorkerOptions extends Partial<WorkerOptions> {
  readonly db?: Kysely<Database>;
  readonly dispatcher?: NotificationDispatcher;
  readonly pollingIntervalMs?: number;
}

export function createNotificationWorker(options?: NotificationWorkerOptions): WorkerInstance {
  let dispatcher = options?.dispatcher;
  if (!dispatcher && options?.db) {
    const outboxRepo = createOutboxRepository(options.db);
    const logRepo = createNotificationLogRepository(options.db);
    dispatcher = createNotificationDispatcher(outboxRepo, logRepo);
  }

  return createWorker({
    workerName: 'notification-worker',
    ...options,
    intervalMs: options?.pollingIntervalMs ?? options?.intervalMs ?? 1000,
    jobHandler: async () => {
      if (dispatcher) {
        await dispatcher.processPendingBatch();
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
  const worker = createNotificationWorker({ db });
  worker.start().catch(() => {
    process.exit(1);
  });
}
