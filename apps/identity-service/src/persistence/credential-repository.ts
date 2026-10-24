import type { UserCredentialRow, NewUserCredential } from '@grocery/database';
import type { DatabaseConnection, CredentialRepository } from './types.js';
import { mapDatabaseError } from './errors.js';

export class KyselyCredentialRepository implements CredentialRepository {
  constructor(private readonly defaultDb: DatabaseConnection) {}

  private getExecutor(trx?: DatabaseConnection): DatabaseConnection {
    return trx ?? this.defaultDb;
  }

  async findByUserId(userId: string, trx?: DatabaseConnection): Promise<UserCredentialRow | null> {
    try {
      const row = await this.getExecutor(trx)
        .selectFrom('identity.user_credentials')
        .selectAll()
        .where('user_id', '=', userId)
        .executeTakeFirst();
      return row ?? null;
    } catch (err) {
      throw mapDatabaseError(err, 'Failed to retrieve user credential');
    }
  }

  async create(
    credential: NewUserCredential,
    trx?: DatabaseConnection,
  ): Promise<UserCredentialRow> {
    try {
      const created = await this.getExecutor(trx)
        .insertInto('identity.user_credentials')
        .values({
          ...credential,
          algorithm: credential.algorithm ?? 'argon2id',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return created;
    } catch (err) {
      throw mapDatabaseError(err, 'Failed to create user credential');
    }
  }

  async updatePasswordHash(
    userId: string,
    passwordHash: string,
    algorithm = 'argon2id',
    trx?: DatabaseConnection,
  ): Promise<UserCredentialRow | null> {
    try {
      const updated = await this.getExecutor(trx)
        .updateTable('identity.user_credentials')
        .set({
          password_hash: passwordHash,
          algorithm,
          updated_at: new Date(),
        })
        .where('user_id', '=', userId)
        .returningAll()
        .executeTakeFirst();
      return updated ?? null;
    } catch (err) {
      throw mapDatabaseError(err, 'Failed to update password credential');
    }
  }
}

export function createCredentialRepository(db: DatabaseConnection): CredentialRepository {
  return new KyselyCredentialRepository(db);
}
