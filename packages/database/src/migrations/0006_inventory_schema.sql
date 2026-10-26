-- 0006_inventory_schema.sql
-- Step 4.1: Inventory & Stock Reservation Schema & Migrations
-- Store-scoped stock balances, reservations, reservation items, and append-only movements ledger

-- 1. Create inventory schema
CREATE SCHEMA IF NOT EXISTS inventory;

-- 2. Create inventory.stock_balances (Store-scoped product inventory levels)
CREATE TABLE IF NOT EXISTS inventory.stock_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES catalog.products(id) ON DELETE RESTRICT,
  sku VARCHAR(50) NULL,
  on_hand_quantity NUMERIC(12, 3) NOT NULL DEFAULT 0,
  reserved_quantity NUMERIC(12, 3) NOT NULL DEFAULT 0,
  available_quantity NUMERIC(12, 3) NOT NULL DEFAULT 0,
  reorder_point NUMERIC(12, 3) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT stock_balances_on_hand_nonnegative CHECK (on_hand_quantity >= 0),
  CONSTRAINT stock_balances_reserved_nonnegative CHECK (reserved_quantity >= 0),
  CONSTRAINT stock_balances_available_nonnegative CHECK (available_quantity >= 0),
  CONSTRAINT stock_balances_zero_oversell_check CHECK (on_hand_quantity >= reserved_quantity),
  CONSTRAINT stock_balances_store_product_unique UNIQUE (store_id, product_id)
);

-- Indexes for stock balance lookups and tenant queries
CREATE INDEX IF NOT EXISTS stock_balances_store_id_idx ON inventory.stock_balances (store_id);
CREATE INDEX IF NOT EXISTS stock_balances_product_id_idx ON inventory.stock_balances (product_id);
CREATE INDEX IF NOT EXISTS stock_balances_store_sku_idx ON inventory.stock_balances (store_id, sku) WHERE sku IS NOT NULL;

-- 3. Create inventory.stock_reservations (Correlated order-level reservations)
CREATE TABLE IF NOT EXISTS inventory.stock_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT stock_reservations_status_check CHECK (status IN ('ACTIVE', 'FULFILLED', 'RELEASED', 'EXPIRED')),
  CONSTRAINT stock_reservations_store_order_unique UNIQUE (store_id, order_id)
);

CREATE INDEX IF NOT EXISTS stock_reservations_store_id_idx ON inventory.stock_reservations (store_id);
CREATE INDEX IF NOT EXISTS stock_reservations_status_expires_idx ON inventory.stock_reservations (status, expires_at);

-- 4. Create inventory.stock_reservation_items (Itemized lines within a reservation)
CREATE TABLE IF NOT EXISTS inventory.stock_reservation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES inventory.stock_reservations(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES catalog.products(id) ON DELETE RESTRICT,
  quantity NUMERIC(12, 3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT stock_reservation_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT stock_reservation_items_unique_item UNIQUE (reservation_id, product_id)
);

CREATE INDEX IF NOT EXISTS stock_res_items_reservation_idx ON inventory.stock_reservation_items (reservation_id);
CREATE INDEX IF NOT EXISTS stock_res_items_store_product_idx ON inventory.stock_reservation_items (store_id, product_id);

-- 5. Create inventory.stock_movements (Append-only audit ledger per ADR-007)
CREATE TABLE IF NOT EXISTS inventory.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES catalog.products(id) ON DELETE RESTRICT,
  delta_quantity NUMERIC(12, 3) NOT NULL,
  reason VARCHAR(50) NOT NULL,
  reference_id VARCHAR(100) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT stock_movements_reason_check CHECK (
    reason IN (
      'INFLOW_PURCHASE',
      'RESERVATION_HOLD',
      'RESERVATION_RELEASE',
      'FULFILLMENT_OUTFLOW',
      'MANUAL_CORRECTION',
      'SHRINKAGE_DAMAGE'
    )
  )
);

CREATE INDEX IF NOT EXISTS stock_movements_store_product_idx ON inventory.stock_movements (store_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_reference_idx ON inventory.stock_movements (store_id, reference_id) WHERE reference_id IS NOT NULL;

-- 6. Configure minimum least-privilege DML access for grocery_inventory_user
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grocery_inventory_user') THEN
    GRANT USAGE ON SCHEMA inventory TO grocery_inventory_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA inventory TO grocery_inventory_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA inventory GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO grocery_inventory_user;
  ELSE
    RAISE NOTICE 'Role grocery_inventory_user does not exist in cluster. Runtime DML privileges were not granted.';
  END IF;
END $$;
