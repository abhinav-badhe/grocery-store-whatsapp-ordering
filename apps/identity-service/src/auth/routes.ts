import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpRequestHandler } from '@grocery/service-runtime';
import type { Logger, RequestContext } from '@grocery/observability';
import type { AuthService } from './types.js';
import { AuthError, PayloadTooLargeError, UnsupportedMediaTypeError } from './errors.js';

const MAX_JSON_BODY_BYTES = 64 * 1024; // 64 KiB payload limit to prevent buffer exhaustion

export interface AuthRouteOptions {
  /**
   * Whether to trust upstream reverse proxy headers (e.g. X-Forwarded-For).
   *
   * SECURITY INVARIANT & GATEWAY PREREQUISITE:
   * When false (default), client IP is extracted directly from the underlying TCP socket
   * (req.socket.remoteAddress), preventing external callers from spoofing arbitrary
   * X-Forwarded-For headers to evade rate limits.
   *
   * When true, X-Forwarded-For is trusted ONLY when identity-service is deployed behind
   * a trusted reverse proxy / API Gateway (per ADR-001 §3). The API Gateway is the mandatory
   * prerequisite responsible for terminating public TLS, stripping unverified client
   * forwarding headers, and setting the canonical client IP.
   */
  readonly trustProxy?: boolean;
  readonly logger?: Logger;
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new UnsupportedMediaTypeError('Content-Type must be application/json');
  }

  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    let exceeded = false;

    req.on('data', (chunk: Buffer) => {
      if (exceeded) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        exceeded = true;
        // Cease buffering and resume stream to discard remaining incoming chunks
        req.removeAllListeners('data');
        req.resume();
        reject(
          new PayloadTooLargeError(
            `Request body exceeds maximum allowed size of ${maxBytes} bytes`,
          ),
        );
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (exceeded) return;
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        const parsed = JSON.parse(text);
        resolve(parsed);
      } catch {
        reject(new Error('Malformed JSON payload in request body'));
      }
    });

    req.on('error', (err) => {
      if (exceeded) return;
      reject(err);
    });
  });
}

function sendJsonResponse(res: ServerResponse, statusCode: number, data: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

/**
 * Creates an HTTP request handler for user registration and login endpoints.
 */
export function createAuthRequestHandler(
  authService: AuthService,
  options?: AuthRouteOptions | Logger,
  maybeLogger?: Logger,
): HttpRequestHandler {
  const opts: AuthRouteOptions =
    options && typeof (options as Logger).info === 'function'
      ? { logger: options as Logger }
      : ((options as AuthRouteOptions) ?? {});
  const logger = maybeLogger ?? opts.logger;
  const trustProxy = opts.trustProxy ?? false;

  return async (req: IncomingMessage, res: ServerResponse, context: RequestContext) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    const getClientIp = (): string => {
      if (trustProxy) {
        const forwarded = req.headers['x-forwarded-for'];
        if (typeof forwarded === 'string') {
          return forwarded.split(',')[0]!.trim();
        }
      }
      return req.socket.remoteAddress ?? '127.0.0.1';
    };

    try {
      // 1. POST /api/v1/auth/register or POST /register
      if (method === 'POST' && (pathname === '/api/v1/auth/register' || pathname === '/register')) {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch (bodyErr) {
          if (bodyErr instanceof AuthError) {
            if (bodyErr.statusCode === 413) {
              res.setHeader('Connection', 'close');
            }
            sendJsonResponse(res, bodyErr.statusCode, bodyErr.toJSON());
            return;
          }
          sendJsonResponse(res, 400, {
            type: 'https://tools.ietf.org/html/rfc7807',
            title: 'Bad Request',
            status: 400,
            detail: (bodyErr as Error).message,
            code: 'INVALID_REQUEST_BODY',
          });
          return;
        }

        const result = await authService.register(body);
        sendJsonResponse(res, 201, result);
        return;
      }

      // 2. POST /api/v1/auth/login or POST /login
      if (method === 'POST' && (pathname === '/api/v1/auth/login' || pathname === '/login')) {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch (bodyErr) {
          if (bodyErr instanceof AuthError) {
            if (bodyErr.statusCode === 413) {
              res.setHeader('Connection', 'close');
            }
            sendJsonResponse(res, bodyErr.statusCode, bodyErr.toJSON());
            return;
          }
          sendJsonResponse(res, 400, {
            type: 'https://tools.ietf.org/html/rfc7807',
            title: 'Bad Request',
            status: 400,
            detail: (bodyErr as Error).message,
            code: 'INVALID_REQUEST_BODY',
          });
          return;
        }

        const clientIp = getClientIp();
        const result = await authService.login(body, clientIp);
        sendJsonResponse(res, 200, result);
        return;
      }

      // 3. Operational Root
      if (method === 'GET' && pathname === '/') {
        sendJsonResponse(res, 200, {
          service: 'identity-service',
          status: 'operational',
          description: 'Identity & Authentication Domain Service',
        });
        return;
      }

      // Unmatched route fallback
      sendJsonResponse(res, 404, {
        type: 'https://tools.ietf.org/html/rfc7807',
        title: 'Not Found',
        status: 404,
        detail: `Cannot ${method} ${pathname}`,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        sendJsonResponse(res, err.statusCode, err.toJSON());
        return;
      }

      logger?.error(
        { err, requestId: context.requestId },
        'Unhandled error in identity auth request handler',
      );
      sendJsonResponse(res, 500, {
        type: 'https://tools.ietf.org/html/rfc7807',
        title: 'Internal Server Error',
        status: 500,
        detail: 'An unexpected internal error occurred',
        code: 'INTERNAL_ERROR',
      });
    }
  };
}
