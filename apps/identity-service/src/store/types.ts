import type { Kysely } from 'kysely';
import type { Database } from '@grocery/database';
import type { StoreProfile, StoreMembership, UserStoreItem } from '@grocery/api-contracts';
import type {
  StoreRepository,
  StoreMembershipRepository,
  UserRepository,
} from '../persistence/types.js';

export interface StoreServiceDependencies {
  readonly db: Kysely<Database>;
  readonly storeRepo?: StoreRepository;
  readonly membershipRepo?: StoreMembershipRepository;
  readonly userRepo?: UserRepository;
}

export interface CreateStoreResult {
  readonly store: StoreProfile;
  readonly membership: StoreMembership;
}

export interface StoreService {
  createStore(userId: string, input: unknown): Promise<CreateStoreResult>;
  getStoreById(storeId: string, userId?: string): Promise<StoreProfile>;
  listStoresForUser(userId: string): Promise<UserStoreItem[]>;
  assignMembership(actingUserId: string, storeId: string, input: unknown): Promise<StoreMembership>;
  listMemberships(actingUserId: string, storeId: string): Promise<StoreMembership[]>;
}
