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
  createUserWithCredential,
  DuplicateEmailError,
  DuplicatePhoneError,
  type UserRepository,
  type CredentialRepository,
  type RefreshTokenRepository,
} from '../persistence/index.js';
import { createPasswordHasher, type PasswordHasher } from '../crypto/index.js';
import type { AuthService, AuthServiceDependencies, RegisterResult, LoginResult } from './types.js';
import {
  ValidationError,
  InvalidCredentialsError,
  AccountSuspendedError,
  AccountInactiveError,
  RegistrationConflictError,
  TooManyRequestsError,
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

  constructor(deps: AuthServiceDependencies) {
    this.db = deps.db;
    this.userRepo = deps.userRepo ?? createUserRepository(deps.db);
    this.credentialRepo = deps.credentialRepo ?? createCredentialRepository(deps.db);
    this.refreshTokenRepo = deps.refreshTokenRepo;
    this.hasher = deps.hasher ?? createPasswordHasher();
    this.rateLimiter = deps.rateLimiter;
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

      return {
        user: mapUserRowToResponse(result.user),
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

    return {
      user: mapUserRowToResponse(user),
    };
  }
}

export function createAuthService(deps: AuthServiceDependencies): AuthService {
  return new DefaultAuthService(deps);
}
