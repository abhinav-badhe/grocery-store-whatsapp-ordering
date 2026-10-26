import crypto from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database, UserRow } from '@grocery/database';
import {
  RegisterInputSchema,
  LoginInputSchema,
  UserResponseSchema,
  type UserResponse,
} from '@grocery/api-contracts';
import {
  createUserRepository,
  createCredentialRepository,
  createRefreshTokenRepository,
  createUserWithCredential,
  DuplicateEmailError,
  DuplicatePhoneError,
  generateRefreshToken,
  hashRefreshToken,
  type UserRepository,
  type CredentialRepository,
  type RefreshTokenRepository,
} from '../persistence/index.js';
import {
  createPasswordHasher,
  signAccessToken,
  verifyAccessToken,
  TokenVerificationError,
  type PasswordHasher,
} from '../crypto/index.js';
import type {
  AuthService,
  AuthServiceDependencies,
  AuthSession,
  AuthSessionKeyPair,
  RegisterResult,
  LoginResult,
  RefreshResult,
  LogoutResult,
  CurrentUserResult,
} from './types.js';
import {
  ValidationError,
  InvalidCredentialsError,
  AccountSuspendedError,
  AccountInactiveError,
  RegistrationConflictError,
  TooManyRequestsError,
  UnauthorizedError,
  InvalidTokenError,
} from './errors.js';
import type { RateLimiter } from './rate-limiter.js';

// Pre-computed valid Argon2id hash for constant-time rejection to prevent timing side-channels
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$/DqgkRpOrSFw2c8YFSaNIg$m7dB9N3U8YCHqcXeC0XetrEUGvSy4Pac97Y4i/fOaRE';

function mapUserRowToResponse(row: UserRow): UserResponse {
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString();
  const updatedAt =
    row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : new Date(row.updated_at).toISOString();

  return UserResponseSchema.parse({
    id: row.id,
    email: row.email,
    phone: row.phone,
    fullName: row.full_name,
    status: row.status,
    createdAt,
    updatedAt,
  });
}

export class DefaultAuthService implements AuthService {
  private readonly db: Kysely<Database>;
  private readonly userRepo: UserRepository;
  private readonly credentialRepo: CredentialRepository;
  private readonly refreshTokenRepo?: RefreshTokenRepository;
  private readonly hasher: PasswordHasher;
  private readonly rateLimiter?: RateLimiter;
  private readonly keyPair?: AuthSessionKeyPair;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly accessTokenExpiresInSeconds: number;

  constructor(deps: AuthServiceDependencies) {
    this.db = deps.db;
    this.userRepo = deps.userRepo ?? createUserRepository(deps.db);
    this.credentialRepo = deps.credentialRepo ?? createCredentialRepository(deps.db);
    this.refreshTokenRepo =
      deps.refreshTokenRepo ?? (deps.db ? createRefreshTokenRepository(deps.db) : undefined);
    this.hasher = deps.hasher ?? createPasswordHasher();
    this.rateLimiter = deps.rateLimiter;
    this.keyPair = deps.keyPair;
    this.issuer = deps.issuer ?? 'grocery-identity-service';
    this.audience = deps.audience ?? 'grocery-api-gateway';
    this.accessTokenExpiresInSeconds = deps.accessTokenExpiresInSeconds ?? 900;
  }

  private async issueSession(
    userId: string,
    claims: { email?: string | null; phone?: string | null; fullName: string },
  ): Promise<AuthSession | undefined> {
    if (!this.keyPair || !this.refreshTokenRepo) {
      return undefined;
    }

    const { rawToken, tokenHash } = generateRefreshToken();
    const familyId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000); // 7 days idle per ADR-003
    const familyExpiresAt = new Date(now + 30 * 24 * 60 * 60 * 1000); // 30 days absolute per ADR-003

    const record = await this.refreshTokenRepo.create({
      user_id: userId,
      token_hash: tokenHash,
      family_id: familyId,
      expires_at: expiresAt,
      family_expires_at: familyExpiresAt,
      status: 'ACTIVE',
    });

    const accessToken = signAccessToken(
      {
        sub: userId,
        email: claims.email,
        phone: claims.phone,
        fullName: claims.fullName,
      },
      {
        privateKey: this.keyPair.privateKey,
        kid: this.keyPair.kid,
        issuer: this.issuer,
        audience: this.audience,
        expiresInSeconds: this.accessTokenExpiresInSeconds,
      },
    );

    const sessionExpiresAt =
      record.expires_at instanceof Date ? record.expires_at : new Date(record.expires_at);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTokenExpiresInSeconds,
      rawRefreshToken: rawToken,
      familyId: record.family_id,
      expiresAt: sessionExpiresAt,
    };
  }

  async register(rawInput: unknown): Promise<RegisterResult> {
    const parseResult = RegisterInputSchema.safeParse(rawInput);
    if (!parseResult.success) {
      const invalidParams = parseResult.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      throw new ValidationError('Validation failed for user registration payload', invalidParams);
    }

    const input = parseResult.data;
    const passwordHash = await this.hasher.hash(input.password);

    try {
      const result = await createUserWithCredential(
        this.db,
        {
          user: {
            full_name: input.fullName.trim(),
            email: input.email ?? null,
            phone: input.phone ?? null,
            status: 'ACTIVE',
          },
          credential: {
            passwordHash,
            algorithm: 'argon2id',
          },
        },
        {
          userRepo: this.userRepo,
          credentialRepo: this.credentialRepo,
        },
      );

      const session = await this.issueSession(result.user.id, {
        email: result.user.email,
        phone: result.user.phone,
        fullName: result.user.full_name,
      });

      return {
        user: mapUserRowToResponse(result.user),
        ...(session ? { session } : {}),
      };
    } catch (err) {
      if (err instanceof DuplicateEmailError) {
        throw new RegistrationConflictError(
          'A user with this email address already exists',
          'DUPLICATE_EMAIL',
        );
      }
      if (err instanceof DuplicatePhoneError) {
        throw new RegistrationConflictError(
          'A user with this phone number already exists',
          'DUPLICATE_PHONE',
        );
      }
      throw err;
    }
  }

  async login(rawInput: unknown, clientIp?: string): Promise<LoginResult> {
    const parseResult = LoginInputSchema.safeParse(rawInput);
    if (!parseResult.success) {
      const invalidParams = parseResult.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      throw new ValidationError('Validation failed for user login payload', invalidParams);
    }

    const input = parseResult.data;
    const identifier = input.identifier.trim();
    const rateLimitKey = clientIp
      ? `${clientIp}:${identifier.toLowerCase()}`
      : identifier.toLowerCase();

    if (this.rateLimiter) {
      const isLimited = await this.rateLimiter.isRateLimited(rateLimitKey);
      if (isLimited) {
        throw new TooManyRequestsError();
      }
    }

    // Determine identifier type: email contains '@' vs phone
    const isEmail = identifier.includes('@');
    const user = isEmail
      ? await this.userRepo.findByEmail(identifier.toLowerCase())
      : await this.userRepo.findByPhone(identifier);

    if (!user) {
      // Execute dummy verification to preserve uniform execution timing and prevent user enumeration
      await this.hasher.verify(input.password, DUMMY_ARGON2_HASH).catch(() => false);
      if (this.rateLimiter) {
        await this.rateLimiter.recordFailure(rateLimitKey);
      }
      throw new InvalidCredentialsError();
    }

    // Account status checks: suspended or inactive attempts fail authentication and increment abuse tracking
    if (user.status === 'SUSPENDED') {
      if (this.rateLimiter) {
        await this.rateLimiter.recordFailure(rateLimitKey);
      }
      throw new AccountSuspendedError();
    }
    if (user.status !== 'ACTIVE') {
      if (this.rateLimiter) {
        await this.rateLimiter.recordFailure(rateLimitKey);
      }
      throw new AccountInactiveError();
    }

    const credential = await this.credentialRepo.findByUserId(user.id);
    if (!credential || !credential.password_hash) {
      await this.hasher.verify(input.password, DUMMY_ARGON2_HASH).catch(() => false);
      if (this.rateLimiter) {
        await this.rateLimiter.recordFailure(rateLimitKey);
      }
      throw new InvalidCredentialsError();
    }

    const isPasswordValid = await this.hasher.verify(input.password, credential.password_hash);
    if (!isPasswordValid) {
      if (this.rateLimiter) {
        await this.rateLimiter.recordFailure(rateLimitKey);
      }
      throw new InvalidCredentialsError();
    }

    // Authentication succeeded: reset failure count
    if (this.rateLimiter) {
      await this.rateLimiter.reset(rateLimitKey);
    }

    const session = await this.issueSession(user.id, {
      email: user.email,
      phone: user.phone,
      fullName: user.full_name,
    });

    return {
      user: mapUserRowToResponse(user),
      ...(session ? { session } : {}),
    };
  }

  async refresh(rawRefreshToken: string): Promise<RefreshResult> {
    if (!this.keyPair || !this.refreshTokenRepo) {
      throw new UnauthorizedError('Session subsystem not configured');
    }

    if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
      throw new InvalidTokenError('Refresh token must be provided');
    }

    let oldTokenHash: string;
    try {
      oldTokenHash = hashRefreshToken(rawRefreshToken);
    } catch {
      throw new InvalidTokenError('Malformed refresh token');
    }

    const { rawToken: newRawToken, tokenHash: newTokenHash } = generateRefreshToken();
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days idle per ADR-003

    const rotateResult = await this.refreshTokenRepo.rotate({
      oldTokenHash,
      newTokenHash,
      newExpiresAt,
    });

    if (!rotateResult.success) {
      if (rotateResult.reason === 'REUSE_DETECTED') {
        throw new InvalidTokenError(
          'Refresh token reuse detected. Session family has been terminated.',
          'TOKEN_REUSE_DETECTED',
        );
      }
      if (rotateResult.reason === 'TOKEN_EXPIRED') {
        throw new InvalidTokenError('Refresh token has expired', 'TOKEN_EXPIRED');
      }
      if (rotateResult.reason === 'TOKEN_REVOKED') {
        throw new InvalidTokenError('Refresh token has been revoked', 'TOKEN_REVOKED');
      }
      throw new InvalidTokenError('Invalid refresh token', 'TOKEN_NOT_FOUND');
    }

    const userId = rotateResult.newToken.user_id;
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new UnauthorizedError('User account not found');
    }
    if (user.status === 'SUSPENDED') {
      throw new AccountSuspendedError();
    }
    if (user.status !== 'ACTIVE') {
      throw new AccountInactiveError();
    }

    const accessToken = signAccessToken(
      {
        sub: user.id,
        email: user.email,
        phone: user.phone,
        fullName: user.full_name,
      },
      {
        privateKey: this.keyPair.privateKey,
        kid: this.keyPair.kid,
        issuer: this.issuer,
        audience: this.audience,
        expiresInSeconds: this.accessTokenExpiresInSeconds,
      },
    );

    const expiresAt =
      rotateResult.newToken.expires_at instanceof Date
        ? rotateResult.newToken.expires_at
        : new Date(rotateResult.newToken.expires_at);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTokenExpiresInSeconds,
      rawRefreshToken: newRawToken,
      familyId: rotateResult.newToken.family_id,
      expiresAt,
    };
  }

  async logout(rawRefreshToken: string): Promise<LogoutResult> {
    if (!this.refreshTokenRepo) {
      return { success: true };
    }

    if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
      return { success: true };
    }

    try {
      const tokenHash = hashRefreshToken(rawRefreshToken);
      const token = await this.refreshTokenRepo.findByTokenHash(tokenHash);
      if (token) {
        await this.refreshTokenRepo.revokeFamily(token.family_id, 'LOGOUT');
      }
    } catch {
      // Invariant: Logout must always succeed / be idempotent
    }

    return { success: true };
  }

  async getCurrentUser(accessToken: string): Promise<CurrentUserResult> {
    if (!this.keyPair) {
      throw new UnauthorizedError('Session subsystem not configured');
    }

    if (!accessToken || typeof accessToken !== 'string') {
      throw new UnauthorizedError('Missing or invalid Authorization header');
    }

    let payload;
    try {
      payload = verifyAccessToken(accessToken, {
        publicKey: this.keyPair.publicKey,
        expectedIssuer: this.issuer,
        expectedAudience: this.audience,
      });
    } catch (err) {
      if (err instanceof TokenVerificationError) {
        throw new InvalidTokenError(err.message, err.reason);
      }
      throw new InvalidTokenError('Invalid access token');
    }

    const user = await this.userRepo.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedError('User account not found');
    }
    if (user.status === 'SUSPENDED') {
      throw new AccountSuspendedError();
    }
    if (user.status !== 'ACTIVE') {
      throw new AccountInactiveError();
    }

    return {
      user: mapUserRowToResponse(user),
    };
  }
}

export function createAuthService(deps: AuthServiceDependencies): AuthService {
  return new DefaultAuthService(deps);
}
