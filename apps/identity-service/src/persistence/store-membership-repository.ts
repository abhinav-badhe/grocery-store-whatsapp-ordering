import type {
  StoreMembershipRow,
  NewStoreMembership,
  StoreRole,
  MembershipStatus,
} from '@grocery/database';
import type { DatabaseConnection, StoreMembershipRepository } from './types.js';
import { mapDatabaseError } from './errors.js';

export class KyselyStoreMembershipRepository implements StoreMembershipRepository {
  constructor(private readonly defaultDb: DatabaseConnection) {}

  private getExecutor(trx?: DatabaseConnection): DatabaseConnection {
    return trx ?? this.defaultDb;
  }

  async findByUserAndStore(
    userId: string,
    storeId: string,
    trx?: DatabaseConnection,
  ): Promise<StoreMembershipRow | null> {
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('identity.store_memberships')
        .selectAll()
        .where('user_id', '=', userId)
        .where('store_id', '=', storeId)
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapDatabaseError(err, 'Failed to find store membership');
    }
  }

  async listByUser(userId: string, trx?: DatabaseConnection): Promise<StoreMembershipRow[]> {
    try {
      const rows = await this.getExecutor(trx)
        .selectFrom('identity.store_memberships')
        .selectAll()
        .where('user_id', '=', userId)
        .execute();
      return rows;
    } catch (err) {
      throw mapDatabaseError(err, `Failed to list memberships for user '${userId}'`);
    }
  }

  async listByStore(storeId: string, trx?: DatabaseConnection): Promise<StoreMembershipRow[]> {
    try {
      const rows = await this.getExecutor(trx)
        .selectFrom('identity.store_memberships')
        .selectAll()
        .where('store_id', '=', storeId)
        .execute();
      return rows;
    } catch (err) {
      throw mapDatabaseError(err, `Failed to list memberships for store '${storeId}'`);
    }
  }

  async create(
    membership: NewStoreMembership,
    trx?: DatabaseConnection,
  ): Promise<StoreMembershipRow> {
    try {
      const created = await this.getExecutor(trx)
        .insertInto('identity.store_memberships')
        .values(membership)
        .returningAll()
        .executeTakeFirstOrThrow();
      return created;
    } catch (err) {
      throw mapDatabaseError(err, 'Failed to create store membership');
    }
  }

  async updateRole(
    userId: string,
    storeId: string,
    role: StoreRole,
    trx?: DatabaseConnection,
  ): Promise<StoreMembershipRow | null> {
    try {
      const updated = await this.getExecutor(trx)
        .updateTable('identity.store_memberships')
        .set({
          role,
          updated_at: new Date(),
        })
        .where('user_id', '=', userId)
        .where('store_id', '=', storeId)
        .returningAll()
        .executeTakeFirst();
      return updated ?? null;
    } catch (err) {
      throw mapDatabaseError(err, 'Failed to update store membership role');
    }
  }

  async updateStatus(
    userId: string,
    storeId: string,
    status: MembershipStatus,
    trx?: DatabaseConnection,
  ): Promise<StoreMembershipRow | null> {
    try {
      const updated = await this.getExecutor(trx)
        .updateTable('identity.store_memberships')
        .set({
          status,
          updated_at: new Date(),
        })
        .where('user_id', '=', userId)
        .where('store_id', '=', storeId)
        .returningAll()
        .executeTakeFirst();
      return updated ?? null;
    } catch (err) {
      throw mapDatabaseError(err, 'Failed to update store membership status');
    }
  }
}

export function createStoreMembershipRepository(db: DatabaseConnection): StoreMembershipRepository {
  return new KyselyStoreMembershipRepository(db);
}
