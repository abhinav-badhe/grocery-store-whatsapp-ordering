import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { HttpInventoryClient } from '../dist/index.js';
import { verifyInternalToken } from '@grocery/service-runtime';

const TEST_SECRET = 'super-secret-internal-token-for-test-32chars!';
const STORE_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';

describe('HttpInventoryClient (Subphase 4)', () => {
  it('makes authenticated reservation call with internal token and store headers', async () => {
    let capturedHeaders: http.IncomingHttpHeaders | null = null;
    let capturedBody: unknown = null;

    const mockServer = http.createServer((req, res) => {
      capturedHeaders = req.headers;
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        capturedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 201;
        res.end(JSON.stringify({ reservation: { id: 'res-123' } }));
      });
    });

    await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const port = (mockServer.address() as { port: number }).port;

    try {
      const client = new HttpInventoryClient({
        baseUrl: `http://127.0.0.1:${port}`,
        internalTokenSecret: TEST_SECRET,
      });

      const result = await client.reserveStock(STORE_ID, ORDER_ID, [
        { productId: PRODUCT_ID, quantity: 2 },
      ]);

      assert.equal(result.success, true);
      assert.equal(result.reservationId, 'res-123');

      // Verify internal token
      const token = capturedHeaders?.['x-internal-token'] as unknown as string;
      assert.ok(token);
      const claims = verifyInternalToken(token, { secret: TEST_SECRET });
      assert.equal(claims.sub, 'order-service');
      assert.equal(claims.tid, STORE_ID);
      assert.deepEqual(claims.roles, ['STAFF']);

      // Verify store header
      assert.equal(capturedHeaders?.['x-store-id'], STORE_ID);

      // Verify payload
      const body = capturedBody as {
        orderId: string;
        items: Array<{ productId: string; quantity: number }>;
      };
      assert.equal(body.orderId, ORDER_ID);
      assert.equal(body.items[0]?.productId, PRODUCT_ID);
      assert.equal(body.items[0]?.quantity, 2);
    } finally {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    }
  });

  it('handles reservation failure gracefully and returns errorMessage', async () => {
    const mockServer = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 409;
      res.end(JSON.stringify({ detail: 'Insufficient stock available' }));
    });

    await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const port = (mockServer.address() as { port: number }).port;

    try {
      const client = new HttpInventoryClient({
        baseUrl: `http://127.0.0.1:${port}`,
        internalTokenSecret: TEST_SECRET,
      });

      const result = await client.reserveStock(STORE_ID, ORDER_ID, [
        { productId: PRODUCT_ID, quantity: 1000 },
      ]);

      assert.equal(result.success, false);
      assert.ok(result.errorMessage?.includes('HTTP 409'));
    } finally {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    }
  });
});
