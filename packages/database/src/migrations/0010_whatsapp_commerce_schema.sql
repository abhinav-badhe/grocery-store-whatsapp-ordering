-- 0010_whatsapp_commerce_schema.sql
-- Step 8.1: WhatsApp Conversational Commerce, Deduplication & Ephemeral State
-- Schema 'whatsapp' owned exclusively by apps/whatsapp-service.
-- ZERO cross-schema foreign keys (enforcing ADR-002).

-- 1. Create dedicated whatsapp schema
CREATE SCHEMA IF NOT EXISTS whatsapp;

-- 2. Store-to-WhatsApp Channel Mapping
-- Maps incoming verified Meta WhatsApp phone number IDs to store tenants.
-- Cross-schema integrity to identity.stores is enforced at application layer.
CREATE TABLE IF NOT EXISTS whatsapp.store_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL,
  phone_number_id VARCHAR(64) NOT NULL,
  display_phone_number VARCHAR(32) NOT NULL,
  waba_id VARCHAR(64) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT store_channels_phone_number_id_unique UNIQUE (phone_number_id)
);

CREATE INDEX IF NOT EXISTS store_channels_store_id_idx ON whatsapp.store_channels (store_id);

-- 3. Inbound Webhook Ingestion & Deduplication Ledger
-- Durable ledger ensuring duplicate deliveries trigger zero duplicate actions,
-- while recovering from process crashes via processing leases.
CREATE TABLE IF NOT EXISTS whatsapp.inbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_message_id VARCHAR(128) NOT NULL,
  store_id UUID NULL,
  sender_phone_e164 VARCHAR(32) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
  attempt_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 5,
  locked_until TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NULL,
  CONSTRAINT inbound_messages_provider_msg_unique UNIQUE (provider_message_id),
  CONSTRAINT inbound_messages_status_check CHECK (
    status IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'QUARANTINED', 'DEAD_LETTER')
  ),
  CONSTRAINT inbound_messages_retry_check CHECK (attempt_count >= 0 AND max_retries >= 0)
);

CREATE INDEX IF NOT EXISTS inbound_messages_polling_idx ON whatsapp.inbound_messages (status, locked_until)
  WHERE status IN ('RECEIVED', 'FAILED', 'PROCESSING');
CREATE INDEX IF NOT EXISTS inbound_messages_store_id_idx ON whatsapp.inbound_messages (store_id)
  WHERE store_id IS NOT NULL;

-- 4. Conversational Orchestration State
-- Ephemeral conversational turn-taking, grocery list parser context, and store association.
CREATE TABLE IF NOT EXISTS whatsapp.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL,
  sender_phone_e164 VARCHAR(32) NOT NULL,
  state VARCHAR(50) NOT NULL DEFAULT 'INITIATED',
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_inbound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_outbound_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversations_unique_sender UNIQUE (store_id, sender_phone_e164),
  CONSTRAINT conversations_state_check CHECK (
    state IN (
      'INITIATED',
      'PARSING_LIST',
      'AWAITING_CLARIFICATION',
      'PROVISIONAL_QUOTE_SENT',
      'CONFIRMING_ORDER',
      'SUBMITTED_TO_SHOPKEEPER',
      'AWAITING_CUSTOMER_CHANGE_CONFIRMATION',
      'PAYMENT_PENDING',
      'FULFILLED',
      'EXPIRED',
      'FAILED'
    )
  )
);

CREATE INDEX IF NOT EXISTS conversations_store_id_idx ON whatsapp.conversations (store_id);
CREATE INDEX IF NOT EXISTS conversations_sender_idx ON whatsapp.conversations (sender_phone_e164);

-- 5. Provisional Quotes Ledger
-- Short-lived price and quantity snapshots with strict TTL.
-- Foreign key references whatsapp.conversations within the same schema.
CREATE TABLE IF NOT EXISTS whatsapp.provisional_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES whatsapp.conversations(id) ON DELETE CASCADE,
  store_id UUID NOT NULL,
  quote_version INT NOT NULL DEFAULT 1,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  items JSONB NOT NULL,
  subtotal_minor INT NOT NULL,
  tax_minor INT NOT NULL DEFAULT 0,
  delivery_minor INT NOT NULL DEFAULT 0,
  total_minor INT NOT NULL,
  order_id UUID NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT quotes_status_check CHECK (
    status IN ('ACTIVE', 'CONFIRMING', 'ORDER_CREATED', 'EXPIRED')
  ),
  CONSTRAINT quotes_amounts_check CHECK (
    subtotal_minor >= 0 AND tax_minor >= 0 AND delivery_minor >= 0 AND total_minor >= 0
  )
);

CREATE INDEX IF NOT EXISTS provisional_quotes_conv_idx ON whatsapp.provisional_quotes (conversation_id);
CREATE INDEX IF NOT EXISTS provisional_quotes_expires_idx ON whatsapp.provisional_quotes (status, expires_at);
CREATE INDEX IF NOT EXISTS provisional_quotes_order_idx ON whatsapp.provisional_quotes (order_id)
  WHERE order_id IS NOT NULL;

-- 6. Customer Phone Identity Linkage
-- Maps WhatsApp sender phone to verified identity.users(id).
-- Cross-schema integrity to identity.users is enforced at application layer.
CREATE TABLE IF NOT EXISTS whatsapp.customer_phone_links (
  sender_phone_e164 VARCHAR(32) PRIMARY KEY,
  user_id UUID NOT NULL,
  verification_status VARCHAR(30) NOT NULL DEFAULT 'UNVERIFIED',
  verified_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT phone_links_status_check CHECK (
    verification_status IN ('UNVERIFIED', 'VERIFIED', 'REVOKED')
  )
);

CREATE INDEX IF NOT EXISTS customer_phone_links_user_idx ON whatsapp.customer_phone_links (user_id);
