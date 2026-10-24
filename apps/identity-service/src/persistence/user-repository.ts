import type { UserRow, NewUser, UserUpdate } from '@grocery/database';
import type { DatabaseConnection, UserRepository } from './types.js';
import { mapDatabaseError } from './errors.js';

/**
 * Normalizes an email string to lowercase trimmed representation.
 * Aligned with NormalizedEmailSchema in @grocery/api-contracts.
 */
function normalizeEmail(email: string | null | undefined): string | null {
  if (!email || typeof email !== 'string') {
    return null;
  }
  const trimmed = email.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

/**
 * Normalizes a phone string (trimming whitespace while preserving E.164 formatting).
 */
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone || typeof phone !== 'string') {
    return null;
  }
  const trimmed = phone.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export class KyselyUserRepository implements UserRepository {
  constructor(private readonly defaultDb: DatabaseConnection) {}

  private getExecutor(trx?: DatabaseConnection): DatabaseConnection {
    return trx ?? this.defaultDb;
  }

  async findById(id: string, trx?: DatabaseConnection): Promise<UserRow | null> {
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('identity.users')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapDatabaseError(err, `Failed to find user by id '${id}'`);
    }
  }

  async findByEmail(email: string, trx?: DatabaseConnection): Promise<UserRow | null> {
    const normalized = normalizeEmail(email);
    if (!normalized) {
      return null;
    }
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('identity.users')
        .selectAll()
        .where('email', '=', normalized)
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapDatabaseError(err, 'Failed to find user by email');
    }
  }

  async findByPhone(phone: string, trx?: DatabaseConnection): Promise<UserRow | null> {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      return null;
    }
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('identity.users')
        .selectAll()
        .where('phone', '=', normalized)
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapDatabaseError(err, 'Failed to find user by phone');
    }
  }

  async create(user: NewUser, trx?: DatabaseConnection): Promise<UserRow> {
    const email = normalizeEmail(user.email);
    const phone = normalizePhone(user.phone);

    try {
      const created = await this.getExecutor(trx)
        .insertInto('identity.users')
        .values({
          ...user,
          email,
          phone,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return created;
    } catch (err) {
      throw mapDatabaseError(err, 'Failed to create user');
    }
  }

  async update(id: string, update: UserUpdate, trx?: DatabaseConnection): Promise<UserRow | null> {
    const payload: UserUpdate = {
      ...update,
      updated_at: new Date(),
    };

    if (update.email !== undefined) {
      payload.email = normalizeEmail(update.email);
    }
    if (update.phone !== undefined) {
      payload.phone = normalizePhone(update.phone);
    }

    try {
      const updated = await this.getExecutor(trx)
        .updateTable('identity.users')
        .set(payload)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
      return updated ?? null;
    } catch (err) {
      throw mapDatabaseError(err, `Failed to update user '${id}'`);
    }
  }
}

export function createUserRepository(db: DatabaseConnection): UserRepository {
  return new KyselyUserRepository(db);
}
