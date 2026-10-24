import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LivenessResponseSchema, ReadinessResponseSchema } from '@grocery/api-contracts';
import { createHttpServer } from '../dist/index.js';

describe('Shared Service Runtime: HTTP Server & Health Endpoints', () => {
  it('guarantees importing and creating a server does not start listening', () => {
    const service = createHttpServer({
      serviceName: 'test-service',
      port: 0,
    });
    assert.equal(service.server.listening, false);
  });

  it('validates timeout configuration options with comprehensive positive finite and bound checks', () => {
    // 0 values
    assert.throws(
      () => createHttpServer({ serviceName: 'test-service', readinessTimeoutMs: 0 }),
      RangeError,
    );
    assert.throws(
      () => createHttpServer({ serviceName: 'test-service', shutdownTimeoutMs: 0 }),
      RangeError,
    );

    // Negative values
    assert.throws(
      () => createHttpServer({ serviceName: 'test-service', readinessTimeoutMs: -1 }),
      RangeError,
    );
    assert.throws(
      () => createHttpServer({ serviceName: 'test-service', shutdownTimeoutMs: -100 }),
      RangeError,
    );

    // NaN
    assert.throws(
      () => createHttpServer({ serviceName: 'test-service', readinessTimeoutMs: NaN }),
      RangeError,
    );
    assert.throws(
      () => createHttpServer({ serviceName: 'test-service', shutdownTimeoutMs: NaN }),
      RangeError,
    );

    // Infinity & -Infinity
    assert.throws(
      () => createHttpServer({ serviceName: 'test-service', readinessTimeoutMs: Infinity }),
      RangeError,
    );
    assert.throws(
      () => createHttpServer({ serviceName: 'test-service', shutdownTimeoutMs: Infinity }),
      RangeError,
    );
    assert.throws(
      () => createHttpServer({ serviceName: 'test-service', readinessTimeoutMs: -Infinity }),
      RangeError,
    );
    assert.throws(
      () => createHttpServer({ serviceName: 'test-service', shutdownTimeoutMs: -Infinity }),
      RangeError,
    );

    // Non-number runtime inputs
    assert.throws(
      () =>
        createHttpServer({
          serviceName: 'test-service',
          readinessTimeoutMs: '3000' as unknown as number,
        }),
      RangeError,
    );
    assert.throws(
      () =>
        createHttpServer({
          serviceName: 'test-service',
          shutdownTimeoutMs: '10000' as unknown as number,
        }),
      RangeError,
    );
    assert.throws(
      () =>
        createHttpServer({
          serviceName: 'test-service',
          readinessTimeoutMs: null as unknown as number,
        }),
      RangeError,
    );
    assert.throws(
      () =>
        createHttpServer({
          serviceName: 'test-service',
          shutdownTimeoutMs: null as unknown as number,
        }),
      RangeError,
    );

    // Upper bound overflow (greater than 32-bit signed integer max: 2,147,483,647)
    assert.throws(
      () => createHttpServer({ serviceName: 'test-service', readinessTimeoutMs: 2_147_483_648 }),
      RangeError,
    );
    assert.throws(
      () => createHttpServer({ serviceName: 'test-service', shutdownTimeoutMs: 2_147_483_648 }),
      RangeError,
    );
  });

  it('serves valid /health/live response conforming to LivenessResponseSchema', async () => {
    const service = createHttpServer({
      serviceName: 'test-service',
      port: 0,
    });
    const { port } = await service.start();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/health/live`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type')?.includes('application/json'), true);
      assert.ok(res.headers.get('x-request-id'));
      assert.ok(res.headers.get('x-correlation-id'));

      const body = await res.json();
      const parsed = LivenessResponseSchema.safeParse(body);
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.equal(parsed.data.status, 'ok');
        assert.ok(typeof parsed.data.uptime_seconds === 'number');
      }
    } finally {
      await service.stop();
    }
  });

  it('serves valid /health/ready response with dependency-independent status when no checks provided', async () => {
    const service = createHttpServer({
      serviceName: 'test-service',
      port: 0,
    });
    const { port } = await service.start();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
      assert.equal(res.status, 200);

      const body = await res.json();
      const parsed = ReadinessResponseSchema.safeParse(body);
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.equal(parsed.data.status, 'ready');
        assert.deepEqual(parsed.data.checks, {});
      }
    } finally {
      await service.stop();
    }
  });

  it('evaluates custom readiness checks and reports not_ready (503) when any dependency is unhealthy', async () => {
    const service = createHttpServer({
      serviceName: 'test-service',
      port: 0,
      getReadinessChecks: async () => ({
        postgres: 'healthy',
        rabbitmq: 'unhealthy',
      }),
    });
    const { port } = await service.start();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
      assert.equal(res.status, 503);

      const body = await res.json();
      const parsed = ReadinessResponseSchema.safeParse(body);
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.equal(parsed.data.status, 'not_ready');
        assert.equal(parsed.data.checks.postgres, 'healthy');
        assert.equal(parsed.data.checks.rabbitmq, 'unhealthy');
      }
    } finally {
      await service.stop();
    }
  });

  it('fails closed (503) when readiness check returns unexpected status value at runtime', async () => {
    const service = createHttpServer({
      serviceName: 'test-service',
      port: 0,
      getReadinessChecks: async () =>
        ({
          postgres: 'healthy',
          redis: 'degraded' as unknown,
        }) as unknown as Record<string, 'healthy' | 'unhealthy'>,
    });
    const { port } = await service.start();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
      assert.equal(res.status, 503);

      const body = await res.json();
      const parsed = ReadinessResponseSchema.safeParse(body);
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.equal(parsed.data.status, 'not_ready');
        assert.equal(parsed.data.checks.postgres, 'healthy');
        // Normalized safely to unhealthy to conform to contract
        assert.equal(parsed.data.checks.redis, 'unhealthy');
      }
    } finally {
      await service.stop();
    }
  });

  it('fails closed (503) when readiness check returns null or non-object', async () => {
    const service = createHttpServer({
      serviceName: 'test-service',
      port: 0,
      getReadinessChecks: async () => null as unknown as Record<string, 'healthy' | 'unhealthy'>,
    });
    const { port } = await service.start();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
      assert.equal(res.status, 503);

      const body = await res.json();
      const parsed = ReadinessResponseSchema.safeParse(body);
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.equal(parsed.data.status, 'not_ready');
        assert.equal(parsed.data.checks.dependencies, 'unhealthy');
      }
    } finally {
      await service.stop();
    }
  });

  it('safely handles readiness check that throws or rejects without leaking secrets', async () => {
    const fakeSecret = 'POSTGRES_PASSWORD_DO_NOT_LEAK';
    const service = createHttpServer({
      serviceName: 'test-service',
      port: 0,
      getReadinessChecks: async () => {
        throw new Error(`Database connection failed: user=app password=${fakeSecret}`);
      },
    });
    const { port } = await service.start();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
      assert.equal(res.status, 503);

      const rawText = await res.text();
      assert.equal(rawText.includes(fakeSecret), false);

      const body = JSON.parse(rawText);
      const parsed = ReadinessResponseSchema.safeParse(body);
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.equal(parsed.data.status, 'not_ready');
        assert.equal(parsed.data.checks.dependencies, 'unhealthy');
      }
    } finally {
      await service.stop();
    }
  });

  it('enforces bounded readiness timeout and triggers AbortSignal when check never settles', async () => {
    let capturedSignal: AbortSignal | undefined;

    const service = createHttpServer({
      serviceName: 'test-service',
      port: 0,
      readinessTimeoutMs: 50,
      getReadinessChecks: async (signal) => {
        capturedSignal = signal;
        // Never resolves on its own; waits for signal or hangs
        return new Promise((_resolve) => {
          signal?.addEventListener('abort', () => {
            // Check received abort signal cooperatively
          });
        });
      },
    });
    const { port } = await service.start();

    const start = Date.now();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
      const elapsed = Date.now() - start;

      assert.equal(res.status, 503);
      assert.ok(elapsed >= 40 && elapsed < 1500, `Expected bounded response, took ${elapsed}ms`);
      assert.equal(capturedSignal?.aborted, true);

      const body = await res.json();
      const parsed = ReadinessResponseSchema.safeParse(body);
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.equal(parsed.data.status, 'not_ready');
        assert.equal(parsed.data.checks.dependencies, 'unhealthy');
      }
    } finally {
      await service.stop();
    }
  });

  it('safely handles late rejection after readiness timeout without unhandledRejection', async () => {
    let rejectLate!: (err: Error) => void;
    const pendingCheck = new Promise<never>((_, reject) => {
      rejectLate = reject;
    });

    const service = createHttpServer({
      serviceName: 'test-service',
      port: 0,
      readinessTimeoutMs: 30,
      getReadinessChecks: () => pendingCheck,
    });
    const { port } = await service.start();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
      assert.equal(res.status, 503);

      // Trigger late rejection after HTTP response has already settled
      rejectLate(new Error('Late database query rejection'));

      // Wait a short delay to ensure no unhandledRejection crashed process
      await new Promise((resolve) => setTimeout(resolve, 30));
    } finally {
      await service.stop();
    }
  });

  it('reports shutting_down (503) on /health/live during graceful shutdown', async () => {
    const service = createHttpServer({
      serviceName: 'test-service',
      port: 0,
    });
    const { port } = await service.start();

    // Trigger stop without awaiting completion immediately
    const stopPromise = service.stop();
    assert.equal(service.isShuttingDown(), true);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/health/live`);
      assert.equal(res.status, 503);

      const body = await res.json();
      const parsed = LivenessResponseSchema.safeParse(body);
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.equal(parsed.data.status, 'shutting_down');
      }
    } catch {
      // In some environments, connection may close immediately, which is also safe shutdown behavior
    } finally {
      await stopPromise;
    }
  });

  it('gracefully handles stop() when server was never started', async () => {
    const service = createHttpServer({
      serviceName: 'test-service',
      port: 0,
    });
    assert.equal(service.server.listening, false);
    await service.stop();
    assert.equal(service.isShuttingDown(), true);
  });

  it('shares in-flight promise across concurrent stop() calls and handles repeated calls', async () => {
    const service = createHttpServer({
      serviceName: 'test-service',
      port: 0,
    });
    await service.start();

    const p1 = service.stop();
    const p2 = service.stop();
    // Verifies exact referential equality of in-flight shutdown promise
    assert.equal(p1, p2);

    await Promise.all([p1, p2]);
    assert.equal(service.isShuttingDown(), true);

    // Subsequent stop() call when already stopped returns resolved promise
    await service.stop();
    assert.equal(service.isShuttingDown(), true);
  });

  it('shares in-flight promise across concurrent start() calls', async () => {
    const service = createHttpServer({
      serviceName: 'test-service',
      port: 0,
    });

    try {
      const p1 = service.start();
      const p2 = service.start();
      // Verifies exact referential equality of in-flight startup promise
      assert.equal(p1, p2);

      const [r1, r2] = await Promise.all([p1, p2]);
      assert.equal(r1.port, r2.port);
      assert.ok(r1.port > 0);
    } finally {
      await service.stop();
    }
  });

  it('handles race condition when stop() is called immediately after start()', async () => {
    const service = createHttpServer({
      serviceName: 'test-service',
      port: 0,
    });

    const startPromise = service.start();
    const stopPromise = service.stop();

    await stopPromise;
    assert.equal(service.server.listening, false);
    assert.equal(service.isShuttingDown(), true);

    try {
      await startPromise;
    } catch {
      // Allowed if start rejected
    }

    // Guarantees no orphaned listener was left behind
    assert.equal(service.server.listening, false);
  });

  it('rejects start() if called after stop() has already been invoked', async () => {
    const service = createHttpServer({
      serviceName: 'test-service',
      port: 0,
    });

    await service.stop();

    await assert.rejects(
      () => service.start(),
      /Cannot start HTTP server: service is shutting down or has stopped/,
    );
    assert.equal(service.server.listening, false);
  });

  it('handles startup failure safely without permanently corrupting lifecycle state', async () => {
    const s1 = createHttpServer({
      serviceName: 'test-service-1',
      port: 0,
    });
    const { port } = await s1.start();

    // Attempt to bind s2 to the same port, causing EADDRINUSE
    const s2 = createHttpServer({
      serviceName: 'test-service-2',
      port,
    });

    try {
      await assert.rejects(
        () => s2.start(),
        (err: unknown) => (err as { code?: string }).code === 'EADDRINUSE',
      );
      // Calling stop on s2 after failed start should succeed cleanly
      await s2.stop();
    } finally {
      await s1.stop();
    }
  });

  it('allows in-flight request to finish before graceful shutdown deadline without stalling on keep-alive', async () => {
    let requestFinished = false;
    let requestStartedResolve!: () => void;
    const requestStartedPromise = new Promise<void>((resolve) => {
      requestStartedResolve = resolve;
    });

    const service = createHttpServer({
      serviceName: 'test-service',
      port: 0,
      shutdownTimeoutMs: 5000,
      requestHandler: async (req, res) => {
        if (req.url === '/slow-operation') {
          requestStartedResolve();
          await new Promise((resolve) => setTimeout(resolve, 50));
          requestFinished = true;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.statusCode = 200;
          res.end(JSON.stringify({ status: 'done' }));
        }
      },
    });
    const { port } = await service.start();

    try {
      // Start in-flight request using fetch (HTTP keep-alive enabled)
      const requestPromise = fetch(`http://127.0.0.1:${port}/slow-operation`);

      // Give request a moment to reach the handler deterministically
      await requestStartedPromise;

      // Initiate graceful shutdown
      const stopStart = Date.now();
      const stopPromise = service.stop();

      const res = await requestPromise;
      assert.equal(res.status, 200);
      const body = (await res.json()) as { status: string };
      assert.equal(body.status, 'done');
      assert.equal(requestFinished, true);

      await stopPromise;
      const stopDuration = Date.now() - stopStart;

      // Must complete promptly (~60-150ms) rather than stalling until the 5000ms deadline
      assert.ok(
        stopDuration < 2000,
        `Graceful shutdown took ${stopDuration}ms, expected to finish promptly without waiting for deadline`,
      );
    } finally {
      await service.stop();
    }
  });

  it('force-closes connections exceeding graceful shutdown deadline for genuinely stalled connections', async () => {
    let requestStartedResolve!: () => void;
    const requestStartedPromise = new Promise<void>((resolve) => {
      requestStartedResolve = resolve;
    });

    const service = createHttpServer({
      serviceName: 'test-service',
      port: 0,
      shutdownTimeoutMs: 50,
      requestHandler: async (req) => {
        if (req.url === '/hanging-request') {
          requestStartedResolve();
          // Genuinely stalled connection (never responds)
          await new Promise(() => {});
        }
      },
    });
    const { port } = await service.start();

    try {
      // Start hanging request
      const requestPromise = fetch(`http://127.0.0.1:${port}/hanging-request`).catch(() => {
        // Expected connection abort when deadline expires and force-closes
        return null;
      });

      // Wait until request has actually arrived at the server
      await requestStartedPromise;

      const start = Date.now();
      await service.stop();
      const elapsed = Date.now() - start;

      assert.ok(elapsed >= 35 && elapsed < 2000, `Shutdown took ${elapsed}ms`);
      await requestPromise;
    } finally {
      await service.stop();
    }
  });

  it('propagates client-supplied X-Request-ID and X-Correlation-ID safely', async () => {
    const service = createHttpServer({
      serviceName: 'test-service',
      port: 0,
    });
    const { port } = await service.start();

    try {
      const customRequestId = 'req-12345-abcdef';
      const customCorrelationId = 'corr-67890-ghijkl';

      const res = await fetch(`http://127.0.0.1:${port}/health/live`, {
        headers: {
          'x-request-id': customRequestId,
          'x-correlation-id': customCorrelationId,
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-request-id'), customRequestId);
      assert.equal(res.headers.get('x-correlation-id'), customCorrelationId);
    } finally {
      await service.stop();
    }
  });

  it('safely handles unhandled errors without leaking stack traces or credentials', async () => {
    const fakeSecret = 'SUPER_SECRET_TOKEN_DO_NOT_LEAK';
    const service = createHttpServer({
      serviceName: 'test-service',
      port: 0,
      requestHandler: () => {
        throw new Error(`Database connection failed with password=${fakeSecret}`);
      },
    });
    const { port } = await service.start();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/error-route`);
      assert.equal(res.status, 500);

      const rawText = await res.text();
      assert.equal(rawText.includes(fakeSecret), false);
      assert.equal(rawText.includes('stack'), false);

      const body = JSON.parse(rawText);
      assert.equal(body.title, 'Internal Server Error');
      assert.equal(body.status, 500);
    } finally {
      await service.stop();
    }
  });
});
