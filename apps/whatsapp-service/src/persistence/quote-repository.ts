import type { Kysely } from 'kysely';
import type { Database } from '@grocery/database';
import type { ProvisionalQuoteSnapshot } from '@grocery/api-contracts';
import { ProvisionalQuoteSnapshotSchema } from '@grocery/api-contracts';

export class ConversationNotFoundError extends Error {
  constructor(public readonly conversationId: string) {
    super(`Conversation '${conversationId}' not found or does not belong to store`);
    this.name = 'ConversationNotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface SaveQuoteResult {
  readonly quoteId: string;
  readonly version: number;
}

export interface QuoteRepository {
  saveProvisionalQuote(
    storeId: string,
    conversationId: string,
    snapshot: ProvisionalQuoteSnapshot,
  ): Promise<SaveQuoteResult>;

  getActiveQuote(storeId: string, conversationId: string): Promise<ProvisionalQuoteSnapshot | null>;

  linkQuoteToOrder(storeId: string, quoteId: string, orderId: string): Promise<void>;
}

export class DefaultQuoteRepository implements QuoteRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Transactionally allocates the next quote version under exclusive conversation lock,
   * inserts the new quote, and expires previous active versions.
   */
  async saveProvisionalQuote(
    storeId: string,
    conversationId: string,
    snapshot: ProvisionalQuoteSnapshot,
  ): Promise<SaveQuoteResult> {
    return this.db.transaction().execute(async (trx) => {
      // 1. Acquire exclusive row lock on the conversation to serialize version allocation
      const conv = await trx
        .selectFrom('whatsapp.conversations')
        .selectAll()
        .where('id', '=', conversationId)
        .where('store_id', '=', storeId)
        .forUpdate()
        .executeTakeFirst();

      if (!conv) {
        throw new ConversationNotFoundError(conversationId);
      }

      // 2. Query maximum allocated version for this conversation
      const maxVerRow = await trx
        .selectFrom('whatsapp.provisional_quotes')
        .select((eb) => eb.fn.max('quote_version').as('max_ver'))
        .where('conversation_id', '=', conversationId)
        .executeTakeFirst();

      const nextVersion = (Number(maxVerRow?.max_ver) || 0) + 1;

      // 3. Insert new quote record with nextVersion and status ACTIVE
      const snapshotWithVersion: ProvisionalQuoteSnapshot = {
        ...snapshot,
        quoteVersion: nextVersion,
      };

      // Note: total_minor stores estimatedTotalMinor solely to satisfy database NOT NULL constraints.
      // The authoritative financial envelope with isPayable: false is preserved in JSONB items.
      const newQuote = await trx
        .insertInto('whatsapp.provisional_quotes')
        .values({
          conversation_id: conversationId,
          store_id: storeId,
          quote_version: nextVersion,
          status: 'ACTIVE',
          items: JSON.stringify(snapshotWithVersion),
          subtotal_minor: snapshot.knownSubtotalMinor,
          tax_minor: snapshot.taxMinor,
          delivery_minor: snapshot.deliveryMinor,
          total_minor: snapshot.estimatedTotalMinor,
          expires_at: new Date(snapshot.expiresAt),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // 4. Expire any previously active quotes for this conversation
      await trx
        .updateTable('whatsapp.provisional_quotes')
        .set({ status: 'EXPIRED' })
        .where('conversation_id', '=', conversationId)
        .where('id', '!=', newQuote.id)
        .where('status', '=', 'ACTIVE')
        .execute();

      // 5. Update conversation state to PROVISIONAL_QUOTE_SENT
      await trx
        .updateTable('whatsapp.conversations')
        .set({
          state: 'PROVISIONAL_QUOTE_SENT',
          updated_at: new Date(),
        })
        .where('id', '=', conversationId)
        .where('store_id', '=', storeId)
        .execute();

      return {
        quoteId: newQuote.id,
        version: nextVersion,
      };
    });
  }

  /**
   * Retrieves the current unexpired active quote for a conversation, if any.
   */
  async getActiveQuote(
    storeId: string,
    conversationId: string,
  ): Promise<ProvisionalQuoteSnapshot | null> {
    const row = await this.db
      .selectFrom('whatsapp.provisional_quotes')
      .selectAll()
      .where('store_id', '=', storeId)
      .where('conversation_id', '=', conversationId)
      .where('status', '=', 'ACTIVE')
      .where('expires_at', '>', new Date())
      .orderBy('quote_version', 'desc')
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    try {
      const parsed = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
      return ProvisionalQuoteSnapshotSchema.parse({
        ...parsed,
        quoteId: row.id,
      });
    } catch {
      return null;
    }
  }

  async linkQuoteToOrder(storeId: string, quoteId: string, orderId: string): Promise<void> {
    await this.db
      .updateTable('whatsapp.provisional_quotes')
      .set({
        order_id: orderId,
        status: 'ORDER_CREATED',
        confirmed_at: new Date(),
      })
      .where('store_id', '=', storeId)
      .where('id', '=', quoteId)
      .execute();
  }
}

export function createQuoteRepository(db: Kysely<Database>): QuoteRepository {
  return new DefaultQuoteRepository(db);
}
