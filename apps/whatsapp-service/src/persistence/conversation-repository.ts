import type { Kysely } from 'kysely';
import type { Database, ConversationRow } from '@grocery/database';

export interface ConversationRepository {
  getOrCreateConversation(storeId: string, senderPhoneE164: string): Promise<ConversationRow>;
  updateConversationState(
    conversationId: string,
    state: string,
    context?: Record<string, unknown>,
  ): Promise<ConversationRow>;
  findById(conversationId: string): Promise<ConversationRow | null>;
  recordOutboundActivity(conversationId: string): Promise<void>;
}

export class DefaultConversationRepository implements ConversationRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async getOrCreateConversation(
    storeId: string,
    senderPhoneE164: string,
  ): Promise<ConversationRow> {
    const existing = await this.db
      .selectFrom('whatsapp.conversations')
      .selectAll()
      .where('store_id', '=', storeId)
      .where('sender_phone_e164', '=', senderPhoneE164)
      .executeTakeFirst();

    if (existing) {
      // Update last_inbound_at timestamp
      const updated = await this.db
        .updateTable('whatsapp.conversations')
        .set({
          last_inbound_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      return updated;
    }

    try {
      const created = await this.db
        .insertInto('whatsapp.conversations')
        .values({
          store_id: storeId,
          sender_phone_e164: senderPhoneE164,
          state: 'INITIATED',
          context: JSON.stringify({}),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return created;
    } catch {
      // Handle concurrent insert race
      const refetched = await this.db
        .selectFrom('whatsapp.conversations')
        .selectAll()
        .where('store_id', '=', storeId)
        .where('sender_phone_e164', '=', senderPhoneE164)
        .executeTakeFirstOrThrow();

      return refetched;
    }
  }

  async updateConversationState(
    conversationId: string,
    state: string,
    context?: Record<string, unknown>,
  ): Promise<ConversationRow> {
    const updateData: {
      state: string;
      updated_at: Date;
      context?: string;
    } = {
      state,
      updated_at: new Date(),
    };

    if (context !== undefined) {
      updateData.context = JSON.stringify(context);
    }

    const updated = await this.db
      .updateTable('whatsapp.conversations')
      .set(updateData)
      .where('id', '=', conversationId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return updated;
  }

  async findById(conversationId: string): Promise<ConversationRow | null> {
    const row = await this.db
      .selectFrom('whatsapp.conversations')
      .selectAll()
      .where('id', '=', conversationId)
      .executeTakeFirst();

    return row ?? null;
  }

  async recordOutboundActivity(conversationId: string): Promise<void> {
    await this.db
      .updateTable('whatsapp.conversations')
      .set({
        last_outbound_at: new Date(),
        updated_at: new Date(),
      })
      .where('id', '=', conversationId)
      .execute();
  }
}

export function createConversationRepository(db: Kysely<Database>): ConversationRepository {
  return new DefaultConversationRepository(db);
}
