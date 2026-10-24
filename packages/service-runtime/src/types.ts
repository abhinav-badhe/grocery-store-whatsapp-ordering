import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import type { Logger, RequestContext } from '@grocery/observability';

export type ReadinessCheckStatus = 'healthy' | 'unhealthy';
export type ReadinessChecks = Record<string, ReadinessCheckStatus>;

/**
 * Function executing dependency readiness checks.
 *
 * @param signal Optional AbortSignal triggered if the readiness check timeout expires.
 * Cancellation is cooperative; the HTTP runtime enforces the timeout regardless of
 * whether the check implementation honors the abort signal.
 */
export type ReadinessCheckFn = (signal?: AbortSignal) => Promise<ReadinessChecks> | ReadinessChecks;

export type HttpRequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  context: RequestContext,
) => void | Promise<void>;

export interface HttpServerOptions {
  serviceName: string;
  port?: number;
  host?: string;
  logger?: Logger;
  getReadinessChecks?: ReadinessCheckFn;
  requestHandler?: HttpRequestHandler;
  readinessTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}

export interface HttpServerInstance {
  readonly server: Server;
  readonly serviceName: string;
  readonly port: number;
  readonly host: string;
  start: () => Promise<{ port: number; host: string }>;
  stop: () => Promise<void>;
  isShuttingDown: () => boolean;
  getActiveRequests: () => number;
}

export interface WorkerOptions {
  workerName: string;
  logger?: Logger;
  jobHandler?: () => Promise<void>;
  intervalMs?: number;
}

export interface WorkerInstance {
  readonly workerName: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getStatus: () => {
    name: string;
    status: 'stopped' | 'running' | 'stopping';
    activeJobs: number;
    uptime_seconds: number;
  };
}
