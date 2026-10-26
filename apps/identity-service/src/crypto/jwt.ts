import crypto from 'node:crypto';

export interface AccessTokenHeader {
  readonly alg: 'EdDSA';
  readonly typ: 'JWT';
  readonly kid?: string;
}

export interface AccessTokenPayload {
  readonly sub: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly fullName: string;
  readonly iss: string;
  readonly aud: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
  readonly [key: string]: unknown;
}

export interface SignAccessTokenOptions {
  readonly privateKey: crypto.KeyObject | string;
  readonly kid?: string;
  readonly issuer?: string;
  readonly audience?: string;
  readonly expiresInSeconds?: number;
}

export interface VerifyAccessTokenOptions {
  readonly publicKey: crypto.KeyObject | string;
  readonly expectedIssuer?: string;
  readonly expectedAudience?: string;
  readonly clockToleranceSeconds?: number;
}

export class TokenVerificationError extends Error {
  constructor(
    message: string,
    public readonly reason:
      | 'MALFORMED_TOKEN'
      | 'UNSUPPORTED_ALGORITHM'
      | 'INVALID_SIGNATURE'
      | 'TOKEN_EXPIRED'
      | 'INVALID_ISSUER'
      | 'INVALID_AUDIENCE',
  ) {
    super(message);
    this.name = 'TokenVerificationError';
  }
}

/**
 * Generates an Ed25519 key pair for asymmetric JWT access token signing.
 */
export function generateEd25519KeyPair(): {
  readonly publicKeyPem: string;
  readonly privateKeyPem: string;
  readonly publicKey: crypto.KeyObject;
  readonly privateKey: crypto.KeyObject;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return { publicKeyPem, privateKeyPem, publicKey, privateKey };
}

export interface SignAccessTokenClaims {
  readonly sub: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly fullName: string;
  readonly iss?: string;
  readonly aud?: string;
  readonly iat?: number;
  readonly exp?: number;
  readonly jti?: string;
  readonly [key: string]: unknown;
}

/**
 * Signs a short-lived public access token using Ed25519 (EdDSA RFC 8037).
 * Modeled strictly after ADR-003 §5.1.
 */
export function signAccessToken(
  claims: SignAccessTokenClaims,
  options: SignAccessTokenOptions,
): string {
  const now = Math.floor(Date.now() / 1000);
  const expiresInSeconds = options.expiresInSeconds ?? 900; // 15 minutes per ADR-003

  const header: AccessTokenHeader = {
    alg: 'EdDSA',
    typ: 'JWT',
    ...(options.kid ? { kid: options.kid } : {}),
  };

  const payload: AccessTokenPayload = {
    iss: options.issuer ?? 'grocery-identity-service',
    aud: options.audience ?? 'grocery-api-gateway',
    iat: claims.iat ?? now,
    exp: claims.exp ?? now + expiresInSeconds,
    jti: claims.jti ?? crypto.randomUUID(),
    sub: claims.sub,
    email: claims.email ?? null,
    phone: claims.phone ?? null,
    fullName: claims.fullName,
  };

  const headerB64 = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;

  const privateKeyObject =
    typeof options.privateKey === 'string'
      ? crypto.createPrivateKey(options.privateKey)
      : options.privateKey;

  const signature = crypto.sign(null, Buffer.from(signingInput, 'utf8'), privateKeyObject);
  const signatureB64 = signature.toString('base64url');

  return `${signingInput}.${signatureB64}`;
}

/**
 * Cryptographically verifies an Ed25519 (EdDSA) JWT access token.
 */
export function verifyAccessToken(
  token: string,
  options: VerifyAccessTokenOptions,
): AccessTokenPayload {
  if (typeof token !== 'string') {
    throw new TokenVerificationError('Token must be a string', 'MALFORMED_TOKEN');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new TokenVerificationError(
      'Token must consist of header, payload, and signature components',
      'MALFORMED_TOKEN',
    );
  }

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let header: AccessTokenHeader;
  let payload: AccessTokenPayload;

  try {
    const headerJson = Buffer.from(headerB64, 'base64url').toString('utf8');
    header = JSON.parse(headerJson) as AccessTokenHeader;
  } catch {
    throw new TokenVerificationError('Malformed token header JSON', 'MALFORMED_TOKEN');
  }

  if (header.alg !== 'EdDSA') {
    throw new TokenVerificationError(
      `Unsupported algorithm '${header.alg}', expected 'EdDSA'`,
      'UNSUPPORTED_ALGORITHM',
    );
  }

  try {
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    payload = JSON.parse(payloadJson) as AccessTokenPayload;
  } catch {
    throw new TokenVerificationError('Malformed token payload JSON', 'MALFORMED_TOKEN');
  }

  const publicKeyObject =
    typeof options.publicKey === 'string'
      ? crypto.createPublicKey(options.publicKey)
      : options.publicKey;

  const signingInput = `${headerB64}.${payloadB64}`;
  const signatureBuffer = Buffer.from(signatureB64, 'base64url');

  const isValid = crypto.verify(
    null,
    Buffer.from(signingInput, 'utf8'),
    publicKeyObject,
    signatureBuffer,
  );

  if (!isValid) {
    throw new TokenVerificationError(
      'Cryptographic signature verification failed',
      'INVALID_SIGNATURE',
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const tolerance = options.clockToleranceSeconds ?? 0;

  if (payload.exp + tolerance <= now) {
    throw new TokenVerificationError('Access token has expired', 'TOKEN_EXPIRED');
  }

  if (options.expectedIssuer && payload.iss !== options.expectedIssuer) {
    throw new TokenVerificationError(
      `Invalid token issuer '${payload.iss}', expected '${options.expectedIssuer}'`,
      'INVALID_ISSUER',
    );
  }

  if (options.expectedAudience && payload.aud !== options.expectedAudience) {
    throw new TokenVerificationError(
      `Invalid token audience '${payload.aud}', expected '${options.expectedAudience}'`,
      'INVALID_AUDIENCE',
    );
  }

  return payload;
}
