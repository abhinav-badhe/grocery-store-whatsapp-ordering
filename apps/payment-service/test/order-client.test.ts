import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { HttpOrderLookupClient } from '../dist/index.js';
import { verifyInternalToken } from '@grocery/service-runtime';

const TEST_SECRET = 'super-secret-internal-payment-token-key-32chars';
const STORE_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';

describe('HttpOrderLookupClient (Subphase 5)', () => {
  it('makes authenticated order lookup call with internal token and store headers', async () => {
    let capturedHeaders: http.IncomingHttpHeaders | null = null;

    const mockServer = http.createServer((req, res) => {
      capturedHeaders = req.headers;
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          order: {
            id: ORDER_ID,
            totalAmountCents: 15000,
            status: 'CONFIRMED',
          },
        }),
      );
    });

    await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const port = (mockServer.address() as { port: number }).port;

    try {
      const client = new HttpOrderLookupClient({
        baseUrl: `http://127.0.0.1:${port}`,
        internalTokenSecret: TEST_SECRET,
      });

      const order = await client.getOrder(STORE_ID, ORDER_ID);

      assert.ok(order);
      assert.equal(order.id, ORDER_ID);
      assert.equal(order.totalAmountCents, 15000);
      assert.equal(order.status, 'CONFIRMED');

      // Verify token claims
      const token = capturedHeaders?.['x-internal-token'] as unknown as string;
      assert.ok(token);
      const claims = verifyInternalToken(token, { secret: TEST_SECRET });
      assert.equal(claims.sub, 'payment-service');
      assert.equal(claims.tid, STORE_ID);
      assert.deepEqual(claims.roles, ['STAFF']);

      // Verify store header
      assert.equal(capturedHeaders?.['x-store-id'], STORE_ID);
    } finally {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    }
  });

  it('returns null when order is not found (404)', async () => {
    const mockServer = http.createServer((_req, res) => {
      res.statusCode = 404;
      res.end(JSON.stringify({ title: 'Not Found' }));
    });

    await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const port = (mockServer.address() as { port: number }).port;

    try {
      const client = new HttpOrderLookupClient({
        baseUrl: `http://127.0.0.1:${port}`,
        internalTokenSecret: TEST_SECRET,
      });

      const order = await client.getOrder(STORE_ID, 'non-existent-order');
      assert.equal(order, null);
    } finally {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    }
  });
});
