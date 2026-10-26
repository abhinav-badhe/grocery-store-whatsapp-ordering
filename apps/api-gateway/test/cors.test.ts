import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApiGateway } from '../dist/index.js';

describe('API Gateway CORS Policy (ADR-011 §4.1)', () => {
  it('sets allow-origin and allow-credentials for verified allowed origins', async () => {
    const allowedOrigin = 'https://store.example.com';
    const gateway = createApiGateway({
      port: 0,
      corsAllowedOrigins: [allowedOrigin],
    });
    const { port } = await gateway.start();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { Origin: allowedOrigin },
      });

      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), allowedOrigin);
      assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
      assert.equal(res.headers.get('vary'), 'Origin');
    } finally {
      await gateway.stop();
    }
  });

  it('omits allow-origin header for origins not on allowlist', async () => {
    const allowedOrigin = 'https://store.example.com';
    const untrustedOrigin = 'https://attacker.evil.com';
    const gateway = createApiGateway({
      port: 0,
      corsAllowedOrigins: [allowedOrigin],
    });
    const { port } = await gateway.start();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { Origin: untrustedOrigin },
      });

      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), null);
      assert.equal(res.headers.get('access-control-allow-credentials'), null);
    } finally {
      await gateway.stop();
    }
  });

  it('handles OPTIONS preflight requests with 204 No Content and standard headers', async () => {
    const allowedOrigin = 'https://store.example.com';
    const gateway = createApiGateway({
      port: 0,
      corsAllowedOrigins: [allowedOrigin],
    });
    const { port } = await gateway.start();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/orders`, {
        method: 'OPTIONS',
        headers: {
          Origin: allowedOrigin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      });

      assert.equal(res.status, 204);
      assert.equal(res.headers.get('access-control-allow-origin'), allowedOrigin);
      assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
      assert.ok(res.headers.get('access-control-allow-methods')?.includes('POST'));
      assert.ok(res.headers.get('access-control-allow-headers')?.includes('Content-Type'));
      assert.equal(res.headers.get('access-control-max-age'), '86400');
    } finally {
      await gateway.stop();
    }
  });
});
