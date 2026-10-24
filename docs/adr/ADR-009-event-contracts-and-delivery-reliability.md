# ADR-009: Event Contracts, Transactional Outbox/Inbox, CloudAMQP, and Messaging Reliability

## Status
`Proposed`

## Date
2026-10-24 (Revised to Qualify Delivery Limits, Operational Incident Responses, and Transactional Boundaries)

## Decision Owner
Lead Backend Architect / Distributed Systems Specialist

---

## 1. Context

In the proposed microservices architecture, cross-service business processes (such as updating customer order status, sending WhatsApp confirmation messages, generating invoice documents, and refreshing reporting projections) require loose coupling.

Direct synchronous HTTP calls between microservices for notifications and reporting introduce cascading failure domains: if Notification Service or Meta's WhatsApp API is experiencing latency or downtime, an otherwise successful order confirmation could fail.

RabbitMQ is selected as the asynchronous messaging broker, proposed to run on **CloudAMQP** (or a dedicated container, pending budget approval). However, distributed messaging must operate under **at-least-once delivery** realities: network disconnects, broker restarts, worker crashes, and duplicate deliveries will occur.

---

## 2. Mandated Requirements from Approved Specifications

- **Message Broker:** Standardize on **RabbitMQ** with durable exchanges, durable queues, and explicit consumer acknowledgements (Spec v2.0 §3, Baseline v3.0 §12).
- **Transactional Outbox Pattern:** When a service mutates domain state and must emit an event, the business mutation and the outbox event row must be written within the **same local database transaction**. A publisher worker reads pending outbox events, publishes them to RabbitMQ, and marks them published only after broker confirmation (Spec v2.0 §8, Baseline v3.0 §12).
- **Consumer Inbox Pattern:** Consumers must assume messages can be duplicated or delivered out of order. Every consumer must record the processed `event_id` in a durable inbox/deduplication table before or atomically with applying business side effects (Spec v2.0 §8, Baseline v3.0 §12).
- **Event Contract Metadata:** Every event payload must include `event_id`, `event_type`, `schema_version`, `occurred_at`, `producer`, `aggregate_id`, `store_id`, and `correlation_id` (Spec v2.0 §8, Baseline v3.0 §12).
- **Authoritative Data in PostgreSQL:** Authoritative business state resides permanently in PostgreSQL. The message broker is a transient transport mechanism, not the source of truth for order or payment status (Baseline v3.0 §1, §12).
- **No Distributed 2PC:** Distributed Two-Phase Commit across services is explicitly prohibited. Eventual consistency via sagas and outbox is mandatory (Spec v2.0 §7, Baseline v3.0 §1).
- **Dead-Letter Handling:** Failed messages must be retried with exponential backoff and jitter up to a bounded maximum (e.g., 5 attempts), after which they are routed to a Dead-Letter Queue (DLQ) with actionable alerts (Spec v2.0 §9, Baseline v3.0 §12).

---

## 3. Four Distinct Architectural Milestones in Every Operation

To prevent conflating transport status with business status, the architecture explicitly distinguishes four milestones in every cross-service workflow:
1. **Request Authenticated:** The caller identity and signature are verified at the Gateway and service boundary. (Does *not* mean the user is authorized).
2. **Business Operation Authorized:** The system verifies the user has rights to the specified tenant store and resource. (Does *not* mean the state change has succeeded).
3. **Database Transaction Committed:** The business mutation and the outbox record are committed atomically to PostgreSQL. **This is the authoritative point of truth.** (Even if the network drops immediately after, the order or payment status is durably committed).
4. **Event Delivered & Acknowledged:** The asynchronous event is transported via RabbitMQ and acknowledged by the consumer. (This occurs eventually and independently of the HTTP response).

---

## 4. Realistic Distributed Reliability & Limits of Guarantees

> **ABSOLUTE ARCHITECTURAL RULE:**  
> We **NEVER claim zero event loss or exactly-once delivery**. Transient network partitions, hard broker disk failures, consumer crashes, and third-party API downtimes occur. Reliability is achieved through **at-least-once delivery + durable local outbox persistence + consumer inbox deduplication**.

### 4.1 Outbox Commit & Publisher Semantics
1. **Atomic Local Persistence:** When an order transitions to `CONFIRMED`, the business state mutation and an `outbox_events` row are committed inside the same local PostgreSQL transaction.
   - If the database transaction rolls back, neither the order confirmation nor the outbox event exists.
   - If the database transaction commits, the event is durably recorded in PostgreSQL.
2. **Polling Publisher with Publisher Confirms:**  
   The `reconciliation-worker` runs a polling loop:
   ```sql
   SELECT id, event_id, event_type, payload, store_id 
   FROM order.outbox_events 
   WHERE published_at IS NULL AND retry_count < 10
   ORDER BY created_at ASC 
   LIMIT 50 
   FOR UPDATE SKIP LOCKED;
   ```
   The worker publishes each event to RabbitMQ using **publisher confirms** (`confirmSelect`). The outbox row is updated (`published_at = NOW()`) **only after the broker confirms receipt**. If the worker crashes mid-publish, the row remains unpublished and is retried on restart.

### 4.2 Consumer Acknowledgement & Inbox Deduplication
Consumers process events under strict ordering:
1. Receive message from RabbitMQ (unacknowledged).
2. Begin local PostgreSQL transaction in consumer's schema:
   - Attempt to insert `event_id` into `inbox_events (event_id UUID PRIMARY KEY)`.
   - If duplicate (`23505 unique_violation`), commit transaction immediately and call `channel.ack(msg)` to safely drop the duplicate.
   - If unique, execute business effect (e.g. update projection or schedule notification), insert `inbox_events`, and commit transaction.
3. Call `channel.ack(msg)` **only after local database commit succeeds**.
4. If process crashes before `channel.ack(msg)`, RabbitMQ redelivers the message to another worker. The new worker encounters the committed `inbox_events` record, acknowledges the message, and performs zero duplicate side effects.

---

## 5. Operational Response Matrix for Message Failure Scenarios

| Failure Scenario | System Behavior & Limits of Guarantee | Operational Response / Runbook Action |
| :--- | :--- | :--- |
| **1. Broker Unavailable (CloudAMQP Outage)** | PostgreSQL commits continue normally. Outbox table buffers unpublished events. Real-time notifications stop temporarily. | Publisher worker enters exponential backoff reconnect loop (1s, 2s, 5s, 15s). Alert triggers after 60s outage. When broker recovers, worker flushes backlog in order. |
| **2. Exhausted Retries (Poison Message)** | Consumer retries 5 times with exponential backoff and jitter. On 5th failure, message is routed to `grocery.dlx` $\rightarrow$ `dead_letter.queue`. | Immediate P2 alert fired to engineering. Operator uses CLI script (`npm run queue:inspect-dlq`) to inspect stack trace and payload defect. |
| **3. Duplicate Delivery (Network Redelivery)** | RabbitMQ delivers the same message twice due to network timeout on ACK. | Handled automatically by database constraint on `inbox_events`. Second message detected as duplicate, logged, and acknowledged with zero side effects. |
| **4. Failed DLQ Replay** | Operator attempts replay of a poisoned message, but downstream bug is still unpatched. | Replayed message fails again and is caught back in `grocery.dlx`. Operator must fix downstream code or patch payload before re-attempting replay. |

---

## 6. Proposed Decision

1. **Adopt CloudAMQP for Staging and Production (Proposed):**  
   Use local Docker Compose RabbitMQ for development; point staging and production environments to CloudAMQP via secure AMQPS URL (`amqps://...`), pending owner budget approval.
2. **Standardize Event Envelope Schema in `packages/event-contracts`:**
   ```typescript
   export interface DomainEventEnvelope<T = unknown> {
     eventId: string;             // UUIDv4
     eventType: string;           // e.g. "order.confirmed.v1"
     schemaVersion: number;       // e.g. 1
     occurredAt: string;          // ISO-8601 UTC timestamp
     producer: string;            // e.g. "order-service"
     aggregateId: string;         // e.g. orderId
     storeId: string;             // UUID of tenant store
     correlationId: string;       // X-Correlation-ID for tracing
     payload: T;                  // Domain-specific payload
   }
   ```
3. **Consumer Inbox Schema per Service:**
   ```sql
   CREATE TABLE inbox_events (
     event_id UUID PRIMARY KEY,
     consumer_name VARCHAR(64) NOT NULL,
     processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   ```

---

## 7. Consequences and Trade-offs

- **Positive:** Proven distributed reliability without complex 2PC; resilience against broker downtime and container restarts; authoritative state remains in PostgreSQL.
- **Negative:** Asynchronous latency (sub-second); CloudAMQP tier limits must be budgeted and monitored.

---

## 8. Testing and Acceptance Criteria

- **Broker Disconnect Outbox Test:** Sever connection to RabbitMQ; place an order; verify order commits to PostgreSQL; reconnect RabbitMQ; verify outbox flushes message and WhatsApp notification is sent.
- **Consumer Crash Test:** Kill consumer container immediately after receiving message; verify replacement container safely resumes without duplicate notifications.
- **DLQ Poison Message Test:** Send intentionally malformed message; verify it is routed to `grocery.dlx` after 5 failed attempts without crashing the worker.

---

## 9. Dependencies

- **Predecessor:** [ADR-001](./ADR-001-microservice-boundaries-and-frontend.md), [ADR-002](./ADR-002-database-ownership-and-tenant-isolation.md), [ADR-008](./ADR-008-hosting-secrets-backups-and-recovery.md).
- **Successor:** [ADR-006](./ADR-006-whatsapp-integration-and-tenant-mapping.md), [ADR-007](./ADR-007-order-review-and-inventory-reservation.md).

---

## 10. Explicit Owner Approval Required

- **Lead Backend Architect:** Approval of outbox polling parameters and RabbitMQ exchange/queue naming convention.
- **Business Owner:** Approval of CloudAMQP hosting budget for staging and production.

---

## 11. Unresolved Questions

1. Which CloudAMQP plan (Free Little Lemur for staging vs Paid Tiger plan for production) is approved?
2. What is the dead-letter message retention period (recommended: 14 days before auto-expire)?
