import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DatabaseConfigError,
  loadDatabaseConfigFromEnv,
  redactDatabaseUrl,
  validateDatabaseConfig,
} from '../dist/index.js';

describe('Database Configuration & Security Redaction', () => {
  it('validates a correct database URL and applies conservative defaults', () => {
    const config = validateDatabaseConfig({
      databaseUrl: 'postgres://app_user:secret_pass@127.0.0.1:5432/grocerystore',
    });

    assert.equal(config.databaseUrl, 'postgres://app_user:secret_pass@127.0.0.1:5432/grocerystore');
    assert.equal(config.maxPoolSize, 5);
    assert.equal(config.connectionTimeoutMs, 5000);
    assert.equal(config.idleTimeoutMs, 30000);
    assert.equal(config.migrationDatabaseUrl, undefined);
  });

  it('accepts custom pool and timeout configuration within valid bounds', () => {
    const config = validateDatabaseConfig({
      databaseUrl: 'postgresql://grocery_migrator:migrator_pass@db.internal:5432/grocerystore',
      maxPoolSize: 10,
      connectionTimeoutMs: 8000,
      idleTimeoutMs: 45000,
      migrationDatabaseUrl:
        'postgres://grocery_migrator:migrator_pass@db.internal:5432/grocerystore',
    });

    assert.equal(config.maxPoolSize, 10);
    assert.equal(config.connectionTimeoutMs, 8000);
    assert.equal(config.idleTimeoutMs, 45000);
    assert.equal(
      config.migrationDatabaseUrl,
      'postgres://grocery_migrator:migrator_pass@db.internal:5432/grocerystore',
    );
  });

  it('rejects invalid database URL schemes and throws DatabaseConfigError', () => {
    assert.throws(
      () => validateDatabaseConfig({ databaseUrl: 'mysql://user:pass@localhost:3306/db' }),
      (err: unknown) => {
        assert.ok(err instanceof DatabaseConfigError);
        assert.match(err.message, /must start with 'postgres:\/\/|postgresql:\/\/'/);
        return true;
      },
    );

    assert.throws(
      () => validateDatabaseConfig({ databaseUrl: 'http://insecure-endpoint' }),
      (err: unknown) => {
        assert.ok(err instanceof DatabaseConfigError);
        return true;
      },
    );
  });

  it('rejects invalid pool sizes and timeouts', () => {
    assert.throws(
      () =>
        validateDatabaseConfig({
          databaseUrl: 'postgres://localhost:5432/db',
          maxPoolSize: 0,
        }),
      (err: unknown) => {
        assert.ok(err instanceof DatabaseConfigError);
        assert.match(err.message, /maxPoolSize must be at least 1/);
        return true;
      },
    );

    assert.throws(
      () =>
        validateDatabaseConfig({
          databaseUrl: 'postgres://localhost:5432/db',
          maxPoolSize: 101,
        }),
      (err: unknown) => {
        assert.ok(err instanceof DatabaseConfigError);
        assert.match(err.message, /maxPoolSize cannot exceed 100/);
        return true;
      },
    );

    assert.throws(
      () =>
        validateDatabaseConfig({
          databaseUrl: 'postgres://localhost:5432/db',
          connectionTimeoutMs: 50,
        }),
      (err: unknown) => {
        assert.ok(err instanceof DatabaseConfigError);
        assert.match(err.message, /connectionTimeoutMs must be at least 100 ms/);
        return true;
      },
    );
  });

  it('redacts credentials from database URLs cleanly', () => {
    const raw =
      'postgres://app_user:super_secret_password_123@db.render.internal:5432/grocerystore';
    const redacted = redactDatabaseUrl(raw);

    assert.equal(redacted, 'postgres://[REDACTED]:[REDACTED]@db.render.internal:5432/grocerystore');
    assert.ok(!redacted.includes('super_secret_password_123'));
    assert.ok(!redacted.includes('app_user'));
  });

  it('redacts sensitive query parameter tokens from database URLs', () => {
    const raw =
      'postgresql://usr@cluster.host:5432/db?password=token123&sslmode=require&api_key=secret999';
    const redacted = redactDatabaseUrl(raw);

    assert.ok(!redacted.includes('token123'));
    assert.ok(!redacted.includes('secret999'));
    assert.ok(redacted.includes('password=[REDACTED]'));
    assert.ok(redacted.includes('api_key=[REDACTED]'));
  });

  it('loads configuration from environment object safely', () => {
    const env = {
      DATABASE_URL: 'postgres://app:pass@127.0.0.1:5432/grocerystore',
      DATABASE_MAX_POOL_SIZE: '7',
      DATABASE_CONNECTION_TIMEOUT_MS: '6000',
      DATABASE_IDLE_TIMEOUT_MS: '25000',
      MIGRATION_DATABASE_URL: 'postgres://migrator:migpass@127.0.0.1:5432/grocerystore',
    };

    const config = loadDatabaseConfigFromEnv(env);
    assert.equal(config.maxPoolSize, 7);
    assert.equal(config.connectionTimeoutMs, 6000);
    assert.equal(config.idleTimeoutMs, 25000);
    assert.equal(
      config.migrationDatabaseUrl,
      'postgres://migrator:migpass@127.0.0.1:5432/grocerystore',
    );
  });
});
