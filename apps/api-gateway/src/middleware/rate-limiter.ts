import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RateLimiterOptions {
  readonly windowMs: number;
  readonly maxRequests: number;
}

export interface RateLimiter {
  checkRateLimit(req: IncomingMessage, res: ServerResponse): boolean;
  reset(): void;
}

interface ClientRecord {
  count: number;
  resetTime: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const clients = new Map<string, ClientRecord>();

  return {
    checkRateLimit(req: IncomingMessage, res: ServerResponse): boolean {
      const now = Date.now();
      const clientIp = req.socket.remoteAddress ?? '127.0.0.1';

      let record = clients.get(clientIp);
      if (!record || now > record.resetTime) {
        record = {
          count: 1,
          resetTime: now + options.windowMs,
        };
        clients.set(clientIp, record);
        return true;
      }

      record.count++;
      if (record.count > options.maxRequests) {
        const retryAfterSeconds = Math.max(1, Math.ceil((record.resetTime - now) / 1000));
        res.setHeader('Retry-After', String(retryAfterSeconds));
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.statusCode = 429;
        res.end(
          JSON.stringify({
            type: 'https://tools.ietf.org/html/rfc7807',
            title: 'Too Many Requests',
            status: 429,
            detail: 'Rate limit exceeded. Please try again later.',
            retryAfterSeconds,
          }),
        );
        return false;
      }

      return true;
    },

    reset(): void {
      clients.clear();
    },
  };
}
