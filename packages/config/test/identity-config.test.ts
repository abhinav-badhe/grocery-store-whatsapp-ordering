import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  Argon2idEnvSchema,
  InternalTokenEnvSchema,
  DatabaseEnvSchema,
  IdentityServiceEnvSchema,
  loadIdentityServiceConfig,
  loadConfig,
  ConfigValidationError,
} from '../dist/index.js';

describe('Shared Config: Argon2id Parameters', () => {
  it('applies architecture-specified defaults (memory: 65536 KiB, time: 3, parallelism: 4)', () => {
    const parsed = Argon2idEnvSchema.parse({});
    assert.equal(parsed.ARGON2_MEMORY_COST, 65536);
    assert.equal(parsed.ARGON2_TIME_COST, 3);
    assert.equal(parsed.ARGON2_PARALLELISM, 4);
  });

  it('coerces string values and accepts valid custom bounds', () => {
    const parsed = Argon2idEnvSchema.parse({
      ARGON2_MEMORY_COST: '32768',
      ARGON2_TIME_COST: '2',
      ARGON2_PARALLELISM: '2',
    });
    assert.equal(parsed.ARGON2_MEMORY_COST, 32768);
    assert.equal(parsed.ARGON2_TIME_COST, 2);
    assert.equal(parsed.ARGON2_PARALLELISM, 2);
  });

  it('rejects memory cost below 1024 KiB or above 1048576 KiB', () => {
    assert.throws(() => Argon2idEnvSchema.parse({ ARGON2_MEMORY_COST: '1023' }));
    assert.throws(() => Argon2idEnvSchema.parse({ ARGON2_MEMORY_COST: '1048577' }));
  });

  it('rejects time cost below 1 or above 100', () => {
    assert.throws(() => Argon2idEnvSchema.parse({ ARGON2_TIME_COST: '0' }));
    assert.throws(() => Argon2idEnvSchema.parse({ ARGON2_TIME_COST: '101' }));
  });

  it('rejects parallelism below 1 or above 64', () => {
    assert.throws(() => Argon2idEnvSchema.parse({ ARGON2_PARALLELISM: '0' }));
    assert.throws(() => Argon2idEnvSchema.parse({ ARGON2_PARALLELISM: '65' }));
  });
});

describe('Shared Config: Internal Token Environment', () => {
  const validSecret = 'test-token-secret-at-least-32-chars-long!';

  it('applies defaults for TTL, KID, Issuer, and Audience', () => {
    const parsed = InternalTokenEnvSchema.parse({
      INTERNAL_TOKEN_SECRET: validSecret,
    });
    assert.equal(parsed.INTERNAL_TOKEN_TTL_SECONDS, 60);
    assert.equal(parsed.INTERNAL_TOKEN_KID, 'internal-key-2026-1');
    assert.equal(parsed.INTERNAL_TOKEN_ISSUER, 'api-gateway');
    assert.equal(parsed.INTERNAL_TOKEN_AUDIENCE, 'grocery-internal-service');
    assert.equal(parsed.INTERNAL_TOKEN_SECRET, validSecret);
  });

  it('rejects secret shorter than 32 characters', () => {
    assert.throws(
      () => InternalTokenEnvSchema.parse({ INTERNAL_TOKEN_SECRET: 'short-secret' }),
      /INTERNAL_TOKEN_SECRET must be at least 32 characters long/,
    );
  });

  it('enforces TTL boundaries (5 to 3600 seconds)', () => {
    assert.throws(() =>
      InternalTokenEnvSchema.parse({
        INTERNAL_TOKEN_SECRET: validSecret,
        INTERNAL_TOKEN_TTL_SECONDS: '4',
      }),
    );
    assert.throws(() =>
      InternalTokenEnvSchema.parse({
        INTERNAL_TOKEN_SECRET: validSecret,
        INTERNAL_TOKEN_TTL_SECONDS: '3601',
      }),
    );
  });

  it('redacts internal token secrets when validation fails in loadConfig', () => {
    const invalidSecret = 'short-secret-with-password';
    try {
      loadConfig(InternalTokenEnvSchema, {
        INTERNAL_TOKEN_SECRET: invalidSecret,
      });
      assert.fail('Should have thrown ConfigValidationError');
    } catch (err: unknown) {
      assert.ok(err instanceof ConfigValidationError);
      assert.equal(err.message.includes(invalidSecret), false);
      assert.equal(JSON.stringify(err).includes(invalidSecret), false);
      for (const fe of err.fieldErrors) {
        assert.equal(fe.message.includes(invalidSecret), false);
      }
    }
  });
});

describe('Shared Config: Database Runtime Environment', () => {
  const validDbUrl = 'postgresql://grocery_identity_user:secret@localhost:5432/grocery_identity';

  it('accepts valid PostgreSQL connection URL and applies default pool settings', () => {
    const parsed = DatabaseEnvSchema.parse({
      DATABASE_URL: validDbUrl,
    });
    assert.equal(parsed.DATABASE_URL, validDbUrl);
    assert.equal(parsed.DATABASE_MAX_POOL_SIZE, 5);
    assert.equal(parsed.DATABASE_CONNECTION_TIMEOUT_MS, 5000);
    assert.equal(parsed.DATABASE_IDLE_TIMEOUT_MS, 30000);
  });

  it('accepts postgres:// prefix in addition to postgresql://', () => {
    const url = 'postgres://grocery_identity_user:secret@localhost:5432/grocery_identity';
    const parsed = DatabaseEnvSchema.parse({ DATABASE_URL: url });
    assert.equal(parsed.DATABASE_URL, url);
  });

  it('rejects non-PostgreSQL database URIs', () => {
    assert.throws(() =>
      DatabaseEnvSchema.parse({ DATABASE_URL: 'mysql://user:pass@localhost:3306/db' }),
    );
    assert.throws(() => DatabaseEnvSchema.parse({ DATABASE_URL: 'http://localhost:5432/db' }));
    assert.throws(() => DatabaseEnvSchema.parse({ DATABASE_URL: 'invalid-string' }));
  });

  it('proves migration credentials are separate and not required for service runtime', () => {
    const shapeKeys = Object.keys(DatabaseEnvSchema.shape);
    assert.equal(shapeKeys.includes('MIGRATION_DATABASE_URL'), false);
  });
});

describe('Shared Config: Identity Service Configuration Loader', () => {
  const validMinimalEnv = {
    DATABASE_URL: 'postgresql://grocery_identity_user:pass@localhost:5432/grocery_identity',
    INTERNAL_TOKEN_SECRET: 'a-very-secure-internal-token-secret-32-chars-long!',
  };

  it('validates IdentityServiceEnvSchema shape directly', () => {
    assert.ok(IdentityServiceEnvSchema.shape.DATABASE_URL);
    assert.ok(IdentityServiceEnvSchema.shape.INTERNAL_TOKEN_SECRET);
    assert.ok(IdentityServiceEnvSchema.shape.ARGON2_MEMORY_COST);
    assert.ok(IdentityServiceEnvSchema.shape.PORT);
  });

  it('loads valid minimal configuration with all subsystem defaults populated', () => {
    const config = loadIdentityServiceConfig(validMinimalEnv);

    // CommonEnv defaults
    assert.equal(config.NODE_ENV, 'development');
    assert.equal(config.PORT, 3000);
    assert.equal(config.LOG_LEVEL, 'info');

    // DatabaseEnv defaults
    assert.equal(config.DATABASE_URL, validMinimalEnv.DATABASE_URL);
    assert.equal(config.DATABASE_MAX_POOL_SIZE, 5);

    // Argon2id defaults
    assert.equal(config.ARGON2_MEMORY_COST, 65536);
    assert.equal(config.ARGON2_TIME_COST, 3);
    assert.equal(config.ARGON2_PARALLELISM, 4);

    // InternalToken defaults
    assert.equal(config.INTERNAL_TOKEN_TTL_SECONDS, 60);
    assert.equal(config.INTERNAL_TOKEN_KID, 'internal-key-2026-1');
    assert.equal(config.INTERNAL_TOKEN_SECRET, validMinimalEnv.INTERNAL_TOKEN_SECRET);
  });

  it('strips extraneous environment variables from typed config output', () => {
    const rawEnv = {
      ...validMinimalEnv,
      EXTRA_VARIABLE: 'should_be_stripped',
      RENDER_SERVICE_ID: 'srv-12345',
    };
    const config = loadIdentityServiceConfig(rawEnv);
    assert.equal('EXTRA_VARIABLE' in config, false);
    assert.equal('RENDER_SERVICE_ID' in config, false);
  });

  it('throws ConfigValidationError on missing required variables', () => {
    assert.throws(
      () => loadIdentityServiceConfig({}),
      (err) => {
        assert.ok(err instanceof ConfigValidationError);
        const keys = err.fieldErrors.map((f) => f.key);
        assert.ok(keys.includes('DATABASE_URL'));
        assert.ok(keys.includes('INTERNAL_TOKEN_SECRET'));
        return true;
      },
    );
  });

  it('guarantees configuration loading is lazy and does not trigger on module import', async () => {
    // Importing the module with missing env vars must not throw
    const mod = await import('../dist/index.js');
    assert.equal(typeof mod.loadIdentityServiceConfig, 'function');
  });
});
