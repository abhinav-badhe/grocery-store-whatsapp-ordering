-- 0011_billing_and_inbox_schema.sql
-- Step 6.2: Billing Schema, Invoices, Immutable Line Snapshots, Credit Notes, and Consumer Inbox Deduplication
-- Conforms to ADR-002, ADR-005, ADR-009, and ADR-010

-- 1. Create billing schema
CREATE SCHEMA IF NOT EXISTS billing;

-- 2. Create billing.invoice_sequences (Atomic gapless sequential invoice numbering per store/year)
CREATE TABLE IF NOT EXISTS billing.invoice_sequences (
  store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT,
  fiscal_year VARCHAR(10) NOT NULL,
  current_sequence INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, fiscal_year)
);

-- 3. Create billing.invoices (Issued Tax Invoices with Immutable Totals in Minor Units)
CREATE TABLE IF NOT EXISTS billing.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES "order".orders(id) ON DELETE RESTRICT,
  invoice_number VARCHAR(64) NOT NULL,
  subtotal_minor BIGINT NOT NULL,
  tax_total_minor BIGINT NOT NULL,
  grand_total_minor BIGINT NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  status VARCHAR(30) NOT NULL DEFAULT 'ISSUED',
  storage_key TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoices_subtotal_minor_check CHECK (subtotal_minor >= 0),
  CONSTRAINT invoices_tax_total_minor_check CHECK (tax_total_minor >= 0),
  CONSTRAINT invoices_grand_total_minor_check CHECK (grand_total_minor >= 0),
  CONSTRAINT invoices_status_check CHECK (status IN ('ISSUED', 'PAID', 'CANCELLED', 'REFUNDED')),
  CONSTRAINT invoices_store_number_unique UNIQUE (store_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS invoices_store_id_idx ON billing.invoices (store_id);
CREATE INDEX IF NOT EXISTS invoices_order_id_idx ON billing.invoices (order_id);
CREATE INDEX IF NOT EXISTS invoices_created_at_idx ON billing.invoices (store_id, created_at DESC);

-- 4. Create billing.invoice_line_snapshots (Frozen product name, SKU, price, quantity, and GST)
CREATE TABLE IF NOT EXISTS billing.invoice_line_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES billing.invoices(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES catalog.products(id) ON DELETE RESTRICT,
  item_name_snapshot VARCHAR(255) NOT NULL,
  sku_snapshot VARCHAR(64) NULL,
  unit_of_measure_snapshot VARCHAR(16) NOT NULL,
  unit_price_minor_snapshot BIGINT NOT NULL,
  quantity NUMERIC(10, 3) NOT NULL,
  tax_rate_basis_points INT NOT NULL DEFAULT 0,
  tax_amount_minor BIGINT NOT NULL DEFAULT 0,
  line_total_minor BIGINT NOT NULL,
  CONSTRAINT invoice_line_snapshots_quantity_check CHECK (quantity > 0),
  CONSTRAINT invoice_line_snapshots_unit_price_check CHECK (unit_price_minor_snapshot >= 0),
  CONSTRAINT invoice_line_snapshots_tax_amount_check CHECK (tax_amount_minor >= 0),
  CONSTRAINT invoice_line_snapshots_line_total_check CHECK (line_total_minor >= 0)
);

CREATE INDEX IF NOT EXISTS invoice_line_snapshots_invoice_id_idx ON billing.invoice_line_snapshots (invoice_id);
CREATE INDEX IF NOT EXISTS invoice_line_snapshots_store_id_idx ON billing.invoice_line_snapshots (store_id);

-- 5. Create billing.credit_notes (Balancing ledger document for cancelled/refunded invoices)
CREATE TABLE IF NOT EXISTS billing.credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT,
  invoice_id UUID NOT NULL REFERENCES billing.invoices(id) ON DELETE RESTRICT,
  credit_note_number VARCHAR(64) NOT NULL,
  reason TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT credit_notes_amount_minor_check CHECK (amount_minor >= 0),
  CONSTRAINT credit_notes_store_number_unique UNIQUE (store_id, credit_note_number)
);

CREATE INDEX IF NOT EXISTS credit_notes_store_id_idx ON billing.credit_notes (store_id);
CREATE INDEX IF NOT EXISTS credit_notes_invoice_id_idx ON billing.credit_notes (invoice_id);

-- 6. Create events.inbox_events (Consumer Inbox Pattern per ADR-009 for deduplication)
CREATE TABLE IF NOT EXISTS events.inbox_events (
  event_id UUID NOT NULL,
  consumer_name VARCHAR(64) NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, consumer_name)
);

CREATE INDEX IF NOT EXISTS inbox_events_processed_at_idx ON events.inbox_events (processed_at);

-- 7. Grant DML permissions on billing schema to grocery_order_user (co-located Billing module)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grocery_order_user') THEN
    GRANT USAGE ON SCHEMA billing TO grocery_order_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA billing TO grocery_order_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA billing GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO grocery_order_user;
  END IF;
END $$;
