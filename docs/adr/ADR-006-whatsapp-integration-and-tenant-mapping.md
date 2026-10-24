# ADR-006: WhatsApp Business Cloud API, Tenant Mapping, and Notification Reliability

## Status
`Proposed`

## Date
2026-10-24

## Decision Owner
Product Owner / WhatsApp Operations Lead

---

## 1. Context

WhatsApp is a core customer interaction channel for this platform. Customers browse grocery catalogs, send grocery lists or order intents, receive shopkeeper confirmations, review itemized bills, receive payment links, and track delivery or pickup notifications directly inside WhatsApp.

The architecture must support the official **WhatsApp Business Platform Cloud API** (hosted by Meta) while maintaining multi-tenant isolation, protecting against forged webhooks, deduplicating retried inbound messages, respecting Meta's 24-hour conversation window rules, and preventing outbound messaging failures from corrupting order transactions.

---

## 2. Mandated Requirements from Approved Specifications

- **Official Provider:** Integration must use the official WhatsApp Business Platform Cloud API unless an approved alternative is recorded (Spec v2.0 §3, Baseline v3.0 §10).
- **Tenant Mapping Invariant:** Webhook requests do not carry trusted tenant IDs. The platform must resolve the target store tenant by mapping the incoming verified provider business phone number (`metadata.phone_number_id` or `display_phone_number`) against store tenant configuration. Webhooks for unknown or unverified numbers must be rejected (Spec v2.0 §5.B, Baseline v3.0 §4, §10).
- **Webhook Signature Verification:** Validate the `X-Hub-Signature-256` header against the raw incoming request body using Meta's app secret. Processing an unverified webhook payload is strictly prohibited (Spec v2.0 §10, Baseline v3.0 §8, §10).
- **Inbound Message Deduplication:** Persist provider `message_id` in a unique constraint table before processing. Duplicate webhook deliveries must return `200 OK` and trigger zero duplicate business actions or replies (Spec v2.0 §5.B, Baseline v3.0 §10).
- **Asynchronous Isolation:** Outbound notifications must be queued asynchronously via RabbitMQ. A WhatsApp provider timeout or outage must never roll back or prevent an order from being placed or confirmed (Spec v2.0 §5, §12, Baseline v3.0 §4, §10).

---

## 3. Options Considered

### A. WhatsApp Cloud API Architecture
- **Option 1: Multi-Tenant Single WABA (WhatsApp Business Account) with Dedicated Phone Numbers:**  
  The platform operates an authorized Meta WhatsApp Business Account (WABA). Each merchant is assigned or brings a verified Phone Number ID configured under the platform WABA or via Meta Tech Provider embedded signup.
- **Option 2: Individual WABA Credentials per Tenant:**  
  Each merchant provides their own standalone Meta App ID, Token, and Webhook URL.
- **Option 3: Third-Party Aggregator (Twilio, Gupshup, Wati):**  
  Interfacing with WhatsApp through an intermediary SaaS aggregator.

### B. Inbound Conversation State Handling
- **Option C1: Explicit State Machine (Catalog Browse $\rightarrow$ Order Intent $\rightarrow$ Review $\rightarrow$ Payment Link):**  
  Conversations maintain a persisted state record (`conversation_states` table) with structured prompts and strict clarification rules for ambiguous text.
- **Option C2: Unstructured Free-Text Parser:**  
  Heuristic or LLM parsing directly translating natural text into immediate submitted orders.

---

## 4. Advantages and Disadvantages

### API Architecture Comparison
- **Option 1 (Platform WABA with Number Mapping):**
  - *Advantages:* Centralized webhook endpoint (`/api/v1/webhooks/whatsapp`); uniform template approvals; streamlined onboarding for small grocery shopkeepers.
  - *Disadvantages:* Requires Meta Tech Provider / Business Manager verification.
- **Option 2 (Individual WABAs):**
  - *Disadvantages:* Severe webhook configuration nightmare (requires dynamic routing or hundreds of separate endpoints); rejected as unmaintainable.
- **Option 3 (Aggregator):**
  - *Advantages:* Simplified setup.
  - *Disadvantages:* Added monthly cost and per-message markup; conflicts with baseline's direct Cloud API requirement.

### Conversation Handling Comparison
- **Option C1 (Explicit State Machine):**
  - *Advantages:* Enforces the core invariant that ambiguous messages trigger clarifying questions rather than accidental phantom orders; replay-safe.
  - *Disadvantages:* Requires state storage and TTL expiration for stale sessions.

---

## 5. Proposed Decision

1. **Adopt Official WhatsApp Cloud API with Phone Number Mapping (Option 1):**  
   Configure a single centralized webhook endpoint in `apps/notification-service`: `POST /api/v1/webhooks/whatsapp`.  
   Store lookup table `store_whatsapp_channels`:
   - `store_id UUID NOT NULL REFERENCES stores(id)`
   - `phone_number_id VARCHAR(64) UNIQUE NOT NULL`
   - `display_phone_number VARCHAR(32) NOT NULL`
   - `waba_id VARCHAR(64) NOT NULL`
   - `is_active BOOLEAN NOT NULL DEFAULT TRUE`
2. **Raw Body HMAC-SHA256 Signature Verification:**  
   The gateway captures the raw buffer of the incoming POST body. The webhook middleware computes `crypto.createHmac('sha256', META_APP_SECRET).update(rawBody).digest('hex')` and validates against `X-Hub-Signature-256` using timing-safe equality.
3. **Inbound Message Deduplication:**  
   Incoming messages are inserted into `inbound_whatsapp_messages`:
   - `provider_message_id VARCHAR(128) PRIMARY KEY`
   - `store_id UUID NOT NULL`
   - `sender_phone_e164 VARCHAR(32) NOT NULL`
   - `payload JSONB NOT NULL`
   - `processed_at TIMESTAMPTZ`  
   Duplicate deliveries trigger an immediate `200 OK` return.
4. **Conversation Window & Template Enforcement:**  
   - Within the 24-hour service window: free-form messages, order lists, and interactive buttons may be sent.
   - Outside the 24-hour window: messages must strictly use pre-approved Meta message templates (`order_confirmation_v1`, `payment_link_v1`, `out_for_delivery_v1`).
5. **Customer Consent & Opt-Out:**  
   Recognize standard keywords (`STOP`, `UNSUBSCRIBE`, `START`). Record customer opt-out state in `customer_communication_preferences`. Never send marketing or template messages to opted-out numbers.

---

## 6. Consequences and Trade-offs

- **Positive:** Complies with Meta's developer policies; complete tenant isolation across stores; zero lost orders from duplicate webhooks.
- **Negative:** WhatsApp Business Account verification and template approvals introduce pre-launch lead time.

---

## 7. Security and Tenant-Isolation Implications

- If a webhook originates from an unknown `phone_number_id`, it is logged and dropped immediately.
- Tenant access tokens and Meta System User tokens are stored securely in environment secret stores and decrypted only within `notification-service`.

---

## 8. Reliability and Failure-Recovery Implications

- Outbound notifications are queued in RabbitMQ (`grocery.notifications.whatsapp`).
- Worker retries with exponential backoff (e.g. 1s, 5s, 30s, 2m, 10m) upon encountering HTTP 429 (rate limits) or 500 (Meta service outage). After 5 failed attempts, messages route to DLQ.
- Delivery receipts (`sent`, `delivered`, `read`, `failed`) update `notification_attempts` table.

---

## 9. Testing and Acceptance Criteria

- **Signature Verification Test:** Send webhook with tampered body; verify rejection with `401/403`.
- **Tenant Mapping Test:** Webhook for Store A's number cannot access or create an order in Store B.
- **Duplicate Webhook Test:** Send identical webhook 3 times; verify customer receives exactly one reply.

---

## 10. Dependencies

- **Predecessor:** [ADR-001](./ADR-001-microservice-boundaries-and-frontend.md), [ADR-002](./ADR-002-database-ownership-and-tenant-isolation.md), [ADR-003](./ADR-003-authentication-and-identity-linking.md).
- **Successor:** [ADR-007](./ADR-007-order-review-and-inventory-reservation.md), [ADR-009](./ADR-009-event-contracts-and-delivery-reliability.md).

---

## 11. Explicit Owner Approval Required

- **Product Owner:** Sign-off on conversation state flow, clarification rules, and opt-out policy.
- **WhatsApp Operations Lead:** Setup and authorization of Meta Business Manager, WABA account, and approved message templates.

---

## 12. Unresolved Questions

1. Has a Meta WhatsApp Business Account (WABA) already been provisioned with verified business status?
2. Which specific message templates (names and language codes) will be registered with Meta?
3. What is the opt-in consent mechanism for customers who order primarily via the web interface?
