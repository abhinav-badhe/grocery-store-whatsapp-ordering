import { type WhatsAppInboundMessage, type ProvisionalQuoteSnapshot } from '@grocery/api-contracts';
import { DeterministicGroceryParser } from '../parser/grocery-list-parser.js';
import { CatalogResolver } from '../resolver/catalog-resolver.js';
import { QuoteGenerator } from '../quote/quote-generator.js';
import type { QuoteRepository } from '../persistence/quote-repository.js';
import type { InboundMessageRepository } from '../persistence/inbound-message-repository.js';
import type { StoreChannelRepository } from '../persistence/store-channel-repository.js';
import type { ConversationRepository } from '../persistence/conversation-repository.js';
import type { WhatsAppOutboundClient } from '../clients/whatsapp-outbound-client.js';
import type { OrderLookupClient } from '../clients/order-client.js';

export interface CoordinatorOptions {
  readonly storeChannelRepo: StoreChannelRepository;
  readonly inboundRepo: InboundMessageRepository;
  readonly conversationRepo: ConversationRepository;
  readonly quoteRepo: QuoteRepository;
  readonly catalogResolver: CatalogResolver;
  readonly outboundClient: WhatsAppOutboundClient;
  readonly orderClient?: OrderLookupClient;
}

export interface ProcessInboundEventParams {
  readonly phoneNumberId: string;
  readonly message: WhatsAppInboundMessage;
  readonly rawPayload: unknown;
}

export type ProcessInboundResult =
  | { readonly outcome: 'STORE_CHANNEL_NOT_FOUND'; readonly phoneNumberId: string }
  | { readonly outcome: 'DUPLICATE_DROPPED'; readonly providerMessageId: string }
  | { readonly outcome: 'GREETING_SENT'; readonly conversationId: string }
  | {
      readonly outcome: 'PROVISIONAL_QUOTE_SENT';
      readonly conversationId: string;
      readonly quoteVersion: number;
      readonly quote: ProvisionalQuoteSnapshot;
    }
  | { readonly outcome: 'ORDER_SUBMITTED'; readonly conversationId: string }
  | { readonly outcome: 'UNSUPPORTED_MESSAGE_TYPE'; readonly conversationId: string };

export class ConversationCoordinator {
  constructor(private readonly options: CoordinatorOptions) {}

  async processInboundMessage(params: ProcessInboundEventParams): Promise<ProcessInboundResult> {
    const { phoneNumberId, message, rawPayload } = params;

    // 1. Resolve store tenant from Meta WhatsApp Phone Number ID
    const channel = await this.options.storeChannelRepo.findByPhoneNumberId(phoneNumberId);
    if (!channel) {
      return {
        outcome: 'STORE_CHANNEL_NOT_FOUND',
        phoneNumberId,
      };
    }

    const storeId = channel.store_id;

    // 2. Inbound Deduplication: record raw message idempotently
    const recordResult = await this.options.inboundRepo.recordInboundMessage({
      providerMessageId: message.providerMessageId,
      storeId,
      senderPhoneE164: message.fromPhoneE164,
      payload: rawPayload,
    });

    if (recordResult.isDuplicate) {
      return {
        outcome: 'DUPLICATE_DROPPED',
        providerMessageId: message.providerMessageId,
      };
    }

    const inboundRow = recordResult.message;

    // 3. Acquire processing lease
    const leaseAcquired = await this.options.inboundRepo.acquireProcessingLease(inboundRow.id);
    if (!leaseAcquired) {
      return {
        outcome: 'DUPLICATE_DROPPED',
        providerMessageId: message.providerMessageId,
      };
    }

    try {
      // 4. Retrieve or initialize conversation session
      const conv = await this.options.conversationRepo.getOrCreateConversation(
        storeId,
        message.fromPhoneE164,
      );

      // 5. Handle message types and intent
      const textContent =
        message.type === 'text'
          ? (message.text?.trim() ?? '')
          : (message.interactive?.buttonReply?.title ??
            message.interactive?.listReply?.title ??
            '');

      const normalizedIntent = textContent.toUpperCase();

      // Case A: Customer CONFIRM / APPROVE intent
      if (
        normalizedIntent === 'CONFIRM' ||
        normalizedIntent === 'CONFIRM ORDER' ||
        normalizedIntent === 'APPROVE' ||
        message.interactive?.buttonReply?.id === 'CONFIRM_ORDER'
      ) {
        const activeQuote = await this.options.quoteRepo.getActiveQuote(storeId, conv.id);

        if (activeQuote) {
          let orderNumber: string | undefined;

          if (this.options.orderClient) {
            const confirmedItems = activeQuote.items
              .filter((it) => it.matchedProduct !== null && it.lineTotalCents !== null)
              .map((it) => ({
                productId: it.matchedProduct!.id,
                productName: it.matchedProduct!.name,
                quantity: it.requestedQuantity ?? 1,
                unitPriceCents: it.unitPriceCents ?? 0,
                unit: it.matchedProduct!.unit,
                sku: it.matchedProduct!.sku,
              }));

            if (confirmedItems.length > 0) {
              const createdOrder = await this.options.orderClient.createOrderFromQuote({
                storeId,
                customerPhone: message.fromPhoneE164,
                quoteId: activeQuote.quoteId,
                items: confirmedItems,
              });
              orderNumber = createdOrder.orderNumber;

              if (activeQuote.quoteId) {
                await this.options.quoteRepo.linkQuoteToOrder(
                  storeId,
                  activeQuote.quoteId,
                  createdOrder.id,
                );
              }
            }
          }

          await this.options.conversationRepo.updateConversationState(
            conv.id,
            'SUBMITTED_TO_SHOPKEEPER',
          );

          const confirmText = orderNumber
            ? `✅ *Order Submitted (#${orderNumber})!*\n\nYour grocery order has been sent to the shopkeeper for review. You will receive a confirmation message and payment link once verified.`
            : '✅ *Order Submitted!*\n\nYour grocery order has been sent to the shopkeeper for review. You will receive a confirmation message and payment link once verified.';

          await this.options.outboundClient.sendTextMessage({
            toPhoneE164: message.fromPhoneE164,
            phoneNumberId,
            text: confirmText,
          });

          await this.options.conversationRepo.recordOutboundActivity(conv.id);
          await this.options.inboundRepo.markProcessed(inboundRow.id);

          return {
            outcome: 'ORDER_SUBMITTED',
            conversationId: conv.id,
          };
        }
      }

      // Case B: General text -> Grocery list parsing & catalog resolution
      if (message.type === 'text' && textContent.length > 0) {
        const parser = new DeterministicGroceryParser();
        const parseResult = parser.parse(textContent);
        const parsedItems = parseResult.items;

        if (parsedItems.length > 0) {
          // Resolve items against store's real-time catalog and inventory stock
          const resolvedItems = await this.options.catalogResolver.resolveItems(
            storeId,
            parsedItems,
          );

          // Generate non-payable provisional quote snapshot
          const provisionalSnapshot = QuoteGenerator.generateProvisionalQuote({
            storeId,
            conversationId: conv.id,
            quoteVersion: 1, // Will be incremented monotonically by repo
            items: resolvedItems,
          });

          // Save quote and allocate version
          const saveResult = await this.options.quoteRepo.saveProvisionalQuote(
            storeId,
            conv.id,
            provisionalSnapshot,
          );

          // Format customer response
          const customerSummary = QuoteGenerator.formatCustomerSummary(provisionalSnapshot);

          // Dispatch WhatsApp message
          await this.options.outboundClient.sendTextMessage({
            toPhoneE164: message.fromPhoneE164,
            phoneNumberId,
            text: customerSummary,
          });

          await this.options.conversationRepo.recordOutboundActivity(conv.id);
          await this.options.inboundRepo.markProcessed(inboundRow.id);

          return {
            outcome: 'PROVISIONAL_QUOTE_SENT',
            conversationId: conv.id,
            quoteVersion: saveResult.version,
            quote: provisionalSnapshot,
          };
        }

        // Non-grocery conversational text -> Send helpful greeting
        await this.options.outboundClient.sendTextMessage({
          toPhoneE164: message.fromPhoneE164,
          phoneNumberId,
          text: 'Welcome to Local Corner Grocery! 🛒\n\nPlease send us your grocery shopping list (e.g. *1kg basmati rice, 500g sugar, 2 packets of milk*) and we will check stock and prices for you.',
        });

        await this.options.conversationRepo.recordOutboundActivity(conv.id);
        await this.options.inboundRepo.markProcessed(inboundRow.id);

        return {
          outcome: 'GREETING_SENT',
          conversationId: conv.id,
        };
      }

      // Unsupported message type (media, sticker, location)
      await this.options.outboundClient.sendTextMessage({
        toPhoneE164: message.fromPhoneE164,
        phoneNumberId,
        text: 'Sorry, we can only read text grocery lists at this time. Please type your item list as text.',
      });

      await this.options.conversationRepo.recordOutboundActivity(conv.id);
      await this.options.inboundRepo.markProcessed(inboundRow.id);

      return {
        outcome: 'UNSUPPORTED_MESSAGE_TYPE',
        conversationId: conv.id,
      };
    } catch (err) {
      const errorDetail = err instanceof Error ? err.message : String(err);
      await this.options.inboundRepo.markFailed(inboundRow.id, errorDetail);
      throw err;
    }
  }
}

export function createConversationCoordinator(
  options: CoordinatorOptions,
): ConversationCoordinator {
  return new ConversationCoordinator(options);
}
