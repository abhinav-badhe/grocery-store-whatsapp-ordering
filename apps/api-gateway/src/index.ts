import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpServer, type HttpServerInstance } from '@grocery/service-runtime';
import { loadGatewayConfig } from '@grocery/config';
import { createCorsMiddleware } from './middleware/cors.js';
import { createRateLimiter } from './middleware/rate-limiter.js';
import { createProxyRouter } from './middleware/proxy.js';
import type { ApiGatewayOptions, ServiceUrls } from './types.js';

export * from './types.js';
export * from './middleware/index.js';

export function createApiGateway(options?: ApiGatewayOptions): HttpServerInstance {
  const config = loadGatewayConfig(process.env);

  const corsAllowedOrigins =
    options?.corsAllowedOrigins ?? config.CORS_ALLOWED_ORIGINS.split(',').map((s) => s.trim());

  const rateLimitWindowMs = options?.rateLimitWindowMs ?? config.RATE_LIMIT_WINDOW_MS;
  const rateLimitMaxRequests = options?.rateLimitMaxRequests ?? config.RATE_LIMIT_MAX_REQUESTS;
  const internalTokenSecret = options?.internalTokenSecret ?? config.INTERNAL_TOKEN_SECRET;

  const serviceUrls: ServiceUrls = {
    identity: options?.serviceUrls?.identity ?? config.IDENTITY_SERVICE_URL,
    catalog: options?.serviceUrls?.catalog ?? config.CATALOG_SERVICE_URL,
    inventory: options?.serviceUrls?.inventory ?? config.INVENTORY_SERVICE_URL,
    order: options?.serviceUrls?.order ?? config.ORDER_SERVICE_URL,
    payment: options?.serviceUrls?.payment ?? config.PAYMENT_SERVICE_URL,
  };

  const cors = createCorsMiddleware(corsAllowedOrigins);
  const rateLimiter = createRateLimiter({
    windowMs: rateLimitWindowMs,
    maxRequests: rateLimitMaxRequests,
  });
  const proxyRouter = createProxyRouter(serviceUrls);

  return createHttpServer({
    serviceName: 'api-gateway',
    ...options,
    requestHandler: async (req, res, context) => {
      if (options?.requestHandler) {
        await options.requestHandler(req, res, context);
        return;
      }

      // 1. CORS Preflight & Headers
      if (cors.handleCors(req, res)) {
        return;
      }

      // 2. Ingress Rate Limiting
      if (!rateLimiter.checkRateLimit(req, res)) {
        return;
      }

      const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = parsedUrl.pathname;

      // 3. Gateway Root Info
      if (pathname === '/') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            service: 'api-gateway',
            status: 'operational',
            description: 'Public API Gateway Ingress',
          }),
        );
        return;
      }

      // 4. Reverse Proxy Routing to Downstream Microservices
      const targetBaseUrl = proxyRouter.getTargetUrl(pathname);
      if (targetBaseUrl) {
        await proxyRouter.forwardRequest(req, res, targetBaseUrl, internalTokenSecret);
        return;
      }

      // 5. Unmatched 404 Route
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
  const service = createApiGateway();
  service.start().catch(() => {
    process.exit(1);
  });
}
