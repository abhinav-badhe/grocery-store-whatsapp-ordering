import type { Generated, Insertable, Selectable, Updateable } from 'kysely';

/**
 * Validated lifecycle statuses for global platform users.
 * Aligned with UserStatusSchema in @grocery/api-contracts.
 */
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION';

/**
 * Validated lifecycle statuses for merchant stores.
 * Aligned with StoreStatusSchema in @grocery/api-contracts.
 */
export type StoreStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

/**
 * Architecture-approved store-scoped roles.
 * Aligned with StoreRoleSchema in @grocery/api-contracts.
 */
export type StoreRole = 'OWNER' | 'MANAGER' | 'STAFF';

/**
 * Validated lifecycle statuses for store memberships.
 * Aligned with MembershipStatusSchema in @grocery/api-contracts.
 */
export type MembershipStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED';

/**
 * Kysely table interface for identity.users.
 * Represents global platform users (merchants, staff, or registered customers).
 */
export interface UsersTable {
  id: Generated<string>;
  email: string | null;
  phone: string | null;
  full_name: string;
  status: Generated<UserStatus>;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type UserRow = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

/**
 * Kysely table interface for identity.user_credentials.
 * Stores sensitive password hashes separately from public user profiles.
 */
export interface UserCredentialsTable {
  user_id: string;
  password_hash: string;
  algorithm: Generated<string>;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type UserCredentialRow = Selectable<UserCredentialsTable>;
export type NewUserCredential = Insertable<UserCredentialsTable>;
export type UserCredentialUpdate = Updateable<UserCredentialsTable>;

/**
 * Kysely table interface for identity.stores.
 * Represents merchant stores (tenant boundary root).
 */
export interface StoresTable {
  id: Generated<string>;
  name: string;
  code: string | null;
  currency: Generated<string>;
  timezone: Generated<string>;
  status: Generated<StoreStatus>;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type StoreRow = Selectable<StoresTable>;
export type NewStore = Insertable<StoresTable>;
export type StoreUpdate = Updateable<StoresTable>;

/**
 * Kysely table interface for identity.store_memberships.
 * Represents explicit user-to-store membership and store-scoped roles.
 */
export interface StoreMembershipsTable {
  id: Generated<string>;
  user_id: string;
  store_id: string;
  role: StoreRole;
  status: Generated<MembershipStatus>;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type StoreMembershipRow = Selectable<StoreMembershipsTable>;
export type NewStoreMembership = Insertable<StoreMembershipsTable>;
export type StoreMembershipUpdate = Updateable<StoreMembershipsTable>;

export type RefreshTokenStatus = 'ACTIVE' | 'CONSUMED' | 'REVOKED';

/**
 * Kysely table interface for identity.refresh_tokens.
 * Supports token-family based rotation and reuse detection.
 */
export interface RefreshTokensTable {
  id: Generated<string>;
  user_id: string;
  family_id: string;
  token_hash: string;
  status: Generated<RefreshTokenStatus>;
  consumed_at: Date | string | null;
  revoked_at: Date | string | null;
  revoked_reason: string | null;
  replaced_by_token_id: string | null;
  expires_at: Date | string;
  created_at: Generated<Date | string>;
  updated_at: Generated<Date | string>;
}

export type RefreshTokenRow = Selectable<RefreshTokensTable>;
export type NewRefreshToken = Insertable<RefreshTokensTable>;
export type RefreshTokenUpdate = Updateable<RefreshTokensTable>;

/**
 * Composite Kysely database schema interface for identity persistence.
 * Supports both schema-prefixed and direct table access when search_path is configured.
 */
export interface Database {
  'identity.users': UsersTable;
  'identity.user_credentials': UserCredentialsTable;
  'identity.stores': StoresTable;
  'identity.store_memberships': StoreMembershipsTable;
  'identity.refresh_tokens': RefreshTokensTable;
  users: UsersTable;
  user_credentials: UserCredentialsTable;
  stores: StoresTable;
  store_memberships: StoreMembershipsTable;
  refresh_tokens: RefreshTokensTable;
}
