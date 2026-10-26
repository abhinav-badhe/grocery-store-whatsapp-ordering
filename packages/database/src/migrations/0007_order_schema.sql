-- 0007_order_schema.sql
-- Step 5.1: Order Management Relational Schema & State Machine
-- Store-scoped orders, immutable item price snapshots, substitutions, and status audit history

-- 1. Create order schema
CREATE SCHEMA IF NOT EXISTS "order";

-- 2. Create order.orders
CREATE TABLE IF NOT EXISTS "order".orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT,
  customer_id UUID NULL REFERENCES identity.users(id) ON DELETE SET NULL,
  order_number VARCHAR(30) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'AWAITING_SHOPKEEPER_REVIEW',
  fulfillment_type VARCHAR(20) NOT NULL DEFAULT 'PICKUP',
  delivery_address TEXT NULL,
  customer_phone VARCHAR(20) NULL,
  customer_name VARCHAR(100) NULL,
  total_amount_cents BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  notes TEXT NULL,
  idempotency_key VARCHAR(100) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT orders_total_amount_cents_check CHECK (total_amount_cents >= 0),
  CONSTRAINT orders_currency_format_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT orders_fulfillment_type_check CHECK (fulfillment_type IN ('PICKUP', 'DELIVERY')),
  CONSTRAINT orders_status_check CHECK (
    status IN (
      'RECEIVED',
      'AWAITING_SHOPKEEPER_REVIEW',
      'CHANGE_REQUESTED',
      'REJECTED',
      'CONFIRMATION_PENDING_RESERVATION',
      'CONFIRMED',
      'PREPARING',
      'READY_FOR_PICKUP',
      'DISPATCHED',
      'COMPLETED',
      'CANCELLED'
    )
  ),
  CONSTRAINT orders_store_order_number_unique UNIQUE (store_id, order_number)
);

CREATE INDEX IF NOT EXISTS orders_store_id_idx ON "order".orders (store_id);
CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON "order".orders (customer_id);
CREATE INDEX IF NOT EXISTS orders_store_status_idx ON "order".orders (store_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS orders_store_idempotency_key_idx ON "order".orders (store_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 3. Create order.order_items (Immutable price snapshots & substitutions)
CREATE TABLE IF NOT EXISTS "order".order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES "order".orders(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES catalog.products(id) ON DELETE RESTRICT,
  product_name_snapshot VARCHAR(150) NOT NULL,
  sku_snapshot VARCHAR(50) NULL,
  unit_snapshot VARCHAR(20) NOT NULL DEFAULT 'PIECE',
  unit_price_cents BIGINT NOT NULL,
  quantity NUMERIC(12, 3) NOT NULL,
  total_price_cents BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  substituted_product_id UUID NULL REFERENCES catalog.products(id) ON DELETE SET NULL,
  substitution_notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT order_items_unit_price_nonnegative CHECK (unit_price_cents >= 0),
  CONSTRAINT order_items_total_price_nonnegative CHECK (total_price_cents >= 0),
  CONSTRAINT order_items_status_check CHECK (status IN ('PENDING', 'CONFIRMED', 'SUBSTITUTED', 'REMOVED'))
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON "order".order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_store_product_idx ON "order".order_items (store_id, product_id);

-- 4. Create order.order_status_history (Audit log of state transitions)
CREATE TABLE IF NOT EXISTS "order".order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES "order".orders(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT,
  from_status VARCHAR(40) NULL,
  to_status VARCHAR(40) NOT NULL,
  changed_by_user_id UUID NULL REFERENCES identity.users(id) ON DELETE SET NULL,
  reason VARCHAR(255) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS order_status_history_order_idx ON "order".order_status_history (order_id, created_at ASC);

-- 5. Configure minimum least-privilege DML access for grocery_order_user
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grocery_order_user') THEN
    GRANT USAGE ON SCHEMA "order" TO grocery_order_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "order" TO grocery_order_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA "order" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO grocery_order_user;
  ELSE
    RAISE NOTICE 'Role grocery_order_user does not exist in cluster. Runtime DML privileges were not granted.';
  END IF;
END $$;
