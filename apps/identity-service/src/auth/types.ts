import type crypto from 'node:crypto';
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

export interface AuthSessionKeyPair {
  readonly publicKey: crypto.KeyObject | string;
  readonly privateKey: crypto.KeyObject | string;
  readonly kid?: string;
}

export interface AuthServiceDependencies {
  readonly db: Kysely<Database>;
  readonly userRepo?: UserRepository;
  readonly credentialRepo?: CredentialRepository;
  readonly refreshTokenRepo?: RefreshTokenRepository;
  readonly hasher?: PasswordHasher;
  readonly rateLimiter?: RateLimiter;
  readonly keyPair?: AuthSessionKeyPair;
  readonly issuer?: string;
  readonly audience?: string;
  readonly accessTokenExpiresInSeconds?: number;
}

export interface AuthSession {
  readonly accessToken: string;
  readonly tokenType: 'Bearer';
  readonly expiresIn: number;
  readonly rawRefreshToken: string;
  readonly familyId: string;
  readonly expiresAt: Date;
}

export interface RegisterResult {
  readonly user: UserResponse;
  readonly session?: AuthSession;
}

export interface LoginResult {
  readonly user: UserResponse;
  readonly session?: AuthSession;
}

export interface RefreshResult {
  readonly accessToken: string;
  readonly tokenType: 'Bearer';
  readonly expiresIn: number;
  readonly rawRefreshToken: string;
  readonly familyId: string;
  readonly expiresAt: Date;
}

export interface LogoutResult {
  readonly success: boolean;
}

export interface CurrentUserResult {
  readonly user: UserResponse;
}

export interface AuthService {
  register(input: unknown): Promise<RegisterResult>;
  login(input: unknown, clientIp?: string): Promise<LoginResult>;
  refresh(rawRefreshToken: string): Promise<RefreshResult>;
  logout(rawRefreshToken: string): Promise<LogoutResult>;
  getCurrentUser(accessToken: string): Promise<CurrentUserResult>;
}
