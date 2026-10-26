import type { Kysely } from 'kysely';
import type { Database, StoreChannelRow, NewStoreChannel } from '@grocery/database';

export interface StoreChannelRepository {
  findByPhoneNumberId(phoneNumberId: string): Promise<StoreChannelRow | null>;
  findByStoreId(storeId: string): Promise<StoreChannelRow | null>;
  upsertChannel(channel: NewStoreChannel): Promise<StoreChannelRow>;
}

export class DefaultStoreChannelRepository implements StoreChannelRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findByPhoneNumberId(phoneNumberId: string): Promise<StoreChannelRow | null> {
    const row = await this.db
      .selectFrom('whatsapp.store_channels')
      .selectAll()
      .where('phone_number_id', '=', phoneNumberId)
      .where('is_active', '=', true)
      .executeTakeFirst();

    return row ?? null;
  }

  async findByStoreId(storeId: string): Promise<StoreChannelRow | null> {
    const row = await this.db
      .selectFrom('whatsapp.store_channels')
      .selectAll()
      .where('store_id', '=', storeId)
      .where('is_active', '=', true)
      .executeTakeFirst();

    return row ?? null;
  }

  async upsertChannel(channel: NewStoreChannel): Promise<StoreChannelRow> {
    const row = await this.db
      .insertInto('whatsapp.store_channels')
      .values(channel)
      .onConflict((oc) =>
        oc.column('phone_number_id').doUpdateSet({
          store_id: channel.store_id,
          display_phone_number: channel.display_phone_number,
          waba_id: channel.waba_id,
          is_active: channel.is_active ?? true,
          updated_at: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    return row;
  }
}

export function createStoreChannelRepository(db: Kysely<Database>): StoreChannelRepository {
  return new DefaultStoreChannelRepository(db);
}
