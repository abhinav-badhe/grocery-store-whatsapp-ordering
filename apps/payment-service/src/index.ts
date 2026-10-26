import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Kysely } from 'kysely';
import { createDatabaseClient, type Database } from '@grocery/database';
import {
  createHttpServer,
  createInternalTokenMiddleware,
  type HttpServerInstance,
  type HttpServerOptions,
} from '@grocery/service-runtime';
import { loadPaymentServiceConfig } from '@grocery/config';
import { createPaymentRepository, createPaymentWebhookRepository } from './persistence/index.js';
import {
  createPaymentServiceInstance,
  type PaymentService,
  type OrderLookupClient,
} from './service/index.js';
import { createPaymentRoutes } from './routes.js';
import { HttpOrderLookupClient } from './client/order-client.js';

export * from './persistence/index.js';
export * from './service/index.js';
export * from './routes.js';
export * from './client/order-client.js';

export interface PaymentServiceOptions extends Partial<HttpServerOptions> {
  readonly paymentService?: PaymentService;
  readonly orderClient?: OrderLookupClient;
  readonly db?: Kysely<Database>;
  readonly internalTokenSecret?: string;
  readonly expectedIssuer?: string;
  readonly expectedAudience?: string;
}

export function createPaymentService(options?: PaymentServiceOptions): HttpServerInstance {
  let paymentService = options?.paymentService;
  if (!paymentService && options?.db) {
    const paymentRepo = createPaymentRepository(options.db);
    const webhookRepo = createPaymentWebhookRepository(options.db);
    paymentService = createPaymentServiceInstance(
      paymentRepo,
      webhookRepo,
      undefined,
      options.orderClient,
    );
  }

  const rawRouteHandler = paymentService ? createPaymentRoutes({ paymentService }) : undefined;

  const internalTokenAuth =
    rawRouteHandler && options?.internalTokenSecret
      ? createInternalTokenMiddleware(
          {
            secret: options.internalTokenSecret,
            expectedIssuer: options.expectedIssuer,
            expectedAudience: options.expectedAudience,
          },
          rawRouteHandler,
        )
      : undefined;

  return createHttpServer({
    serviceName: 'payment-service',
    ...options,
    requestHandler: async (req, res, context) => {
      const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = parsedUrl.pathname;

      if (rawRouteHandler) {
        // Public endpoints: health checks, root info, and external webhook ingress
        const isPublic =
          pathname === '/' ||
          pathname.startsWith('/health/') ||
          pathname.startsWith('/api/v1/payments/webhooks/');

        if (isPublic || !internalTokenAuth) {
          await rawRouteHandler(req, res, context);
          return;
        }

        // Internal service-to-service endpoints require X-Internal-Token
        await internalTokenAuth(req, res, context);
        return;
      }

      if (options?.requestHandler) {
        await options.requestHandler(req, res, context);
        return;
      }

      if (pathname === '/') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            service: 'payment-service',
            status: 'operational',
            description: 'Payment Lifecycle & Provider Integration Domain Service',
          }),
        );
        return;
      }

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
    },
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const config = loadPaymentServiceConfig();
  const dbClient = createDatabaseClient<Database>({
    databaseUrl: config.DATABASE_URL,
    maxPoolSize: config.DATABASE_MAX_POOL_SIZE,
    connectionTimeoutMs: config.DATABASE_CONNECTION_TIMEOUT_MS,
    idleTimeoutMs: config.DATABASE_IDLE_TIMEOUT_MS,
  });
  const orderClient = new HttpOrderLookupClient({
    baseUrl: process.env.ORDER_SERVICE_URL ?? 'http://127.0.0.1:3004',
    internalTokenSecret: config.INTERNAL_TOKEN_SECRET,
  });
  const service = createPaymentService({
    port: config.PORT,
    db: dbClient.db,
    orderClient,
    internalTokenSecret: config.INTERNAL_TOKEN_SECRET,
    expectedIssuer: config.INTERNAL_TOKEN_ISSUER,
    expectedAudience: config.INTERNAL_TOKEN_AUDIENCE,
  });
  service.start().catch(() => {
    process.exit(1);
  });
}
