import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpRequestHandler } from '@grocery/service-runtime';
import type { Logger, RequestContext } from '@grocery/observability';
import {
  AuthResponseSchema,
  TokenResponseSchema,
  RefreshTokenResponseSchema,
  LogoutResponseSchema,
  CurrentUserResponseSchema,
} from '@grocery/api-contracts';
import type { AuthService } from './types.js';
import {
  AuthError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  UnauthorizedError,
  ForbiddenError,
} from './errors.js';

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
  readonly allowedOrigins?: readonly string[];
  readonly cookieSecure?: boolean;
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return {};
  }
  const cookies: Record<string, string> = {};
  for (const pair of cookieHeader.split(';')) {
    const [rawKey, ...valParts] = pair.trim().split('=');
    if (rawKey && valParts.length > 0) {
      cookies[rawKey.trim()] = decodeURIComponent(valParts.join('=').trim());
    }
  }
  return cookies;
}

export function buildRefreshTokenCookie(
  rawToken: string,
  options: { maxAgeSeconds?: number; secure?: boolean } = {},
): string {
  const maxAge = options.maxAgeSeconds ?? 7 * 24 * 60 * 60; // 7 days idle per ADR-003
  const isSecure = options.secure ?? true;
  const secureFlag = isSecure ? '; Secure' : '';
  return `refresh_token=${rawToken}; Path=/api/v1/auth; HttpOnly; SameSite=Strict${secureFlag}; Max-Age=${maxAge}`;
}

export function buildClearRefreshTokenCookie(options: { secure?: boolean } = {}): string {
  const isSecure = options.secure ?? true;
  const secureFlag = isSecure ? '; Secure' : '';
  return `refresh_token=; Path=/api/v1/auth; HttpOnly; SameSite=Strict${secureFlag}; Max-Age=0`;
}

function validateCsrf(req: IncomingMessage, allowedOrigins?: readonly string[]): void {
  const origin = req.headers['origin'];
  const referer = req.headers['referer'];

  // If origin is provided, verify against allowed origins when configured
  if (allowedOrigins && allowedOrigins.length > 0) {
    if (typeof origin === 'string') {
      const originMatches = allowedOrigins.some((allowed) => allowed === origin);
      if (!originMatches) {
        throw new ForbiddenError(
          `Cross-site request blocked: Origin '${origin}' is not authorized`,
          'CSRF_VALIDATION_FAILED',
        );
      }
      return;
    }

    if (typeof referer === 'string') {
      try {
        const refererUrl = new URL(referer);
        const refererOrigin = refererUrl.origin;
        const refererMatches = allowedOrigins.some((allowed) => allowed === refererOrigin);
        if (!refererMatches) {
          throw new ForbiddenError(
            `Cross-site request blocked: Referer origin '${refererOrigin}' is not authorized`,
            'CSRF_VALIDATION_FAILED',
          );
        }
        return;
      } catch {
        throw new ForbiddenError('Malformed Referer header in request', 'CSRF_VALIDATION_FAILED');
      }
    }

    // In production with configured allowedOrigins, missing both Origin and Referer on state-changing cookie requests is rejected
    throw new ForbiddenError(
      'Missing Origin or Referer header on state-changing request',
      'CSRF_VALIDATION_FAILED',
    );
  }
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
 * Creates an HTTP request handler for authentication, session management, and user identity endpoints.
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
  const cookieSecure = opts.cookieSecure ?? true;
  const allowedOrigins = opts.allowedOrigins;

  return async (req: IncomingMessage, res: ServerResponse, context: RequestContext) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    // CORS headers
    const reqOrigin = req.headers['origin'];
    if (typeof reqOrigin === 'string' && allowedOrigins?.includes(reqOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }

    if (method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With',
      );
      res.setHeader('Access-Control-Max-Age', '86400');
      res.statusCode = 204;
      res.end();
      return;
    }

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

        if (result.session) {
          res.setHeader(
            'Set-Cookie',
            buildRefreshTokenCookie(result.session.rawRefreshToken, { secure: cookieSecure }),
          );
          const responsePayload = TokenResponseSchema.parse({
            accessToken: result.session.accessToken,
            tokenType: result.session.tokenType,
            expiresIn: result.session.expiresIn,
            user: result.user,
          });
          sendJsonResponse(res, 201, responsePayload);
          return;
        }

        const responsePayload = AuthResponseSchema.parse({
          user: result.user,
        });
        sendJsonResponse(res, 201, responsePayload);
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

        if (result.session) {
          res.setHeader(
            'Set-Cookie',
            buildRefreshTokenCookie(result.session.rawRefreshToken, { secure: cookieSecure }),
          );
          const responsePayload = TokenResponseSchema.parse({
            accessToken: result.session.accessToken,
            tokenType: result.session.tokenType,
            expiresIn: result.session.expiresIn,
            user: result.user,
          });
          sendJsonResponse(res, 200, responsePayload);
          return;
        }

        const responsePayload = AuthResponseSchema.parse({
          user: result.user,
        });
        sendJsonResponse(res, 200, responsePayload);
        return;
      }

      // 3. POST /api/v1/auth/refresh (Rotation per ADR-003 / ADR-011)
      if (method === 'POST' && pathname === '/api/v1/auth/refresh') {
        validateCsrf(req, allowedOrigins);
        const cookies = parseCookies(req.headers['cookie']);
        const rawRefreshToken = cookies['refresh_token'];

        if (!rawRefreshToken) {
          throw new UnauthorizedError(
            'Refresh token cookie is required for session refresh',
            'REFRESH_TOKEN_REQUIRED',
          );
        }

        const result = await authService.refresh(rawRefreshToken);
        res.setHeader(
          'Set-Cookie',
          buildRefreshTokenCookie(result.rawRefreshToken, { secure: cookieSecure }),
        );
        const responsePayload = RefreshTokenResponseSchema.parse({
          accessToken: result.accessToken,
          tokenType: result.tokenType,
          expiresIn: result.expiresIn,
        });
        sendJsonResponse(res, 200, responsePayload);
        return;
      }

      // 4. POST /api/v1/auth/logout (Revocation & Cookie Clearance)
      if (method === 'POST' && pathname === '/api/v1/auth/logout') {
        validateCsrf(req, allowedOrigins);
        const cookies = parseCookies(req.headers['cookie']);
        const rawRefreshToken = cookies['refresh_token'];

        if (rawRefreshToken) {
          await authService.logout(rawRefreshToken);
        }

        res.setHeader('Set-Cookie', buildClearRefreshTokenCookie({ secure: cookieSecure }));
        const responsePayload = LogoutResponseSchema.parse({ success: true });
        sendJsonResponse(res, 200, responsePayload);
        return;
      }

      // 5. GET /api/v1/auth/me (User verification via Bearer access token)
      if (method === 'GET' && pathname === '/api/v1/auth/me') {
        const authHeader = req.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          throw new UnauthorizedError(
            'Bearer access token is required in Authorization header',
            'UNAUTHORIZED',
          );
        }

        const token = authHeader.slice(7).trim();
        const result = await authService.getCurrentUser(token);
        const responsePayload = CurrentUserResponseSchema.parse({
          user: result.user,
        });
        sendJsonResponse(res, 200, responsePayload);
        return;
      }

      // 6. Operational Root
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
