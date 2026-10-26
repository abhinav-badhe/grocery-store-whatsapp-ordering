import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import http from 'node:http';
import crypto from 'node:crypto';
import type {
  Database,
  UserRow,
  UserCredentialRow,
  RefreshTokenRow,
  RefreshTokenStatus,
} from '@grocery/database';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
} from 'kysely';
import {
  generateEd25519KeyPair,
  signAccessToken,
  verifyAccessToken,
  TokenVerificationError,
  createAuthService,
  createIdentityService,
  parseCookies,
  buildRefreshTokenCookie,
  buildClearRefreshTokenCookie,
  type UserRepository,
  type CredentialRepository,
  type RefreshTokenRepository,
} from '../dist/index.js';

function createMockKysely(): Kysely<Database> {
  const connection: DatabaseConnection = {
    executeQuery: async <R>() => ({ rows: [] as R[] }),
    streamQuery: () => {
      throw new Error('Streaming not implemented in mock');
    },
  };

  const driver: Driver = {
    init: async () => {},
    acquireConnection: async () => connection,
    beginTransaction: async () => {},
    commitTransaction: async () => {},
    rollbackTransaction: async () => {},
    releaseConnection: async () => {},
    destroy: async () => {},
  };

  return new Kysely<Database>({
    dialect: {
      createDriver: () => driver,
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createAdapter: () => new PostgresAdapter(),
      createIntrospector: (db) => new PostgresIntrospector(db),
    },
  });
}

function createMockUserRepo(initialUsers: UserRow[] = []): UserRepository {
  const users = [...initialUsers];
  return {
    async findById(id) {
      return users.find((u) => u.id === id) ?? null;
    },
    async findByEmail(email) {
      const normalized = email.trim().toLowerCase();
      return users.find((u) => u.email === normalized) ?? null;
    },
    async findByPhone(phone) {
      const normalized = phone.trim();
      return users.find((u) => u.phone === normalized) ?? null;
    },
    async create(newUser) {
      const row: UserRow = {
        id: crypto.randomUUID(),
        email: newUser.email ?? null,
        phone: newUser.phone ?? null,
        full_name: newUser.full_name,
        status: (newUser.status as UserRow['status']) ?? 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      };
      users.push(row);
      return row;
    },
    async update(id, update) {
      const idx = users.findIndex((u) => u.id === id);
      if (idx === -1) return null;
      const current = users[idx]!;
      const updated: UserRow = {
        ...current,
        full_name: update.full_name ?? current.full_name,
        email: update.email !== undefined ? update.email : current.email,
        phone: update.phone !== undefined ? update.phone : current.phone,
        status: (update.status as UserRow['status']) ?? current.status,
        updated_at: new Date(),
      };
      users[idx] = updated;
      return updated;
    },
  };
}

function createMockCredentialRepo(initialCreds: UserCredentialRow[] = []): CredentialRepository {
  const creds = [...initialCreds];
  return {
    async findByUserId(userId) {
      return creds.find((c) => c.user_id === userId) ?? null;
    },
    async create(newCred) {
      const row: UserCredentialRow = {
        user_id: newCred.user_id,
        password_hash: newCred.password_hash,
        algorithm: 'argon2id',
        created_at: new Date(),
        updated_at: new Date(),
      };
      creds.push(row);
      return row;
    },
    async updatePasswordHash(userId, passwordHash, algorithm = 'argon2id') {
      const idx = creds.findIndex((c) => c.user_id === userId);
      if (idx === -1) return null;
      const updated: UserCredentialRow = {
        ...creds[idx]!,
        password_hash: passwordHash,
        algorithm: algorithm as 'argon2id',
        updated_at: new Date(),
      };
      creds[idx] = updated;
      return updated;
    },
  };
}

function createMockRefreshTokenRepo(): RefreshTokenRepository {
  const tokens: RefreshTokenRow[] = [];
  return {
    async findById(id) {
      return tokens.find((t) => t.id === id) ?? null;
    },
    async findByTokenHash(tokenHash) {
      return tokens.find((t) => t.token_hash === tokenHash) ?? null;
    },
    async create(newRecord) {
      const row: RefreshTokenRow = {
        id: crypto.randomUUID(),
        user_id: newRecord.user_id,
        family_id: newRecord.family_id,
        token_hash: newRecord.token_hash,
        status: (newRecord.status as RefreshTokenStatus) ?? 'ACTIVE',
        replaced_by_token_id: null,
        revoked_reason: null,
        revoked_at: null,
        consumed_at: null,
        expires_at:
          newRecord.expires_at instanceof Date
            ? newRecord.expires_at
            : new Date(newRecord.expires_at),
        family_expires_at:
          newRecord.family_expires_at instanceof Date
            ? newRecord.family_expires_at
            : newRecord.family_expires_at
              ? new Date(newRecord.family_expires_at)
              : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        created_at: new Date(),
        updated_at: new Date(),
      };
      tokens.push(row);
      return row;
    },
    async rotate(params) {
      const existing = tokens.find((t) => t.token_hash === params.oldTokenHash);
      if (!existing) return { success: false, reason: 'TOKEN_NOT_FOUND' };
      if (existing.status === 'REVOKED')
        return { success: false, reason: 'TOKEN_REVOKED', token: existing };
      if (new Date(existing.expires_at).getTime() <= Date.now()) {
        return { success: false, reason: 'TOKEN_EXPIRED', token: existing };
      }
      if (new Date(existing.family_expires_at).getTime() <= Date.now()) {
        return { success: false, reason: 'TOKEN_EXPIRED', token: existing };
      }
      if (existing.status === 'CONSUMED') {
        let count = 0;
        for (const t of tokens) {
          if (t.family_id === existing.family_id && t.status !== 'REVOKED') {
            (t as { status: RefreshTokenStatus }).status = 'REVOKED';
            (t as { revoked_at: Date }).revoked_at = new Date();
            (t as { revoked_reason: string }).revoked_reason = 'REUSE_DETECTED';
            count++;
          }
        }
        return {
          success: false,
          reason: 'REUSE_DETECTED',
          familyId: existing.family_id,
          revokedCount: count,
        };
      }
      const boundedExpiresAt =
        params.newExpiresAt.getTime() > new Date(existing.family_expires_at).getTime()
          ? new Date(existing.family_expires_at)
          : params.newExpiresAt;

      const newRow: RefreshTokenRow = {
        id: crypto.randomUUID(),
        user_id: existing.user_id,
        family_id: existing.family_id,
        token_hash: params.newTokenHash,
        status: 'ACTIVE',
        replaced_by_token_id: null,
        revoked_reason: null,
        revoked_at: null,
        consumed_at: null,
        expires_at: boundedExpiresAt,
        family_expires_at: existing.family_expires_at,
        created_at: new Date(),
        updated_at: new Date(),
      };
      tokens.push(newRow);
      (existing as { status: RefreshTokenStatus }).status = 'CONSUMED';
      (existing as { consumed_at: Date }).consumed_at = new Date();
      (existing as { replaced_by_token_id: string }).replaced_by_token_id = newRow.id;
      return { success: true, oldToken: existing, newToken: newRow };
    },
    async revokeFamily(familyId, reason = 'EXPLICIT_REVOCATION') {
      let count = 0;
      for (const t of tokens) {
        if (t.family_id === familyId && t.status !== 'REVOKED') {
          (t as { status: RefreshTokenStatus }).status = 'REVOKED';
          (t as { revoked_reason: string }).revoked_reason = reason;
          (t as { revoked_at: Date }).revoked_at = new Date();
          count++;
        }
      }
      return count;
    },
    async revokeToken(id, reason = 'LOGOUT') {
      const t = tokens.find((tok) => tok.id === id);
      if (!t) return null;
      (t as { status: RefreshTokenStatus }).status = 'REVOKED';
      (t as { revoked_reason: string }).revoked_reason = reason;
      (t as { revoked_at: Date }).revoked_at = new Date();
      return t;
    },
    async revokeAllForUser(userId, reason = 'USER_SECURITY_RESET') {
      let count = 0;
      for (const t of tokens) {
        if (t.user_id === userId && t.status !== 'REVOKED') {
          (t as { status: RefreshTokenStatus }).status = 'REVOKED';
          (t as { revoked_reason: string }).revoked_reason = reason;
          (t as { revoked_at: Date }).revoked_at = new Date();
          count++;
        }
      }
      return count;
    },
    async listActiveByUser(userId) {
      const now = Date.now();
      return tokens.filter(
        (t) =>
          t.user_id === userId && t.status === 'ACTIVE' && new Date(t.expires_at).getTime() > now,
      );
    },
  };
}

function makeHttpRequest(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...headers,
          ...(body ? { 'Content-Length': Buffer.byteLength(body).toString() } : {}),
        },
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
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

describe('Asymmetric Ed25519 JWT Signing & Verification', () => {
  it('generates a valid Ed25519 keypair and signs a JWT verifiable with public key', () => {
    const keyPair = generateEd25519KeyPair();
    assert.ok(keyPair.publicKeyPem.includes('BEGIN PUBLIC KEY'));
    assert.ok(keyPair.privateKeyPem.includes('BEGIN PRIVATE KEY'));

    const token = signAccessToken(
      {
        sub: '10000000-0000-4000-8000-000000000001',
        email: 'user@example.com',
        phone: '+919876543210',
        fullName: 'Test User',
      },
      {
        privateKey: keyPair.privateKey,
        kid: 'key-1',
        issuer: 'grocery-identity-service',
        audience: 'grocery-api-gateway',
        expiresInSeconds: 900,
      },
    );

    const parts = token.split('.');
    assert.equal(parts.length, 3);

    const verified = verifyAccessToken(token, {
      publicKey: keyPair.publicKey,
      expectedIssuer: 'grocery-identity-service',
      expectedAudience: 'grocery-api-gateway',
    });

    assert.equal(verified.sub, '10000000-0000-4000-8000-000000000001');
    assert.equal(verified.email, 'user@example.com');
    assert.equal(verified.phone, '+919876543210');
    assert.equal(verified.fullName, 'Test User');
    assert.equal(verified.iss, 'grocery-identity-service');
    assert.equal(verified.aud, 'grocery-api-gateway');
  });

  it('rejects tampered signature with TokenVerificationError INVALID_SIGNATURE', () => {
    const keyPair = generateEd25519KeyPair();
    const otherKeyPair = generateEd25519KeyPair();

    const token = signAccessToken(
      {
        sub: '10000000-0000-4000-8000-000000000001',
        fullName: 'Test User',
      },
      { privateKey: keyPair.privateKey },
    );

    assert.throws(
      () =>
        verifyAccessToken(token, {
          publicKey: otherKeyPair.publicKey,
        }),
      (err) => {
        assert.ok(err instanceof TokenVerificationError);
        assert.equal(err.reason, 'INVALID_SIGNATURE');
        return true;
      },
    );
  });

  it('rejects expired access token with TokenVerificationError TOKEN_EXPIRED', () => {
    const keyPair = generateEd25519KeyPair();
    const token = signAccessToken(
      {
        sub: '10000000-0000-4000-8000-000000000001',
        fullName: 'Expired User',
        exp: Math.floor(Date.now() / 1000) - 10,
      },
      { privateKey: keyPair.privateKey },
    );

    assert.throws(
      () =>
        verifyAccessToken(token, {
          publicKey: keyPair.publicKey,
        }),
      (err) => {
        assert.ok(err instanceof TokenVerificationError);
        assert.equal(err.reason, 'TOKEN_EXPIRED');
        return true;
      },
    );
  });

  it('rejects mismatched issuer or audience', () => {
    const keyPair = generateEd25519KeyPair();
    const token = signAccessToken(
      {
        sub: '10000000-0000-4000-8000-000000000001',
        fullName: 'Audience Test',
      },
      {
        privateKey: keyPair.privateKey,
        issuer: 'grocery-identity-service',
        audience: 'grocery-api-gateway',
      },
    );

    assert.throws(
      () =>
        verifyAccessToken(token, {
          publicKey: keyPair.publicKey,
          expectedIssuer: 'wrong-issuer',
        }),
      (err) => {
        assert.ok(err instanceof TokenVerificationError);
        assert.equal(err.reason, 'INVALID_ISSUER');
        return true;
      },
    );

    assert.throws(
      () =>
        verifyAccessToken(token, {
          publicKey: keyPair.publicKey,
          expectedAudience: 'wrong-audience',
        }),
      (err) => {
        assert.ok(err instanceof TokenVerificationError);
        assert.equal(err.reason, 'INVALID_AUDIENCE');
        return true;
      },
    );
  });
});

describe('Cookie Parsing & Formatting Utilities', () => {
  it('parses multi-cookie headers accurately', () => {
    const header = 'cookie1=val1; refresh_token=sec-token-123; session_id=xyz';
    const parsed = parseCookies(header);
    assert.equal(parsed['cookie1'], 'val1');
    assert.equal(parsed['refresh_token'], 'sec-token-123');
    assert.equal(parsed['session_id'], 'xyz');
  });

  it('handles empty or malformed cookie headers gracefully', () => {
    assert.deepEqual(parseCookies(undefined), {});
    assert.deepEqual(parseCookies(''), {});
    assert.deepEqual(parseCookies('invalid-entry-without-equals; good=yes'), { good: 'yes' });
  });

  it('builds refresh token cookie with strict security flags per ADR-003 and ADR-011', () => {
    const cookie = buildRefreshTokenCookie('test-raw-token', {
      maxAgeSeconds: 604800,
      secure: true,
    });
    assert.ok(cookie.includes('refresh_token=test-raw-token'));
    assert.ok(cookie.includes('Path=/api/v1/auth'));
    assert.ok(cookie.includes('HttpOnly'));
    assert.ok(cookie.includes('SameSite=Strict'));
    assert.ok(cookie.includes('Secure'));
    assert.ok(cookie.includes('Max-Age=604800'));
  });

  it('builds clear refresh token cookie with Max-Age=0', () => {
    const clearCookie = buildClearRefreshTokenCookie({ secure: true });
    assert.ok(clearCookie.includes('refresh_token=;'));
    assert.ok(clearCookie.includes('Path=/api/v1/auth'));
    assert.ok(clearCookie.includes('HttpOnly'));
    assert.ok(clearCookie.includes('SameSite=Strict'));
    assert.ok(clearCookie.includes('Secure'));
    assert.ok(clearCookie.includes('Max-Age=0'));
  });
});

describe('Full Session Flow over HTTP', () => {
  it('issues session cookie and TokenResponseSchema on login, supports rotation on /refresh, profile fetch on /me, and revocation on /logout', async () => {
    const keyPair = generateEd25519KeyPair();
    const mockDb = createMockKysely();
    const userRepo = createMockUserRepo();
    const credRepo = createMockCredentialRepo();
    const refreshTokenRepo = createMockRefreshTokenRepo();

    const authService = createAuthService({
      db: mockDb,
      userRepo,
      credentialRepo: credRepo,
      refreshTokenRepo,
      keyPair: {
        publicKey: keyPair.publicKey,
        privateKey: keyPair.privateKey,
        kid: 'test-key-1',
      },
      accessTokenExpiresInSeconds: 900,
    });

    const server = createIdentityService({
      authService,
      port: 0,
      host: '127.0.0.1',
      allowedOrigins: ['https://app.grocerystore.local'],
      cookieSecure: false, // false for HTTP loopback test
    });

    await server.start();
    const address = server.server.address() as { port: number };
    const port = address.port;

    try {
      // 1. Register user
      const registerRes = await makeHttpRequest(
        port,
        'POST',
        '/api/v1/auth/register',
        { 'Content-Type': 'application/json' },
        JSON.stringify({
          fullName: 'Alice Merchant',
          email: 'alice@grocerystore.local',
          password: 'Password123!',
        }),
      );

      assert.equal(registerRes.statusCode, 201);
      const registerData = JSON.parse(registerRes.body);
      assert.ok(registerData.accessToken);
      assert.equal(registerData.tokenType, 'Bearer');
      assert.equal(registerData.expiresIn, 900);
      assert.equal(registerData.user.email, 'alice@grocerystore.local');

      // Verify Set-Cookie header on register
      const regCookieHeader = registerRes.headers['set-cookie'];
      assert.ok(regCookieHeader && regCookieHeader.length > 0);
      const regCookie = regCookieHeader[0]!;
      assert.ok(regCookie.includes('refresh_token='));
      assert.ok(regCookie.includes('Path=/api/v1/auth'));
      assert.ok(regCookie.includes('HttpOnly'));
      assert.ok(regCookie.includes('SameSite=Strict'));

      // 2. Login user
      const loginRes = await makeHttpRequest(
        port,
        'POST',
        '/api/v1/auth/login',
        { 'Content-Type': 'application/json' },
        JSON.stringify({
          identifier: 'alice@grocerystore.local',
          password: 'Password123!',
        }),
      );

      assert.equal(loginRes.statusCode, 200);
      const loginData = JSON.parse(loginRes.body);
      assert.ok(loginData.accessToken);
      assert.equal(loginData.tokenType, 'Bearer');
      assert.equal(loginData.expiresIn, 900);
      assert.equal(loginData.user.fullName, 'Alice Merchant');

      const loginCookieHeader = loginRes.headers['set-cookie']![0]!;
      const loginCookies = parseCookies(loginCookieHeader.split(';')[0]);
      const initialRefreshToken = loginCookies['refresh_token']!;
      assert.ok(initialRefreshToken);

      // 3. Fetch current user via GET /api/v1/auth/me
      const meRes = await makeHttpRequest(port, 'GET', '/api/v1/auth/me', {
        Authorization: `Bearer ${loginData.accessToken}`,
      });
      assert.equal(meRes.statusCode, 200);
      const meData = JSON.parse(meRes.body);
      assert.equal(meData.user.email, 'alice@grocerystore.local');
      assert.equal(meData.user.fullName, 'Alice Merchant');

      // 4. Test CSRF protection on /refresh: foreign origin rejected with 403
      const csrfBlockedRes = await makeHttpRequest(port, 'POST', '/api/v1/auth/refresh', {
        Cookie: `refresh_token=${initialRefreshToken}`,
        Origin: 'https://malicious-attacker.com',
      });
      assert.equal(csrfBlockedRes.statusCode, 403);
      const csrfErr = JSON.parse(csrfBlockedRes.body);
      assert.equal(csrfErr.code, 'CSRF_VALIDATION_FAILED');

      // 5. Rotate token via POST /api/v1/auth/refresh with authorized Origin
      const refreshRes = await makeHttpRequest(port, 'POST', '/api/v1/auth/refresh', {
        Cookie: `refresh_token=${initialRefreshToken}`,
        Origin: 'https://app.grocerystore.local',
      });

      assert.equal(refreshRes.statusCode, 200);
      const refreshData = JSON.parse(refreshRes.body);
      assert.ok(refreshData.accessToken);
      assert.equal(refreshData.tokenType, 'Bearer');
      assert.equal(refreshData.expiresIn, 900);

      // Verify new rotated refresh cookie
      const newCookieHeader = refreshRes.headers['set-cookie']![0]!;
      const newCookies = parseCookies(newCookieHeader.split(';')[0]);
      const rotatedRefreshToken = newCookies['refresh_token']!;
      assert.ok(rotatedRefreshToken);
      assert.notEqual(rotatedRefreshToken, initialRefreshToken);

      // 6. Test reuse detection: presenting old consumed refresh token must trigger 401 and revoke family
      const reuseRes = await makeHttpRequest(port, 'POST', '/api/v1/auth/refresh', {
        Cookie: `refresh_token=${initialRefreshToken}`,
        Origin: 'https://app.grocerystore.local',
      });

      assert.equal(reuseRes.statusCode, 401);
      const reuseErr = JSON.parse(reuseRes.body);
      assert.equal(reuseErr.code, 'TOKEN_REUSE_DETECTED');

      // 7. Verify rotated token is now also revoked due to family invalidation
      const subsequentRefreshRes = await makeHttpRequest(port, 'POST', '/api/v1/auth/refresh', {
        Cookie: `refresh_token=${rotatedRefreshToken}`,
        Origin: 'https://app.grocerystore.local',
      });
      assert.equal(subsequentRefreshRes.statusCode, 401);

      // 8. Test /logout endpoint clears cookie and returns success: true
      const logoutRes = await makeHttpRequest(port, 'POST', '/api/v1/auth/logout', {
        Cookie: `refresh_token=${rotatedRefreshToken}`,
        Origin: 'https://app.grocerystore.local',
      });
      assert.equal(logoutRes.statusCode, 200);
      const logoutData = JSON.parse(logoutRes.body);
      assert.equal(logoutData.success, true);

      // Verify clear cookie header
      const logoutCookieHeader = logoutRes.headers['set-cookie']![0]!;
      assert.ok(logoutCookieHeader.includes('refresh_token=;'));
      assert.ok(logoutCookieHeader.includes('Max-Age=0'));
    } finally {
      await server.stop();
    }
  });

  it('rejects /me when Authorization header is missing or malformed', async () => {
    const keyPair = generateEd25519KeyPair();
    const mockDb = createMockKysely();
    const userRepo = createMockUserRepo();
    const credRepo = createMockCredentialRepo();
    const refreshTokenRepo = createMockRefreshTokenRepo();

    const authService = createAuthService({
      db: mockDb,
      userRepo,
      credentialRepo: credRepo,
      refreshTokenRepo,
      keyPair: {
        publicKey: keyPair.publicKey,
        privateKey: keyPair.privateKey,
      },
    });

    const server = createIdentityService({
      authService,
      port: 0,
      host: '127.0.0.1',
    });

    await server.start();
    const address = server.server.address() as { port: number };
    const port = address.port;

    try {
      const missingAuthRes = await makeHttpRequest(port, 'GET', '/api/v1/auth/me');
      assert.equal(missingAuthRes.statusCode, 401);

      const invalidSchemeRes = await makeHttpRequest(port, 'GET', '/api/v1/auth/me', {
        Authorization: 'Basic dXNlcjpwYXNz',
      });
      assert.equal(invalidSchemeRes.statusCode, 401);
    } finally {
      await server.stop();
    }
  });

  it('handles CORS OPTIONS preflight correctly', async () => {
    const mockDb = createMockKysely();
    const authService = createAuthService({ db: mockDb });

    const server = createIdentityService({
      authService,
      port: 0,
      host: '127.0.0.1',
      allowedOrigins: ['https://app.grocerystore.local'],
    });

    await server.start();
    const address = server.server.address() as { port: number };
    const port = address.port;

    try {
      const optionsRes = await makeHttpRequest(port, 'OPTIONS', '/api/v1/auth/login', {
        Origin: 'https://app.grocerystore.local',
        'Access-Control-Request-Method': 'POST',
      });
      assert.equal(optionsRes.statusCode, 204);
      assert.equal(
        optionsRes.headers['access-control-allow-origin'],
        'https://app.grocerystore.local',
      );
      assert.equal(optionsRes.headers['access-control-allow-credentials'], 'true');
    } finally {
      await server.stop();
    }
  });
});
