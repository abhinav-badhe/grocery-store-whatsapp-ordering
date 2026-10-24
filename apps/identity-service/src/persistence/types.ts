import type { Kysely, Transaction } from 'kysely';
import type {
  Database,
  UserRow,
  NewUser,
  UserUpdate,
  UserCredentialRow,
  NewUserCredential,
  StoreRow,
  NewStore,
  StoreUpdate,
  StoreMembershipRow,
  NewStoreMembership,
  StoreRole,
  MembershipStatus,
  RefreshTokenRow,
  NewRefreshToken,
  RefreshTokenUpdate,
  RefreshTokenStatus,
} from '@grocery/database';

/**
 * Either a standard Kysely instance or an active Transaction instance.
 * Allows repository operations to execute within an external transaction context.
 */
export type DatabaseConnection = Kysely<Database> | Transaction<Database>;

/**
 * Repository interface for global platform user accounts.
 * Passwords and sensitive credentials are intentionally excluded from this interface.
 */
export interface UserRepository {
  findById(id: string, trx?: DatabaseConnection): Promise<UserRow | null>;
  findByEmail(email: string, trx?: DatabaseConnection): Promise<UserRow | null>;
  findByPhone(phone: string, trx?: DatabaseConnection): Promise<UserRow | null>;
  create(user: NewUser, trx?: DatabaseConnection): Promise<UserRow>;
  update(id: string, update: UserUpdate, trx?: DatabaseConnection): Promise<UserRow | null>;
}

/**
 * Internal repository interface for user authentication credentials.
 * Handles sensitive Argon2id password hashes in strict isolation from public user profiles.
 */
export interface CredentialRepository {
  findByUserId(userId: string, trx?: DatabaseConnection): Promise<UserCredentialRow | null>;
  create(credential: NewUserCredential, trx?: DatabaseConnection): Promise<UserCredentialRow>;
  updatePasswordHash(
    userId: string,
    passwordHash: string,
    algorithm?: string,
    trx?: DatabaseConnection,
  ): Promise<UserCredentialRow | null>;
}

/**
 * Repository interface for merchant stores (tenant boundary root).
 */
export interface StoreRepository {
  findById(id: string, trx?: DatabaseConnection): Promise<StoreRow | null>;
  findByCode(code: string, trx?: DatabaseConnection): Promise<StoreRow | null>;
  create(store: NewStore, trx?: DatabaseConnection): Promise<StoreRow>;
  update(id: string, update: StoreUpdate, trx?: DatabaseConnection): Promise<StoreRow | null>;
  listStoresForUser(userId: string, trx?: DatabaseConnection): Promise<StoreRow[]>;
}

/**
 * Repository interface for store memberships and store-scoped user roles.
 */
export interface StoreMembershipRepository {
  findByUserAndStore(
    userId: string,
    storeId: string,
    trx?: DatabaseConnection,
  ): Promise<StoreMembershipRow | null>;
  listByUser(userId: string, trx?: DatabaseConnection): Promise<StoreMembershipRow[]>;
  listByStore(storeId: string, trx?: DatabaseConnection): Promise<StoreMembershipRow[]>;
  create(membership: NewStoreMembership, trx?: DatabaseConnection): Promise<StoreMembershipRow>;
  updateRole(
    userId: string,
    storeId: string,
    role: StoreRole,
    trx?: DatabaseConnection,
  ): Promise<StoreMembershipRow | null>;
  updateStatus(
    userId: string,
    storeId: string,
    status: MembershipStatus,
    trx?: DatabaseConnection,
  ): Promise<StoreMembershipRow | null>;
}

/**
 * Input parameters for atomically creating a user with their initial password credential.
 */
export interface CreateUserWithCredentialParams {
  readonly user: NewUser;
  readonly credential: {
    readonly passwordHash: string;
    readonly algorithm?: string;
  };
}

/**
 * Result of atomically creating a user with their initial password credential.
 */
export interface CreateUserWithCredentialResult {
  readonly user: UserRow;
  readonly credential: UserCredentialRow;
}

/**
 * Input parameters for atomically creating a store with its initial owner membership.
 */
export interface CreateStoreWithOwnerParams {
  readonly store: NewStore;
  readonly ownerUserId: string;
}

/**
 * Result of atomically creating a store with its initial owner membership.
 */
export interface CreateStoreWithOwnerResult {
  readonly store: StoreRow;
  readonly membership: StoreMembershipRow;
}

/**
 * Input parameters for atomically rotating a refresh token.
 */
export interface RotateTokenParams {
  readonly oldTokenHash: string;
  readonly newTokenHash: string;
  readonly newExpiresAt: Date;
}

/**
 * Discriminated result of an atomic refresh-token rotation operation.
 */
export type RotateTokenResult =
  | {
      readonly success: true;
      readonly oldToken: RefreshTokenRow;
      readonly newToken: RefreshTokenRow;
    }
  | {
      readonly success: false;
      readonly reason: 'TOKEN_NOT_FOUND';
    }
  | {
      readonly success: false;
      readonly reason: 'TOKEN_REVOKED';
      readonly token: RefreshTokenRow;
    }
  | {
      readonly success: false;
      readonly reason: 'TOKEN_EXPIRED';
      readonly token: RefreshTokenRow;
    }
  | {
      readonly success: false;
      readonly reason: 'REUSE_DETECTED';
      readonly familyId: string;
      readonly revokedCount: number;
    };

/**
 * Persistence repository interface for durable identity refresh-token sessions.
 * Manages token lifecycle, cryptographic hash lookup, atomic rotation, and token-family reuse detection.
 */
export interface RefreshTokenRepository {
  findById(id: string, trx?: DatabaseConnection): Promise<RefreshTokenRow | null>;
  findByTokenHash(tokenHash: string, trx?: DatabaseConnection): Promise<RefreshTokenRow | null>;
  create(token: NewRefreshToken, trx?: DatabaseConnection): Promise<RefreshTokenRow>;
  rotate(params: RotateTokenParams, trx?: DatabaseConnection): Promise<RotateTokenResult>;
  revokeFamily(familyId: string, reason?: string, trx?: DatabaseConnection): Promise<number>;
  revokeToken(
    id: string,
    reason?: string,
    trx?: DatabaseConnection,
  ): Promise<RefreshTokenRow | null>;
  revokeAllForUser(userId: string, reason?: string, trx?: DatabaseConnection): Promise<number>;
  listActiveByUser(userId: string, trx?: DatabaseConnection): Promise<RefreshTokenRow[]>;
}

export type { RefreshTokenRow, NewRefreshToken, RefreshTokenUpdate, RefreshTokenStatus };
