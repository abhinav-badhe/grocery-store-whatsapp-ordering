import type { Kysely } from 'kysely';
import type { Database } from '@grocery/database';
import type {
  UserRepository,
  CredentialRepository,
  StoreRepository,
  StoreMembershipRepository,
  CreateUserWithCredentialParams,
  CreateUserWithCredentialResult,
  CreateStoreWithOwnerParams,
  CreateStoreWithOwnerResult,
} from './types.js';
import { createUserRepository } from './user-repository.js';
import { createCredentialRepository } from './credential-repository.js';
import { createStoreRepository } from './store-repository.js';
import { createStoreMembershipRepository } from './store-membership-repository.js';

export interface IdentityTransactionRepositories {
  readonly userRepo?: UserRepository;
  readonly credentialRepo?: CredentialRepository;
  readonly storeRepo?: StoreRepository;
  readonly membershipRepo?: StoreMembershipRepository;
}

/**
 * Atomically creates a platform user record and their accompanying password credential
 * within a single database transaction.
 *
 * TRANSACTION GUARANTEES:
 * - If credential creation fails, the user record is rolled back automatically.
 * - Prevents orphan users without authentication credentials from being persisted.
 */
export async function createUserWithCredential(
  db: Kysely<Database>,
  params: CreateUserWithCredentialParams,
  repos?: IdentityTransactionRepositories,
): Promise<CreateUserWithCredentialResult> {
  const userRepo = repos?.userRepo ?? createUserRepository(db);
  const credentialRepo = repos?.credentialRepo ?? createCredentialRepository(db);

  return await db.transaction().execute(async (trx) => {
    const user = await userRepo.create(params.user, trx);

    const credential = await credentialRepo.create(
      {
        user_id: user.id,
        password_hash: params.credential.passwordHash,
        algorithm: params.credential.algorithm ?? 'argon2id',
      },
      trx,
    );

    return { user, credential };
  });
}

/**
 * Atomically creates a merchant store and its initial OWNER membership
 * within a single database transaction.
 *
 * TRANSACTION GUARANTEES:
 * - If store membership assignment fails, store creation is rolled back automatically.
 * - Prevents un-owned or partially initialized stores from entering the database.
 */
export async function createStoreWithOwner(
  db: Kysely<Database>,
  params: CreateStoreWithOwnerParams,
  repos?: IdentityTransactionRepositories,
): Promise<CreateStoreWithOwnerResult> {
  const storeRepo = repos?.storeRepo ?? createStoreRepository(db);
  const membershipRepo = repos?.membershipRepo ?? createStoreMembershipRepository(db);

  return await db.transaction().execute(async (trx) => {
    const store = await storeRepo.create(params.store, trx);

    const membership = await membershipRepo.create(
      {
        user_id: params.ownerUserId,
        store_id: store.id,
        role: 'OWNER',
        status: 'ACTIVE',
      },
      trx,
    );

    return { store, membership };
  });
}
