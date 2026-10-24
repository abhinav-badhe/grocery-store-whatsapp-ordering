-- 0002_identity_schema.sql
-- Step 2.3: Identity Service Database Schemas & Migrations
-- Approved per Step 2.2A and Step 2.2B Architecture Preflight

-- 1. Create identity schema
CREATE SCHEMA IF NOT EXISTS identity;

-- 2. Create identity.users (Global platform user identity)
CREATE TABLE IF NOT EXISTS identity.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NULL,
  phone VARCHAR(20) NULL,
  full_name VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_contact_identifier_check CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CONSTRAINT users_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION')),
  CONSTRAINT users_phone_format_check CHECK (phone IS NULL OR phone ~ '^\+[1-9]\d{1,14}$'),
  CONSTRAINT users_full_name_length_check CHECK (char_length(TRIM(full_name)) >= 1 AND char_length(full_name) <= 100)
);

-- Partial unique indexes on non-null normalized contact identifiers
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON identity.users (LOWER(TRIM(email))) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique_idx ON identity.users (phone) WHERE phone IS NOT NULL;

-- 3. Create identity.user_credentials (Sensitive password hash storage strictly separated from public profile)
CREATE TABLE IF NOT EXISTS identity.user_credentials (
  user_id UUID PRIMARY KEY REFERENCES identity.users(id) ON DELETE RESTRICT,
  password_hash VARCHAR(255) NOT NULL,
  algorithm VARCHAR(32) NOT NULL DEFAULT 'argon2id',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_credentials_algorithm_check CHECK (algorithm IN ('argon2id')),
  CONSTRAINT user_credentials_password_hash_length_check CHECK (char_length(password_hash) >= 10)
);

-- 4. Create identity.stores (Merchant store / tenant root entity)
CREATE TABLE IF NOT EXISTS identity.stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  code VARCHAR(50) NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT stores_name_length_check CHECK (char_length(TRIM(name)) >= 2 AND char_length(name) <= 100),
  CONSTRAINT stores_code_format_check CHECK (code IS NULL OR code ~ '^[a-z0-9-]+$'),
  CONSTRAINT stores_currency_format_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT stores_timezone_length_check CHECK (char_length(TRIM(timezone)) >= 1 AND char_length(timezone) <= 50),
  CONSTRAINT stores_status_check CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED'))
);

-- Partial unique index on optional store slug code
CREATE UNIQUE INDEX IF NOT EXISTS stores_code_unique_idx ON identity.stores (code) WHERE code IS NOT NULL;

-- 5. Create identity.store_memberships (Explicit user-to-store membership and store-scoped role)
CREATE TABLE IF NOT EXISTS identity.store_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT,
  role VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT store_memberships_user_store_unique UNIQUE (user_id, store_id),
  CONSTRAINT store_memberships_role_check CHECK (role IN ('OWNER', 'MANAGER', 'STAFF')),
  CONSTRAINT store_memberships_status_check CHECK (status IN ('ACTIVE', 'INVITED', 'SUSPENDED'))
);

-- B-tree indexes for fast membership and tenant lookups
CREATE INDEX IF NOT EXISTS store_memberships_user_id_idx ON identity.store_memberships (user_id);
CREATE INDEX IF NOT EXISTS store_memberships_store_id_idx ON identity.store_memberships (store_id);

-- 6. Configure minimum least-privilege DML access for grocery_identity_user
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grocery_identity_user') THEN
    GRANT USAGE ON SCHEMA identity TO grocery_identity_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity TO grocery_identity_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA identity GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO grocery_identity_user;
  ELSE
    RAISE NOTICE 'Role grocery_identity_user does not exist in cluster. Runtime DML privileges were not granted. Cluster roles must be provisioned via infrastructure setup.';
  END IF;
END $$;
