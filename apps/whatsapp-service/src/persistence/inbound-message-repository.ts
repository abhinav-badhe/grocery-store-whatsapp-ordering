import type { Kysely } from 'kysely';
import type { Database, InboundMessageRow } from '@grocery/database';

export interface RecordInboundMessageInput {
  readonly providerMessageId: string;
  readonly storeId: string | null;
  readonly senderPhoneE164: string;
  readonly payload: unknown;
}

export type RecordInboundResult =
  | { readonly isDuplicate: false; readonly message: InboundMessageRow }
  | { readonly isDuplicate: true; readonly existingMessage: InboundMessageRow };

export interface InboundMessageRepository {
  recordInboundMessage(input: RecordInboundMessageInput): Promise<RecordInboundResult>;
  acquireProcessingLease(messageId: string, leaseDurationMs?: number): Promise<boolean>;
  markProcessed(messageId: string): Promise<void>;
  markFailed(messageId: string, errorDetail: string): Promise<void>;
  findByProviderMessageId(providerMessageId: string): Promise<InboundMessageRow | null>;
}

export class DefaultInboundMessageRepository implements InboundMessageRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async recordInboundMessage(input: RecordInboundMessageInput): Promise<RecordInboundResult> {
    try {
      const inserted = await this.db
        .insertInto('whatsapp.inbound_messages')
        .values({
          provider_message_id: input.providerMessageId,
          store_id: input.storeId,
          sender_phone_e164: input.senderPhoneE164,
          payload: JSON.stringify(input.payload),
          status: 'RECEIVED',
          attempt_count: 0,
          max_retries: 5,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return { isDuplicate: false, message: inserted };
    } catch (err: unknown) {
      // Check for unique constraint violation on provider_message_id
      const isUniqueViolation =
        (err &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code: string }).code === '23505') ||
        (err instanceof Error && err.message.toLowerCase().includes('unique'));

      if (isUniqueViolation) {
        const existing = await this.findByProviderMessageId(input.providerMessageId);
        if (existing) {
          return { isDuplicate: true, existingMessage: existing };
        }
      }
      throw err;
    }
  }

  async acquireProcessingLease(messageId: string, leaseDurationMs = 30000): Promise<boolean> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseDurationMs);

    const result = await this.db
      .updateTable('whatsapp.inbound_messages')
      .set((eb) => ({
        status: 'PROCESSING',
        attempt_count: eb('attempt_count', '+', 1),
        locked_until: leaseUntil,
      }))
      .where('id', '=', messageId)
      .where((eb) =>
        eb.or([
          eb('status', '=', 'RECEIVED'),
          eb('status', '=', 'FAILED'),
          eb.and([eb('status', '=', 'PROCESSING'), eb('locked_until', '<', now)]),
        ]),
      )
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  async markProcessed(messageId: string): Promise<void> {
    await this.db
      .updateTable('whatsapp.inbound_messages')
      .set({
        status: 'PROCESSED',
        processed_at: new Date(),
        locked_until: null,
      })
      .where('id', '=', messageId)
      .execute();
  }

  async markFailed(messageId: string, errorDetail: string): Promise<void> {
    await this.db
      .updateTable('whatsapp.inbound_messages')
      .set({
        status: 'FAILED',
        last_error: errorDetail,
        locked_until: null,
      })
      .where('id', '=', messageId)
      .execute();
  }

  async findByProviderMessageId(providerMessageId: string): Promise<InboundMessageRow | null> {
    const row = await this.db
      .selectFrom('whatsapp.inbound_messages')
      .selectAll()
      .where('provider_message_id', '=', providerMessageId)
      .executeTakeFirst();

    return row ?? null;
  }
}

export function createInboundMessageRepository(db: Kysely<Database>): InboundMessageRepository {
  return new DefaultInboundMessageRepository(db);
}
