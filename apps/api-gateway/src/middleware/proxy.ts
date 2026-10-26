import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { mintInternalToken } from '@grocery/service-runtime';
import type { ServiceUrls } from '../types.js';

export interface ProxyRouter {
  getTargetUrl(pathname: string): string | null;
  forwardRequest(
    req: IncomingMessage,
    res: ServerResponse,
    targetBaseUrl: string,
    internalTokenSecret: string,
  ): Promise<void>;
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
]);

export function createProxyRouter(serviceUrls: ServiceUrls): ProxyRouter {
  return {
    getTargetUrl(pathname: string): string | null {
      if (
        pathname.startsWith('/api/v1/auth') ||
        pathname.startsWith('/api/v1/users') ||
        pathname.startsWith('/api/v1/stores')
      ) {
        return serviceUrls.identity;
      }
      if (pathname.startsWith('/api/v1/catalog')) {
        return serviceUrls.catalog;
      }
      if (pathname.startsWith('/api/v1/inventory')) {
        return serviceUrls.inventory;
      }
      if (pathname.startsWith('/api/v1/orders')) {
        return serviceUrls.order;
      }
      if (pathname.startsWith('/api/v1/payments')) {
        return serviceUrls.payment;
      }
      return null;
    },

    async forwardRequest(
      req: IncomingMessage,
      res: ServerResponse,
      targetBaseUrl: string,
      internalTokenSecret: string,
    ): Promise<void> {
      return new Promise((resolve) => {
        const parsedBase = new URL(targetBaseUrl);
        const incomingUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        const targetPath = `${incomingUrl.pathname}${incomingUrl.search}`;

        // Generate or propagate correlation ID
        const correlationId = (req.headers['x-correlation-id'] as string) || crypto.randomUUID();

        // Extract tenant store ID from header if present to avoid TENANT_MISMATCH downstream
        const tenantStoreId =
          (typeof req.headers['x-store-id'] === 'string' && req.headers['x-store-id'].trim()) ||
          '00000000-0000-0000-0000-000000000000';

        // Sign internal token for private microservice boundary
        const internalToken = mintInternalToken(
          {
            sub: 'api-gateway',
            act: 'SYSTEM',
            tid: tenantStoreId,
            roles: ['OWNER', 'STAFF'],
          },
          {
            secret: internalTokenSecret,
            issuer: 'api-gateway',
            audience: 'grocery-internal-services',
          },
        );

        // Sanitize headers
        const forwardedHeaders: http.OutgoingHttpHeaders = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase()) && value !== undefined) {
            forwardedHeaders[key] = value;
          }
        }

        forwardedHeaders['x-correlation-id'] = correlationId;
        forwardedHeaders['x-forwarded-for'] = req.socket.remoteAddress ?? '127.0.0.1';
        forwardedHeaders['x-forwarded-proto'] = 'http';
        forwardedHeaders['x-internal-token'] = internalToken;

        const isHttps = parsedBase.protocol === 'https:';
        const requestFn = isHttps ? https.request : http.request;

        const proxyReq = requestFn(
          {
            protocol: parsedBase.protocol,
            hostname: parsedBase.hostname,
            port: parsedBase.port || (isHttps ? 443 : 80),
            path: targetPath,
            method: req.method,
            headers: forwardedHeaders,
            timeout: 30000,
          },
          (proxyRes) => {
            res.statusCode = proxyRes.statusCode ?? 500;

            for (const [key, value] of Object.entries(proxyRes.headers)) {
              if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase()) && value !== undefined) {
                res.setHeader(key, value);
              }
            }

            proxyRes.pipe(res);
            proxyRes.on('end', () => resolve());
            proxyRes.on('error', () => {
              if (!res.headersSent) {
                res.statusCode = 502;
                res.end();
              }
              resolve();
            });
          },
        );

        proxyReq.on('error', (err) => {
          if (!res.headersSent) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(
              JSON.stringify({
                type: 'https://tools.ietf.org/html/rfc7807',
                title: 'Bad Gateway',
                status: 502,
                detail: `Downstream service at ${targetBaseUrl} is unavailable: ${err.message}`,
              }),
            );
          }
          resolve();
        });

        proxyReq.on('timeout', () => {
          proxyReq.destroy();
          if (!res.headersSent) {
            res.statusCode = 504;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(
              JSON.stringify({
                type: 'https://tools.ietf.org/html/rfc7807',
                title: 'Gateway Timeout',
                status: 504,
                detail: `Downstream service timed out after 30000ms`,
              }),
            );
          }
          resolve();
        });

        req.pipe(proxyReq);
      });
    },
  };
}
