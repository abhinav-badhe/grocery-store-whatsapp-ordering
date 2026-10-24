-- 0001_bootstrap.sql
-- Initial platform database bootstrap migration.
-- Proves migration runner execution and ledger recording without creating domain schemas.

CREATE TABLE IF NOT EXISTS public._platform_bootstrap (
  id SERIAL PRIMARY KEY,
  initialized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
