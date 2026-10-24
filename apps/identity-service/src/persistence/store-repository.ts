import type { StoreRow, NewStore, StoreUpdate } from '@grocery/database';
import type { DatabaseConnection, StoreRepository } from './types.js';
import { mapDatabaseError } from './errors.js';

export class KyselyStoreRepository implements StoreRepository {
  constructor(private readonly defaultDb: DatabaseConnection) {}

  private getExecutor(trx?: DatabaseConnection): DatabaseConnection {
    return trx ?? this.defaultDb;
  }

  async findById(id: string, trx?: DatabaseConnection): Promise<StoreRow | null> {
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('identity.stores')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapDatabaseError(err, `Failed to find store by id '${id}'`);
    }
  }

  async findByCode(code: string, trx?: DatabaseConnection): Promise<StoreRow | null> {
    const trimmed = code?.trim().toLowerCase();
    if (!trimmed) {
      return null;
    }
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('identity.stores')
        .selectAll()
        .where('code', '=', trimmed)
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapDatabaseError(err, `Failed to find store by code '${code}'`);
    }
  }

  async create(store: NewStore, trx?: DatabaseConnection): Promise<StoreRow> {
    const code = store.code ? store.code.trim().toLowerCase() : null;
    try {
      const created = await this.getExecutor(trx)
        .insertInto('identity.stores')
        .values({
          ...store,
          code,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return created;
    } catch (err) {
      throw mapDatabaseError(err, 'Failed to create store');
    }
  }

  async update(
    id: string,
    update: StoreUpdate,
    trx?: DatabaseConnection,
  ): Promise<StoreRow | null> {
    const payload: StoreUpdate = {
      ...update,
      updated_at: new Date(),
    };
    if (update.code !== undefined && typeof update.code === 'string') {
      payload.code = update.code.trim().toLowerCase();
    }

    try {
      const updated = await this.getExecutor(trx)
        .updateTable('identity.stores')
        .set(payload)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
      return updated ?? null;
    } catch (err) {
      throw mapDatabaseError(err, `Failed to update store '${id}'`);
    }
  }

  async listStoresForUser(userId: string, trx?: DatabaseConnection): Promise<StoreRow[]> {
    try {
      const rows = await this.getExecutor(trx)
        .selectFrom('identity.stores')
        .innerJoin(
          'identity.store_memberships',
          'identity.store_memberships.store_id',
          'identity.stores.id',
        )
        .selectAll('identity.stores')
        .where('identity.store_memberships.user_id', '=', userId)
        .execute();
      return rows;
    } catch (err) {
      throw mapDatabaseError(err, `Failed to list stores for user '${userId}'`);
    }
  }
}

export function createStoreRepository(db: DatabaseConnection): StoreRepository {
  return new KyselyStoreRepository(db);
}
