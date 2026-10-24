import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Kysely } from 'kysely';
import type { Database } from '@grocery/database';
import {
  createHttpServer,
  type HttpServerInstance,
  type HttpServerOptions,
} from '@grocery/service-runtime';
import { createAuthService, createAuthRequestHandler, type AuthService } from './auth/index.js';

export * from './crypto/index.js';
export * from './persistence/index.js';
export * from './auth/index.js';

export interface IdentityServiceOptions extends Partial<HttpServerOptions> {
  readonly authService?: AuthService;
  readonly db?: Kysely<Database>;
  readonly trustProxy?: boolean;
}

export function createIdentityService(options?: IdentityServiceOptions): HttpServerInstance {
  const authService =
    options?.authService ?? (options?.db ? createAuthService({ db: options.db }) : undefined);

  return createHttpServer({
    serviceName: 'identity-service',
    ...options,
    requestHandler: async (req, res, context) => {
      if (options?.requestHandler) {
        await options.requestHandler(req, res, context);
        return;
      }
      if (authService) {
        const handler = createAuthRequestHandler(authService, {
          trustProxy: options?.trustProxy,
          logger: options?.logger,
        });
        await handler(req, res, context);
        return;
      }
      const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      if (parsedUrl.pathname === '/') {
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
  const service = createIdentityService();
  service.start().catch(() => {
    process.exit(1);
  });
}
