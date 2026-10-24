import { z } from 'zod';

/**
 * Standardized Platform Event Metadata Fields.
 * In accordance with ADR-009, all asynchronous domain events published via CloudAMQP
 * and recorded in the Transactional Outbox conform to these core envelope attributes.
 *
 * CRITICAL RELIABILITY & ARCHITECTURAL INVARIANTS:
 * 1. Event Identity (id): Generated once at event occurrence time and durably persisted in the Outbox.
 *    It MUST remain strictly constant across broker retries, consumer redeliveries, and reconnections.
 * 2. At-Least-Once Delivery & Deduplication: Delivery is at-least-once. Consumers MUST deduplicate
 *    using (consumer_name, event.id) within their durable inbox tables. Schema validation alone
 *    does NOT provide durable deduplication or transactional persistence.
 * 3. Transport Isolation: Transport metadata (AMQP exchange, routing key, delivery tag, redelivery flag)
 *    is transient network metadata and MUST NOT mutate the immutable event envelope.
 * 4. Multi-Tenancy Isolation:
 *    - Tenant-scoped events MUST provide a valid canonical RFC 4122 UUIDv4 `store_id`.
 *    - Platform-level events (e.g. system maintenance) MUST NOT specify a `store_id`.
 *    - Tenant identity in event envelopes is DATA, not proof of consumer authorization.
 * 5. Type and Version Consistency:
 *    Event types follow `<domain>.<entity>.<action>.v<version>`. The `.v<N>` suffix MUST strictly
 *    equal the integer `version` field.
 * 6. Timezone Policy:
 *    All event timestamps (`occurred_at`) MUST be formatted as ISO 8601 UTC strings terminating in 'Z'.
 */
const EventMetadataFields = {
  id: z.string().uuid({ message: 'Event ID must be a valid canonical UUIDv4' }),
  type: z
    .string()
    .min(1, { message: 'Event type cannot be empty' })
    .regex(/^[a-z]+(\.[a-z0-9_-]+)+\.v([1-9][0-9]*)$/, {
      message:
        'Event type must follow domain naming convention: <domain>.<entity>.<action>.v<version> with a positive version number (e.g. order.confirmed.v1)',
    }),
  version: z.number().int().positive({ message: 'Schema version must be a positive integer' }),
  occurred_at: z
    .string()
    .datetime({ message: 'occurred_at must be an ISO 8601 UTC timestamp terminating in Z' }),
  source: z.string().min(1, { message: 'Source service name cannot be empty' }),
  correlation_id: z.string().uuid({ message: 'Correlation ID must be a valid UUID' }),
  causation_id: z.string().uuid({ message: 'Causation ID must be a valid UUID' }).optional(),
};

/**
 * Validates that the event type version suffix (.v<N>) strictly matches the version integer field.
 */
function refineTypeMatchesVersion(data: { type: string; version: number }) {
  const match = data.type.match(/\.v([1-9][0-9]*)$/);
  if (!match) return false;
  return Number.parseInt(match[1], 10) === data.version;
}

const typeVersionRefinementMessage = {
  message: 'Event type version suffix (.v<N>) must match the version integer field',
  path: ['version'],
};

/**
 * Base Event Envelope Schema (generalized).
 */
export const EventEnvelopeBaseSchema = z
  .object({
    ...EventMetadataFields,
    store_id: z.string().uuid({ message: 'Store ID must be a valid canonical UUIDv4' }).optional(),
  })
  .refine(refineTypeMatchesVersion, typeVersionRefinementMessage);

export type EventEnvelopeBase = z.infer<typeof EventEnvelopeBaseSchema>;

/**
 * Tenant-Scoped Event Envelope Schema.
 * Mandates a valid canonical UUIDv4 store_id.
 */
export const TenantEventEnvelopeBaseSchema = z
  .object({
    ...EventMetadataFields,
    store_id: z.string().uuid({
      message: 'Store ID is required for tenant-scoped events and must be a valid canonical UUIDv4',
    }),
  })
  .refine(refineTypeMatchesVersion, typeVersionRefinementMessage);

export type TenantEventEnvelopeBase = z.infer<typeof TenantEventEnvelopeBaseSchema>;

/**
 * Platform-Level Event Envelope Schema.
 * Explicitly forbids/omits store_id because platform events operate across stores.
 */
export const PlatformEventEnvelopeBaseSchema = z
  .object({
    ...EventMetadataFields,
    store_id: z
      .undefined({ invalid_type_error: 'Platform-level events must not specify a store_id' })
      .optional(),
  })
  .refine(refineTypeMatchesVersion, typeVersionRefinementMessage);

export type PlatformEventEnvelopeBase = z.infer<typeof PlatformEventEnvelopeBaseSchema>;

/**
 * Helper to construct a typed Tenant-Scoped Event Envelope Schema for any domain payload.
 */
export function createTenantEventEnvelopeSchema<T extends z.ZodTypeAny>(payloadSchema: T) {
  return z
    .object({
      ...EventMetadataFields,
      store_id: z.string().uuid({
        message:
          'Store ID is required for tenant-scoped events and must be a valid canonical UUIDv4',
      }),
      data: payloadSchema,
    })
    .refine(refineTypeMatchesVersion, typeVersionRefinementMessage);
}

/**
 * Helper to construct a typed Platform-Level Event Envelope Schema for any domain payload.
 */
export function createPlatformEventEnvelopeSchema<T extends z.ZodTypeAny>(payloadSchema: T) {
  return z
    .object({
      ...EventMetadataFields,
      store_id: z
        .undefined({ invalid_type_error: 'Platform-level events must not specify a store_id' })
        .optional(),
      data: payloadSchema,
    })
    .refine(refineTypeMatchesVersion, typeVersionRefinementMessage);
}

/**
 * Default alias: domain events in this grocery architecture are tenant-scoped by default.
 */
export const createEventEnvelopeSchema = createTenantEventEnvelopeSchema;
