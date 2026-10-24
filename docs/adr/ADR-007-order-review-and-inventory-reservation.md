# ADR-007: Order Review Workflow, Inventory Reservation Invariants, and Cancellation Saga

## Status
`Proposed`

## Date
2026-10-24

## Decision Owner
Application Architect / Lead Backend Engineer

---

## 1. Context

Grocery ordering has unique domain constraints: items may be weighed at pickup, produce quality can vary, stock counts may shift dynamically in a physical store, and customers often request custom items via WhatsApp.

A naive e-commerce workflow that immediately reserves stock and collects payment at submission will fail in a neighborhood grocery setting, causing high cancellation and refund rates.

Both approved architecture documents establish a fundamental business invariant: **incoming orders are not immediate stock reservations; they must first undergo shopkeeper review and confirmation.**

---

## 2. Mandated Requirements from Approved Specifications

- **Review-Before-Reservation Invariant:** An incoming order begins in `AWAITING_SHOPKEEPER_REVIEW`. It is not a stock guarantee. Inventory is reserved **only when the shopkeeper reviews, adjusts if necessary, and explicitly confirms the order** (Spec v2.0 §2, §5.A, Baseline v3.0 §5, §6.A).
- **Atomic All-or-Nothing Stock Reservation:** When reservation is requested, the Inventory service must atomically check and reserve all requested items or none. It must never partially reserve stock or silently oversell (Spec v2.0 §7, Baseline v3.0 §7).
- **Stable SKU Lock Ordering:** To prevent deadlocks under high concurrent reservation load, items must be locked in a deterministic, stable sort order (e.g. sorted ascending by `product_id` / `sku_id`) (Spec v2.0 §7, Baseline v3.0 §7).
- **Append-Only Stock Ledger:** Every inventory movement (receipt, sale, reservation, release, adjustment, shrinkage) must be recorded in an immutable ledger (Spec v2.0 §6, Baseline v3.0 §7).
- **Saga & Compensation:** Cross-service workflows (Order $\rightarrow$ Inventory $\rightarrow$ Payment $\rightarrow$ Billing) must be coordinated using a persisted saga state record with explicit timeouts and idempotent compensating actions (Spec v2.0 §8, Baseline v3.0 §6.B).
- **Idempotency:** Order creation, shopkeeper revisions, stock reservations, and cancellations must accept an `Idempotency-Key` (Spec v2.0 §9, Baseline v3.0 §12).

---

## 3. Options Considered

### A. Reservation Timing
- **Option 1 (Mandated Architecture): Reservation upon Shopkeeper Confirmation:**  
  Order is submitted $\rightarrow$ `AWAITING_SHOPKEEPER_REVIEW` $\rightarrow$ shopkeeper adjusts quantities/substitutions $\rightarrow$ shopkeeper clicks "Confirm & Reserve" $\rightarrow$ Inventory atomically locks and reserves stock $\rightarrow$ Order transitions to `CONFIRMED`.
- **Option 2 (Traditional E-Commerce): Reservation at Initial Submission:**  
  Order locks stock immediately upon customer cart submission. If shopkeeper takes 30 minutes to review, physical walk-in customers are blocked from buying available stock.
- *Verdict:* Option 1 is mandated by the approved specifications and cannot be altered without an explicit signed change request.

### B. Concurrency Control in Inventory
- **Option C1: Atomic Conditional SQL Update (`WHERE available_quantity >= $requested`):**  
  Execute atomic SQL update and verify affected rows equals the number of items.
- **Option C2: Row-Level Locking (`SELECT ... FOR UPDATE` with Stable SKU Sort):**  
  Sort requested items by SKU ascending, lock matching inventory balance rows within a transaction, evaluate availability, insert reservation items, and commit.
- **Option C3: Optimistic Concurrency with Version Columns:**  
  Relying on version counters and application-level retry loops.

---

## 4. Advantages and Disadvantages

### Concurrency Options
- **Option C2 (Row-Level Locking with Sorted SKUs):**
  - *Advantages:* 100% deterministic; completely eliminates database deadlocks; handles multi-item all-or-nothing reservations cleanly; provides clear locking semantics.
  - *Disadvantages:* Slightly longer transaction hold time (mitigated by keeping transactions microsecond-short).
- **Option C1 (Conditional Update):**
  - *Advantages:* Very fast for single-item reservations.
  - *Disadvantages:* Complex rollback logic when item 3 of 5 fails midway through a multi-item batch.

---

## 5. Proposed Decision

1. **Order State Machine Definition:**
   ```text
   [RECEIVED]
       │
       ▼
   [AWAITING_SHOPKEEPER_REVIEW] ◄─── (Customer proposes order or WhatsApp list)
       │
       ├─► [CHANGE_REQUESTED] (Shopkeeper revises items/substitutions; customer re-confirms)
       │
       ├─► [REJECTED] (Terminal state; stock never reserved)
       │
       ▼ (Shopkeeper confirms)
   [CONFIRMATION_PENDING_RESERVATION]
       │
       ├─► reservation fails ──► returns to [AWAITING_SHOPKEEPER_REVIEW] or [FAILED]
       │
       ▼ (Reservation succeeds)
   [CONFIRMED] ──► (Triggers Invoice Snapshot & Payment Link creation)
       │
       ▼
   [PREPARING] ──► [READY_FOR_PICKUP / DISPATCHED] ──► [COMPLETED / DELIVERED]
       │
       ▼ (If cancelled by customer or staff before dispatch)
   [CANCELLED] ──► (Triggers Saga Compensation: Idempotent Stock Release & Refund)
   ```
2. **Deterministic Multi-Item Reservation Implementation:**  
   In `inventory-service`, multi-item reservations execute in a single database transaction:
   ```sql
   -- 1. Sort SKUs ascending to avoid deadlocks
   SELECT sku_id, available_quantity, reserved_quantity 
   FROM stock_balances 
   WHERE store_id = $1 AND sku_id = ANY($2::uuid[])
   ORDER BY sku_id ASC 
   FOR UPDATE;

   -- 2. Verify: FOR ALL items, available_quantity >= requested_quantity
   -- 3. If any item is insufficient: ROLLBACK transaction and return INSUFFICIENT_STOCK
   -- 4. If all sufficient: 
   --    UPDATE stock_balances SET available_quantity = available_quantity - $qty, reserved_quantity = reserved_quantity + $qty;
   --    INSERT INTO reservations (...);
   --    INSERT INTO stock_movements (..., delta = -$qty, reason = 'RESERVATION');
   --    COMMIT;
   ```
3. **Reservation Expiry Worker:**  
   Reservations carry an `expires_at` timestamp (default: 4 hours from confirmation or pickup window end). A scheduled background worker checks for expired unfulfilled reservations and releases the stock via idempotent compensation.
4. **Idempotency Enforcement:**  
   Order state transitions record an `idempotency_key` and previous state. Retried requests with the same key return the recorded response without re-executing transitions.

---

## 6. Consequences and Trade-offs

- **Positive:** Guarantees zero overselling; physical store inventory is not artificially frozen by unconfirmed cart submissions; eliminates concurrency deadlocks.
- **Negative:** If shopkeeper takes too long to review, products may sell out to walk-in customers before review is completed, requiring the shopkeeper to propose substitutions.

---

## 7. Security and Tenant-Isolation Implications

- Order review actions require verified staff/admin roles (`req.user.role IN ('OWNER', 'MANAGER', 'STAFF')`).
- Staff can only view and mutate orders matching their authenticated `store_id`.

---

## 8. Reliability and Failure-Recovery Implications

- The Order Saga coordinator persists each step in an `order_sagas` table:
  - Step 1: `RESERVE_INVENTORY`
  - Step 2: `GENERATE_INVOICE`
  - Step 3: `CREATE_PAYMENT_LINK`
  - Step 4: `DISPATCH_NOTIFICATIONS`
- If the service process crashes midway, the saga worker resumes from the last completed step.
- Compensating actions (releasing inventory on cancellation) are strictly idempotent.

---

## 9. Testing and Acceptance Criteria

- **100-Concurrent-Requests Concurrency Gate:** Given 10 units available of SKU X, fire 100 simultaneous reservation requests for 1 unit each. Verify exactly 10 succeed, 90 fail with `INSUFFICIENT_STOCK`, and available quantity ends at exactly 0.
- **Order State Gate:** Verify an order cannot transition directly from `AWAITING_SHOPKEEPER_REVIEW` to `CONFIRMED` without an explicit successful reservation record.

---

## 10. Dependencies

- **Predecessor:** [ADR-001](./ADR-001-microservice-boundaries-and-frontend.md), [ADR-002](./ADR-002-database-ownership-and-tenant-isolation.md), [ADR-010](./ADR-010-product-units-variants-and-pricing.md).
- **Successor:** [ADR-004](./ADR-004-payment-provider-and-reconciliation.md), [ADR-005](./ADR-005-tax-invoicing-and-rounding.md), [ADR-009](./ADR-009-event-contracts-and-delivery-reliability.md).

---

## 11. Explicit Owner Approval Required

- **Lead Engineer / Application Architect:** Ratification of the deterministic SKU sorting and order saga structure.
- **Product Owner:** Confirmation of shopkeeper review timeout and reservation expiration durations.

---

## 12. Unresolved Questions

1. What is the standard timeout for shopkeeper review before an order is automatically cancelled or flagged (e.g., 30 minutes vs. 2 hours)?
2. What is the reservation expiration duration if the customer does not complete payment or pick up the order?
