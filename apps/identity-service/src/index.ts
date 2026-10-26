import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Kysely } from 'kysely';
import { createDatabaseClient, type Database } from '@grocery/database';
import { loadIdentityServiceConfig } from '@grocery/config';
import {
  createHttpServer,
  type HttpServerInstance,
  type HttpServerOptions,
} from '@grocery/service-runtime';
import { createAuthService, createAuthRequestHandler, type AuthService } from './auth/index.js';
import { createStoreService, createStoreRequestHandler, type StoreService } from './store/index.js';

export * from './crypto/index.js';
export * from './persistence/index.js';
export * from './auth/index.js';
export {
  createStoreService,
  createStoreRequestHandler,
  mapStoreRowToProfile,
  mapMembershipRow,
  type StoreService,
  type StoreServiceDependencies,
  type CreateStoreResult,
  type StoreRouteOptions,
  StoreError,
  StoreNotFoundError,
  MembershipNotFoundError,
  StoreAccessDeniedError,
  StoreUnauthorizedError,
} from './store/index.js';

export interface IdentityServiceOptions extends Partial<HttpServerOptions> {
  readonly authService?: AuthService;
  readonly storeService?: StoreService;
  readonly db?: Kysely<Database>;
  readonly trustProxy?: boolean;
  readonly allowedOrigins?: readonly string[];
  readonly cookieSecure?: boolean;
}

export function createIdentityService(options?: IdentityServiceOptions): HttpServerInstance {
  const authService =
    options?.authService ?? (options?.db ? createAuthService({ db: options.db }) : undefined);
  const storeService =
    options?.storeService ?? (options?.db ? createStoreService({ db: options.db }) : undefined);

  return createHttpServer({
    serviceName: 'identity-service',
    ...options,
    requestHandler: async (req, res, context) => {
      if (options?.requestHandler) {
        await options.requestHandler(req, res, context);
        return;
      }

      const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = parsedUrl.pathname;

      if (
        storeService &&
        (pathname.startsWith('/api/v1/stores') || pathname === '/api/v1/users/me/stores')
      ) {
        const storeHandler = createStoreRequestHandler(storeService, {
          logger: options?.logger,
          authService,
        });
        await storeHandler(req, res, context);
        return;
      }

      if (authService) {
        const handler = createAuthRequestHandler(authService, {
          trustProxy: options?.trustProxy,
          logger: options?.logger,
          allowedOrigins: options?.allowedOrigins,
          cookieSecure: options?.cookieSecure,
        });
        await handler(req, res, context);
        return;
      }
      if (pathname === '/') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            service: 'identity-service',
            status: 'operational',
            description: 'Identity & Authentication Domain Service',
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
  const config = loadIdentityServiceConfig();
  const dbClient = createDatabaseClient<Database>({
    databaseUrl: config.DATABASE_URL,
    maxPoolSize: config.DATABASE_MAX_POOL_SIZE,
    connectionTimeoutMs: config.DATABASE_CONNECTION_TIMEOUT_MS,
    idleTimeoutMs: config.DATABASE_IDLE_TIMEOUT_MS,
  });
  const service = createIdentityService({
    port: config.PORT,
    db: dbClient.db,
  });
  service.start().catch(() => {
    process.exit(1);
  });
}
