import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import http from 'node:http';
import crypto from 'node:crypto';
import {
  mintInternalToken,
  verifyInternalToken,
  createInternalTokenMiddleware,
  InternalTokenError,
  INTERNAL_TOKEN_HEADER,
  createHttpServer,
} from '../dist/index.js';

const TEST_SECRET = 'shared-super-secret-internal-service-key-32-chars!!';
const TEST_USER_ID = '10000000-0000-4000-8000-000000000001';
const TEST_STORE_ID = '20000000-0000-4000-8000-000000000002';

function makeHttpRequest(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers,
      },
      (res) => {
        let resBody = '';
        res.on('data', (chunk) => {
          resBody += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 500,
            headers: res.headers,
            body: resBody,
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Symmetric HMAC-SHA256 Internal Token Propagation', () => {
  describe('mintInternalToken', () => {
    it('mints a valid HS256 internal token conforming to ADR-001 §5.2 claims schema', () => {
      const token = mintInternalToken(
        {
          sub: TEST_USER_ID,
          act: 'SHOPKEEPER',
          tid: TEST_STORE_ID,
          roles: ['OWNER'],
        },
        { secret: TEST_SECRET },
      );

      assert.ok(typeof token === 'string');
      const parts = token.split('.');
      assert.equal(parts.length, 3);

      const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
      assert.equal(header.alg, 'HS256');
      assert.equal(header.typ, 'JWT');

      const claims = verifyInternalToken(token, { secret: TEST_SECRET });
      assert.equal(claims.sub, TEST_USER_ID);
      assert.equal(claims.act, 'SHOPKEEPER');
      assert.equal(claims.tid, TEST_STORE_ID);
      assert.deepEqual(claims.roles, ['OWNER']);
      assert.equal(claims.iss, 'grocery-api-gateway');
      assert.equal(claims.aud, 'grocery-internal-services');
      assert.ok(claims.exp > claims.iat);
    });

    it('rejects minting when secret is missing or empty', () => {
      assert.throws(
        () =>
          mintInternalToken(
            {
              sub: TEST_USER_ID,
              act: 'CUSTOMER',
              tid: TEST_STORE_ID,
              roles: ['STAFF'],
            },
            { secret: '' },
          ),
        TypeError,
      );
    });

    it('rejects invalid persona, non-UUID identifiers, or empty roles with schema validation error', () => {
      assert.throws(
        () =>
          mintInternalToken(
            {
              sub: 'invalid-non-uuid',
              act: 'INVALID_PERSONA' as unknown as 'SHOPKEEPER',
              tid: TEST_STORE_ID,
              roles: ['OWNER'],
            },
            { secret: TEST_SECRET },
          ),
        (err) => {
          assert.ok(err instanceof InternalTokenError);
          assert.equal(err.reason, 'SCHEMA_VALIDATION_FAILED');
          return true;
        },
      );

      assert.throws(
        () =>
          mintInternalToken(
            {
              sub: TEST_USER_ID,
              act: 'SHOPKEEPER',
              tid: TEST_STORE_ID,
              roles: [], // empty roles array violates ADR-001 §5.2 min(1) rule
            },
            { secret: TEST_SECRET },
          ),
        (err) => {
          assert.ok(err instanceof InternalTokenError);
          assert.equal(err.reason, 'SCHEMA_VALIDATION_FAILED');
          return true;
        },
      );
    });

    it('rejects invalid timestamps where expiration is not strictly later than issuance', () => {
      const now = Math.floor(Date.now() / 1000);
      assert.throws(
        () =>
          mintInternalToken(
            {
              sub: TEST_USER_ID,
              act: 'SHOPKEEPER',
              tid: TEST_STORE_ID,
              roles: ['OWNER'],
              iat: now,
              exp: now, // exp === iat violates refinement rule
            },
            { secret: TEST_SECRET },
          ),
        (err) => {
          assert.ok(err instanceof InternalTokenError);
          assert.equal(err.reason, 'SCHEMA_VALIDATION_FAILED');
          return true;
        },
      );
    });
  });

  describe('verifyInternalToken', () => {
    it('verifies valid token and checks issuer and audience constraints', () => {
      const token = mintInternalToken(
        {
          sub: TEST_USER_ID,
          act: 'STAFF',
          tid: TEST_STORE_ID,
          roles: ['MANAGER'],
          iss: 'custom-gateway',
          aud: 'custom-backend',
        },
        { secret: TEST_SECRET },
      );

      const claims = verifyInternalToken(token, {
        secret: TEST_SECRET,
        expectedIssuer: 'custom-gateway',
        expectedAudience: 'custom-backend',
      });

      assert.equal(claims.iss, 'custom-gateway');
      assert.equal(claims.aud, 'custom-backend');
      assert.equal(claims.act, 'STAFF');
    });

    it('rejects tampered signature with INVALID_SIGNATURE', () => {
      const token = mintInternalToken(
        {
          sub: TEST_USER_ID,
          act: 'SHOPKEEPER',
          tid: TEST_STORE_ID,
          roles: ['OWNER'],
        },
        { secret: TEST_SECRET },
      );

      assert.throws(
        () =>
          verifyInternalToken(token, {
            secret: 'completely-different-wrong-secret-key-1234',
          }),
        (err) => {
          assert.ok(err instanceof InternalTokenError);
          assert.equal(err.reason, 'INVALID_SIGNATURE');
          return true;
        },
      );
    });

    it('rejects expired token with TOKEN_EXPIRED', () => {
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = mintInternalToken(
        {
          sub: TEST_USER_ID,
          act: 'SHOPKEEPER',
          tid: TEST_STORE_ID,
          roles: ['OWNER'],
          iat: now - 120,
          exp: now - 10,
        },
        { secret: TEST_SECRET },
      );

      assert.throws(
        () =>
          verifyInternalToken(expiredToken, {
            secret: TEST_SECRET,
          }),
        (err) => {
          assert.ok(err instanceof InternalTokenError);
          assert.equal(err.reason, 'TOKEN_EXPIRED');
          assert.equal(err.code, 'EXPIRED_INTERNAL_TOKEN');
          return true;
        },
      );
    });

    it('rejects unsupported algorithm (none attack prevention)', () => {
      const headerB64 = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
        'base64url',
      );
      const payloadB64 = Buffer.from(
        JSON.stringify({
          iss: 'gateway',
          aud: 'services',
          sub: TEST_USER_ID,
          act: 'SHOPKEEPER',
          tid: TEST_STORE_ID,
          roles: ['OWNER'],
          jti: crypto.randomUUID(),
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 60,
        }),
      ).toString('base64url');

      const attackToken = `${headerB64}.${payloadB64}.`;

      assert.throws(
        () =>
          verifyInternalToken(attackToken, {
            secret: TEST_SECRET,
          }),
        (err) => {
          assert.ok(err instanceof InternalTokenError);
          assert.equal(err.reason, 'UNSUPPORTED_ALGORITHM');
          return true;
        },
      );
    });

    it('rejects mismatched expected issuer and audience', () => {
      const token = mintInternalToken(
        {
          sub: TEST_USER_ID,
          act: 'SHOPKEEPER',
          tid: TEST_STORE_ID,
          roles: ['OWNER'],
        },
        { secret: TEST_SECRET },
      );

      assert.throws(
        () =>
          verifyInternalToken(token, {
            secret: TEST_SECRET,
            expectedIssuer: 'unmatched-issuer',
          }),
        (err) => {
          assert.ok(err instanceof InternalTokenError);
          assert.equal(err.reason, 'INVALID_ISSUER');
          return true;
        },
      );

      assert.throws(
        () =>
          verifyInternalToken(token, {
            secret: TEST_SECRET,
            expectedAudience: 'unmatched-audience',
          }),
        (err) => {
          assert.ok(err instanceof InternalTokenError);
          assert.equal(err.reason, 'INVALID_AUDIENCE');
          return true;
        },
      );
    });
  });

  describe('createInternalTokenMiddleware over HTTP', () => {
    it('enforces X-Internal-Token header, populates context.storeId, and rejects unauthorized callers', async () => {
      let capturedStoreId: string | undefined;
      let capturedRoles: readonly string[] | undefined;

      const middleware = createInternalTokenMiddleware(
        { secret: TEST_SECRET },
        (req, res, context) => {
          capturedStoreId = context.storeId;
          capturedRoles = req.internalToken?.roles;
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({ success: true, storeId: context.storeId }));
        },
      );

      const server = createHttpServer({
        serviceName: 'downstream-catalog-service',
        port: 0,
        host: '127.0.0.1',
        requestHandler: middleware,
      });

      await server.start();
      const address = server.server.address() as { port: number };
      const port = address.port;

      try {
        // 1. Missing header returns 401 MISSING_INTERNAL_TOKEN
        const missingRes = await makeHttpRequest(port, 'GET', '/internal/products');
        assert.equal(missingRes.statusCode, 401);
        const missingData = JSON.parse(missingRes.body);
        assert.equal(missingData.code, 'MISSING_INTERNAL_TOKEN');

        // 2. Invalid signature returns 401 INVALID_INTERNAL_TOKEN
        const invalidToken = mintInternalToken(
          {
            sub: TEST_USER_ID,
            act: 'SHOPKEEPER',
            tid: TEST_STORE_ID,
            roles: ['OWNER'],
          },
          { secret: 'wrong-key-used-by-attacker' },
        );

        const invalidRes = await makeHttpRequest(port, 'GET', '/internal/products', {
          [INTERNAL_TOKEN_HEADER]: invalidToken,
        });
        assert.equal(invalidRes.statusCode, 401);
        const invalidData = JSON.parse(invalidRes.body);
        assert.equal(invalidData.reason, 'INVALID_SIGNATURE');

        // 3. Valid token succeeds, sets context.storeId, and executes downstream handler
        const validToken = mintInternalToken(
          {
            sub: TEST_USER_ID,
            act: 'SHOPKEEPER',
            tid: TEST_STORE_ID,
            roles: ['OWNER', 'MANAGER'],
          },
          { secret: TEST_SECRET },
        );

        const validRes = await makeHttpRequest(port, 'GET', '/internal/products', {
          [INTERNAL_TOKEN_HEADER]: validToken,
        });

        assert.equal(validRes.statusCode, 200);
        const validData = JSON.parse(validRes.body);
        assert.equal(validData.success, true);
        assert.equal(validData.storeId, TEST_STORE_ID);
        assert.equal(capturedStoreId, TEST_STORE_ID);
        assert.deepEqual(capturedRoles, ['OWNER', 'MANAGER']);
      } finally {
        await server.stop();
      }
    });
  });
});
