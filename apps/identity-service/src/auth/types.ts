import type { Kysely } from 'kysely';
import type { Database } from '@grocery/database';
import type { UserResponse } from '@grocery/api-contracts';
import type {
  UserRepository,
  CredentialRepository,
  RefreshTokenRepository,
} from '../persistence/types.js';
import type { PasswordHasher } from '../crypto/hasher.js';
import type { RateLimiter } from './rate-limiter.js';

export interface AuthServiceDependencies {
  readonly db: Kysely<Database>;
  readonly userRepo?: UserRepository;
  readonly credentialRepo?: CredentialRepository;
  readonly refreshTokenRepo?: RefreshTokenRepository;
  readonly hasher?: PasswordHasher;
  readonly rateLimiter?: RateLimiter;
}

export interface RegisterResult {
  readonly user: UserResponse;
}

export interface LoginResult {
  readonly user: UserResponse;
  readonly session?: {
    readonly rawRefreshToken: string;
    readonly familyId: string;
    readonly expiresAt: Date;
  };
}

export interface AuthService {
  register(input: unknown): Promise<RegisterResult>;
  login(input: unknown, clientIp?: string): Promise<LoginResult>;
}
