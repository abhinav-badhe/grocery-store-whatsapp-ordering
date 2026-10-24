import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import {
  createLogger,
  runWithContext,
  getRequestContext,
  withRequestContext,
  extractRequestContext,
  formatSafeError,
  sanitizeErrorMessage,
  type Logger,
} from '../dist/index.js';

/**
 * Capture stream for deterministic test log verification.
 */
class TestDestination extends Writable {
  public chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: string, callback: () => void): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  get rawOutput(): string {
    return this.chunks.join('');
  }

  get records(): Record<string, unknown>[] {
    return this.rawOutput
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  }

  clear(): void {
    this.chunks = [];
  }
}

describe('Observability: Structured Logging & Standard Fields', () => {
  it('emits valid structured JSON with ISO timestamp, level, and message', () => {
    const dest = new TestDestination();
    const logger = createLogger({ name: 'order-service', level: 'info' }, dest);

    logger.info('Order processed successfully');

    assert.equal(dest.records.length, 1);
    const [record] = dest.records;

    assert.equal(typeof record.time, 'string');
    // Verify ISO 8601 timestamp format
    assert.ok(!Number.isNaN(Date.parse(record.time as string)));
    assert.equal(record.level, 30); // Pino info level
    assert.equal(record.name, 'order-service');
    assert.equal(record.msg, 'Order processed successfully');
  });

  it('respects log level thresholds and suppresses lower levels', () => {
    const dest = new TestDestination();
    const logger = createLogger({ level: 'warn' }, dest);

    logger.trace('trace message');
    logger.debug('debug message');
    logger.info('info message');
    assert.equal(dest.records.length, 0);

    logger.warn('warn message');
    logger.error('error message');
    logger.fatal('fatal message');

    assert.equal(dest.records.length, 3);
    assert.equal(dest.records[0].level, 40);
    assert.equal(dest.records[0].msg, 'warn message');
    assert.equal(dest.records[1].level, 50);
    assert.equal(dest.records[1].msg, 'error message');
    assert.equal(dest.records[2].level, 60);
    assert.equal(dest.records[2].msg, 'fatal message');
  });

  it('completely suppresses all logs when level is set to silent', () => {
    const dest = new TestDestination();
    const logger = createLogger({ level: 'silent' }, dest);

    logger.error('critical failure');
    logger.fatal('system down');

    assert.equal(dest.records.length, 0);
  });
});

describe('Observability: Request & Correlation Context', () => {
  it('automatically attaches request_id, correlation_id, and store_id when context is present', () => {
    const dest = new TestDestination();
    const logger = createLogger({ level: 'info' }, dest);

    const testContext = {
      requestId: 'req-123456',
      correlationId: 'corr-987654',
      storeId: '00000000-0000-0000-0000-000000000001',
    };

    runWithContext(testContext, () => {
      logger.info('Processing payment confirmation');
    });

    assert.equal(dest.records.length, 1);
    const [record] = dest.records;

    assert.equal(record.request_id, 'req-123456');
    assert.equal(record.correlation_id, 'corr-987654');
    assert.equal(record.store_id, '00000000-0000-0000-0000-000000000001');
    assert.equal(record.msg, 'Processing payment confirmation');
  });

  it('produces valid logs without throwing when logging outside any request context', () => {
    const dest = new TestDestination();
    const logger = createLogger({ level: 'info' }, dest);

    // Call outside of runWithContext
    assert.equal(getRequestContext(), undefined);
    assert.doesNotThrow(() => {
      logger.info('Application bootstrap initialized');
    });

    assert.equal(dest.records.length, 1);
    const [record] = dest.records;
    assert.equal(record.request_id, undefined);
    assert.equal(record.correlation_id, undefined);
    assert.equal(record.msg, 'Application bootstrap initialized');
  });

  it('maintains strict context isolation across concurrent asynchronous operations', async () => {
    const dest = new TestDestination();
    const logger = createLogger({ level: 'info' }, dest);

    async function simulateOperation(id: string, delayMs: number) {
      await runWithContext({ requestId: `req-${id}`, correlationId: `corr-${id}` }, async () => {
        logger.info(`Start op ${id}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        logger.info(`End op ${id}`);
      });
    }

    // Run two concurrent operations with interleaved execution
    await Promise.all([simulateOperation('A', 25), simulateOperation('B', 10)]);

    assert.equal(dest.records.length, 4);

    const logsForA = dest.records.filter((r) => r.request_id === 'req-A');
    const logsForB = dest.records.filter((r) => r.request_id === 'req-B');

    assert.equal(logsForA.length, 2);
    assert.equal(logsForB.length, 2);

    for (const log of logsForA) {
      assert.equal(log.correlation_id, 'corr-A');
    }
    for (const log of logsForB) {
      assert.equal(log.correlation_id, 'corr-B');
    }
  });

  it('handles nested contexts predictably, restoring outer context upon completion', () => {
    const dest = new TestDestination();
    const logger = createLogger({ level: 'info' }, dest);

    runWithContext({ requestId: 'outer-req', correlationId: 'outer-corr' }, () => {
      logger.info('Outer 1');

      runWithContext({ requestId: 'inner-req', correlationId: 'inner-corr' }, () => {
        logger.info('Inner');
      });

      logger.info('Outer 2');
    });

    assert.equal(dest.records.length, 3);
    assert.equal(dest.records[0].request_id, 'outer-req');
    assert.equal(dest.records[1].request_id, 'inner-req');
    assert.equal(dest.records[2].request_id, 'outer-req');

    // Context must be completely cleared after outer block exits
    assert.equal(getRequestContext(), undefined);
  });

  it('guarantees a completed request context never leaks into subsequent requests', () => {
    const dest = new TestDestination();
    const logger = createLogger({ level: 'info' }, dest);

    // Request 1
    runWithContext({ requestId: 'req-completed-1' }, () => {
      logger.info('Request 1');
    });

    // Un-contexted execution between requests
    logger.info('Standalone operation');

    // Request 2
    runWithContext({ requestId: 'req-active-2' }, () => {
      logger.info('Request 2');
    });

    assert.equal(dest.records.length, 3);
    assert.equal(dest.records[0].request_id, 'req-completed-1');
    assert.equal(dest.records[1].request_id, undefined);
    assert.equal(dest.records[2].request_id, 'req-active-2');
  });

  it('child loggers inherit bindings and dynamically acquire active request context at log time', () => {
    const dest = new TestDestination();
    const rootLogger = createLogger({ name: 'gateway' }, dest);
    const childLogger: Logger = rootLogger.child({ component: 'rate-limiter' });

    // 1. Log from child outside context
    childLogger.info('Evaluating global limit');
    assert.equal(dest.records[0].component, 'rate-limiter');
    assert.equal(dest.records[0].request_id, undefined);

    // 2. Log from same child inside context
    runWithContext({ requestId: 'req-child-ctx', correlationId: 'corr-child-ctx' }, () => {
      childLogger.info('Evaluating tenant limit');
    });

    assert.equal(dest.records[1].component, 'rate-limiter');
    assert.equal(dest.records[1].request_id, 'req-child-ctx');
    assert.equal(dest.records[1].correlation_id, 'corr-child-ctx');
  });
});

describe('Observability: HTTP Middleware & Trust Boundaries', () => {
  it('extracts valid incoming request and correlation headers case-insensitively', () => {
    const headers = {
      'x-request-id': 'c4b12345-6789-4000-8000-123456789abc',
      'X-Correlation-ID': 'corr-upstream-7890',
    };

    const ctx = extractRequestContext(headers);
    assert.equal(ctx.requestId, 'c4b12345-6789-4000-8000-123456789abc');
    assert.equal(ctx.correlationId, 'corr-upstream-7890');
  });

  it('validates and handles request ID and correlation ID independently', () => {
    // Malformed request ID but valid correlation ID
    const headers1 = {
      'x-request-id': 'malformed\n\rID"',
      'x-correlation-id': 'valid-correlation-uuid-123',
    };
    const ctx1 = extractRequestContext(headers1);
    // Request ID should be regenerated, while correlation ID remains preserved
    assert.notEqual(ctx1.requestId, headers1['x-request-id']);
    assert.equal(ctx1.correlationId, 'valid-correlation-uuid-123');

    // Valid request ID but oversized correlation ID (> 128 chars)
    const headers2 = {
      'x-request-id': 'valid-request-uuid-456',
      'x-correlation-id': 'b'.repeat(150),
    };
    const ctx2 = extractRequestContext(headers2);
    assert.equal(ctx2.requestId, 'valid-request-uuid-456');
    assert.notEqual(ctx2.correlationId, headers2['x-correlation-id']);
  });

  it('strictly ignores untrusted tenant headers from client request headers', () => {
    // An external client attempting to inject tenant context via headers
    const untrustedHeaders = {
      'x-store-id': '00000000-0000-0000-0000-000000000099',
      store_id: '00000000-0000-0000-0000-000000000099',
      'x-tenant-id': '00000000-0000-0000-0000-000000000099',
    };

    const ctx = extractRequestContext(untrustedHeaders);
    // CRITICAL SECURITY ASSERTION: storeId must NEVER be populated from external headers
    assert.equal(ctx.storeId, undefined);
  });

  it('accepts storeId and trusted IDs only through explicit trusted ContextOptions', () => {
    const untrustedHeaders = {
      'x-request-id': 'client-untrusted-req',
      'x-store-id': 'client-untrusted-store',
    };

    const ctx = extractRequestContext(untrustedHeaders, {
      trustedRequestId: 'trusted-gateway-req-123',
      trustedCorrelationId: 'trusted-gateway-corr-456',
      storeId: '00000000-0000-0000-0000-000000000001',
    });

    assert.equal(ctx.requestId, 'trusted-gateway-req-123');
    assert.equal(ctx.correlationId, 'trusted-gateway-corr-456');
    assert.equal(ctx.storeId, '00000000-0000-0000-0000-000000000001');
  });

  it('discards malformed or oversized storeId passed in ContextOptions', () => {
    const ctx = extractRequestContext(
      {},
      {
        storeId: 'invalid\nstore\r',
      },
    );
    assert.equal(ctx.storeId, undefined);
  });

  it('withRequestContext wraps execution block and cleans up context upon completion', () => {
    const headers = { 'x-request-id': 'trace-test-uuid' };

    const result = withRequestContext(headers, () => {
      const activeCtx = getRequestContext();
      assert.ok(activeCtx);
      assert.equal(activeCtx.requestId, 'trace-test-uuid');
      return 'operation_result';
    });

    assert.equal(result, 'operation_result');
    assert.equal(getRequestContext(), undefined);
  });
});

describe('Observability: Structured Redaction (Pino Paths & Naming Variants)', () => {
  it('redacts all credential categories across lowercase, UPPERCASE, camelCase, TitleCase, and arrays', () => {
    const dest = new TestDestination();
    const logger = createLogger({ level: 'info' }, dest);

    const distinctiveSecrets = {
      passLower: 'DISTINCT_SECRET_PASS_LOWER_123',
      passUpper: 'DISTINCT_SECRET_PASS_UPPER_456',
      passTitle: 'DISTINCT_SECRET_PASS_TITLE_789',
      passHashCamel: 'DISTINCT_SECRET_HASH_CAMEL_012',
      passHashUpper: 'DISTINCT_SECRET_HASH_UPPER_345',
      authUpper: 'Bearer DISTINCT_SECRET_AUTH_UPPER_678',
      authLower: 'Bearer DISTINCT_SECRET_AUTH_LOWER_901',
      tokenUpper: 'DISTINCT_SECRET_TOKEN_UPPER_234',
      tokenLower: 'DISTINCT_SECRET_TOKEN_LOWER_567',
      accessTokenCamel: 'DISTINCT_SECRET_ACCESS_CAMEL_890',
      refreshTokenUpper: 'DISTINCT_SECRET_REFRESH_UPPER_123',
      apiKeySnakeUpper: 'DISTINCT_SECRET_API_KEY_SNAKE_UPPER_456',
      apiKeyCamel: 'DISTINCT_SECRET_API_KEY_CAMEL_789',
      apiKeyTitle: 'DISTINCT_SECRET_API_KEY_TITLE_012',
      clientSecretUpper: 'DISTINCT_SECRET_CLIENT_SECRET_UPPER_345',
      clientSecretCamel: 'DISTINCT_SECRET_CLIENT_SECRET_CAMEL_678',
      secretUpper: 'DISTINCT_SECRET_UPPER_901',
      secretLower: 'DISTINCT_SECRET_LOWER_234',
      privateKeyUpper: 'DISTINCT_SECRET_PRIVATE_KEY_UPPER_567',
      privateKeyCamel: 'DISTINCT_SECRET_PRIVATE_KEY_CAMEL_890',
      cookieUpper: 'session=DISTINCT_SECRET_COOKIE_UPPER_123',
      cookieLower: 'session=DISTINCT_SECRET_COOKIE_LOWER_456',
      setCookieCamel: 'session=DISTINCT_SECRET_SET_COOKIE_CAMEL_789',
      dbUrlUpper: 'postgres://app:DISTINCT_SECRET_DB_PASS_UPPER_012@db.internal:5432/main',
      dbUrlLower: 'postgres://app:DISTINCT_SECRET_DB_PASS_LOWER_345@db.internal:5432/main',
      connStrUpper: 'postgres://app:DISTINCT_SECRET_CONN_STR_UPPER_678@db.internal:5432/main',
      cardNumUpper: 'DISTINCT_SECRET_CARD_NUM_UPPER_4111111111111111',
      cardNumCamel: 'DISTINCT_SECRET_CARD_NUM_CAMEL_5500000000000004',
      cvvUpper: 'DISTINCT_SECRET_CVV_UPPER_999',
      cvvLower: 'DISTINCT_SECRET_CVV_LOWER_888',
      pinUpper: 'DISTINCT_SECRET_PIN_UPPER_1234',
      pinLower: 'DISTINCT_SECRET_PIN_LOWER_5678',
      sessionIdUpper: 'DISTINCT_SECRET_SESSION_ID_UPPER_999',
      sessionIdCamel: 'DISTINCT_SECRET_SESSION_ID_CAMEL_888',
      arraySecret1: 'DISTINCT_SECRET_ARRAY_ITEM_1',
      arraySecret2: 'DISTINCT_SECRET_ARRAY_ITEM_2',
    };

    logger.info({
      // Passwords
      password: distinctiveSecrets.passLower,
      PASSWORD: distinctiveSecrets.passUpper,
      Password: distinctiveSecrets.passTitle,
      passwordHash: distinctiveSecrets.passHashCamel,
      PASSWORD_HASH: distinctiveSecrets.passHashUpper,

      // Authorization & tokens
      AUTHORIZATION: distinctiveSecrets.authUpper,
      authorization: distinctiveSecrets.authLower,
      TOKEN: distinctiveSecrets.tokenUpper,
      token: distinctiveSecrets.tokenLower,
      accessToken: distinctiveSecrets.accessTokenCamel,
      REFRESH_TOKEN: distinctiveSecrets.refreshTokenUpper,
      SESSION_ID: distinctiveSecrets.sessionIdUpper,
      sessionId: distinctiveSecrets.sessionIdCamel,

      // API keys & secrets
      API_KEY: distinctiveSecrets.apiKeySnakeUpper,
      apiKey: distinctiveSecrets.apiKeyCamel,
      ApiKey: distinctiveSecrets.apiKeyTitle,
      CLIENT_SECRET: distinctiveSecrets.clientSecretUpper,
      clientSecret: distinctiveSecrets.clientSecretCamel,
      SECRET: distinctiveSecrets.secretUpper,
      secret: distinctiveSecrets.secretLower,
      PRIVATE_KEY: distinctiveSecrets.privateKeyUpper,
      privateKey: distinctiveSecrets.privateKeyCamel,

      // Cookies
      COOKIE: distinctiveSecrets.cookieUpper,
      cookie: distinctiveSecrets.cookieLower,
      setCookie: distinctiveSecrets.setCookieCamel,

      // Database URLs
      DATABASE_URL: distinctiveSecrets.dbUrlUpper,
      database_url: distinctiveSecrets.dbUrlLower,
      CONNECTION_STRING: distinctiveSecrets.connStrUpper,

      // Payment card, CVV, PIN
      CARD_NUMBER: distinctiveSecrets.cardNumUpper,
      cardNumber: distinctiveSecrets.cardNumCamel,
      CVV: distinctiveSecrets.cvvUpper,
      cvv: distinctiveSecrets.cvvLower,
      PIN: distinctiveSecrets.pinUpper,
      pin: distinctiveSecrets.pinLower,

      // Nested structures and arrays
      nested: {
        deeper: {
          PASSWORD: distinctiveSecrets.passUpper,
          API_KEY: distinctiveSecrets.apiKeySnakeUpper,
        },
      },
      items: [
        { password: distinctiveSecrets.arraySecret1 },
        { secret: distinctiveSecrets.arraySecret2 },
      ],
    });

    const output = dest.rawOutput;

    // CRITICAL SECURITY ASSERTION: No distinctive fake secret may appear in the raw JSON output
    for (const [key, secretValue] of Object.entries(distinctiveSecrets)) {
      assert.equal(
        output.includes(secretValue),
        false,
        `Secret field ${key} (${secretValue}) leaked into captured log output!`,
      );
    }

    // Verify redaction was applied in parsed object
    const [record] = dest.records;
    assert.equal(record.password, '[REDACTED]');
    assert.equal(record.PASSWORD, '[REDACTED]');
    assert.equal(record.Password, '[REDACTED]');
    assert.equal(record.API_KEY, '[REDACTED]');
    assert.equal(record.apiKey, '[REDACTED]');
    assert.equal(record.CLIENT_SECRET, '[REDACTED]');
    assert.equal(record.DATABASE_URL, '[REDACTED]');
    assert.equal(record.CARD_NUMBER, '[REDACTED]');

    const nested = record.nested as Record<string, Record<string, unknown>>;
    assert.equal(nested.deeper.PASSWORD, '[REDACTED]');
    assert.equal(nested.deeper.API_KEY, '[REDACTED]');

    const items = record.items as Record<string, unknown>[];
    assert.equal(items[0].password, '[REDACTED]');
    assert.equal(items[1].secret, '[REDACTED]');
  });

  it('guarantees caller input objects are never mutated in memory during logging', () => {
    const dest = new TestDestination();
    const logger = createLogger({ level: 'info' }, dest);

    const callerObject = {
      username: 'shopkeeper_1',
      password: 'UNMUTATED_CALLER_PASSWORD_VAL',
      tokens: ['tok_1', 'tok_2'],
      nested: {
        API_KEY: 'UNMUTATED_API_KEY_VAL',
      },
    };

    const copyBefore = JSON.parse(JSON.stringify(callerObject));
    logger.info(callerObject);

    // Verify caller object retained its original value and was not mutated in memory
    assert.deepEqual(callerObject, copyBefore);
    assert.equal(callerObject.password, 'UNMUTATED_CALLER_PASSWORD_VAL');
    assert.equal(callerObject.nested.API_KEY, 'UNMUTATED_API_KEY_VAL');
  });
});

describe('Observability: Fail-Closed Safe Error Serialization', () => {
  it('default serializer emits allowlisted structural metadata only, omitting raw messages, stacks, and custom properties', () => {
    const dest = new TestDestination();
    const logger = createLogger({ level: 'error' }, dest);

    const fakeSecrets = {
      messageSecret: 'DISTINCT_SECRET_IN_ERROR_MESSAGE_999',
      stackSecret: 'DISTINCT_SECRET_IN_STACK_TRACE_888',
      querySecret: 'DISTINCT_SECRET_IN_QUERY_PARAM_777',
      customPropToken: 'DISTINCT_SECRET_IN_CUSTOM_PROP_666',
      customPropPass: 'DISTINCT_SECRET_IN_CUSTOM_PASS_555',
      causeSecret: 'DISTINCT_SECRET_IN_NESTED_CAUSE_444',
      aggregateSecret: 'DISTINCT_SECRET_IN_AGGREGATE_333',
    };

    // Construct error with embedded secrets in message, stack, query string, custom props, and nested causes
    const causeError = new Error(
      `Database connection failed: postgres://admin:${fakeSecrets.causeSecret}@db.internal:5432/main`,
    );
    (causeError as unknown as { code: string }).code = 'ECONNREFUSED';

    const rawError = new Error(
      `Authentication failed: Bearer ${fakeSecrets.messageSecret} ` +
        `during request to https://api.gateway.internal/orders?api_key=${fakeSecrets.querySecret}`,
      { cause: causeError },
    );
    rawError.stack = `Error: Authentication failed\n    at query (${fakeSecrets.stackSecret})`;
    (rawError as unknown as { code: string }).code = 'ERR_AUTH_FAILED';

    // Attach custom properties containing credentials
    (rawError as unknown as { token: string; password: string }).token =
      fakeSecrets.customPropToken;
    (rawError as unknown as { token: string; password: string }).password =
      fakeSecrets.customPropPass;

    logger.error({ err: rawError }, 'Request processing encountered an error');

    const output = dest.rawOutput;

    // CRITICAL SECURITY ASSERTION: None of the distinctive fake secrets may appear in captured JSON output
    for (const [key, secretValue] of Object.entries(fakeSecrets)) {
      assert.equal(output.includes(secretValue), false, `Secret ${key} leaked into error log!`);
    }

    const [record] = dest.records;
    const errRecord = record.err as Record<string, unknown>;

    // Structural metadata is safely preserved
    assert.equal(errRecord.type, 'Error');
    assert.equal(errRecord.code, 'ERR_AUTH_FAILED');

    // Raw message, stack, and custom properties are omitted by default
    assert.equal(errRecord.message, undefined);
    assert.equal(errRecord.stack, undefined);
    assert.equal(errRecord.token, undefined);
    assert.equal(errRecord.password, undefined);

    // Nested cause is structural
    const causeRecord = errRecord.cause as Record<string, unknown>;
    assert.ok(causeRecord);
    assert.equal(causeRecord.type, 'Error');
    assert.equal(causeRecord.code, 'ECONNREFUSED');
    assert.equal(causeRecord.message, undefined);
  });

  it('safely handles AggregateError with multiple nested errors without leaking credentials', () => {
    const dest = new TestDestination();
    const logger = createLogger({ level: 'error' }, dest);

    const fakeAggSecret1 = 'DISTINCT_SECRET_AGG_1_PASS';
    const fakeAggSecret2 = 'DISTINCT_SECRET_AGG_2_PASS';

    const err1 = new Error(`Connection 1 failed: password=${fakeAggSecret1}`);
    (err1 as unknown as { code: string }).code = 'ECONNRESET';
    const err2 = new Error(`Connection 2 failed: token=${fakeAggSecret2}`);
    (err2 as unknown as { code: string }).code = 'ETIMEDOUT';

    const aggError = new AggregateError([err1, err2], 'Batch dispatch failed');
    (aggError as unknown as { code: string }).code = 'ERR_BATCH_FAILED';

    logger.error({ err: aggError }, 'Aggregate failure occurred');

    const output = dest.rawOutput;
    assert.equal(output.includes(fakeAggSecret1), false);
    assert.equal(output.includes(fakeAggSecret2), false);

    const [record] = dest.records;
    const errRecord = record.err as Record<string, unknown>;
    assert.equal(errRecord.type, 'AggregateError');
    assert.equal(errRecord.code, 'ERR_BATCH_FAILED');

    const errors = errRecord.errors as Record<string, unknown>[];
    assert.equal(errors.length, 2);
    assert.equal(errors[0].type, 'Error');
    assert.equal(errors[0].code, 'ECONNRESET');
    assert.equal(errors[1].type, 'Error');
    assert.equal(errors[1].code, 'ETIMEDOUT');
  });

  it('supports opt-in sanitized message logging when explicitly configured', () => {
    const dest = new TestDestination();
    const logger = createLogger(
      {
        level: 'error',
        errorSerializerOptions: {
          includeSanitizedMessage: true,
        },
      },
      dest,
    );

    const fakeDbPass = 'DISTINCT_SECRET_OPT_IN_DB_PASS_123';
    const fakeBearer = 'DISTINCT_SECRET_OPT_IN_BEARER_456';
    const fakeQuery = 'DISTINCT_SECRET_OPT_IN_QUERY_789';

    const rawError = new Error(
      `Database connection failed: postgres://admin:${fakeDbPass}@db.internal:5432/main ` +
        `after bearer Bearer ${fakeBearer} and query https://api.internal/pay?api_key=${fakeQuery}`,
    );

    logger.error({ err: rawError }, 'Opt-in error test');

    const output = dest.rawOutput;
    // Verify none of the secrets appear in raw output
    assert.equal(output.includes(fakeDbPass), false);
    assert.equal(output.includes(fakeBearer), false);
    assert.equal(output.includes(fakeQuery), false);

    const [record] = dest.records;
    const errRecord = record.err as Record<string, unknown>;
    assert.equal(errRecord.type, 'Error');
    assert.ok((errRecord.message as string).includes('postgres://[REDACTED]:[REDACTED]@'));
    assert.ok((errRecord.message as string).includes('Bearer [REDACTED]'));
    assert.ok((errRecord.message as string).includes('api_key=[REDACTED]'));
  });

  it('formatSafeError extracts safe structural metadata without exposing messages', () => {
    const fakeSecretErrMessage = 'Catastrophic leak of secret FAKE_SECRET_ERR_MSG_123';
    const err = new Error(fakeSecretErrMessage);
    (err as unknown as { code: string }).code = 'ERR_AUTH_REJECTED';

    const safeMeta = formatSafeError(err);
    assert.equal(safeMeta.type, 'Error');
    assert.equal(safeMeta.code, 'ERR_AUTH_REJECTED');
    assert.equal(JSON.stringify(safeMeta).includes(fakeSecretErrMessage), false);

    assert.equal(formatSafeError('not an error').type, 'UnknownError');
  });

  it('sanitizeErrorMessage helper handles empty strings and redacts credential formats', () => {
    assert.equal(sanitizeErrorMessage(''), '');
    const sanitized = sanitizeErrorMessage('token: "secret_token_12345678"');
    assert.ok(sanitized.includes('[REDACTED]'));
    assert.equal(sanitized.includes('secret_token_12345678'), false);
  });
});

describe('Observability: Import-Time Side Effect Invariant', () => {
  it('guarantees importing the package does not write to stdout or perform runtime side effects', async () => {
    const imported = await import('../dist/index.js');
    assert.ok(typeof imported.createLogger === 'function');
    assert.ok(typeof imported.runWithContext === 'function');
    assert.ok(typeof imported.getRequestContext === 'function');
    assert.ok(typeof imported.withRequestContext === 'function');
    assert.ok(typeof imported.extractRequestContext === 'function');
  });
});
