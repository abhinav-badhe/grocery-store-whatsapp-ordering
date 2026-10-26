import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { verifyInternalToken } from '@grocery/service-runtime';
import { createApiGateway } from '../dist/index.js';

const TEST_SECRET = 'a-very-secure-32-byte-token-secret-for-tests!';

function createTestServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
): Promise<{ server: http.Server; port: number; stop: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        server,
        port,
        stop: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe('API Gateway Reverse Proxy Ingress & Routing (ADR-001, ADR-011)', () => {
  it('proxies /api/v1/auth requests to identity service and attaches signed X-Internal-Token', async () => {
    let capturedHeaders: http.IncomingHttpHeaders | null = null;
    let capturedBody = '';

    const identityServer = await createTestServer(async (req, res) => {
      capturedHeaders = req.headers;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      capturedBody = Buffer.concat(chunks).toString('utf8');

      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ user: { id: 'usr-1', email: 'test@example.com' } }));
    });

    const gateway = createApiGateway({
      port: 0,
      internalTokenSecret: TEST_SECRET,
      serviceUrls: {
        identity: `http://127.0.0.1:${identityServer.port}`,
      },
    });
    const { port: gatewayPort } = await gateway.start();

    try {
      const res = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': 'corr-12345',
        },
        body: JSON.stringify({ email: 'test@example.com', password: 'secretpassword123' }),
      });

      assert.equal(res.status, 200);
      const data = (await res.json()) as { user: { id: string } };
      assert.equal(data.user.id, 'usr-1');

      // Assert captured downstream headers
      assert.ok(capturedHeaders);
      assert.equal(capturedHeaders['x-correlation-id'], 'corr-12345');
      assert.ok(capturedHeaders['x-forwarded-for']);
      assert.ok(capturedHeaders['x-internal-token']);

      // Verify the minted internal token
      const verified = verifyInternalToken(capturedHeaders['x-internal-token'] as string, {
        secret: TEST_SECRET,
        expectedIssuer: 'api-gateway',
        expectedAudience: 'grocery-internal-services',
      });
      assert.equal(verified.sub, 'api-gateway');
      assert.equal(verified.act, 'SYSTEM');

      // Assert body was preserved
      const parsedBody = JSON.parse(capturedBody);
      assert.equal(parsedBody.email, 'test@example.com');
    } finally {
      await gateway.stop();
      await identityServer.stop();
    }
  });

  it('proxies cookie headers and propagates Set-Cookie response header back to client', async () => {
    const identityServer = await createTestServer((req, res) => {
      const receivedCookie = req.headers['cookie'];
      assert.equal(receivedCookie, 'refresh_token=old-refresh-token');

      res.setHeader(
        'Set-Cookie',
        'refresh_token=new-refresh-token; Path=/api/v1/auth; HttpOnly; SameSite=Strict',
      );
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true }));
    });

    const gateway = createApiGateway({
      port: 0,
      internalTokenSecret: TEST_SECRET,
      serviceUrls: {
        identity: `http://127.0.0.1:${identityServer.port}`,
      },
    });
    const { port: gatewayPort } = await gateway.start();

    try {
      const res = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          Cookie: 'refresh_token=old-refresh-token',
        },
      });

      assert.equal(res.status, 200);
      const setCookie = res.headers.get('set-cookie');
      assert.ok(setCookie);
      assert.ok(setCookie.includes('refresh_token=new-refresh-token'));
      assert.ok(setCookie.includes('HttpOnly'));
    } finally {
      await gateway.stop();
      await identityServer.stop();
    }
  });

  it('routes to respective microservices according to path prefixes', async () => {
    let catalogHit = false;
    let inventoryHit = false;
    let orderHit = false;
    let paymentHit = false;

    const catalogServer = await createTestServer((_req, res) => {
      catalogHit = true;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ service: 'catalog' }));
    });

    const inventoryServer = await createTestServer((_req, res) => {
      inventoryHit = true;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ service: 'inventory' }));
    });

    const orderServer = await createTestServer((_req, res) => {
      orderHit = true;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ service: 'order' }));
    });

    const paymentServer = await createTestServer((_req, res) => {
      paymentHit = true;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ service: 'payment' }));
    });

    const gateway = createApiGateway({
      port: 0,
      internalTokenSecret: TEST_SECRET,
      serviceUrls: {
        catalog: `http://127.0.0.1:${catalogServer.port}`,
        inventory: `http://127.0.0.1:${inventoryServer.port}`,
        order: `http://127.0.0.1:${orderServer.port}`,
        payment: `http://127.0.0.1:${paymentServer.port}`,
      },
    });
    const { port: gatewayPort } = await gateway.start();

    try {
      const resCatalog = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/catalog/products`);
      assert.equal(resCatalog.status, 200);
      assert.ok(catalogHit);

      const resInventory = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/inventory/balances`);
      assert.equal(resInventory.status, 200);
      assert.ok(inventoryHit);

      const resOrder = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/orders`);
      assert.equal(resOrder.status, 200);
      assert.ok(orderHit);

      const resPayment = await fetch(
        `http://127.0.0.1:${gatewayPort}/api/v1/payments/webhooks/razorpay`,
        { method: 'POST', body: '{}' },
      );
      assert.equal(resPayment.status, 200);
      assert.ok(paymentHit);
    } finally {
      await gateway.stop();
      await catalogServer.stop();
      await inventoryServer.stop();
      await orderServer.stop();
      await paymentServer.stop();
    }
  });

  it('returns 502 Bad Gateway when downstream service is unreachable', async () => {
    const gateway = createApiGateway({
      port: 0,
      internalTokenSecret: TEST_SECRET,
      serviceUrls: {
        catalog: 'http://127.0.0.1:59999', // Port with no server running
      },
    });
    const { port: gatewayPort } = await gateway.start();

    try {
      const res = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/catalog/items`);
      assert.equal(res.status, 502);

      const body = (await res.json()) as { status: number; title: string; detail: string };
      assert.equal(body.status, 502);
      assert.equal(body.title, 'Bad Gateway');
      assert.ok(body.detail.includes('unavailable'));
    } finally {
      await gateway.stop();
    }
  });

  it('returns 404 Not Found for routes not matching any downstream microservice', async () => {
    const gateway = createApiGateway({ port: 0 });
    const { port: gatewayPort } = await gateway.start();

    try {
      const res = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/unsupported`);
      assert.equal(res.status, 404);

      const body = (await res.json()) as { status: number; title: string };
      assert.equal(body.status, 404);
      assert.equal(body.title, 'Not Found');
    } finally {
      await gateway.stop();
    }
  });
});
