# ADR-010: Product Variants, Units of Measure, Fractional Quantities, and Price Snapshots

## Status
`Proposed`

## Date
2026-10-24

## Decision Owner
Catalog Domain Lead / Product Owner

---

## 1. Context

Grocery retail differs fundamentally from general retail because products are sold both as distinct packaged units (e.g., "1 box of Kellogg's Cornflakes 500g") and as weighed, variable-quantity commodities (e.g., "1.75 kg of Tomatoes", "250 g of Ginger", "500 ml of Milk").

If units of measure are stored as arbitrary free-form strings (e.g., "kilos", "kg", "kgs", "packet"), inventory calculations and stock aggregations fail. Furthermore, price changes must never retroactively alter existing or historical orders.

---

## 2. Mandated Requirements from Approved Specifications

- **Explicit Variants and SKUs:** Sellable items must be modeled as explicit product variants/SKUs where package size, brand, weight, barcode, or price differs (Spec v2.0 §6, Baseline v3.0 §9).
- **Canonical Units of Measure:** Define a controlled enumeration of canonical units of measure (e.g. `KG`, `G`, `L`, `ML`, `PIECE`, `PACK`) and formal conversion multipliers. Free-form text in stock arithmetic is strictly prohibited (Baseline v3.0 §9).
- **Fractional Quantity Rules:** Inventory and order models must support fractional quantities for weighed produce, validating minimum increments and precision (e.g., minimum 0.1 kg with 0.01 kg increments) (Baseline v3.0 §9).
- **Precision Separation:** Keep stock quantity precision strictly distinct from monetary precision. Quantities may be represented as fixed-point decimals (e.g. `NUMERIC(10, 3)`), while money is strictly integer minor units (`BIGINT`) (Baseline v3.0 §9).
- **Immutable Item Price Snapshots:** Orders and invoices must store immutable snapshots of product name, SKU, unit of measure, quantity, and unit price as approved at review time. Catalog price edits must write to an auditable price version history (Spec v2.0 §6, §7, Baseline v3.0 §5, §8, §9).

---

## 3. Options Considered

### A. Unit of Measure Modeling
- **Option 1: Base Canonical Unit per Category with Standard Conversion (Recommended):**  
  Store stock balances in the smallest base canonical unit for that commodity (e.g., all mass in grams `G`, all volume in milliliters `ML`, or all discrete items in `PIECE`). Display layers convert to `kg` or `litres` for customer convenience.
- **Option 2: Decimal Quantities in Display Units:**  
  Store stock directly as decimal kilograms (`1.250 kg`) using PostgreSQL `NUMERIC(12, 3)`.
- **Option 3: Free-form String Units:**  
  (Rejected immediately: catastrophic data corruption in stock balance arithmetic).

### B. Product Hierarchy & SKU Modeling
- **Option H1: Product (Parent) $\rightarrow$ ProductVariant / SKU (Child):**  
  `products` represents the general item (e.g., "Aashirvaad Whole Wheat Atta"), while `product_variants` represents the sellable inventory item (e.g., SKU "AASH-ATTA-1KG", SKU "AASH-ATTA-5KG", barcode, pack size, price).
- **Option H2: Flat Product List without Variants:**  
  Every variant is a completely separate top-level product.

---

## 4. Advantages and Disadvantages

### Product Hierarchy Comparison
- **Option H1 (Product $\rightarrow$ Variant/SKU):**
  - *Advantages:* Natural customer browsing (customer views "Atta" and selects 1kg vs 5kg from a dropdown); clean barcode/SKU mapping; adheres strictly to Spec v2.0 and Baseline v3.0.
  - *Disadvantages:* Slightly more normalized schema.
- **Option H2 (Flat Product List):**
  - *Disadvantages:* Clutters search results with duplicated product entries; poor mobile UX.

---

## 5. Proposed Decision

1. **Adopt Product $\rightarrow$ Variant/SKU Hierarchy (Option H1):**
   - `products`: `id`, `store_id`, `category_id`, `brand`, `name`, `description`, `image_url`, `is_active`, `created_at`.
   - `product_variants`: `id`, `store_id`, `product_id`, `sku`, `barcode`, `variant_name` (e.g. "500g Pouch"), `unit_of_measure`, `pack_size`, `allow_fractional`, `min_quantity`, `increment_step`, `current_price_minor`, `created_at`.
2. **Standardize Controlled Canonical Units:**
   ```typescript
   export enum UnitOfMeasure {
     PIECE = 'PIECE',   // Discrete items
     PACK = 'PACK',     // Multi-packs
     KG = 'KG',         // Kilograms
     G = 'G',           // Grams
     L = 'L',           // Litres
     ML = 'ML'          // Millilitres
   }
   ```
3. **Numeric Precision Strategy:**
   - **Quantities:** Stored in PostgreSQL as `NUMERIC(10, 3)` (supports up to 3 decimal places, e.g., `1.250 kg` or `0.050 kg`).
   - **Prices & Currency:** Stored as `BIGINT` minor units (e.g., ₹45.50 = `4550` paise).
   - **Line Total Formula:** `line_total_minor = Math.round(Number(quantity) * Number(unit_price_minor))`.
4. **Order Item Snapshots:**  
   The `order_items` table explicitly records:
   - `product_id`, `sku_id`
   - `item_name_snapshot VARCHAR(255)`
   - `unit_of_measure_snapshot VARCHAR(16)`
   - `unit_price_minor_snapshot BIGINT`
   - `quantity NUMERIC(10, 3)`
   - `line_total_minor BIGINT`
5. **Shopkeeper Revisions & Substitutions:**  
   During `AWAITING_SHOPKEEPER_REVIEW`, the shopkeeper can:
   - Adjust actual weighed quantities (e.g., customer requested 1.0 kg, shopkeeper weighed 1.15 kg).
   - Substitute an out-of-stock SKU with an alternative variant.
   - Any modification creates a new `order_revisions` record and recalculates totals before confirmation.

---

## 6. Consequences and Trade-offs

- **Positive:** Robust support for both packaged barcodes and weighed produce; exact accounting with zero historical price corruption; rich customer catalog navigation.
- **Negative:** Mobile WhatsApp conversational flow must parse or prompt for specific pack sizes when a customer asks for ambiguous items.

---

## 7. Security and Tenant-Isolation Implications

- Catalog queries and SKU searches are strictly scoped by `store_id`. Store A's custom SKU names and prices are never visible to Store B.

---

## 8. Reliability and Failure-Recovery Implications

- Snapshots protect historical orders and invoices: if a shopkeeper updates the price of Rice from ₹60 to ₹65 tomorrow, orders placed today retain ₹60 permanently.

---

## 9. Testing and Acceptance Criteria

- **Snapshot Invariance Test:** Create an order for Product A at ₹100; update Product A catalog price to ₹150; fetch the order and confirm order item price remains ₹100.
- **Fractional Precision Test:** Create order item with `quantity: 0.375` at `price: 8000` paise; verify `line_total_minor = 3000` paise (`0.375 * 8000 = 3000`).

---

## 10. Dependencies

- **Predecessor:** [ADR-001](./ADR-001-microservice-boundaries-and-frontend.md), [ADR-002](./ADR-002-database-ownership-and-tenant-isolation.md).
- **Successor:** [ADR-005](./ADR-005-tax-invoicing-and-rounding.md), [ADR-007](./ADR-007-order-review-and-inventory-reservation.md).

---

## 11. Explicit Owner Approval Required

- **Catalog Domain Lead / Product Owner:** Approval of supported units of measure, default fractional step increments, and substitution policies.

---

## 12. Unresolved Questions

1. Should weighed items allow arbitrary custom customer decimal inputs on the web UI, or should the UI constrain inputs to common increments (e.g., 0.25 kg, 0.5 kg, 1 kg)?
2. When a shopkeeper proposes a substitution during review, is explicit customer confirmation required via WhatsApp/web before reservation, or does the shopkeeper have authority to confirm directly?
