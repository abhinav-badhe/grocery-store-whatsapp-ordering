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
import { loadCatalogServiceConfig } from '@grocery/config';
import { createCategoryRepository } from './persistence/category-repository.js';
import { createProductRepository } from './persistence/product-repository.js';
import { createCatalogServiceInstance, type CatalogService } from './service/index.js';
import { createCatalogRoutes } from './routes.js';

export * from './persistence/index.js';
export * from './service/index.js';
export * from './routes.js';

export interface CatalogServiceOptions extends Partial<HttpServerOptions> {
  readonly catalogService?: CatalogService;
  readonly db?: Kysely<Database>;
  readonly internalTokenSecret?: string;
  readonly expectedIssuer?: string;
  readonly expectedAudience?: string;
}

export function createCatalogService(options?: CatalogServiceOptions): HttpServerInstance {
  let catalogService = options?.catalogService;
  if (!catalogService && options?.db) {
    const categoryRepo = createCategoryRepository(options.db);
    const productRepo = createProductRepository(options.db);
    catalogService = createCatalogServiceInstance(categoryRepo, productRepo);
  }

  const rawRouteHandler = catalogService ? createCatalogRoutes({ catalogService }) : undefined;

  const catalogHandler =
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
    serviceName: 'catalog-service',
    ...options,
    requestHandler: async (req, res, context) => {
      if (options?.requestHandler) {
        await options.requestHandler(req, res, context);
        return;
      }
      const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = parsedUrl.pathname;

      if (catalogHandler && pathname.startsWith('/api/v1/catalog')) {
        await catalogHandler(req, res, context);
        return;
      }

      if (pathname === '/') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            service: 'catalog-service',
            status: 'operational',
            description: 'Product Catalog & Category Domain Service',
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
  const config = loadCatalogServiceConfig();
  const dbClient = createDatabaseClient<Database>({
    databaseUrl: config.DATABASE_URL,
    maxPoolSize: config.DATABASE_MAX_POOL_SIZE,
    connectionTimeoutMs: config.DATABASE_CONNECTION_TIMEOUT_MS,
    idleTimeoutMs: config.DATABASE_IDLE_TIMEOUT_MS,
  });
  const service = createCatalogService({
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
