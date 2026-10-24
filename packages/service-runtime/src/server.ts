import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createLogger,
  extractRequestContext,
  runWithContext,
  safeErrorSerializer,
  type Logger,
  type LogLevel,
} from '@grocery/observability';
import type { HttpServerInstance, HttpServerOptions, ReadinessChecks } from './types.js';

const MAX_TIMEOUT_MS = 2_147_483_647; // Max 32-bit signed integer supported by Node.js setTimeout

function validateTimeout(value: unknown, name: string, defaultValue: number): number {
  const timeout = value === undefined ? defaultValue : value;
  if (
    typeof timeout !== 'number' ||
    !Number.isFinite(timeout) ||
    timeout <= 0 ||
    timeout > MAX_TIMEOUT_MS
  ) {
    throw new RangeError(
      `${name} must be a positive finite number <= ${MAX_TIMEOUT_MS}, received: ${timeout}`,
    );
  }
  return timeout;
}

export function createHttpServer(options: HttpServerOptions): HttpServerInstance {
  const serviceName = options.serviceName;
  const configuredPort = options.port ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);
  const host = options.host ?? '0.0.0.0';

  const readinessTimeoutMs = validateTimeout(
    options.readinessTimeoutMs,
    'readinessTimeoutMs',
    3000,
  );
  const shutdownTimeoutMs = validateTimeout(options.shutdownTimeoutMs, 'shutdownTimeoutMs', 10000);

  const logger: Logger =
    options.logger ??
    createLogger({
      name: serviceName,
      level: (process.env.LOG_LEVEL as LogLevel) ?? 'info',
    });

  let isShuttingDown = false;
  let isStopped = false;
  let isStarting = false;
  let startPromise: Promise<{ port: number; host: string }> | null = null;
  let shutdownPromise: Promise<void> | null = null;
  let activeRequests = 0;

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    activeRequests++;

    // Hook res.end to ensure Connection: close header is set if shutdown is initiated
    const originalEnd = res.end.bind(res);
    res.end = function (...args: Parameters<ServerResponse['end']>) {
      if (isShuttingDown && !res.headersSent) {
        res.setHeader('Connection', 'close');
      }
      return originalEnd(...args);
    } as ServerResponse['end'];

    // If client or response closes while shutting down, close idle connection immediately
    res.once('close', () => {
      if (isShuttingDown) {
        server.closeIdleConnections?.();
      }
    });

    const rawHeaders = req.headers as Record<string, string | string[] | undefined>;
    const context = extractRequestContext(rawHeaders);

    runWithContext(context, async () => {
      if (context.requestId) {
        res.setHeader('X-Request-ID', context.requestId);
      }
      if (context.correlationId) {
        res.setHeader('X-Correlation-ID', context.correlationId);
      }

      if (isShuttingDown && !res.headersSent) {
        res.setHeader('Connection', 'close');
      }

      const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = requestUrl.pathname;

      try {
        if (req.method === 'GET' && (pathname === '/health/live' || pathname === '/healthz')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          if (isShuttingDown) {
            res.statusCode = 503;
            res.end(
              JSON.stringify({
                status: 'shutting_down',
                timestamp: new Date().toISOString(),
                uptime_seconds: Math.floor(process.uptime()),
              }),
            );
            return;
          }

          res.statusCode = 200;
          res.end(
            JSON.stringify({
              status: 'ok',
              timestamp: new Date().toISOString(),
              uptime_seconds: Math.floor(process.uptime()),
            }),
          );
          return;
        }

        if (req.method === 'GET' && (pathname === '/health/ready' || pathname === '/readyz')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          if (isShuttingDown) {
            res.statusCode = 503;
            res.end(
              JSON.stringify({
                status: 'not_ready',
                timestamp: new Date().toISOString(),
                checks: { process: 'unhealthy' },
              }),
            );
            return;
          }

          let isReady = false;
          let sanitizedChecks: ReadinessChecks = {};

          if (!options.getReadinessChecks) {
            isReady = true;
            sanitizedChecks = {};
          } else {
            const controller = new AbortController();
            let timeoutId: NodeJS.Timeout | null = null;

            const timeoutPromise = new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => {
                controller.abort();
                reject(new Error(`Readiness check timed out after ${readinessTimeoutMs}ms`));
              }, readinessTimeoutMs);
              timeoutId.unref?.();
            });

            let rawChecks: unknown = {};
            try {
              const checkPromise = Promise.resolve(options.getReadinessChecks(controller.signal));
              checkPromise.catch(() => {
                // Suppress unhandled rejections if check settles after timeout
              });
              rawChecks = await Promise.race([checkPromise, timeoutPromise]);
            } catch (checkErr) {
              logger.error(
                { err: safeErrorSerializer(checkErr) },
                'Readiness check execution failed or timed out',
              );
              rawChecks = { dependencies: 'unhealthy' };
            } finally {
              if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
              }
            }

            if (typeof rawChecks !== 'object' || rawChecks === null || Array.isArray(rawChecks)) {
              logger.warn(
                { service: serviceName },
                'Readiness check returned invalid non-object payload',
              );
              isReady = false;
              sanitizedChecks = { dependencies: 'unhealthy' };
            } else {
              const entries = Object.entries(rawChecks as Record<string, unknown>);
              const allHealthy =
                entries.length > 0 && entries.every(([, status]) => status === 'healthy');

              isReady = allHealthy;
              sanitizedChecks = {};
              for (const [dep, status] of entries) {
                sanitizedChecks[dep] = status === 'healthy' ? 'healthy' : 'unhealthy';
              }
              if (entries.length === 0) {
                isReady = true;
              }
            }
          }

          res.statusCode = isReady ? 200 : 503;
          res.end(
            JSON.stringify({
              status: isReady ? 'ready' : 'not_ready',
              timestamp: new Date().toISOString(),
              checks: sanitizedChecks,
            }),
          );
          return;
        }

        if (options.requestHandler) {
          await options.requestHandler(req, res, context);
          return;
        }

        // Default root endpoint
        if (req.method === 'GET' && pathname === '/') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              service: serviceName,
              status: 'operational',
            }),
          );
          return;
        }

        // Default 404 for unmatched routes
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.statusCode = 404;
        res.end(
          JSON.stringify({
            type: 'https://tools.ietf.org/html/rfc7807',
            title: 'Not Found',
            status: 404,
            detail: `Cannot ${req.method} ${pathname}`,
          }),
        );
      } catch (err) {
        logger.error(
          { err: safeErrorSerializer(err) },
          'Unhandled exception processing HTTP request',
        );
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.statusCode = 500;
          res.end(
            JSON.stringify({
              type: 'https://tools.ietf.org/html/rfc7807',
              title: 'Internal Server Error',
              status: 500,
              detail: 'An unexpected internal error occurred',
            }),
          );
        }
      } finally {
        activeRequests--;
        if (isShuttingDown) {
          server.closeIdleConnections?.();
        }
      }
    });
  });

  return {
    get server() {
      return server;
    },
    get serviceName() {
      return serviceName;
    },
    get port() {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        return addr.port;
      }
      return configuredPort;
    },
    get host() {
      return host;
    },
    isShuttingDown() {
      return isShuttingDown;
    },
    getActiveRequests() {
      return activeRequests;
    },
    start(): Promise<{ port: number; host: string }> {
      if (isShuttingDown || isStopped) {
        return Promise.reject(
          new Error('Cannot start HTTP server: service is shutting down or has stopped'),
        );
      }
      if (startPromise) {
        return startPromise;
      }
      if (server.listening) {
        const addr = server.address() as AddressInfo;
        return Promise.resolve({ port: addr.port, host: addr.address });
      }

      isStarting = true;
      startPromise = new Promise<{ port: number; host: string }>((resolve, reject) => {
        const onListening = () => {
          server.removeListener('error', onError);
          isStarting = false;
          const addr = server.address() as AddressInfo;
          logger.info(
            { port: addr.port, host: addr.address, service: serviceName },
            'HTTP service started',
          );
          resolve({ port: addr.port, host: addr.address });
        };

        const onError = (err: Error) => {
          server.removeListener('listening', onListening);
          isStarting = false;
          startPromise = null;
          logger.error(
            { err: safeErrorSerializer(err), service: serviceName },
            'Failed to start HTTP server',
          );
          reject(err);
        };

        server.once('listening', onListening);
        server.once('error', onError);

        try {
          server.listen(configuredPort, host);
        } catch (err) {
          onError(err as Error);
        }
      });

      return startPromise;
    },
    stop(): Promise<void> {
      if (isStopped) {
        return Promise.resolve();
      }
      if (shutdownPromise) {
        return shutdownPromise;
      }

      isShuttingDown = true;

      shutdownPromise = (async () => {
        // If startup is in flight, wait for it to settle before attempting closure
        if (isStarting && startPromise) {
          try {
            await startPromise;
          } catch {
            // Startup failed (e.g. EADDRINUSE). No listening socket to close.
            isStopped = true;
            return;
          }
        }

        if (!server.listening) {
          isStopped = true;
          logger.info({ service: serviceName }, 'HTTP service stopped (was not listening)');
          return;
        }

        return new Promise<void>((resolve, reject) => {
          let timerId: NodeJS.Timeout | null = null;

          const cleanupTimer = () => {
            if (timerId) {
              clearTimeout(timerId);
              timerId = null;
            }
          };

          timerId = setTimeout(() => {
            logger.warn(
              { service: serviceName, shutdownTimeoutMs, activeRequests },
              'Graceful shutdown deadline exceeded; force-closing remaining connections',
            );
            server.closeAllConnections?.();
          }, shutdownTimeoutMs);
          timerId.unref?.();

          server.closeIdleConnections?.();

          server.close((err) => {
            cleanupTimer();
            isStopped = true;
            if (err) {
              logger.error(
                { err: safeErrorSerializer(err), service: serviceName },
                'Error while closing HTTP server',
              );
              reject(err);
              return;
            }
            logger.info({ service: serviceName }, 'HTTP service stopped gracefully');
            resolve();
          });
        });
      })();

      return shutdownPromise;
    },
  };
}
