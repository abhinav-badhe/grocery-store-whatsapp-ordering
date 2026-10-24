# ADR-005: Tax Calculation, Invoicing Rules, Rounding Precision, and Credit Notes

## Status
`Proposed`

## Date
2026-10-24

## Decision Owner
Finance Lead / Tax Accountant / Business Owner

---

## 1. Context

When a grocery order is reviewed and confirmed by the shopkeeper, the Billing module/service generates an itemized invoice. Invoices must comply with legal standards, provide clear transparency to the customer, and ensure zero floating-point discrepancies across payment, tax calculations, and bookkeeping.

Price changes in the product catalog must never retroactively alter historical invoices. In addition, when an order is cancelled or refunded post-invoicing, formal accounting principles require issuing a credit note rather than mutating or deleting historical invoice records.

---

## 2. Mandated Requirements from Approved Specifications

- **Money Representation Invariant:** Represent all monetary amounts using integer minor units (e.g. paise, cents) or PostgreSQL `NUMERIC` with explicit documented scale. The use of IEEE 754 floating-point arithmetic for financial calculations is strictly prohibited (Spec v2.0 §7, Baseline v3.0 §7, §8).
- **Immutable Invoice Snapshots:** Order items, prices, applied discounts, and tax rates must be frozen into immutable invoice snapshots upon creation. Future changes to catalog prices must never alter issued invoices (Spec v2.0 §7, Baseline v3.0 §5, §8).
- **Sequential Invoice Numbering:** Each store tenant must maintain a continuous, auditable, gapless or tracked sequential invoice sequence (e.g., `INV-STORE-2026-00001`) (Baseline v3.0 §5, §8).
- **Credit Notes:** Cancellations of paid or invoiced orders require generating a corresponding Credit Note snapshot to balance the financial ledger (Baseline v3.0 §5, §8).

---

## 3. Options Considered

### A. Price Display and Tax Computation
- **Option 1: Tax-Inclusive Catalog Pricing:**  
  Catalog prices displayed to customers already include all applicable taxes. Tax components (e.g., CGST/SGST or VAT) are back-calculated for reporting and invoicing.
- **Option 2: Tax-Exclusive Catalog Pricing:**  
  Catalog prices are net of tax; tax percentages are calculated and added at checkout.
- **Option 3: Hybrid / Category-Specific Tax Rules:**  
  Fresh produce (zero-tax / exempt) alongside packaged goods with variable tax rates.

### B. Rounding Strategy
- **Option R1: Half-Up Rounding on Line Items (Integer Minor Units):**  
  Line totals are computed as `Math.round(quantity * unit_price_minor_units)` and summed.
- **Option R2: Subtotal Rounding:**  
  Line items retain fractional minor units during aggregation and round only at the final invoice total.

---

## 4. Advantages and Disadvantages

### Price Display Comparison
- **Option 1 (Tax-Inclusive):** Standard for Indian and UK retail groceries; prevents checkout price surprise for customers.
- **Option 2 (Tax-Exclusive):** Standard in US B2B/retail; can cause customer abandonment if unexpected taxes appear on WhatsApp order summaries.
- *Recommendation:* Tax-inclusive display is recommended for retail grocery, subject to finance confirmation.

### Rounding Comparison
- **Option R1 (Half-Up on Line Items):**
  - *Advantages:* Transparent itemized bill where each line item price visibly multiplies to its line total; eliminates customer confusion where individual displayed lines do not sum up to the total.
  - *Disadvantages:* Micro-differences compared to pure continuous aggregation (negligible in retail).

---

## 5. Proposed Decision

1. **Integer Minor Unit Currency Representation:**  
   All monetary amounts across APIs, database columns, and RabbitMQ payloads will be stored as `BIGINT` representing minor units (e.g., Indian Paise: ₹10.50 is stored as `1050`).
2. **Immutable Snapshot Entities:**  
   Define `invoices` and `invoice_line_snapshots` tables in `grocery_order` / `billing`:
   - `invoice_id UUID PRIMARY KEY`
   - `store_id UUID NOT NULL`
   - `order_id UUID NOT NULL REFERENCES orders(id)`
   - `invoice_number VARCHAR(64) NOT NULL` (unique per store)
   - `subtotal_minor BIGINT NOT NULL`
   - `tax_total_minor BIGINT NOT NULL`
   - `grand_total_minor BIGINT NOT NULL`
   - `currency VARCHAR(3) NOT NULL DEFAULT 'INR'`
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
3. **Sequential Counter Mechanism:**  
   Maintain an atomic `invoice_sequences` table per store (`store_id`, `fiscal_year`, `current_sequence`) utilizing PostgreSQL row locking (`SELECT ... FOR UPDATE`) during invoice creation to guarantee gapless monotonic numbering.
4. **Credit Note Workflow:**  
   When an invoiced order is cancelled, the system creates a `credit_notes` record referencing `invoice_id` with negated line items and issues a Credit Note document.

---

## 6. Consequences and Trade-offs

- **Positive:** Zero risk of JavaScript floating-point rounding bugs (e.g. `0.1 + 0.2 = 0.30000000000000004`); clean compliance with legal accounting and audit requirements.
- **Negative:** Display layers must always format minor units into major currency strings (e.g. `(minor / 100).toFixed(2)`).

---

## 7. Security and Tenant-Isolation Implications

- Invoice sequences are scoped by `store_id`. Store A cannot inspect or consume Store B's invoice numbers.
- Public invoice download URLs (PDF receipts) must use cryptographically signed time-limited URLs or require authenticated sessions.

---

## 8. Reliability and Failure-Recovery Implications

- Invoice generation is triggered locally within the Order confirmation transaction or immediately after reservation confirmation via the outbox pattern.
- If PDF generation fails, the underlying raw invoice record is already safe in PostgreSQL; the PDF can be regenerated asynchronously.

---

## 9. Testing and Acceptance Criteria

- **Arithmetic Precision Test:** Verify calculations across fractional quantities (e.g., 1.35 kg at ₹45.00/kg) confirm exact integer rounding without precision drift.
- **Sequence Uniqueness Test:** Concurrently generate 50 invoices for Store A; verify all 50 receive strictly sequential, non-duplicate numbers.

---

## 10. Dependencies

- **Predecessor:** [ADR-001](./ADR-001-microservice-boundaries-and-frontend.md), [ADR-002](./ADR-002-database-ownership-and-tenant-isolation.md), [ADR-004](./ADR-004-payment-provider-and-reconciliation.md).
- **Successor:** [ADR-007](./ADR-007-order-review-and-inventory-reservation.md), [ADR-010](./ADR-010-product-units-variants-and-pricing.md).

---

## 11. Explicit Owner Approval Required

- **Finance Lead / Tax Accountant:** Approval of tax jurisdiction rules, tax-inclusive vs. exclusive policy, GST/VAT rates, and invoice numbering format.
- **Business Owner:** Approval of cancellation and credit note issuance policy.

---

## 12. Unresolved Questions

1. What is the official tax jurisdiction (e.g., Indian GST, UK VAT, US State Sales Tax)?
2. Are displayed catalog prices tax-inclusive or tax-exclusive?
3. What is the required invoice numbering format (e.g., `INV-{STORE_CODE}-{YYYY}-{NNNNN}`)?
4. Is PDF generation required on server-side (e.g. via PDFKit/Puppeteer) or is an HTML/print-friendly web receipt acceptable for initial release?
