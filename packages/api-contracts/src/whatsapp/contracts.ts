import { z } from 'zod';
import { CanonicalUnitSchema } from '../common/money.js';
import { ProductUnitSchema } from '../catalog/product.js';

/**
 * Standard confidence rating for parsed grocery items.
 */
export const ParseConfidenceSchema = z.enum(['EXACT', 'AMBIGUOUS', 'INCOMPATIBLE', 'MALFORMED'], {
  errorMap: () => ({
    message: "Confidence must be 'EXACT', 'AMBIGUOUS', 'INCOMPATIBLE', or 'MALFORMED'",
  }),
});

export type ParseConfidence = z.infer<typeof ParseConfidenceSchema>;

/**
 * Package size specification embedded in a customer's grocery item request.
 * e.g., "500g" in "2 packs of 500g butter".
 */
export const PackageSizeSpecSchema = z.object({
  amount: z.number().positive(),
  unit: z.string().min(1),
});

export type PackageSizeSpec = z.infer<typeof PackageSizeSpecSchema>;

/**
 * Parsed individual grocery item contract.
 * Strictly separates original customer text, requested count, pack size, and dimension-normalized quantities.
 */
export const ParsedGroceryItemSchema = z.object({
  rawText: z.string().min(1),
  brand: z.string().nullable(),
  productName: z.string().min(1),
  originalQuantity: z.number().positive().nullable(),
  originalUnit: z.string().nullable(),
  normalizedQuantity: z.number().positive().nullable(),
  normalizedUnit: CanonicalUnitSchema.nullable(),
  requestedPackCount: z.number().int().positive().nullable(),
  packageSize: PackageSizeSpecSchema.nullable(),
  confidence: ParseConfidenceSchema,
  ambiguityReasons: z.array(z.string()),
});

export type ParsedGroceryItem = z.infer<typeof ParsedGroceryItemSchema>;

/**
 * Aggregate result of parsing a natural language grocery list.
 */
export const GroceryListParseResultSchema = z.object({
  originalMessage: z.string(),
  items: z.array(ParsedGroceryItemSchema),
  hasAmbiguity: z.boolean(),
  unparsedLines: z.array(z.string()),
});

export type GroceryListParseResult = z.infer<typeof GroceryListParseResultSchema>;

/**
 * WhatsApp interactive message response type (button reply or list selection).
 */
export const WhatsAppInteractiveResponseSchema = z.object({
  type: z.enum(['button_reply', 'list_reply']),
  buttonReply: z
    .object({
      id: z.string(),
      title: z.string(),
    })
    .optional(),
  listReply: z
    .object({
      id: z.string(),
      title: z.string(),
      description: z.string().optional(),
    })
    .optional(),
});

export type WhatsAppInteractiveResponse = z.infer<typeof WhatsAppInteractiveResponseSchema>;

/**
 * WhatsApp inbound message structure extracted from Meta Cloud API webhook entry.
 */
export const WhatsAppInboundMessageSchema = z.object({
  providerMessageId: z.string().min(1),
  fromPhoneE164: z.string().regex(/^\+[1-9]\d{1,14}$/, {
    message: 'Sender phone must be in canonical E.164 format (e.g. +919820011223)',
  }),
  timestamp: z.string(),
  type: z.enum(['text', 'interactive', 'unsupported']),
  text: z.string().optional(),
  interactive: WhatsAppInteractiveResponseSchema.optional(),
});

export type WhatsAppInboundMessage = z.infer<typeof WhatsAppInboundMessageSchema>;

/**
 * Meta WhatsApp Cloud API Webhook Notification Payload.
 */
export const MetaWebhookPayloadSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          field: z.literal('messages'),
          value: z.object({
            messaging_product: z.literal('whatsapp'),
            metadata: z.object({
              display_phone_number: z.string(),
              phone_number_id: z.string(),
            }),
            contacts: z
              .array(
                z.object({
                  profile: z.object({
                    name: z.string().optional(),
                  }),
                  wa_id: z.string(),
                }),
              )
              .optional(),
            messages: z
              .array(
                z.object({
                  id: z.string(),
                  from: z.string(),
                  timestamp: z.string(),
                  type: z.string(),
                  text: z.object({ body: z.string() }).optional(),
                  interactive: z.record(z.unknown()).optional(),
                }),
              )
              .optional(),
            statuses: z
              .array(
                z.object({
                  id: z.string(),
                  status: z.enum(['sent', 'delivered', 'read', 'failed']),
                  timestamp: z.string(),
                  recipient_id: z.string(),
                  errors: z.array(z.record(z.unknown())).optional(),
                }),
              )
              .optional(),
          }),
        }),
      ),
    }),
  ),
});

export type MetaWebhookPayload = z.infer<typeof MetaWebhookPayloadSchema>;

/**
 * WhatsApp Conversation Session Lifecycle States.
 */
export const WhatsAppConversationStateSchema = z.enum([
  'INITIATED',
  'PARSING_LIST',
  'AWAITING_CLARIFICATION',
  'PROVISIONAL_QUOTE_SENT',
  'CONFIRMING_ORDER',
  'SUBMITTED_TO_SHOPKEEPER',
  'AWAITING_CUSTOMER_CHANGE_CONFIRMATION',
  'PAYMENT_PENDING',
  'FULFILLED',
  'EXPIRED',
  'FAILED',
]);

export type WhatsAppConversationState = z.infer<typeof WhatsAppConversationStateSchema>;

/**
 * Outcome category for resolving a parsed item against catalog & inventory.
 */
export const CatalogMatchOutcomeSchema = z.enum([
  'EXACT_MATCH',
  'AMBIGUOUS_OPTIONS',
  'NO_MATCH',
  'OUT_OF_STOCK',
  'INSUFFICIENT_STOCK',
  'UNIT_INCOMPATIBLE',
  'PACKAGE_SIZE_MISMATCH',
  'FRACTIONAL_NOT_AUTHORIZED',
]);

export type CatalogMatchOutcome = z.infer<typeof CatalogMatchOutcomeSchema>;

/**
 * Candidate product from store catalog matching search query.
 */
export const CatalogCandidateProductSchema = z.object({
  id: z.string().uuid(),
  storeId: z.string().uuid(),
  name: z.string().min(1),
  sku: z.string().nullable(),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().min(1),
  unit: ProductUnitSchema,
  isWeightBased: z.boolean(),
  availableQuantity: z.number().nonnegative(),
});

export type CatalogCandidateProduct = z.infer<typeof CatalogCandidateProductSchema>;

/**
 * An individual item resolved and priced in a provisional quote.
 */
export const ResolvedQuoteItemSchema = z.object({
  rawText: z.string().min(1),
  productName: z.string().min(1),
  requestedQuantity: z.number().positive().nullable(),
  requestedUnit: z.string().nullable(),
  outcome: CatalogMatchOutcomeSchema,
  matchedProduct: CatalogCandidateProductSchema.nullable(),
  candidates: z.array(CatalogCandidateProductSchema),
  quantityMilliCatalogUnits: z.string().nullable(), // BigInt encoded as string
  unitPriceCents: z.number().int().nonnegative().nullable(),
  lineTotalCents: z.number().int().nonnegative().nullable(),
  notes: z.string().nullable(),
});

export type ResolvedQuoteItem = z.infer<typeof ResolvedQuoteItemSchema>;

/**
 * Quote finalization status.
 */
export const QuoteFinalizationStatusSchema = z.enum([
  'PROVISIONAL_PENDING_REVIEW',
  'CONFIRMED_BY_CUSTOMER',
  'EXPIRED',
]);

export type QuoteFinalizationStatus = z.infer<typeof QuoteFinalizationStatusSchema>;

/**
 * Complete immutable snapshot of a provisional quote.
 * Persisted durably inside whatsapp.provisional_quotes.items (JSONB).
 *
 * FINANCIAL INTEGRITY & NON-PAYABLE INVARIANTS:
 * - isPayable is strictly `false`. Provisional quotes are informational estimates and
 *   cannot be used as payment authorization or bill of sale under any circumstance.
 * - knownSubtotalMinor represents the sum of strictly resolved and in-stock items.
 * - In the database table `whatsapp.provisional_quotes`, relational column `total_minor`
 *   mirrors `knownSubtotalMinor` solely to satisfy non-null check constraints.
 * - Downstream consumers (order-service, payment-service) MUST deserialize this JSONB snapshot
 *   and explicitly assert `isPayable === true` and `unresolvedCharges.length === 0` before
 *   creating payable orders or initiating payment sessions.
 */
export const ProvisionalQuoteSnapshotSchema = z.object({
  quoteId: z.string().uuid().optional(),
  conversationId: z.string().uuid(),
  storeId: z.string().uuid(),
  quoteVersion: z.number().int().positive(),
  isPayable: z.literal(false),
  finalizationStatus: QuoteFinalizationStatusSchema,
  unresolvedCharges: z.array(z.string()),
  hasUnpricedItems: z.boolean(),
  knownSubtotalMinor: z.number().int().nonnegative(),
  taxMinor: z.number().int().nonnegative(),
  deliveryMinor: z.number().int().nonnegative(),
  estimatedTotalMinor: z.number().int().nonnegative(),
  currency: z.string().min(1),
  items: z.array(ResolvedQuoteItemSchema),
  disclaimer: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export type ProvisionalQuoteSnapshot = z.infer<typeof ProvisionalQuoteSnapshotSchema>;
