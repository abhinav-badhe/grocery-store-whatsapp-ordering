import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorker, type WorkerInstance, type WorkerOptions } from '@grocery/service-runtime';

export function createReconciliationWorker(options?: Partial<WorkerOptions>): WorkerInstance {
  return createWorker({
    workerName: 'reconciliation-worker',
    ...options,
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const worker = createReconciliationWorker();
  worker.start().catch(() => {
    process.exit(1);
  });
}
