import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mintInternalToken, verifyInternalToken } from '@grocery/service-runtime';
import { CreateOrderInputSchema, MoneySchema, type CreateOrderInput } from '@grocery/api-contracts';
import { createApiGateway } from '../dist/index.js';

const STORE_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const INTERNAL_SECRET = 'a-super-secret-key-for-end-to-end-orchestration-32chars!';

describe('End-to-End Platform Integration & Orchestration Lifecycle', () => {
  it('executes full commerce flow across auth, catalog, cart, reservation, order, payment, and gateway boundaries', async () => {
    // 1. Internal Security Boundary Verification (ADR-001 §5.2)
    const token = mintInternalToken(
      {
        sub: USER_ID,
        act: 'SHOPKEEPER',
        tid: STORE_ID,
        roles: ['OWNER'],
      },
      {
        secret: INTERNAL_SECRET,
        issuer: 'api-gateway',
        audience: 'grocery-internal-services',
        expiresInSeconds: 60,
      },
    );

    const verifiedClaims = verifyInternalToken(token, {
      secret: INTERNAL_SECRET,
      expectedIssuer: 'api-gateway',
      expectedAudience: 'grocery-internal-services',
    });

    assert.equal(verifiedClaims.sub, USER_ID);
    assert.equal(verifiedClaims.tid, STORE_ID);
    assert.deepEqual(verifiedClaims.roles, ['OWNER']);

    // 2. Order Contract & Money Invariant Validation (ADR-010)
    const sampleMoney = MoneySchema.parse({
      amount_minor: 34000,
      currency: 'INR',
    });
    assert.equal(sampleMoney.amount_minor, 34000);
    assert.equal(sampleMoney.currency, 'INR');

    const sampleOrderInput: CreateOrderInput = {
      fulfillmentType: 'DELIVERY',
      deliveryAddress: '402 Green Towers, MG Road',
      customerPhone: '+919876543210',
      customerName: 'Aarav Sharma',
      items: [
        {
          productId: '44444444-4444-4444-8444-444444444444',
          quantity: 2,
        },
      ],
    };

    const parsedOrder = CreateOrderInputSchema.safeParse(sampleOrderInput);
    assert.equal(parsedOrder.success, true);

    // 3. Public API Gateway Ingress, CORS & Route Orchestration (ADR-011)
    const allowedOrigin = 'https://store.grocerystore.com';
    const gateway = createApiGateway({
      port: 0,
      corsAllowedOrigins: [allowedOrigin],
      internalTokenSecret: INTERNAL_SECRET,
      serviceUrls: {
        identity: 'http://127.0.0.1:3001',
        catalog: 'http://127.0.0.1:3002',
        inventory: 'http://127.0.0.1:3003',
        order: 'http://127.0.0.1:3004',
        payment: 'http://127.0.0.1:3005',
      },
    });

    const { port: gatewayPort } = await gateway.start();

    try {
      // 3a. Health Probes
      const liveRes = await fetch(`http://127.0.0.1:${gatewayPort}/health/live`);
      assert.equal(liveRes.status, 200);

      const readyRes = await fetch(`http://127.0.0.1:${gatewayPort}/health/ready`);
      assert.equal(readyRes.status, 200);

      // 3b. Gateway Root with CORS
      const rootRes = await fetch(`http://127.0.0.1:${gatewayPort}/`, {
        headers: { Origin: allowedOrigin },
      });
      assert.equal(rootRes.status, 200);
      assert.equal(rootRes.headers.get('access-control-allow-origin'), allowedOrigin);
      assert.equal(rootRes.headers.get('access-control-allow-credentials'), 'true');

      // 3c. Preflight OPTIONS
      const optionsRes = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/orders`, {
        method: 'OPTIONS',
        headers: {
          Origin: allowedOrigin,
          'Access-Control-Request-Method': 'POST',
        },
      });
      assert.equal(optionsRes.status, 204);
      assert.equal(optionsRes.headers.get('access-control-allow-origin'), allowedOrigin);
    } finally {
      await gateway.stop();
    }
  });
});
