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
import { loadInventoryServiceConfig } from '@grocery/config';
import { createStockBalanceRepository } from './persistence/stock-balance-repository.js';
import { createStockReservationRepository } from './persistence/stock-reservation-repository.js';
import { createStockMovementRepository } from './persistence/stock-movement-repository.js';
import { createInventoryServiceInstance, type InventoryService } from './service/index.js';
import { createInventoryRoutes } from './routes.js';

export * from './persistence/index.js';
export * from './service/index.js';
export * from './routes.js';

export interface InventoryServiceOptions extends Partial<HttpServerOptions> {
  readonly inventoryService?: InventoryService;
  readonly db?: Kysely<Database>;
  readonly internalTokenSecret?: string;
  readonly expectedIssuer?: string;
  readonly expectedAudience?: string;
}

export function createInventoryService(options?: InventoryServiceOptions): HttpServerInstance {
  let inventoryService = options?.inventoryService;
  if (!inventoryService && options?.db) {
    const stockRepo = createStockBalanceRepository(options.db);
    const reservationRepo = createStockReservationRepository(options.db);
    const movementRepo = createStockMovementRepository(options.db);
    inventoryService = createInventoryServiceInstance(
      options.db,
      stockRepo,
      reservationRepo,
      movementRepo,
    );
  }

  const rawRouteHandler = inventoryService
    ? createInventoryRoutes({ inventoryService })
    : undefined;

  const inventoryHandler =
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
    serviceName: 'inventory-service',
    ...options,
    requestHandler: async (req, res, context) => {
      if (options?.requestHandler) {
        await options.requestHandler(req, res, context);
        return;
      }
      const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = parsedUrl.pathname;

      if (inventoryHandler && pathname.startsWith('/api/v1/inventory')) {
        await inventoryHandler(req, res, context);
        return;
      }

      if (pathname === '/') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            service: 'inventory-service',
            status: 'operational',
            description: 'Inventory & Stock Balance Domain Service',
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
  const config = loadInventoryServiceConfig();
  const dbClient = createDatabaseClient<Database>({
    databaseUrl: config.DATABASE_URL,
    maxPoolSize: config.DATABASE_MAX_POOL_SIZE,
    connectionTimeoutMs: config.DATABASE_CONNECTION_TIMEOUT_MS,
    idleTimeoutMs: config.DATABASE_IDLE_TIMEOUT_MS,
  });
  const service = createInventoryService({
    port: config.PORT,
    db: dbClient.db,
    internalTokenSecret: config.INTERNAL_TOKEN_SECRET,
    expectedIssuer: config.INTERNAL_TOKEN_ISSUER,
    expectedAudience: config.INTERNAL_TOKEN_AUDIENCE,
  });
  service.start().catch(() => {
    process.exit(1);
  });
}
