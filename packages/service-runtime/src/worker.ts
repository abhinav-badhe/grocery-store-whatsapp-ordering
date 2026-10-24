import {
  createLogger,
  safeErrorSerializer,
  type Logger,
  type LogLevel,
} from '@grocery/observability';
import type { WorkerInstance, WorkerOptions } from './types.js';

export function createWorker(options: WorkerOptions): WorkerInstance {
  const workerName = options.workerName;
  const logger: Logger =
    options.logger ??
    createLogger({
      name: workerName,
      level: (process.env.LOG_LEVEL as LogLevel) ?? 'info',
    });

  let status: 'stopped' | 'running' | 'stopping' = 'stopped';
  let activeJobs = 0;
  let intervalTimer: NodeJS.Timeout | null = null;
  const startTime = Date.now();

  return {
    get workerName() {
      return workerName;
    },
    getStatus() {
      return {
        name: workerName,
        status,
        activeJobs,
        uptime_seconds: status === 'stopped' ? 0 : Math.floor((Date.now() - startTime) / 1000),
      };
    },
    async start(): Promise<void> {
      if (status === 'running') {
        return;
      }
      status = 'running';
      logger.info({ worker: workerName }, 'Worker process started');

      if (options.jobHandler && options.intervalMs && options.intervalMs > 0) {
        intervalTimer = setInterval(async () => {
          if (status !== 'running') {
            return;
          }
          activeJobs++;
          try {
            await options.jobHandler!();
          } catch (jobErr) {
            logger.error({ err: safeErrorSerializer(jobErr) }, 'Worker job execution failed');
          } finally {
            activeJobs--;
          }
        }, options.intervalMs);
        intervalTimer.unref();
      }
    },
    async stop(): Promise<void> {
      if (status === 'stopped') {
        return;
      }
      status = 'stopping';
      logger.info({ worker: workerName }, 'Worker stopping');

      if (intervalTimer) {
        clearInterval(intervalTimer);
        intervalTimer = null;
      }

      status = 'stopped';
      logger.info({ worker: workerName }, 'Worker stopped');
    },
  };
}
