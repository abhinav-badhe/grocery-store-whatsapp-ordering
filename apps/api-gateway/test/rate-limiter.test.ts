import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApiGateway } from '../dist/index.js';

describe('API Gateway Rate Limiting Policy (ADR-011 §2)', () => {
  it('allows requests within rate limits and blocks with 429 when threshold exceeded', async () => {
    const gateway = createApiGateway({
      port: 0,
      rateLimitWindowMs: 10000,
      rateLimitMaxRequests: 3,
    });
    const { port } = await gateway.start();

    try {
      // 1st request - OK
      const res1 = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(res1.status, 200);

      // 2nd request - OK
      const res2 = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(res2.status, 200);

      // 3rd request - OK
      const res3 = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(res3.status, 200);

      // 4th request - Rate limit exceeded (429)
      const res4 = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(res4.status, 429);
      assert.ok(res4.headers.get('retry-after'));

      const body = (await res4.json()) as { status: number; title: string; detail: string };
      assert.equal(body.status, 429);
      assert.equal(body.title, 'Too Many Requests');
      assert.ok(body.detail.includes('Rate limit exceeded'));
    } finally {
      await gateway.stop();
    }
  });
});
