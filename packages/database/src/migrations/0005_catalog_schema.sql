-- 0005_catalog_schema.sql
-- Step 3.1: Catalog Service Database Schema & Migrations
-- Store-scoped categories, products, inventory linkages, and search indexes

-- 1. Create catalog schema
CREATE SCHEMA IF NOT EXISTS catalog;

-- 2. Create catalog.categories (Store-scoped hierarchical category tree)
CREATE TABLE IF NOT EXISTS catalog.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT NULL,
  parent_id UUID NULL REFERENCES catalog.categories(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT categories_name_length_check CHECK (char_length(TRIM(name)) >= 1 AND char_length(name) <= 100),
  CONSTRAINT categories_slug_format_check CHECK (slug ~ '^[a-z0-9-]+$'),
  CONSTRAINT categories_status_check CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  CONSTRAINT categories_store_slug_unique UNIQUE (store_id, slug)
);

-- Indexes for category hierarchy and tenant scoping
CREATE INDEX IF NOT EXISTS categories_store_id_idx ON catalog.categories (store_id);
CREATE INDEX IF NOT EXISTS categories_parent_id_idx ON catalog.categories (parent_id);

-- 3. Create catalog.products (Store-scoped product catalog entity)
CREATE TABLE IF NOT EXISTS catalog.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES identity.stores(id) ON DELETE RESTRICT,
  category_id UUID NULL REFERENCES catalog.categories(id) ON DELETE SET NULL,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(150) NOT NULL,
  sku VARCHAR(50) NULL,
  barcode VARCHAR(50) NULL,
  description TEXT NULL,
  price_cents BIGINT NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  unit VARCHAR(20) NOT NULL DEFAULT 'PIECE',
  is_weight_based BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  image_url VARCHAR(500) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT products_name_length_check CHECK (char_length(TRIM(name)) >= 1 AND char_length(name) <= 150),
  CONSTRAINT products_slug_format_check CHECK (slug ~ '^[a-z0-9-]+$'),
  CONSTRAINT products_price_cents_check CHECK (price_cents >= 0),
  CONSTRAINT products_currency_format_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT products_status_check CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  CONSTRAINT products_unit_check CHECK (unit IN ('PIECE', 'KG', 'GRAM', 'LITRE', 'MILLILITRE', 'PACK', 'DOZEN')),
  CONSTRAINT products_store_slug_unique UNIQUE (store_id, slug)
);

-- Indexes for product queries and tenant scoping
CREATE INDEX IF NOT EXISTS products_store_id_idx ON catalog.products (store_id);
CREATE INDEX IF NOT EXISTS products_category_id_idx ON catalog.products (category_id);
CREATE UNIQUE INDEX IF NOT EXISTS products_store_sku_unique_idx ON catalog.products (store_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_store_barcode_idx ON catalog.products (store_id, barcode) WHERE barcode IS NOT NULL;

-- 4. Configure minimum least-privilege DML access for grocery_catalog_user
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grocery_catalog_user') THEN
    GRANT USAGE ON SCHEMA catalog TO grocery_catalog_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA catalog TO grocery_catalog_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA catalog GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO grocery_catalog_user;
  ELSE
    RAISE NOTICE 'Role grocery_catalog_user does not exist in cluster. Runtime DML privileges were not granted.';
  END IF;
END $$;
