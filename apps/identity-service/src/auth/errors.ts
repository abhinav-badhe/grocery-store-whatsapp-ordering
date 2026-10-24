import { sanitizeErrorMessage } from '@grocery/observability';

export interface InvalidParamDetail {
  readonly path: string;
  readonly message: string;
}

/**
 * Base domain error for authentication operations.
 * Produces RFC 7807 Problem Details compliant serialization.
 */
export abstract class AuthError extends Error {
  public abstract readonly statusCode: number;
  public abstract readonly title: string;
  public readonly code: string;
  public readonly detail: string;
  public readonly invalidParams?: readonly InvalidParamDetail[];

  constructor(detail: string, code: string, invalidParams?: readonly InvalidParamDetail[]) {
    const sanitized = sanitizeErrorMessage(detail);
    super(sanitized);
    this.name = this.constructor.name;
    this.detail = sanitized;
    this.code = code;
    this.invalidParams = invalidParams;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      type: 'https://tools.ietf.org/html/rfc7807',
      title: this.title,
      status: this.statusCode,
      detail: this.detail,
      code: this.code,
      ...(this.invalidParams && this.invalidParams.length > 0
        ? { invalidParams: this.invalidParams }
        : {}),
    };
  }
}

/**
 * Thrown when request payload fails schema validation constraints.
 */
export class ValidationError extends AuthError {
  public readonly statusCode = 400;
  public readonly title = 'Bad Request';

  constructor(
    detail = 'Validation failed for request payload',
    invalidParams?: readonly InvalidParamDetail[],
  ) {
    super(detail, 'VALIDATION_ERROR', invalidParams);
  }
}

/**
 * Thrown on unknown login identifier or incorrect password.
 * Returns identical message to prevent user enumeration attacks.
 */
export class InvalidCredentialsError extends AuthError {
  public readonly statusCode = 401;
  public readonly title = 'Unauthorized';

  constructor(detail = 'Invalid login identifier or password') {
    super(detail, 'INVALID_CREDENTIALS');
  }
}

/**
 * Thrown when an account has been suspended by an administrator.
 */
export class AccountSuspendedError extends AuthError {
  public readonly statusCode = 403;
  public readonly title = 'Forbidden';

  constructor(detail = 'Account has been suspended. Please contact customer support.') {
    super(detail, 'ACCOUNT_SUSPENDED');
  }
}

/**
 * Thrown when an account is not in ACTIVE status (e.g. PENDING_VERIFICATION).
 */
export class AccountInactiveError extends AuthError {
  public readonly statusCode = 403;
  public readonly title = 'Forbidden';

  constructor(detail = 'Account is not active and cannot be authenticated.') {
    super(detail, 'ACCOUNT_INACTIVE');
  }
}

/**
 * Thrown when user registration collides with an existing email or phone number.
 */
export class RegistrationConflictError extends AuthError {
  public readonly statusCode = 409;
  public readonly title = 'Conflict';

  constructor(detail: string, code = 'REGISTRATION_CONFLICT') {
    super(detail, code);
  }
}

/**
 * Thrown when failed login attempts exceed the configured threshold.
 */
export class TooManyRequestsError extends AuthError {
  public readonly statusCode = 429;
  public readonly title = 'Too Many Requests';

  constructor(detail = 'Too many failed login attempts. Please try again later.') {
    super(detail, 'RATE_LIMITED');
  }
}

/**
 * Thrown when request body exceeds maximum allowed size (64 KiB).
 */
export class PayloadTooLargeError extends AuthError {
  public readonly statusCode = 413;
  public readonly title = 'Payload Too Large';

  constructor(detail = 'Request body exceeds maximum allowed size of 65536 bytes') {
    super(detail, 'PAYLOAD_TOO_LARGE');
  }
}

/**
 * Thrown when request Content-Type is not application/json.
 */
export class UnsupportedMediaTypeError extends AuthError {
  public readonly statusCode = 415;
  public readonly title = 'Unsupported Media Type';

  constructor(detail = 'Content-Type must be application/json') {
    super(detail, 'UNSUPPORTED_MEDIA_TYPE');
  }
}
