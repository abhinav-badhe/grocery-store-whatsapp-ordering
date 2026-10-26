import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CatalogServiceEnvSchema,
  loadCatalogServiceConfig,
  ConfigValidationError,
} from '../dist/index.js';

describe('Shared Config: Catalog Service Environment Configuration', () => {
  const validCatalogEnv = {
    NODE_ENV: 'production',
    PORT: '4002',
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgresql://grocery_catalog_user:pass123@localhost:5432/grocery_main',
    DATABASE_MAX_POOL_SIZE: '10',
    DATABASE_CONNECTION_TIMEOUT_MS: '5000',
    DATABASE_IDLE_TIMEOUT_MS: '30000',
    INTERNAL_TOKEN_TTL_SECONDS: '60',
    INTERNAL_TOKEN_KID: 'internal-key-2026-1',
    INTERNAL_TOKEN_ISSUER: 'api-gateway',
    INTERNAL_TOKEN_AUDIENCE: 'grocery-internal-service',
    INTERNAL_TOKEN_SECRET: 'super-secure-internal-hmac-secret-at-least-32-chars-long',
  };

  it('successfully parses valid catalog service environment variables', () => {
    const config = loadCatalogServiceConfig(validCatalogEnv);

    assert.equal(config.NODE_ENV, 'production');
    assert.equal(config.PORT, 4002);
    assert.equal(config.LOG_LEVEL, 'info');
    assert.equal(
      config.DATABASE_URL,
      'postgresql://grocery_catalog_user:pass123@localhost:5432/grocery_main',
    );
    assert.equal(config.DATABASE_MAX_POOL_SIZE, 10);
    assert.equal(config.INTERNAL_TOKEN_SECRET.length >= 32, true);
  });

  it('applies documented defaults for omitted optional settings', () => {
    const minimalEnv = {
      DATABASE_URL: 'postgres://localhost:5432/grocery_main',
      INTERNAL_TOKEN_SECRET: 'super-secure-internal-hmac-secret-at-least-32-chars-long',
    };

    const config = loadCatalogServiceConfig(minimalEnv);

    assert.equal(config.NODE_ENV, 'development');
    assert.equal(config.PORT, 3000);
    assert.equal(config.LOG_LEVEL, 'info');
    assert.equal(config.DATABASE_MAX_POOL_SIZE, 5);
    assert.equal(config.DATABASE_CONNECTION_TIMEOUT_MS, 5000);
    assert.equal(config.DATABASE_IDLE_TIMEOUT_MS, 30000);
    assert.equal(config.INTERNAL_TOKEN_TTL_SECONDS, 60);
    assert.equal(config.INTERNAL_TOKEN_ISSUER, 'api-gateway');
  });

  it('rejects invalid or non-postgres DATABASE_URL', () => {
    const invalidEnv = {
      ...validCatalogEnv,
      DATABASE_URL: 'mysql://root:pass@localhost:3306/db',
    };

    assert.throws(
      () => loadCatalogServiceConfig(invalidEnv),
      (err: unknown) => {
        assert.ok(err instanceof ConfigValidationError);
        assert.ok(err.fieldErrors.some((f) => f.key === 'DATABASE_URL'));
        return true;
      },
    );
  });

  it('rejects short INTERNAL_TOKEN_SECRET (< 32 characters) without leaking secret in error message', () => {
    const secretValue = 'short-secret-123';
    const invalidEnv = {
      ...validCatalogEnv,
      INTERNAL_TOKEN_SECRET: secretValue,
    };

    assert.throws(
      () => loadCatalogServiceConfig(invalidEnv),
      (err: unknown) => {
        assert.ok(err instanceof ConfigValidationError);
        assert.equal(err.message.includes(secretValue), false);
        return true;
      },
    );
  });
});
