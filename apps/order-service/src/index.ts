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
import { loadOrderServiceConfig } from '@grocery/config';
import { createOrderRepository } from './persistence/order-repository.js';
import {
  createOrderServiceInstance,
  type OrderService,
  type InventoryClient,
  type CatalogLookupClient,
} from './service/index.js';
import { createOrderRoutes } from './routes.js';
import { HttpInventoryClient, type HttpInventoryClientOptions } from './client/inventory-client.js';

export * from './persistence/index.js';
export * from './service/index.js';
export * from './routes.js';
export * from './client/inventory-client.js';

export interface OrderServiceOptions extends Partial<HttpServerOptions> {
  readonly orderService?: OrderService;
  readonly db?: Kysely<Database>;
  readonly inventoryClient?: InventoryClient;
  readonly catalogClient?: CatalogLookupClient;
  readonly internalTokenSecret?: string;
  readonly expectedIssuer?: string;
  readonly expectedAudience?: string;
}

export function createOrderService(options?: OrderServiceOptions): HttpServerInstance {
  let orderService = options?.orderService;
  if (!orderService && options?.db) {
    const orderRepo = createOrderRepository(options.db);
    orderService = createOrderServiceInstance(
      orderRepo,
      options.inventoryClient,
      options.catalogClient,
    );
  }

  const rawRouteHandler = orderService ? createOrderRoutes({ orderService }) : undefined;

  const orderHandler =
    rawRouteHandler && options?.internalTokenSecret
      ? createInternalTokenMiddleware(
          {
            secret: options.internalTokenSecret,
            expectedIssuer: options.expectedIssuer,
            expectedAudience: options.expectedAudience,
          },
          rawRouteHandler,
        )
      : rawRouteHandler;

  return createHttpServer({
    serviceName: 'order-service',
    ...options,
    requestHandler: async (req, res, context) => {
      if (orderHandler) {
        await orderHandler(req, res, context);
        return;
      }
      if (options?.requestHandler) {
        await options.requestHandler(req, res, context);
        return;
      }
      const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      if (parsedUrl.pathname === '/') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            service: 'order-service',
            status: 'operational',
            description: 'Order State Machine, Cart Lifecycle & Checkout Orchestration Service',
            modules: ['order', 'billing'],
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
          detail: `Cannot ${req.method} ${parsedUrl.pathname}`,
        }),
      );
    },
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const config = loadOrderServiceConfig();
  const dbClient = createDatabaseClient<Database>({
    databaseUrl: config.DATABASE_URL,
    maxPoolSize: config.DATABASE_MAX_POOL_SIZE,
    connectionTimeoutMs: config.DATABASE_CONNECTION_TIMEOUT_MS,
    idleTimeoutMs: config.DATABASE_IDLE_TIMEOUT_MS,
  });
  const inventoryClient = new HttpInventoryClient({
    baseUrl: process.env.INVENTORY_SERVICE_URL ?? 'http://127.0.0.1:3003',
    internalTokenSecret: config.INTERNAL_TOKEN_SECRET,
  });
  const service = createOrderService({
    port: config.PORT,
    db: dbClient.db,
    inventoryClient,
    internalTokenSecret: config.INTERNAL_TOKEN_SECRET,
    expectedIssuer: config.INTERNAL_TOKEN_ISSUER,
    expectedAudience: config.INTERNAL_TOKEN_AUDIENCE,
  });
  service.start().catch(() => {
    process.exit(1);
  });
}
