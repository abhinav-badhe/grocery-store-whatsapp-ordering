import type { IncomingMessage, ServerResponse } from 'node:http';

export interface CorsHandler {
  handleCors(req: IncomingMessage, res: ServerResponse): boolean;
}

export function createCorsMiddleware(allowedOrigins: readonly string[]): CorsHandler {
  const allowedSet = new Set(allowedOrigins.map((o) => o.trim().toLowerCase()));

  return {
    handleCors(req: IncomingMessage, res: ServerResponse): boolean {
      const origin = req.headers.origin;

      if (origin) {
        const normalizedOrigin = origin.trim().toLowerCase();
        if (allowedSet.has(normalizedOrigin)) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Credentials', 'true');
          res.setHeader('Vary', 'Origin');
        }
      }

      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, X-Requested-With, X-Correlation-ID, Idempotency-Key, x-internal-token, x-razorpay-signature, stripe-signature',
        );
        res.setHeader('Access-Control-Max-Age', '86400');
        res.statusCode = 204;
        res.end();
        return true;
      }

      return false;
    },
  };
}
