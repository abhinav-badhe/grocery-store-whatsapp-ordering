import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  InternalTokenClaimsSchema,
  type InternalTokenClaims,
  type ActorPersona,
  type StoreRole,
} from '@grocery/api-contracts';
import type { RequestContext } from '@grocery/observability';
import type { HttpRequestHandler } from './types.js';

export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

export interface InternalTokenHeader {
  readonly alg: 'HS256';
  readonly typ: 'JWT';
}

export type InternalTokenErrorReason =
  | 'MISSING_TOKEN'
  | 'MALFORMED_TOKEN'
  | 'UNSUPPORTED_ALGORITHM'
  | 'INVALID_SIGNATURE'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_NOT_YET_VALID'
  | 'INVALID_ISSUER'
  | 'INVALID_AUDIENCE'
  | 'SCHEMA_VALIDATION_FAILED';

export class InternalTokenError extends Error {
  public readonly statusCode = 401;
  public readonly title = 'Unauthorized';
  public readonly code: string;

  constructor(
    detail: string,
    public readonly reason: InternalTokenErrorReason,
    code = 'INVALID_INTERNAL_TOKEN',
  ) {
    super(detail);
    this.name = 'InternalTokenError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      type: 'https://tools.ietf.org/html/rfc7807',
      title: this.title,
      status: this.statusCode,
      detail: this.message,
      code: this.code,
      reason: this.reason,
    };
  }
}

export interface MintInternalTokenInput {
  readonly sub: string;
  readonly act: ActorPersona;
  readonly tid: string;
  readonly roles: readonly StoreRole[];
  readonly iss?: string;
  readonly aud?: string;
  readonly jti?: string;
  readonly iat?: number;
  readonly nbf?: number;
  readonly exp?: number;
}

export interface MintInternalTokenOptions {
  readonly secret: string | Buffer;
  readonly issuer?: string;
  readonly audience?: string;
  readonly expiresInSeconds?: number;
}

export interface VerifyInternalTokenOptions {
  readonly secret: string | Buffer;
  readonly expectedIssuer?: string;
  readonly expectedAudience?: string;
  readonly clockToleranceSeconds?: number;
}

/**
 * Mints a symmetric HMAC-SHA256 internal service-to-service token (X-Internal-Token).
 * Modeled strictly after ADR-001 §5.2.
 */
export function mintInternalToken(
  input: MintInternalTokenInput,
  options: MintInternalTokenOptions,
): string {
  const secretKey = options.secret;
  if (!secretKey || (typeof secretKey === 'string' && secretKey.length === 0)) {
    throw new TypeError('Secret key must be a non-empty string or Buffer');
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresIn = options.expiresInSeconds ?? 60; // 60s default short lifespan per ADR-001 §5.2

  const header: InternalTokenHeader = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const rawClaims = {
    iss: input.iss ?? options.issuer ?? 'grocery-api-gateway',
    aud: input.aud ?? options.audience ?? 'grocery-internal-services',
    sub: input.sub,
    act: input.act,
    tid: input.tid,
    roles: input.roles,
    jti: input.jti ?? crypto.randomUUID(),
    iat: input.iat ?? now,
    exp: input.exp ?? now + expiresIn,
    ...(input.nbf !== undefined ? { nbf: input.nbf } : {}),
  };

  // Validate claims structure against the shared architectural schema
  const parsed = InternalTokenClaimsSchema.safeParse(rawClaims);
  if (!parsed.success) {
    const issueMessage = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join(', ');
    throw new InternalTokenError(
      `Claims failed internal token schema validation: ${issueMessage}`,
      'SCHEMA_VALIDATION_FAILED',
      'SCHEMA_VALIDATION_ERROR',
    );
  }

  const headerB64 = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(parsed.data), 'utf8').toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(signingInput, 'utf8')
    .digest('base64url');

  return `${signingInput}.${signature}`;
}

/**
 * Cryptographically verifies and validates a symmetric HMAC-SHA256 internal token.
 */
export function verifyInternalToken(
  token: string,
  options: VerifyInternalTokenOptions,
): InternalTokenClaims {
  if (!token || typeof token !== 'string') {
    throw new InternalTokenError('Internal token must be a non-empty string', 'MISSING_TOKEN');
  }

  const secretKey = options.secret;
  if (!secretKey || (typeof secretKey === 'string' && secretKey.length === 0)) {
    throw new TypeError('Secret key must be a non-empty string or Buffer');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new InternalTokenError(
      'Token must consist of header, payload, and signature components',
      'MALFORMED_TOKEN',
    );
  }

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let header: InternalTokenHeader;
  try {
    const headerJson = Buffer.from(headerB64, 'base64url').toString('utf8');
    header = JSON.parse(headerJson) as InternalTokenHeader;
  } catch {
    throw new InternalTokenError('Malformed token header JSON', 'MALFORMED_TOKEN');
  }

  if (header.alg !== 'HS256') {
    throw new InternalTokenError(
      `Unsupported algorithm '${header.alg}', expected 'HS256'`,
      'UNSUPPORTED_ALGORITHM',
    );
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSignatureB64 = crypto
    .createHmac('sha256', secretKey)
    .update(signingInput, 'utf8')
    .digest('base64url');

  const sigBuffer = Buffer.from(signatureB64, 'utf8');
  const expectedSigBuffer = Buffer.from(expectedSignatureB64, 'utf8');

  if (
    sigBuffer.length !== expectedSigBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedSigBuffer)
  ) {
    throw new InternalTokenError(
      'Cryptographic signature verification failed',
      'INVALID_SIGNATURE',
    );
  }

  let rawPayload: unknown;
  try {
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    rawPayload = JSON.parse(payloadJson);
  } catch {
    throw new InternalTokenError('Malformed token payload JSON', 'MALFORMED_TOKEN');
  }

  const parseResult = InternalTokenClaimsSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    const issueMessage = parseResult.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join(', ');
    throw new InternalTokenError(
      `Token payload failed schema validation: ${issueMessage}`,
      'SCHEMA_VALIDATION_FAILED',
    );
  }

  const payload = parseResult.data;
  const now = Math.floor(Date.now() / 1000);
  const tolerance = options.clockToleranceSeconds ?? 0;

  if (payload.exp + tolerance <= now) {
    throw new InternalTokenError(
      `Internal token expired at ${new Date(payload.exp * 1000).toISOString()}`,
      'TOKEN_EXPIRED',
      'EXPIRED_INTERNAL_TOKEN',
    );
  }

  if (payload.nbf !== undefined && payload.nbf - tolerance > now) {
    throw new InternalTokenError('Internal token is not yet valid', 'TOKEN_NOT_YET_VALID');
  }

  if (options.expectedIssuer && payload.iss !== options.expectedIssuer) {
    throw new InternalTokenError(
      `Invalid token issuer '${payload.iss}', expected '${options.expectedIssuer}'`,
      'INVALID_ISSUER',
    );
  }

  if (options.expectedAudience && payload.aud !== options.expectedAudience) {
    throw new InternalTokenError(
      `Invalid token audience '${payload.aud}', expected '${options.expectedAudience}'`,
      'INVALID_AUDIENCE',
    );
  }

  return payload;
}

/**
 * Extracts the raw internal token string from the request headers.
 */
export function extractInternalToken(req: IncomingMessage): string | null {
  const headerVal = req.headers[INTERNAL_TOKEN_HEADER];
  if (!headerVal) {
    return null;
  }
  if (Array.isArray(headerVal)) {
    return headerVal[0]?.trim() || null;
  }
  return headerVal.trim() || null;
}

export interface InternalTokenMiddlewareOptions {
  readonly secret: string | Buffer;
  readonly expectedIssuer?: string;
  readonly expectedAudience?: string;
  readonly clockToleranceSeconds?: number;
}

/**
 * Creates an HTTP request handler middleware that enforces and validates the X-Internal-Token header.
 * Propagates tenant context into RequestContext (storeId) and attaches validated claims to the request.
 */
export function createInternalTokenMiddleware(
  options: InternalTokenMiddlewareOptions,
  nextHandler: (
    req: IncomingMessage & { internalToken?: InternalTokenClaims },
    res: ServerResponse,
    context: RequestContext & { storeId?: string },
  ) => void | Promise<void>,
): HttpRequestHandler {
  return async (req: IncomingMessage, res: ServerResponse, context: RequestContext) => {
    const rawToken = extractInternalToken(req);
    if (!rawToken) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.statusCode = 401;
      res.end(
        JSON.stringify({
          type: 'https://tools.ietf.org/html/rfc7807',
          title: 'Unauthorized',
          status: 401,
          detail: 'Missing mandatory X-Internal-Token header for internal service request',
          code: 'MISSING_INTERNAL_TOKEN',
        }),
      );
      return;
    }

    try {
      const claims = verifyInternalToken(rawToken, {
        secret: options.secret,
        expectedIssuer: options.expectedIssuer,
        expectedAudience: options.expectedAudience,
        clockToleranceSeconds: options.clockToleranceSeconds,
      });

      // Enrich request and context with tenant boundary root
      const enrichedReq = req as IncomingMessage & { internalToken?: InternalTokenClaims };
      enrichedReq.internalToken = claims;

      const enrichedContext: RequestContext & { storeId?: string } = {
        ...context,
        storeId: claims.tid,
      };

      await nextHandler(enrichedReq, res, enrichedContext);
    } catch (err) {
      if (err instanceof InternalTokenError) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.statusCode = err.statusCode;
        res.end(JSON.stringify(err.toJSON()));
        return;
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.statusCode = 401;
      res.end(
        JSON.stringify({
          type: 'https://tools.ietf.org/html/rfc7807',
          title: 'Unauthorized',
          status: 401,
          detail: 'Internal token verification failed',
          code: 'INVALID_INTERNAL_TOKEN',
        }),
      );
    }
  };
}
