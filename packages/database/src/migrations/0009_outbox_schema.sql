-- 0009_outbox_schema.sql
-- Step 7.1: Transactional Outbox & Notification Dispatch Ledger
-- Atomic domain event queuing, retry tracking, and multi-channel notification audit

-- 1. Create events schema
CREATE SCHEMA IF NOT EXISTS events;

-- 2. Create events.outbox (Transactional Outbox Queue)
CREATE TABLE IF NOT EXISTS events.outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT,
  event_type VARCHAR(100) NOT NULL,
  aggregate_type VARCHAR(50) NOT NULL,
  aggregate_id UUID NOT NULL,
  payload JSONB NOT NULL,
  metadata JSONB NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 5,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT outbox_status_check CHECK (
    status IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'DEAD_LETTER')
  ),
  CONSTRAINT outbox_retry_count_check CHECK (retry_count >= 0),
  CONSTRAINT outbox_max_retries_check CHECK (max_retries >= 0)
);

CREATE INDEX IF NOT EXISTS outbox_store_id_idx ON events.outbox (store_id);
CREATE INDEX IF NOT EXISTS outbox_aggregate_idx ON events.outbox (store_id, aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS outbox_pending_polling_idx ON events.outbox (status, scheduled_at)
  WHERE status IN ('PENDING', 'PROCESSING');

-- 3. Create events.notification_logs (Multi-channel notification delivery journal)
CREATE TABLE IF NOT EXISTS events.notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT,
  outbox_id UUID NULL REFERENCES events.outbox(id) ON DELETE SET NULL,
  channel VARCHAR(30) NOT NULL DEFAULT 'WHATSAPP',
  recipient VARCHAR(100) NOT NULL,
  template_name VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  provider_message_id VARCHAR(255) NULL,
  sent_at TIMESTAMPTZ NULL,
  delivered_at TIMESTAMPTZ NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notification_logs_channel_check CHECK (
    channel IN ('WHATSAPP', 'SMS', 'EMAIL')
  ),
  CONSTRAINT notification_logs_status_check CHECK (
    status IN ('PENDING', 'SENT', 'DELIVERED', 'FAILED')
  )
);

CREATE INDEX IF NOT EXISTS notification_logs_store_id_idx ON events.notification_logs (store_id);
CREATE INDEX IF NOT EXISTS notification_logs_recipient_idx ON events.notification_logs (store_id, recipient);
CREATE INDEX IF NOT EXISTS notification_logs_channel_status_idx ON events.notification_logs (channel, status);
