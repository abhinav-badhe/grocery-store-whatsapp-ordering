import { randomUUID } from 'node:crypto';
import { runWithContext, type RequestContext } from './context.js';

/**
 * Regex defining valid, safe correlation and request identifiers.
 * Permits RFC 4122 UUIDs, nanoids, alphanumeric tokens, hyphens, and underscores.
 * Bounded to 1-128 characters.
 */
export const VALID_IDENTIFIER_REGEX = /^[a-zA-Z0-9_\-.]{1,128}$/;

/**
 * Normalizes and validates an externally supplied identifier.
 * If the value is undefined, not a string, exceeds 128 characters, or contains illegal characters,
 * it is discarded and replaced with a newly generated RFC 4122 UUIDv4.
 */
export function sanitizeOrGenerateId(suppliedId?: unknown): string {
  if (typeof suppliedId === 'string') {
    const trimmed = suppliedId.trim();
    if (trimmed.length > 0 && trimmed.length <= 128 && VALID_IDENTIFIER_REGEX.test(trimmed)) {
      return trimmed;
    }
  }
  return randomUUID();
}

/**
 * Extracts a header value case-insensitively from a headers dictionary.
 */
function getHeader(
  headers: Record<string, string | string[] | undefined>,
  headerName: string,
): string | undefined {
  const target = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      if (Array.isArray(value)) {
        return value[0];
      }
      return value;
    }
  }
  return undefined;
}

export interface ContextOptions {
  /**
   * Trusted request ID supplied directly by the service (overrides external headers).
   */
  readonly trustedRequestId?: string;

  /**
   * Trusted correlation ID supplied directly by the service (overrides external headers).
   */
  readonly trustedCorrelationId?: string;

  /**
   * Store identifier (tenant ID) if validated by an upstream authentication middleware.
   *
   * CRITICAL SECURITY INVARIANT:
   * `storeId` is for diagnostic logging enrichment ONLY.
   * It must NEVER be accepted from external HTTP headers, and must NEVER be treated as
   * tenant authentication, authorization, or database query scoping proof.
   */
  readonly storeId?: string;
}

/**
 * Extracts, validates, and initializes request context from incoming HTTP headers or trusted options.
 * Framework-neutral: works with Node's http.IncomingMessage, Express, Fastify, Fetch Request headers, etc.
 *
 * Header Security Policy:
 * 1. Checks 'x-request-id' and 'x-correlation-id' case-insensitively.
 * 2. External headers must strictly conform to /^[a-zA-Z0-9_\\-.]{1,128}$/.
 * 3. Any header with control characters, whitespace, newlines, or exceeding 128 chars is discarded
 *    and replaced with a cryptographically generated UUIDv4.
 * 4. Request ID and Correlation ID are validated and handled independently.
 * 5. Trusted IDs passed in ContextOptions take absolute precedence over external untrusted headers.
 * 6. Untrusted tenant headers (e.g. x-store-id, store_id, x-tenant-id) are strictly ignored.
 *    `storeId` is populated ONLY from validated ContextOptions.storeId.
 */
export function extractRequestContext(
  headers: Record<string, string | string[] | undefined> = {},
  options: ContextOptions = {},
): RequestContext {
  const rawRequestId = options.trustedRequestId ?? getHeader(headers, 'x-request-id');
  const rawCorrelationId =
    options.trustedCorrelationId ?? getHeader(headers, 'x-correlation-id') ?? rawRequestId;

  const requestId = sanitizeOrGenerateId(rawRequestId);
  const correlationId = sanitizeOrGenerateId(rawCorrelationId);

  let validatedStoreId: string | undefined;
  if (options.storeId && typeof options.storeId === 'string') {
    const trimmed = options.storeId.trim();
    if (trimmed.length > 0 && trimmed.length <= 128 && VALID_IDENTIFIER_REGEX.test(trimmed)) {
      validatedStoreId = trimmed;
    }
  }

  return {
    requestId,
    correlationId,
    ...(validatedStoreId ? { storeId: validatedStoreId } : {}),
  };
}

/**
 * Framework-neutral request execution wrapper.
 * Initializes context and executes the downstream handler within that context.
 *
 * NOTE: This is an execution helper for binding request context. It does NOT perform
 * complete HTTP request logging, authentication, or framework lifecycle management.
 */
export function withRequestContext<T>(
  headers: Record<string, string | string[] | undefined>,
  callback: () => T,
  options?: ContextOptions,
): T {
  const context = extractRequestContext(headers, options);
  return runWithContext(context, callback);
}
