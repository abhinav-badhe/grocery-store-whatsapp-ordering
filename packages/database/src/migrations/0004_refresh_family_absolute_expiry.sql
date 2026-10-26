-- 0004_refresh_family_absolute_expiry.sql
-- Step 2.5: Enforce Immutable Refresh-Token Family Absolute Expiry
-- Resolves Audit Finding H-1 per ADR-003 §5.1

-- 1. Add family_expires_at column to identity.refresh_tokens with 30-day default
ALTER TABLE identity.refresh_tokens 
  ADD COLUMN IF NOT EXISTS family_expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days');

-- Backfill any existing tokens to have family_expires_at = created_at + 30 days
UPDATE identity.refresh_tokens 
  SET family_expires_at = created_at + INTERVAL '30 days' 
  WHERE family_expires_at IS NULL;

-- Enforce NOT NULL constraint after backfill
ALTER TABLE identity.refresh_tokens 
  ALTER COLUMN family_expires_at SET NOT NULL;

-- 2. Index for active tokens by family expiration
CREATE INDEX IF NOT EXISTS refresh_tokens_family_expires_at_idx 
  ON identity.refresh_tokens (family_expires_at) 
  WHERE status = 'ACTIVE';
