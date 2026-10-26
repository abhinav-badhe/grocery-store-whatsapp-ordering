-- 0008_payment_schema.sql
-- Step 6.1: Payment Gateway Integration & Webhook Relational Schema
-- Store-scoped payments, idempotent webhook ingestion ledger, and refunds

-- 1. Create payment schema
CREATE SCHEMA IF NOT EXISTS payment;

-- 2. Create payment.payments
CREATE TABLE IF NOT EXISTS payment.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES "order".orders(id) ON DELETE RESTRICT,
  payment_method VARCHAR(50) NOT NULL DEFAULT 'UPI',
  provider VARCHAR(50) NOT NULL DEFAULT 'MOCK',
  provider_order_id VARCHAR(255) NULL,
  provider_payment_id VARCHAR(255) NULL,
  amount_cents BIGINT NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  idempotency_key VARCHAR(100) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payments_amount_cents_check CHECK (amount_cents > 0),
  CONSTRAINT payments_currency_format_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT payments_status_check CHECK (
    status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED')
  ),
  CONSTRAINT payments_method_check CHECK (
    payment_method IN ('UPI', 'CARD', 'NETBANKING', 'WALLET', 'COD', 'OTHER')
  ),
  CONSTRAINT payments_provider_check CHECK (
    provider IN ('RAZORPAY', 'STRIPE', 'CASH_ON_DELIVERY', 'MOCK')
  )
);

CREATE INDEX IF NOT EXISTS payments_store_id_idx ON payment.payments (store_id);
CREATE INDEX IF NOT EXISTS payments_store_order_id_idx ON payment.payments (store_id, order_id);
CREATE INDEX IF NOT EXISTS payments_provider_payment_id_idx ON payment.payments (provider, provider_payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS payments_store_idempotency_key_idx ON payment.payments (store_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 3. Create payment.payment_webhooks (Append-only idempotent webhook event journal)
CREATE TABLE IF NOT EXISTS payment.payment_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT,
  provider VARCHAR(50) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  signature VARCHAR(500) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'RECEIVED',
  processed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_webhooks_status_check CHECK (
    status IN ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED')
  ),
  CONSTRAINT payment_webhooks_provider_event_id_unique UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS payment_webhooks_store_id_idx ON payment.payment_webhooks (store_id);
CREATE INDEX IF NOT EXISTS payment_webhooks_status_idx ON payment.payment_webhooks (status);

-- 4. Create payment.refunds
CREATE TABLE IF NOT EXISTS payment.refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payment.payments(id) ON DELETE RESTRICT,
  store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL,
  reason VARCHAR(255) NULL,
  provider_refund_id VARCHAR(255) NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT refunds_amount_cents_check CHECK (amount_cents > 0),
  CONSTRAINT refunds_status_check CHECK (
    status IN ('PENDING', 'SUCCEEDED', 'FAILED')
  )
);

CREATE INDEX IF NOT EXISTS refunds_store_id_idx ON payment.refunds (store_id);
CREATE INDEX IF NOT EXISTS refunds_payment_id_idx ON payment.refunds (payment_id);
