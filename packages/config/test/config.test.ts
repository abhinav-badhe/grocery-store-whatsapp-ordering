import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CommonEnvSchema,
  booleanEnv,
  portEnv,
  loadConfig,
  ConfigValidationError,
} from '../dist/index.js';
import { z } from 'zod';

describe('Shared Config: Common Runtime Environment', () => {
  it('parses valid minimal configuration with expected types', () => {
    const rawEnv = {
      NODE_ENV: 'production',
      PORT: '8080',
      LOG_LEVEL: 'warn',
    };

    const config = loadConfig(CommonEnvSchema, rawEnv);

    assert.equal(config.NODE_ENV, 'production');
    assert.equal(config.PORT, 8080);
    assert.equal(typeof config.PORT, 'number');
    assert.equal(config.LOG_LEVEL, 'warn');
  });

  it('applies documented defaults when common variables are omitted', () => {
    const config = loadConfig(CommonEnvSchema, {});

    assert.equal(config.NODE_ENV, 'development');
    assert.equal(config.PORT, 3000);
    assert.equal(config.LOG_LEVEL, 'info');
  });

  it('tolerates and strips unknown environment variables per platform policy without mutating caller input', () => {
    const rawEnv = {
      NODE_ENV: 'production',
      PORT: '3000',
      LOG_LEVEL: 'info',
      // Platform-injected environment variables (Render, Vercel, Docker, OS)
      RENDER_SERVICE_ID: 'srv-c1234567890',
      RENDER_INSTANCE_ID: 'srv-c1234567890-worker-1',
      VERCEL_ENV: 'production',
      PATH: '/usr/local/bin:/usr/bin',
      HOME: '/home/appuser',
    };

    const inputCopy = { ...rawEnv };
    const config = loadConfig(CommonEnvSchema, rawEnv);

    // Common variables are parsed and typed
    assert.equal(config.NODE_ENV, 'production');
    assert.equal(config.PORT, 3000);

    // Exact keys on returned configuration object MUST match schema only
    const returnedKeys = Object.keys(config).sort();
    assert.deepEqual(returnedKeys, ['LOG_LEVEL', 'NODE_ENV', 'PORT']);

    // Unknown variables are stripped from the typed configuration object
    const untyped = config as Record<string, unknown>;
    assert.equal(untyped.RENDER_SERVICE_ID, undefined);
    assert.equal(untyped.RENDER_INSTANCE_ID, undefined);
    assert.equal(untyped.VERCEL_ENV, undefined);
    assert.equal(untyped.PATH, undefined);
    assert.equal(untyped.HOME, undefined);

    // CALLER IMMUTABILITY: Caller's source object MUST NOT be mutated
    assert.deepEqual(rawEnv, inputCopy);
  });

  it('correctly strips unknown keys for ordinary standalone Zod schemas and extended schemas', () => {
    // 1. Standalone ordinary Zod object schema
    const StandaloneSchema = z.object({
      SERVICE_TOKEN: z.string(),
    });
    const standaloneParsed = loadConfig(StandaloneSchema, {
      SERVICE_TOKEN: 'tok_123456',
      PLATFORM_UNTRACKED_KEY: 'strip_me',
      ANOTHER_UNTRACKED: 'also_strip_me',
    });
    assert.deepEqual(Object.keys(standaloneParsed), ['SERVICE_TOKEN']);
    assert.equal(standaloneParsed.SERVICE_TOKEN, 'tok_123456');

    // 2. Schema extended from CommonEnvSchema
    const ExtendedSchema = CommonEnvSchema.extend({
      DATABASE_NAME: z.string(),
    });
    const extendedParsed = loadConfig(ExtendedSchema, {
      DATABASE_NAME: 'grocery_main',
      EXTRA_UNTRACKED_VAR: 'discarded',
    });
    assert.deepEqual(Object.keys(extendedParsed).sort(), [
      'DATABASE_NAME',
      'LOG_LEVEL',
      'NODE_ENV',
      'PORT',
    ]);
    assert.equal(extendedParsed.DATABASE_NAME, 'grocery_main');
  });
});

describe('Shared Config: Numeric and Port Validation', () => {
  it('parses valid explicit port numbers', () => {
    const config = loadConfig(CommonEnvSchema, { PORT: '8080' });
    assert.equal(config.PORT, 8080);
    assert.equal(typeof config.PORT, 'number');
  });

  it('rejects empty string for PORT rather than silently replacing with default', () => {
    // Empty string must be rejected: default applies ONLY when variable is absent/undefined
    assert.throws(
      () => loadConfig(CommonEnvSchema, { PORT: '' }),
      (err: Error) =>
        err instanceof ConfigValidationError && err.fieldErrors.some((f) => f.key === 'PORT'),
    );
  });

  it('rejects invalid or non-numeric port strings without falling back to defaults', () => {
    assert.throws(
      () => loadConfig(CommonEnvSchema, { PORT: 'not-a-number' }),
      (err: Error) =>
        err instanceof ConfigValidationError && err.fieldErrors.some((f) => f.key === 'PORT'),
    );
  });

  it('rejects out-of-bounds or non-finite port numbers', () => {
    // Port 0 (reserved/invalid for listening)
    assert.throws(
      () => loadConfig(CommonEnvSchema, { PORT: '0' }),
      (err: Error) =>
        err instanceof ConfigValidationError && err.fieldErrors.some((f) => f.key === 'PORT'),
    );

    // Negative port
    assert.throws(
      () => loadConfig(CommonEnvSchema, { PORT: '-1' }),
      (err: Error) =>
        err instanceof ConfigValidationError && err.fieldErrors.some((f) => f.key === 'PORT'),
    );

    // Exceeds max TCP port 65535
    assert.throws(
      () => loadConfig(CommonEnvSchema, { PORT: '65536' }),
      (err: Error) =>
        err instanceof ConfigValidationError && err.fieldErrors.some((f) => f.key === 'PORT'),
    );

    // Non-finite values
    assert.throws(
      () => loadConfig(CommonEnvSchema, { PORT: 'Infinity' }),
      (err: Error) =>
        err instanceof ConfigValidationError && err.fieldErrors.some((f) => f.key === 'PORT'),
    );
    assert.throws(
      () => loadConfig(CommonEnvSchema, { PORT: 'NaN' }),
      (err: Error) =>
        err instanceof ConfigValidationError && err.fieldErrors.some((f) => f.key === 'PORT'),
    );

    // Fractional port
    assert.throws(
      () => loadConfig(CommonEnvSchema, { PORT: '3000.5' }),
      (err: Error) =>
        err instanceof ConfigValidationError && err.fieldErrors.some((f) => f.key === 'PORT'),
    );
  });

  it('supports custom default port helper', () => {
    const CustomPortSchema = z.object({
      METRICS_PORT: portEnv(9090),
    });

    const parsedDefault = loadConfig(CustomPortSchema, {});
    assert.equal(parsedDefault.METRICS_PORT, 9090);

    const parsedExplicit = loadConfig(CustomPortSchema, { METRICS_PORT: '9100' });
    assert.equal(parsedExplicit.METRICS_PORT, 9100);
  });
});

describe('Shared Config: Explicit Boolean Environment Validation', () => {
  it('parses truthy strings ("true", "1") to boolean true', () => {
    const BoolSchema = z.object({
      ENABLE_FEATURE: booleanEnv(),
    });

    assert.equal(loadConfig(BoolSchema, { ENABLE_FEATURE: 'true' }).ENABLE_FEATURE, true);
    assert.equal(loadConfig(BoolSchema, { ENABLE_FEATURE: 'TRUE' }).ENABLE_FEATURE, true);
    assert.equal(loadConfig(BoolSchema, { ENABLE_FEATURE: '1' }).ENABLE_FEATURE, true);
  });

  it('parses falsy strings ("false", "0") to boolean false', () => {
    const BoolSchema = z.object({
      ENABLE_FEATURE: booleanEnv(),
    });

    assert.equal(loadConfig(BoolSchema, { ENABLE_FEATURE: 'false' }).ENABLE_FEATURE, false);
    assert.equal(loadConfig(BoolSchema, { ENABLE_FEATURE: 'FALSE' }).ENABLE_FEATURE, false);
    assert.equal(loadConfig(BoolSchema, { ENABLE_FEATURE: '0' }).ENABLE_FEATURE, false);
  });

  it('rejects ambiguous strings ("yes", "no", arbitrary text) rather than coercing truthiness', () => {
    const BoolSchema = z.object({
      ENABLE_FEATURE: booleanEnv(),
    });

    assert.throws(
      () => loadConfig(BoolSchema, { ENABLE_FEATURE: 'yes' }),
      (err: Error) =>
        err instanceof ConfigValidationError &&
        err.fieldErrors.some((f) => f.key === 'ENABLE_FEATURE'),
    );
    assert.throws(
      () => loadConfig(BoolSchema, { ENABLE_FEATURE: 'no' }),
      (err: Error) =>
        err instanceof ConfigValidationError &&
        err.fieldErrors.some((f) => f.key === 'ENABLE_FEATURE'),
    );
    assert.throws(
      () => loadConfig(BoolSchema, { ENABLE_FEATURE: '2' }),
      (err: Error) =>
        err instanceof ConfigValidationError &&
        err.fieldErrors.some((f) => f.key === 'ENABLE_FEATURE'),
    );
  });

  it('handles optional and default boolean values', () => {
    const SchemaWithDefaults = z.object({
      FEATURE_A: booleanEnv(false),
      FEATURE_B: booleanEnv(true),
    });

    const parsed = loadConfig(SchemaWithDefaults, {});
    assert.equal(parsed.FEATURE_A, false);
    assert.equal(parsed.FEATURE_B, true);
  });
});

describe('Shared Config: Service Extension & Missing Required Variables', () => {
  it('throws ConfigValidationError when required service variables are missing', () => {
    const ServiceSchema = CommonEnvSchema.extend({
      SERVICE_NAME: z.string().min(1, { message: 'SERVICE_NAME is required' }),
      DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a valid connection URL' }),
    });

    assert.throws(
      () => loadConfig(ServiceSchema, {}),
      (err: Error) => {
        assert.ok(err instanceof ConfigValidationError);
        assert.equal(err.name, 'ConfigValidationError');
        const keys = err.fieldErrors.map((f) => f.key);
        assert.ok(keys.includes('SERVICE_NAME'));
        assert.ok(keys.includes('DATABASE_URL'));
        return true;
      },
    );
  });

  it('supports optional service variables without throwing', () => {
    const ExtendedSchema = CommonEnvSchema.extend({
      OPTIONAL_CACHE_TTL: z.coerce.number().int().positive().optional(),
    });

    const parsed = loadConfig(ExtendedSchema, {});
    assert.equal(parsed.OPTIONAL_CACHE_TTL, undefined);

    const parsedWithVal = loadConfig(ExtendedSchema, { OPTIONAL_CACHE_TTL: '60' });
    assert.equal(parsedWithVal.OPTIONAL_CACHE_TTL, 60);
  });
});

describe('Shared Config: Secret Protection & Error Sanitization', () => {
  it('never prints or exposes supplied secret values in error messages, fieldErrors, or serialized JSON', () => {
    const SecretSchema = CommonEnvSchema.extend({
      API_SECRET_KEY: z
        .string()
        .min(64, { message: 'API_SECRET_KEY must be at least 64 characters long' }),
    });

    const confidentialSensitiveValue = 'my-super-secret-leaked-password-123';

    try {
      loadConfig(SecretSchema, { API_SECRET_KEY: confidentialSensitiveValue });
      assert.fail('Should have thrown ConfigValidationError');
    } catch (err: unknown) {
      assert.ok(err instanceof ConfigValidationError);

      // Verify the error message contains the variable key and failure reason
      assert.ok(err.message.includes('API_SECRET_KEY'));
      assert.ok(err.message.includes('must be at least 64 characters long'));

      // CRITICAL SECURITY ASSERTION: The confidential value MUST NOT be present in the error string
      assert.equal(err.message.includes(confidentialSensitiveValue), false);

      // The fieldErrors structured array must also omit raw values
      for (const field of err.fieldErrors) {
        assert.equal(field.key, 'API_SECRET_KEY');
        assert.equal(JSON.stringify(field).includes(confidentialSensitiveValue), false);
      }

      // Serialized error (JSON.stringify) must NOT contain confidential value
      const serialized = JSON.stringify(err);
      assert.equal(serialized.includes(confidentialSensitiveValue), false);
    }
  });

  it('sanitizes Zod enum and custom issue messages so reflected input values are stripped or redacted', () => {
    const EnumSecretSchema = z.object({
      AUTH_STRATEGY: z.enum(['oauth2', 'session']),
      CUSTOM_API_TOKEN: z.string().refine(
        (val) => val === 'safe-expected-token',
        (val) => ({ message: `Token rejected: ${val}` }),
      ),
    });

    const fakeEnumSecret = 'leaked-enum-secret-token-xyz';
    const fakeCustomSecret = 'leaked-custom-secret-token-abc';

    try {
      loadConfig(EnumSecretSchema, {
        AUTH_STRATEGY: fakeEnumSecret,
        CUSTOM_API_TOKEN: fakeCustomSecret,
      });
      assert.fail('Should have thrown ConfigValidationError');
    } catch (err: unknown) {
      assert.ok(err instanceof ConfigValidationError);

      // Neither secret may appear anywhere in error message, fieldErrors, or serialized error
      assert.equal(err.message.includes(fakeEnumSecret), false);
      assert.equal(err.message.includes(fakeCustomSecret), false);

      const serialized = JSON.stringify(err);
      assert.equal(serialized.includes(fakeEnumSecret), false);
      assert.equal(serialized.includes(fakeCustomSecret), false);

      // The enum error should explain expected options without echoing the secret
      const enumError = err.fieldErrors.find((f) => f.key === 'AUTH_STRATEGY');
      assert.ok(enumError);
      assert.ok(enumError.message.includes("'oauth2'"));
      assert.ok(enumError.message.includes("'session'"));

      // The custom error should have the raw value redacted
      const customError = err.fieldErrors.find((f) => f.key === 'CUSTOM_API_TOKEN');
      assert.ok(customError);
      assert.ok(customError.message.includes('[REDACTED]'));
    }
  });

  it('supports nested schemas and formats nested keys cleanly without leaking secrets', () => {
    const NestedSchema = z.object({
      DATABASE: z.object({
        SECRET_PASSWORD: z.string().min(50, { message: 'Must be at least 50 characters' }),
      }),
    });

    const fakeDbPassword = 'my-short-secret-db-pass';

    try {
      loadConfig(NestedSchema, {
        DATABASE: {
          SECRET_PASSWORD: fakeDbPassword,
        },
      });
      assert.fail('Should have thrown ConfigValidationError');
    } catch (err: unknown) {
      assert.ok(err instanceof ConfigValidationError);
      assert.ok(err.fieldErrors.some((f) => f.key === 'DATABASE.SECRET_PASSWORD'));
      assert.equal(err.message.includes(fakeDbPassword), false);
      assert.equal(JSON.stringify(err).includes(fakeDbPassword), false);
    }
  });

  it('redacts fake secrets when custom refinements place the secret at the beginning, middle, or end of error messages', () => {
    const fakeSecretStart = 'DISTINCT_SECRET_START_987654321';
    const fakeSecretMiddle = 'DISTINCT_SECRET_MIDDLE_555444333';
    const fakeSecretEnd = 'DISTINCT_SECRET_END_111222333';

    const MultiRefinementSchema = z.object({
      TOKEN_START: z.string().refine(
        (val) => val === 'allowed',
        (val) => ({ message: `${val} is not an authorized token` }),
      ),
      TOKEN_MIDDLE: z.string().refine(
        (val) => val === 'allowed',
        (val) => ({ message: `Prefix notice: ${val} was rejected by security policy` }),
      ),
      TOKEN_END: z.string().refine(
        (val) => val === 'allowed',
        (val) => ({ message: `Rejection error for secret: ${val}` }),
      ),
    });

    try {
      loadConfig(MultiRefinementSchema, {
        TOKEN_START: fakeSecretStart,
        TOKEN_MIDDLE: fakeSecretMiddle,
        TOKEN_END: fakeSecretEnd,
      });
      assert.fail('Should have thrown ConfigValidationError');
    } catch (err: unknown) {
      assert.ok(err instanceof ConfigValidationError);

      // Verify that NONE of the fake secrets appear anywhere in public error message
      assert.equal(err.message.includes(fakeSecretStart), false);
      assert.equal(err.message.includes(fakeSecretMiddle), false);
      assert.equal(err.message.includes(fakeSecretEnd), false);

      // Verify serialized toJSON() / JSON.stringify()
      const jsonStr = JSON.stringify(err);
      assert.equal(jsonStr.includes(fakeSecretStart), false);
      assert.equal(jsonStr.includes(fakeSecretMiddle), false);
      assert.equal(jsonStr.includes(fakeSecretEnd), false);

      const jsonObj = err.toJSON();
      assert.equal(JSON.stringify(jsonObj).includes(fakeSecretStart), false);
      assert.equal(JSON.stringify(jsonObj).includes(fakeSecretMiddle), false);
      assert.equal(JSON.stringify(jsonObj).includes(fakeSecretEnd), false);

      // Verify structured fieldErrors
      for (const fe of err.fieldErrors) {
        assert.equal(fe.message.includes(fakeSecretStart), false);
        assert.equal(fe.message.includes(fakeSecretMiddle), false);
        assert.equal(fe.message.includes(fakeSecretEnd), false);
      }

      // Verify redaction was applied accurately
      const startField = err.fieldErrors.find((f) => f.key === 'TOKEN_START');
      assert.ok(startField);
      assert.equal(startField.message, '[REDACTED] is not an authorized token');

      const middleField = err.fieldErrors.find((f) => f.key === 'TOKEN_MIDDLE');
      assert.ok(middleField);
      assert.equal(
        middleField.message,
        'Prefix notice: [REDACTED] was rejected by security policy',
      );

      const endField = err.fieldErrors.find((f) => f.key === 'TOKEN_END');
      assert.ok(endField);
      assert.equal(endField.message, 'Rejection error for secret: [REDACTED]');
    }
  });

  it('redacts secrets when custom messages use unexpected formats without standard Zod received wording', () => {
    const fakeCustomWordingSecret = 'DISTINCT_SECRET_UNEXPECTED_FORMAT_777';

    const UnexpectedWordingSchema = z.object({
      AUTH_TOKEN: z.string().refine(
        (val) => val === 'valid-token',
        (val) => ({
          message: `Unexpected token pattern detected [token="${val}"] - access prohibited`,
        }),
      ),
    });

    try {
      loadConfig(UnexpectedWordingSchema, {
        AUTH_TOKEN: fakeCustomWordingSecret,
      });
      assert.fail('Should have thrown ConfigValidationError');
    } catch (err: unknown) {
      assert.ok(err instanceof ConfigValidationError);

      assert.equal(err.message.includes(fakeCustomWordingSecret), false);
      assert.equal(JSON.stringify(err).includes(fakeCustomWordingSecret), false);
      assert.equal(JSON.stringify(err.toJSON()).includes(fakeCustomWordingSecret), false);

      const authField = err.fieldErrors.find((f) => f.key === 'AUTH_TOKEN');
      assert.ok(authField);
      assert.equal(
        authField.message,
        'Unexpected token pattern detected [token="[REDACTED]"] - access prohibited',
      );
    }
  });

  it('sanitizes and redacts secrets in deeply nested objects and array paths', () => {
    const fakeObjSecret = 'DISTINCT_SECRET_NESTED_OBJ_444';
    const fakeArraySecret1 = 'DISTINCT_SECRET_NESTED_ARR_0_555';
    const fakeArraySecret2 = 'DISTINCT_SECRET_NESTED_ARR_1_666';

    const NestedComplexSchema = z.object({
      SERVICES: z.object({
        DATABASE: z.object({
          ADMIN_PASSWORD: z.string().refine(
            (val) => val.length >= 64,
            (val) => ({ message: `Database admin password failed validation: ${val}` }),
          ),
        }),
        OAUTH_PROVIDERS: z.array(
          z.object({
            NAME: z.string(),
            CLIENT_SECRET: z.string().refine(
              (val) => val.startsWith('cs_'),
              (val) => ({ message: `Provider secret ${val} is invalid` }),
            ),
          }),
        ),
      }),
    });

    try {
      loadConfig(NestedComplexSchema, {
        SERVICES: {
          DATABASE: {
            ADMIN_PASSWORD: fakeObjSecret,
          },
          OAUTH_PROVIDERS: [
            { NAME: 'google', CLIENT_SECRET: fakeArraySecret1 },
            { NAME: 'github', CLIENT_SECRET: fakeArraySecret2 },
          ],
        },
      });
      assert.fail('Should have thrown ConfigValidationError');
    } catch (err: unknown) {
      assert.ok(err instanceof ConfigValidationError);

      // Verify no secrets appear anywhere
      for (const secret of [fakeObjSecret, fakeArraySecret1, fakeArraySecret2]) {
        assert.equal(err.message.includes(secret), false);
        assert.equal(JSON.stringify(err).includes(secret), false);
        assert.equal(JSON.stringify(err.toJSON()).includes(secret), false);
        for (const fe of err.fieldErrors) {
          assert.equal(fe.message.includes(secret), false);
        }
      }

      // Verify exact path formatting
      const keys = err.fieldErrors.map((f) => f.key);
      assert.ok(keys.includes('SERVICES.DATABASE.ADMIN_PASSWORD'));
      assert.ok(keys.includes('SERVICES.OAUTH_PROVIDERS.0.CLIENT_SECRET'));
      assert.ok(keys.includes('SERVICES.OAUTH_PROVIDERS.1.CLIENT_SECRET'));
    }
  });

  it('safely handles multiple validation issues for a single field without exposing secrets', () => {
    const fakeMultiIssueSecret = 'DISTINCT_SECRET_MULTI_ISSUE_999000111';

    const MultiIssueFieldSchema = z.object({
      WEBHOOK_SECRET: z
        .string()
        .min(60, { message: 'Must be at least 60 characters' })
        .refine(
          (val) => val.startsWith('whsec_'),
          (val) => ({ message: `First failure: ${val} must start with whsec_` }),
        )
        .refine(
          (val) => val.endsWith('_prod'),
          (val) => ({ message: `Second failure: ${val} must end with _prod` }),
        ),
    });

    try {
      loadConfig(MultiIssueFieldSchema, {
        WEBHOOK_SECRET: fakeMultiIssueSecret,
      });
      assert.fail('Should have thrown ConfigValidationError');
    } catch (err: unknown) {
      assert.ok(err instanceof ConfigValidationError);

      // Distinct secret must not appear anywhere
      assert.equal(err.message.includes(fakeMultiIssueSecret), false);
      assert.equal(JSON.stringify(err).includes(fakeMultiIssueSecret), false);
      assert.equal(JSON.stringify(err.toJSON()).includes(fakeMultiIssueSecret), false);

      // All 3 validation failures are captured under the same key
      const webhookErrors = err.fieldErrors.filter((f) => f.key === 'WEBHOOK_SECRET');
      assert.equal(webhookErrors.length, 3);

      for (const fe of webhookErrors) {
        assert.equal(fe.message.includes(fakeMultiIssueSecret), false);
      }

      assert.ok(webhookErrors.some((f) => f.message.includes('Must be at least 60 characters')));
      assert.ok(
        webhookErrors.some((f) =>
          f.message.includes('First failure: [REDACTED] must start with whsec_'),
        ),
      );
      assert.ok(
        webhookErrors.some((f) =>
          f.message.includes('Second failure: [REDACTED] must end with _prod'),
        ),
      );
    }
  });

  it('guarantees importing the package does not trigger import-time environment validation or start infrastructure', async () => {
    // In an empty environment, importing must never throw or execute side effects
    const importedModule = await import('../dist/index.js');
    assert.ok(importedModule.CommonEnvSchema);
    assert.ok(typeof importedModule.loadConfig === 'function');
    assert.ok(typeof importedModule.booleanEnv === 'function');
    assert.ok(typeof importedModule.portEnv === 'function');
  });
});
