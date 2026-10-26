import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import type { Database } from '@grocery/database';
import type { ProvisionalQuoteSnapshot } from '@grocery/api-contracts';
import { DefaultQuoteRepository, ConversationNotFoundError } from '../dist/index.js';

describe('Quote Repository (Subphase 2)', () => {
  const storeId = '00000000-0000-4000-8000-000000000001';
  const conversationId = '22222222-2222-4222-8222-222222222222';

  const mockSnapshot: ProvisionalQuoteSnapshot = {
    conversationId,
    storeId,
    quoteVersion: 1,
    isPayable: false,
    finalizationStatus: 'PROVISIONAL_PENDING_REVIEW',
    unresolvedCharges: ['TAX_POLICY_UNRESOLVED'],
    hasUnpricedItems: false,
    knownSubtotalMinor: 6000,
    taxMinor: 0,
    deliveryMinor: 0,
    estimatedTotalMinor: 6000,
    currency: 'INR',
    items: [],
    disclaimer: 'Provisional estimate',
    expiresAt: new Date(Date.now() + 900000).toISOString(),
    createdAt: new Date().toISOString(),
  };

  it('allocates monotonically increasing versions and expires previous quotes inside transaction', async () => {
    const executedOperations: string[] = [];

    const mockTrx: any = {
      selectFrom: (table: string) => {
        executedOperations.push(`selectFrom:${table}`);
        return {
          selectAll: () => ({
            where: () => ({
              where: () => ({
                forUpdate: () => {
                  executedOperations.push('forUpdate');
                  return {
                    executeTakeFirst: async () => ({ id: conversationId, store_id: storeId }),
                  };
                },
              }),
            }),
          }),
          select: () => ({
            where: () => ({
              executeTakeFirst: async () => {
                executedOperations.push('maxVersionQuery');
                return { max_ver: 2 }; // previous version was 2
              },
            }),
          }),
        };
      },
      insertInto: (table: string) => {
        executedOperations.push(`insertInto:${table}`);
        return {
          values: (values: any) => {
            executedOperations.push(`insertValues:version=${values.quote_version}`);
            return {
              returningAll: () => ({
                executeTakeFirstOrThrow: async () => ({
                  id: '33333333-3333-4333-8333-333333333333',
                  ...values,
                }),
              }),
            };
          },
        };
      },
      updateTable: (table: string) => {
        executedOperations.push(`updateTable:${table}`);
        const chain: any = {
          execute: async () => {
            executedOperations.push(`updateExecute:${table}`);
          },
          where: () => chain,
        };
        return {
          set: (vals: any) => {
            if (vals.status) {
              executedOperations.push(`expirePreviousQuotes:${vals.status}`);
            }
            if (vals.state) {
              executedOperations.push(`advanceConversationState:${vals.state}`);
            }
            return chain;
          },
        };
      },
    };

    const mockDb: any = {
      transaction: () => ({
        execute: async (callback: (trx: any) => Promise<any>) => callback(mockTrx),
      }),
    };

    const repo = new DefaultQuoteRepository(mockDb as Kysely<Database>);
    const result = await repo.saveProvisionalQuote(storeId, conversationId, mockSnapshot);

    assert.equal(result.version, 3); // max_ver (2) + 1 = 3
    assert.equal(result.quoteId, '33333333-3333-4333-8333-333333333333');

    // Verify correct execution sequence
    assert.ok(
      executedOperations.includes('forUpdate'),
      'Exclusive row lock acquired on conversation',
    );
    assert.ok(executedOperations.includes('maxVersionQuery'), 'Queried max version under lock');
    assert.ok(
      executedOperations.includes('insertValues:version=3'),
      'Inserted new quote version 3',
    );
    assert.ok(
      executedOperations.includes('expirePreviousQuotes:EXPIRED'),
      'Expired previous active quotes',
    );
    assert.ok(
      executedOperations.includes('advanceConversationState:PROVISIONAL_QUOTE_SENT'),
      'Advanced conversation state',
    );
  });

  it('fails closed with ConversationNotFoundError if conversation does not exist', async () => {
    const mockTrx: any = {
      selectFrom: () => ({
        selectAll: () => ({
          where: () => ({
            where: () => ({
              forUpdate: () => ({
                executeTakeFirst: async () => undefined, // conversation not found
              }),
            }),
          }),
        }),
      }),
    };

    const mockDb: any = {
      transaction: () => ({
        execute: async (callback: (trx: any) => Promise<any>) => callback(mockTrx),
      }),
    };

    const repo = new DefaultQuoteRepository(mockDb as Kysely<Database>);

    await assert.rejects(
      () => repo.saveProvisionalQuote(storeId, conversationId, mockSnapshot),
      ConversationNotFoundError,
    );
  });
});
