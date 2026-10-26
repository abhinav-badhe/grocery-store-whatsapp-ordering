import type { Kysely } from 'kysely';
import type { Database, StoreRow, StoreMembershipRow } from '@grocery/database';
import {
  CreateStoreInputSchema,
  AssignMembershipInputSchema,
  StoreProfileSchema,
  StoreMembershipSchema,
  type StoreProfile,
  type StoreMembership,
  type UserStoreItem,
} from '@grocery/api-contracts';
import {
  createStoreRepository,
  createStoreMembershipRepository,
  createUserRepository,
  createStoreWithOwner,
  DuplicateStoreCodeError as PersistenceDuplicateStoreCodeError,
  type StoreRepository,
  type StoreMembershipRepository,
  type UserRepository,
} from '../persistence/index.js';
import type { StoreService, StoreServiceDependencies, CreateStoreResult } from './types.js';
import {
  ValidationError,
  StoreNotFoundError,
  DuplicateStoreCodeError,
  StoreAccessDeniedError,
  StoreUnauthorizedError,
} from './errors.js';

export function mapStoreRowToProfile(row: StoreRow): StoreProfile {
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString();
  const updatedAt =
    row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : new Date(row.updated_at).toISOString();

  return StoreProfileSchema.parse({
    id: row.id,
    name: row.name,
    code: row.code ?? null,
    currency: row.currency,
    timezone: row.timezone,
    status: row.status,
    createdAt,
    updatedAt,
  });
}

export function mapMembershipRow(row: StoreMembershipRow): StoreMembership {
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString();
  const updatedAt =
    row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : new Date(row.updated_at).toISOString();

  return StoreMembershipSchema.parse({
    id: row.id,
    userId: row.user_id,
    storeId: row.store_id,
    role: row.role,
    status: row.status,
    createdAt,
    updatedAt,
  });
}

export class DefaultStoreService implements StoreService {
  private readonly db: Kysely<Database>;
  private readonly storeRepo: StoreRepository;
  private readonly membershipRepo: StoreMembershipRepository;
  private readonly userRepo: UserRepository;

  constructor(deps: StoreServiceDependencies) {
    this.db = deps.db;
    this.storeRepo = deps.storeRepo ?? createStoreRepository(deps.db);
    this.membershipRepo = deps.membershipRepo ?? createStoreMembershipRepository(deps.db);
    this.userRepo = deps.userRepo ?? createUserRepository(deps.db);
  }

  async createStore(userId: string, rawInput: unknown): Promise<CreateStoreResult> {
    const parseResult = CreateStoreInputSchema.safeParse(rawInput);
    if (!parseResult.success) {
      const invalidParams = parseResult.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      throw new ValidationError('Validation failed for store creation payload', invalidParams);
    }

    const user = await this.userRepo.findById(userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new StoreUnauthorizedError('Active user account is required to create a store');
    }

    const input = parseResult.data;
    try {
      const result = await createStoreWithOwner(
        this.db,
        {
          store: {
            name: input.name.trim(),
            code: input.code ? input.code.trim().toLowerCase() : null,
            currency: input.currency ?? 'INR',
            timezone: input.timezone ?? 'Asia/Kolkata',
            status: 'ACTIVE',
          },
          ownerUserId: userId,
        },
        {
          storeRepo: this.storeRepo,
          membershipRepo: this.membershipRepo,
        },
      );

      return {
        store: mapStoreRowToProfile(result.store),
        membership: mapMembershipRow(result.membership),
      };
    } catch (err) {
      if (err instanceof PersistenceDuplicateStoreCodeError) {
        throw new DuplicateStoreCodeError(`Store code '${input.code}' is already in use`);
      }
      throw err;
    }
  }

  async getStoreById(storeId: string, userId?: string): Promise<StoreProfile> {
    const store = await this.storeRepo.findById(storeId);
    if (!store) {
      throw new StoreNotFoundError(`Store with ID '${storeId}' was not found`);
    }

    if (userId) {
      const membership = await this.membershipRepo.findByUserAndStore(userId, storeId);
      if (!membership || membership.status !== 'ACTIVE') {
        throw new StoreAccessDeniedError(`User does not have access to store '${storeId}'`);
      }
    }

    return mapStoreRowToProfile(store);
  }

  async listStoresForUser(userId: string): Promise<UserStoreItem[]> {
    const memberships = await this.membershipRepo.listByUser(userId);
    const activeMemberships = memberships.filter((m) => m.status === 'ACTIVE');

    const items: UserStoreItem[] = [];
    for (const membership of activeMemberships) {
      const store = await this.storeRepo.findById(membership.store_id);
      if (store && store.status === 'ACTIVE') {
        items.push({
          store: mapStoreRowToProfile(store),
          role: membership.role,
          membershipStatus: membership.status,
        });
      }
    }

    return items;
  }

  async assignMembership(
    actingUserId: string,
    storeId: string,
    rawInput: unknown,
  ): Promise<StoreMembership> {
    const parseResult = AssignMembershipInputSchema.safeParse(rawInput);
    if (!parseResult.success) {
      const invalidParams = parseResult.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      throw new ValidationError('Validation failed for membership assignment', invalidParams);
    }

    const input = parseResult.data;
    if (input.storeId !== storeId) {
      throw new ValidationError('Path store ID must match body store ID');
    }

    // Role check: acting user must be active OWNER or MANAGER
    const actingMembership = await this.membershipRepo.findByUserAndStore(actingUserId, storeId);
    if (!actingMembership || actingMembership.status !== 'ACTIVE') {
      throw new StoreAccessDeniedError('You do not have active membership in this store');
    }

    if (actingMembership.role !== 'OWNER' && actingMembership.role !== 'MANAGER') {
      throw new StoreAccessDeniedError('Only store Owners and Managers can manage memberships');
    }

    if (actingMembership.role === 'MANAGER' && input.role === 'OWNER') {
      throw new StoreAccessDeniedError('Managers cannot assign the Owner role');
    }

    // Verify target user exists
    const targetUser = await this.userRepo.findById(input.userId);
    if (!targetUser) {
      throw new ValidationError(`Target user '${input.userId}' does not exist`);
    }

    const existingMembership = await this.membershipRepo.findByUserAndStore(input.userId, storeId);
    if (existingMembership) {
      const updated = await this.membershipRepo.updateRole(input.userId, storeId, input.role);
      if (!updated) {
        throw new StoreNotFoundError('Failed to update membership role');
      }
      return mapMembershipRow(updated);
    }

    const created = await this.membershipRepo.create({
      user_id: input.userId,
      store_id: storeId,
      role: input.role,
      status: 'ACTIVE',
    });

    return mapMembershipRow(created);
  }

  async listMemberships(actingUserId: string, storeId: string): Promise<StoreMembership[]> {
    const actingMembership = await this.membershipRepo.findByUserAndStore(actingUserId, storeId);
    if (!actingMembership || actingMembership.status !== 'ACTIVE') {
      throw new StoreAccessDeniedError('You do not have access to memberships in this store');
    }

    const rows = await this.membershipRepo.listByStore(storeId);
    return rows.map(mapMembershipRow);
  }
}

export function createStoreService(deps: StoreServiceDependencies): StoreService {
  return new DefaultStoreService(deps);
}
