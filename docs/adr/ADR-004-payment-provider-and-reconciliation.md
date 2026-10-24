# ADR-004: Payment Provider Integration, Payment Links, Idempotency, and Reconciliation

## Status
`Proposed`

## Date
2026-10-24

## Decision Owner
Product / Business Owner & Finance Lead

---

## 1. Context

In the grocery ordering workflow, once a shopkeeper confirms an order, the system must generate a secure payment link and deliver it to the customer via WhatsApp and/or email. The customer uses this link to complete digital payment.

Because network calls can timeout, webhooks may arrive out-of-order or duplicate, and customer payments may be interrupted, the payment architecture must prioritize correctness, replay safety, and autonomous reconciliation over naive optimistic assumptions.

No payment provider has been pre-selected. This decision evaluates provider requirements and establishes the core payment state machine and reconciliation invariants.

---

## 2. Mandated Requirements from Approved Specifications

- **Non-Authoritative Client Redirects:** A client browser claiming payment success must never mark an order as paid. Payment confirmation is authoritative only via verified webhook signatures or direct server-to-server reconciliation (Spec v2.0 §5.C, Baseline v3.0 §8).
- **Payment Link Lifecycle:** Payment links are generated only for confirmed order snapshots with server-verified totals in integer minor units (Spec v2.0 §5.C, Baseline v3.0 §8).
- **Webhook Security & Deduplication:** Webhook payloads must be cryptographically verified using raw request bodies and secret signing keys. Webhook event IDs must be persisted with uniqueness constraints before applying state transitions (Spec v2.0 §5.C, Baseline v3.0 §8).
- **Reconciliation of Uncertain States:** If a payment gateway call times out or returns an ambiguous status, the state must be recorded as `UNKNOWN`/`PENDING_RECONCILIATION`. The system must never create a second charge blindly without polling the provider (Spec v2.0 §9, Baseline v3.0 §8).
- **Refund Policy:** Refunds are distinct domain records with explicit states (`PENDING`, `SUCCEEDED`, `FAILED`). A failed refund does not cancel the fact that an original payment succeeded (Baseline v3.0 §5, §8).

---

## 3. Options Considered

### A. Candidate Payment Providers
- **Option P1: Razorpay (Standard for Indian INR Grocery & UPI Workflows):** Native Payment Links API, UPI intent, robust webhook HMAC-SHA256 signatures, comprehensive sandbox environment.
- **Option P2: Stripe:** Global leader in checkout sessions, payment links, and idempotency headers (`Idempotency-Key`), comprehensive test environment and CLI.
- **Option P3: Cashfree / PhonePe Payment Gateway:** Strong regional support for Indian retail payment workflows.

### B. Payment Integration Pattern
- **Option I1: Provider-Agnostic Adapter Pattern with Dedicated `grocery_payment` Database:**  
  Implement a clean domain interface (`PaymentGatewayPort`) with an explicit payment attempts ledger, provider webhook inbox, and scheduled reconciliation worker.
- **Option I2: Direct Tight-Coupled Integration:**  
  Hardcoding provider API calls directly inside the order processing code.

---

## 4. Advantages and Disadvantages

### Integration Pattern Comparison
- **Option I1 (Adapter Pattern with Separate State Machine):**
  - *Advantages:* Decouples Order Service from third-party gateway changes; provider selection can be finalized without rewriting order processing logic; enforces strict deduplication and auditability.
  - *Disadvantages:* Requires maintaining adapter mapping layers.
- **Option I2 (Direct Coupled Integration):**
  - *Disadvantages:* Fails specifications; breaks microservice data boundaries; extreme risk of duplicate billing.

---

## 5. Proposed Decision

1. **Adopt Provider-Agnostic Adapter Architecture:**  
   Implement `PaymentService` utilizing the Hexagonal/Adapter pattern. Define the domain contract:
   - `createPaymentLink(params: CreatePaymentLinkParams): Promise<PaymentLinkResult>`
   - `verifyWebhookSignature(rawBody: Buffer, signature: string): boolean`
   - `fetchPaymentStatus(providerReference: string): Promise<PaymentStatusResult>`
   - `initiateRefund(params: RefundParams): Promise<RefundResult>`
2. **Standardize Payment State Machine:**
   ```text
   [CREATED]
       │
       ▼
   [PENDING_PROVIDER] ──── timeout ────► [UNKNOWN / PENDING_RECONCILIATION]
       │                                              │
       ├──────── webhook: success ───┐                │ reconciliation cron
       ▼                             ▼                ▼
     [PAID]                       [PAID]           [FAILED]
       │
       ▼ (if order cancelled)
   [REFUND_PENDING] ──► [REFUNDED] or [REFUND_FAILED]
   ```
3. **Webhook Idempotency & Inbox Table:**  
   Store every inbound webhook in a `provider_event_inbox` table with unique constraint `(provider, provider_event_id)`. If an event ID already exists, acknowledge `200 OK` immediately without re-triggering order status updates.
4. **Reconciliation Cron Job:**  
   A background worker executes every 5 minutes, scanning for payment attempts stuck in `PENDING_PROVIDER` or `UNKNOWN` for longer than 15 minutes, querying the provider API, and updating status accordingly.

---

## 6. Consequences and Trade-offs

- **Positive:** Zero risk of blind duplicate billing; resilient against network drops; webhook replays are safe and idempotent.
- **Negative:** Requires background scheduled worker infrastructure for reconciliation.

---

## 7. Security and Tenant-Isolation Implications

- Raw webhook body must be captured before JSON body-parsing middleware mutates character encoding, ensuring HMAC-SHA256 signature verification does not fail.
- Webhook secret keys are stored in environment variables, separate per environment.
- Payment links are tied to specific `store_id` and `order_id` values.

---

## 8. Reliability and Failure-Recovery Implications

- If the payment gateway suffers an outage, orders remain in `CONFIRMED` state; customers can be prompted to retry or pay via cash on pickup/delivery.
- The transactional outbox pattern publishes `PaymentAuthorized` only after the local payment state commits to PostgreSQL.

---

## 9. Testing and Acceptance Criteria

- **Webhook Duplicate Test:** Fire the same `payment.captured` webhook 5 times concurrently; verify exactly one `PaymentAuthorized` event is published and payment is credited once.
- **Timeout Reconciliation Test:** Simulate provider timeout on creation; verify state transitions to `UNKNOWN` and reconciliation worker transitions it to `PAID` or `FAILED`.

---

## 10. Dependencies

- **Predecessor:** [ADR-001](./ADR-001-microservice-boundaries-and-frontend.md), [ADR-002](./ADR-002-database-ownership-and-tenant-isolation.md).
- **Successor:** [ADR-005](./ADR-005-tax-invoicing-and-rounding.md), [ADR-007](./ADR-007-order-review-and-inventory-reservation.md).

---

## 11. Explicit Owner Approval Required

- **Product / Business Owner:** Explicit selection and approval of the specific payment provider (e.g. Razorpay vs. Stripe).
- **Finance Lead:** Approval of refund authorization policies and reconciliation windows.

---

## 12. Unresolved Questions

1. Which specific payment provider is officially selected for production and sandbox environments?
2. What is the merchant fee policy: will gateway transaction fees be absorbed by the store or surcharged?
3. What is the expiration window for a generated payment link (e.g., 60 minutes vs. 24 hours)?
