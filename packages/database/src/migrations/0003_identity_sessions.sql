-- 0003_identity_sessions.sql
-- Step 2.4.3: Identity Refresh-Token Sessions & Rotation Schema
-- Approved per Step 2.4.3A Architecture Decision Audit

-- 1. Create identity.refresh_tokens
CREATE TABLE IF NOT EXISTS identity.refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  family_id UUID NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  consumed_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  revoked_reason VARCHAR(50) NULL,
  replaced_by_token_id UUID NULL REFERENCES identity.refresh_tokens(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT refresh_tokens_status_check CHECK (status IN ('ACTIVE', 'CONSUMED', 'REVOKED')),
  CONSTRAINT refresh_tokens_hash_length_check CHECK (char_length(token_hash) = 64)
);

-- 2. Indexes for token lookup, family revocation, and user session management
CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_hash_unique_idx ON identity.refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx ON identity.refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON identity.refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_expires_at_idx ON identity.refresh_tokens (expires_at) WHERE status = 'ACTIVE';

-- 3. Configure least-privilege DML permissions for grocery_identity_user
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grocery_identity_user') THEN
    GRANT USAGE ON SCHEMA identity TO grocery_identity_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity TO grocery_identity_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA identity GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO grocery_identity_user;
  END IF;
END $$;
