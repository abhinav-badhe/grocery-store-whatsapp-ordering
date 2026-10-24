import pino, {
  type DestinationStream,
  type Logger,
  type LoggerOptions as PinoLoggerOptions,
} from 'pino';
import { getRequestContext } from './context.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

export type { Logger } from 'pino';

/**
 * Standard security redaction paths for structured logging.
 * Replaces matching keys with '[REDACTED]'.
 *
 * NOTE ON BOUNDARY LIMITATIONS:
 * 1. Path redaction protects structured keys in JSON payloads.
 *    It CANNOT detect or redact arbitrary secrets embedded in free-form strings.
 * 2. Downstream services must not log raw authentication tokens, complete HTTP request bodies,
 *    unvetted payloads, or full database query dumps.
 */
export const DEFAULT_REDACT_PATHS: readonly string[] = [
  // Passwords and password hashes (lowercase, UPPERCASE, camelCase, TitleCase)
  'password',
  '*.password',
  '*.*.password',
  '[*].password',
  'PASSWORD',
  '*.PASSWORD',
  '*.*.PASSWORD',
  '[*].PASSWORD',
  'Password',
  '*.Password',
  '*.*.Password',
  '[*].Password',
  'password_hash',
  '*.password_hash',
  '*.*.password_hash',
  '[*].password_hash',
  'PASSWORD_HASH',
  '*.PASSWORD_HASH',
  '*.*.PASSWORD_HASH',
  '[*].PASSWORD_HASH',
  'passwordHash',
  '*.passwordHash',
  '*.*.passwordHash',
  '[*].passwordHash',
  'PasswordHash',
  '*.PasswordHash',
  '*.*.PasswordHash',
  '[*].PasswordHash',
  'pass',
  '*.pass',
  'PASS',
  '*.PASS',

  // Authorization headers and authentication tokens
  'authorization',
  '*.authorization',
  '*.*.authorization',
  '[*].authorization',
  'AUTHORIZATION',
  '*.AUTHORIZATION',
  '*.*.AUTHORIZATION',
  '[*].AUTHORIZATION',
  'Authorization',
  '*.Authorization',
  '*.*.Authorization',
  '[*].Authorization',
  'headers.authorization',
  '*.headers.authorization',
  'req.headers.authorization',
  'headers.Authorization',
  '*.headers.Authorization',
  'req.headers.Authorization',
  'token',
  '*.token',
  '*.*.token',
  '[*].token',
  'TOKEN',
  '*.TOKEN',
  '*.*.TOKEN',
  '[*].TOKEN',
  'Token',
  '*.Token',
  '*.*.Token',
  '[*].Token',
  'access_token',
  '*.access_token',
  '*.*.access_token',
  '[*].access_token',
  'ACCESS_TOKEN',
  '*.ACCESS_TOKEN',
  '*.*.ACCESS_TOKEN',
  '[*].ACCESS_TOKEN',
  'accessToken',
  '*.accessToken',
  '*.*.accessToken',
  '[*].accessToken',
  'refresh_token',
  '*.refresh_token',
  '*.*.refresh_token',
  '[*].refresh_token',
  'REFRESH_TOKEN',
  '*.REFRESH_TOKEN',
  '*.*.REFRESH_TOKEN',
  '[*].REFRESH_TOKEN',
  'refreshToken',
  '*.refreshToken',
  '*.*.refreshToken',
  '[*].refreshToken',
  'session_token',
  '*.session_token',
  '*.*.session_token',
  '[*].session_token',
  'SESSION_TOKEN',
  '*.SESSION_TOKEN',
  'sessionToken',
  '*.sessionToken',
  'session_id',
  '*.session_id',
  '*.*.session_id',
  '[*].session_id',
  'SESSION_ID',
  '*.SESSION_ID',
  'sessionId',
  '*.sessionId',
  'SessionId',
  '*.SessionId',
  'internal_token',
  '*.internal_token',
  'INTERNAL_TOKEN',
  '*.INTERNAL_TOKEN',
  'internalToken',
  '*.internalToken',

  // API keys, client secrets, and private keys
  'api_key',
  '*.api_key',
  '*.*.api_key',
  '[*].api_key',
  'API_KEY',
  '*.API_KEY',
  '*.*.API_KEY',
  '[*].API_KEY',
  'apiKey',
  '*.apiKey',
  '*.*.apiKey',
  '[*].apiKey',
  'ApiKey',
  '*.ApiKey',
  '*.*.ApiKey',
  '[*].ApiKey',
  'client_secret',
  '*.client_secret',
  '*.*.client_secret',
  '[*].client_secret',
  'CLIENT_SECRET',
  '*.CLIENT_SECRET',
  '*.*.CLIENT_SECRET',
  '[*].CLIENT_SECRET',
  'clientSecret',
  '*.clientSecret',
  '*.*.clientSecret',
  '[*].clientSecret',
  'secret',
  '*.secret',
  '*.*.secret',
  '[*].secret',
  'SECRET',
  '*.SECRET',
  '*.*.SECRET',
  '[*].SECRET',
  'Secret',
  '*.Secret',
  '*.*.Secret',
  '[*].Secret',
  'private_key',
  '*.private_key',
  '*.*.private_key',
  '[*].private_key',
  'PRIVATE_KEY',
  '*.PRIVATE_KEY',
  '*.*.PRIVATE_KEY',
  '[*].PRIVATE_KEY',
  'privateKey',
  '*.privateKey',
  '*.*.privateKey',
  '[*].privateKey',

  // Cookies and session headers
  'cookie',
  '*.cookie',
  '*.*.cookie',
  '[*].cookie',
  'COOKIE',
  '*.COOKIE',
  '*.*.COOKIE',
  '[*].COOKIE',
  'Cookie',
  '*.Cookie',
  '*.*.Cookie',
  '[*].Cookie',
  'cookies',
  '*.cookies',
  'COOKIES',
  '*.COOKIES',
  'headers.cookie',
  '*.headers.cookie',
  'req.headers.cookie',
  'headers.Cookie',
  '*.headers.Cookie',
  'req.headers.Cookie',
  'set-cookie',
  '*.set-cookie',
  '*.*.set-cookie',
  '[*].set-cookie',
  'SET_COOKIE',
  '*.SET_COOKIE',
  'Set-Cookie',
  '*.Set-Cookie',
  'headers["set-cookie"]',
  '*.headers["set-cookie"]',
  'headers["Set-Cookie"]',
  '*.headers["Set-Cookie"]',
  'setCookie',
  '*.setCookie',
  'SetCookie',
  '*.SetCookie',

  // Database URLs and connection strings
  'database_url',
  '*.database_url',
  '*.*.database_url',
  '[*].database_url',
  'DATABASE_URL',
  '*.DATABASE_URL',
  '*.*.DATABASE_URL',
  '[*].DATABASE_URL',
  'databaseUrl',
  '*.databaseUrl',
  'DatabaseUrl',
  '*.DatabaseUrl',
  'db_url',
  '*.db_url',
  'DB_URL',
  '*.DB_URL',
  'dbUrl',
  '*.dbUrl',
  'connection_string',
  '*.connection_string',
  '*.*.connection_string',
  '[*].connection_string',
  'CONNECTION_STRING',
  '*.CONNECTION_STRING',
  '*.*.CONNECTION_STRING',
  '[*].CONNECTION_STRING',
  'connectionString',
  '*.connectionString',
  'ConnectionString',
  '*.ConnectionString',

  // Payment card numbers, CVV/CVC, and PINs
  'card_number',
  '*.card_number',
  '*.*.card_number',
  '[*].card_number',
  'CARD_NUMBER',
  '*.CARD_NUMBER',
  '*.*.CARD_NUMBER',
  '[*].CARD_NUMBER',
  'cardNumber',
  '*.cardNumber',
  '*.*.cardNumber',
  '[*].cardNumber',
  'credit_card',
  '*.credit_card',
  '*.*.credit_card',
  '[*].credit_card',
  'CREDIT_CARD',
  '*.CREDIT_CARD',
  '*.*.CREDIT_CARD',
  '[*].CREDIT_CARD',
  'creditCard',
  '*.creditCard',
  '*.*.creditCard',
  '[*].creditCard',
  'pan',
  '*.pan',
  'PAN',
  '*.PAN',
  'cvv',
  '*.cvv',
  '*.*.cvv',
  '[*].cvv',
  'CVV',
  '*.CVV',
  '*.*.CVV',
  '[*].CVV',
  'cvc',
  '*.cvc',
  '*.*.cvc',
  '[*].cvc',
  'CVC',
  '*.CVC',
  '*.*.CVC',
  '[*].CVC',
  'pin',
  '*.pin',
  '*.*.pin',
  '[*].pin',
  'PIN',
  '*.PIN',
  '*.*.PIN',
  '[*].PIN',
];

/**
 * Sanitizes an error message or string representation by stripping URI credentials,
 * Bearer tokens, query parameters, and key assignments.
 */
export function sanitizeErrorMessage(text: string): string {
  if (!text) {
    return text;
  }
  return (
    text
      // Redact URI user:password credentials (e.g. postgres://user:pass@host)
      .replace(/:\/\/([^:\s]+):([^@\s]+)@/g, '://[REDACTED]:[REDACTED]@')
      // Redact Bearer tokens
      .replace(/(?:Bearer|bearer)\s+(?:Bearer\s+)?[a-zA-Z0-9_\-.]+/gi, 'Bearer [REDACTED]')
      // Redact query parameters containing sensitive tokens (e.g. ?api_key=... or &token=...)
      .replace(
        /([?&](?:api_key|apiKey|token|secret|password|client_secret|access_token|key)=)[^&\s]+/gi,
        '$1[REDACTED]',
      )
      // Redact key/token assignments in messages
      .replace(
        /\b(password|secret|token|api[_-]?key|private[_-]?key)\s*[:=]\s*["']?([a-zA-Z0-9_\-.]{8,})["']?/gi,
        '$1: "[REDACTED]"',
      )
      // Redact cookie assignments in messages
      .replace(
        /\b(?:Cookie|cookie|Set-Cookie|set-cookie)\s*[:=]\s*["']?[^"'\r\n]+["']?/gi,
        'cookie: "[REDACTED]"',
      )
  );
}

/**
 * Sanitizes error type/class names to prevent log injection or custom name leaking.
 */
function sanitizeErrorType(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9_$.]/g, '');
  return safe.length > 0 && safe.length <= 100 ? safe : 'Error';
}

/**
 * Validates and bounds error codes to safe alphanumeric identifiers.
 */
function sanitizeErrorCode(code: string | number): string | number | undefined {
  if (typeof code === 'number') {
    return Number.isFinite(code) ? code : undefined;
  }
  if (typeof code === 'string') {
    const trimmed = code.trim();
    if (trimmed.length > 0 && trimmed.length <= 64 && /^[a-zA-Z0-9_\-.]+$/.test(trimmed)) {
      return trimmed;
    }
  }
  return undefined;
}

export interface SafeErrorRecord {
  type: string;
  code?: string | number;
  message?: string;
  stack?: string;
  cause?: SafeErrorRecord;
  errors?: SafeErrorRecord[];
}

export interface ErrorSerializerOptions {
  /**
   * Whether to include sanitized error messages in the serialized output.
   * Default: false (fail-closed allowlist policy: omits raw error messages to guarantee
   * zero credential leaks).
   */
  readonly includeSanitizedMessage?: boolean;

  /**
   * Whether to include sanitized stack traces in the serialized output.
   * Default: false.
   */
  readonly includeSanitizedStack?: boolean;
}

/**
 * Creates a safe error serializer for Pino.
 *
 * FAIL-CLOSED SECURITY INVARIANT:
 * By default, this serializer emits only allowlisted structural metadata (error type and
 * validated error code). Raw error messages, stack traces, and custom error properties
 * are omitted by default to ensure credentials cannot leak into logs.
 */
export function createSafeErrorSerializer(
  options: ErrorSerializerOptions = {},
): (err: unknown) => SafeErrorRecord {
  return function safeErrorSerializer(err: unknown): SafeErrorRecord {
    if (err instanceof Error) {
      const code =
        'code' in err && (typeof err.code === 'string' || typeof err.code === 'number')
          ? sanitizeErrorCode(err.code)
          : undefined;

      const record: SafeErrorRecord = {
        type: sanitizeErrorType(err.name || 'Error'),
        ...(code !== undefined ? { code } : {}),
      };

      if (options.includeSanitizedMessage && err.message) {
        record.message = sanitizeErrorMessage(err.message);
      }

      if (options.includeSanitizedStack && err.stack) {
        record.stack = sanitizeErrorMessage(err.stack);
      }

      if (err.cause) {
        record.cause = safeErrorSerializer(err.cause);
      }

      if ('errors' in err && Array.isArray((err as AggregateError).errors)) {
        record.errors = (err as AggregateError).errors.map((e) => safeErrorSerializer(e));
      }

      return record;
    }

    if (typeof err === 'string') {
      return {
        type: 'StringError',
        ...(options.includeSanitizedMessage ? { message: sanitizeErrorMessage(err) } : {}),
      };
    }

    return {
      type: 'UnknownError',
    };
  };
}

/**
 * Default safe error serializer instance (allowlist-only, omitting raw messages/stacks).
 */
export const defaultSafeErrorSerializer = createSafeErrorSerializer({
  includeSanitizedMessage: false,
  includeSanitizedStack: false,
});

/**
 * Backwards-compatible safeErrorSerializer export matching default safe behavior.
 */
export const safeErrorSerializer = defaultSafeErrorSerializer;

/**
 * Public helper for callers wanting to extract safe structural error summary metadata
 * (error type and error code) without exposing any raw error message.
 */
export function formatSafeError(err: unknown): { type: string; code?: string | number } {
  if (err instanceof Error) {
    const code =
      'code' in err && (typeof err.code === 'string' || typeof err.code === 'number')
        ? sanitizeErrorCode(err.code)
        : undefined;
    return {
      type: sanitizeErrorType(err.name || 'Error'),
      ...(code !== undefined ? { code } : {}),
    };
  }
  return { type: 'UnknownError' };
}

export interface LoggerOptions {
  /**
   * Log level threshold. Defaults to 'info'.
   */
  readonly level?: LogLevel;

  /**
   * Component or service name attached to all logs.
   */
  readonly name?: string;

  /**
   * Additional redaction paths to append to DEFAULT_REDACT_PATHS.
   */
  readonly additionalRedactPaths?: readonly string[];

  /**
   * Error serializer options.
   */
  readonly errorSerializerOptions?: ErrorSerializerOptions;

  /**
   * Base attributes to attach to all log records.
   */
  readonly base?: Record<string, unknown>;
}

/**
 * Creates a configured Pino logger instance with structured JSON output,
 * automated correlation ID context propagation, and secret redaction.
 *
 * IMPORT-TIME SIDE EFFECT INVARIANT:
 * Calling or importing this module does NOT emit any logs or evaluate process.env.
 * Loggers are created explicitly by the application bootstrap.
 *
 * @param options Logger configuration options
 * @param destination Optional custom destination stream (useful for unit testing)
 */
export function createLogger(options: LoggerOptions = {}, destination?: DestinationStream): Logger {
  const redactPaths = options.additionalRedactPaths
    ? [...DEFAULT_REDACT_PATHS, ...options.additionalRedactPaths]
    : [...DEFAULT_REDACT_PATHS];

  const errSerializer = options.errorSerializerOptions
    ? createSafeErrorSerializer(options.errorSerializerOptions)
    : defaultSafeErrorSerializer;

  const pinoOptions: PinoLoggerOptions = {
    level: options.level ?? 'info',
    name: options.name,
    base: options.base ?? (options.name ? { name: options.name } : {}),
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: redactPaths,
      censor: '[REDACTED]',
    },
    serializers: {
      err: errSerializer,
    },
    mixin: () => {
      const ctx = getRequestContext();
      if (!ctx) {
        return {};
      }
      const record: Record<string, string> = {};
      if (ctx.requestId) {
        record.request_id = ctx.requestId;
      }
      if (ctx.correlationId) {
        record.correlation_id = ctx.correlationId;
      }
      if (ctx.storeId) {
        record.store_id = ctx.storeId;
      }
      return record;
    },
  };

  return destination ? pino(pinoOptions, destination) : pino(pinoOptions);
}
