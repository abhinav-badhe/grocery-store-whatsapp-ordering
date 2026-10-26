import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  NormalizedEmailSchema,
  PasswordInputSchema,
  RegisterInputSchema,
  LoginInputSchema,
  UserStatusSchema,
  UserResponseSchema,
  AuthResponseSchema,
  TokenResponseSchema,
  RefreshTokenResponseSchema,
  LogoutResponseSchema,
  CurrentUserResponseSchema,
  StoreStatusSchema,
  StoreProfileSchema,
  CreateStoreInputSchema,
  StoreRoleSchema,
  MembershipStatusSchema,
  StoreMembershipSchema,
  AssignMembershipInputSchema,
  ActorPersonaSchema,
  InternalTokenClaimsSchema,
} from '../dist/index.js';

describe('Identity API Contracts: Registration & Passwords', () => {
  it('normalizes email addresses by trimming and lowercasing', () => {
    const raw = '  User.Name+Tag@Example.COM  ';
    const parsed = NormalizedEmailSchema.parse(raw);
    assert.equal(parsed, 'user.name+tag@example.com');
  });

  it('rejects malformed email addresses', () => {
    assert.throws(() => NormalizedEmailSchema.parse('not-an-email'));
    assert.throws(() => NormalizedEmailSchema.parse('missing-domain@'));
    assert.throws(() => NormalizedEmailSchema.parse('@missing-user.com'));
  });

  it('preserves raw password contents strictly without trimming or normalization', () => {
    const rawPasswordWithSpaces = '  SpacesAtEnds123!  ';
    const parsed = PasswordInputSchema.parse(rawPasswordWithSpaces);
    // CRITICAL: Must NOT trim or transform password content
    assert.equal(parsed, rawPasswordWithSpaces);
    assert.equal(parsed.length, rawPasswordWithSpaces.length);
  });

  it('enforces password length boundaries (8 to 128 characters)', () => {
    // 8 characters (min bound)
    assert.equal(PasswordInputSchema.parse('12345678'), '12345678');
    // 7 characters (too short)
    assert.throws(() => PasswordInputSchema.parse('1234567'));
    // 128 characters (max bound)
    const maxPassword = 'a'.repeat(128);
    assert.equal(PasswordInputSchema.parse(maxPassword), maxPassword);
    // 129 characters (too long)
    assert.throws(() => PasswordInputSchema.parse('a'.repeat(129)));
  });

  it('accepts valid registration with email only', () => {
    const input = {
      fullName: 'Aarav Sharma',
      email: 'aarav@example.com',
      password: 'StrongPassword123!',
    };
    const parsed = RegisterInputSchema.parse(input);
    assert.equal(parsed.fullName, 'Aarav Sharma');
    assert.equal(parsed.email, 'aarav@example.com');
    assert.equal(parsed.phone, undefined);
    assert.equal(parsed.password, 'StrongPassword123!');
  });

  it('accepts valid registration with E.164 phone only', () => {
    const input = {
      fullName: 'Priya Patel',
      phone: '+919876543210',
      password: 'StrongPassword123!',
    };
    const parsed = RegisterInputSchema.parse(input);
    assert.equal(parsed.fullName, 'Priya Patel');
    assert.equal(parsed.phone, '+919876543210');
    assert.equal(parsed.email, undefined);
  });

  it('accepts valid registration with both email and phone', () => {
    const input = {
      fullName: 'Rohan Gupta',
      email: 'rohan@example.com',
      phone: '+919123456789',
      password: 'StrongPassword123!',
    };
    const parsed = RegisterInputSchema.parse(input);
    assert.equal(parsed.fullName, 'Rohan Gupta');
    assert.equal(parsed.email, 'rohan@example.com');
    assert.equal(parsed.phone, '+919123456789');
  });

  it('rejects registration when neither email nor phone is provided', () => {
    const input = {
      fullName: 'Anonymous User',
      password: 'StrongPassword123!',
    };
    assert.throws(() => RegisterInputSchema.parse(input), /At least one contact identifier/);
  });

  it('rejects registration with invalid phone format', () => {
    const input = {
      fullName: 'Test User',
      phone: '9876543210', // Missing + country code
      password: 'StrongPassword123!',
    };
    assert.throws(() => RegisterInputSchema.parse(input));
  });
});

describe('Identity API Contracts: Login', () => {
  it('accepts valid login with email identifier', () => {
    const input = {
      identifier: 'merchant@store.in',
      password: 'Password999!',
    };
    const parsed = LoginInputSchema.parse(input);
    assert.equal(parsed.identifier, 'merchant@store.in');
    assert.equal(parsed.password, 'Password999!');
  });

  it('accepts valid login with E.164 phone identifier', () => {
    const input = {
      identifier: '+919876543210',
      password: 'Password999!',
    };
    const parsed = LoginInputSchema.parse(input);
    assert.equal(parsed.identifier, '+919876543210');
  });

  it('rejects login with invalid identifier format', () => {
    const input = {
      identifier: 'not-an-email-or-phone',
      password: 'Password999!',
    };
    assert.throws(
      () => LoginInputSchema.parse(input),
      /must be a valid email address or an E\.164 phone number/,
    );
  });

  it('preserves exact raw password during login validation', () => {
    const rawPass = '  P@ssw0rd With Spaces  ';
    const input = {
      identifier: 'user@example.com',
      password: rawPass,
    };
    const parsed = LoginInputSchema.parse(input);
    assert.equal(parsed.password, rawPass);
  });
});

describe('Identity API Contracts: User & Authentication Responses', () => {
  const validUser = {
    id: 'a0000000-0000-4000-8000-000000000001',
    email: 'user@example.com',
    phone: '+919876543210',
    fullName: 'Ananya Verma',
    status: 'ACTIVE' as const,
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:00:00.000Z',
  };

  it('validates a safe public user representation', () => {
    const parsed = UserResponseSchema.parse(validUser);
    assert.equal(parsed.id, validUser.id);
    assert.equal(parsed.fullName, 'Ananya Verma');
    assert.equal(parsed.status, 'ACTIVE');
  });

  it('validates user status enumerations', () => {
    assert.equal(UserStatusSchema.parse('ACTIVE'), 'ACTIVE');
    assert.equal(UserStatusSchema.parse('SUSPENDED'), 'SUSPENDED');
    assert.equal(UserStatusSchema.parse('PENDING_VERIFICATION'), 'PENDING_VERIFICATION');
    assert.throws(() => UserStatusSchema.parse('UNKNOWN'));
  });

  it('validates AuthResponse contract containing user representation', () => {
    const authRes = AuthResponseSchema.parse({ user: validUser });
    assert.equal(authRes.user.id, validUser.id);
  });

  it('validates TokenResponseSchema containing memory access token and user', () => {
    const tokenRes = TokenResponseSchema.parse({
      accessToken: 'eyJhbGciOiJFZERTQSI...sample-access-token',
      expiresIn: 900,
      user: validUser,
    });
    assert.equal(tokenRes.accessToken, 'eyJhbGciOiJFZERTQSI...sample-access-token');
    assert.equal(tokenRes.tokenType, 'Bearer');
    assert.equal(tokenRes.expiresIn, 900);
    assert.equal(tokenRes.user.id, validUser.id);
  });

  it('rejects TokenResponseSchema with missing access token or non-positive expiresIn', () => {
    assert.throws(() =>
      TokenResponseSchema.parse({
        accessToken: '',
        expiresIn: 900,
        user: validUser,
      }),
    );
    assert.throws(() =>
      TokenResponseSchema.parse({
        accessToken: 'valid-token',
        expiresIn: 0,
        user: validUser,
      }),
    );
  });

  it('validates RefreshTokenResponseSchema containing rotated access token without user payload', () => {
    const refreshRes = RefreshTokenResponseSchema.parse({
      accessToken: 'new-access-token-rotated',
      expiresIn: 900,
    });
    assert.equal(refreshRes.accessToken, 'new-access-token-rotated');
    assert.equal(refreshRes.tokenType, 'Bearer');
    assert.equal(refreshRes.expiresIn, 900);
  });

  it('validates LogoutResponseSchema and CurrentUserResponseSchema', () => {
    const logoutRes = LogoutResponseSchema.parse({ success: true });
    assert.equal(logoutRes.success, true);
    assert.throws(() => LogoutResponseSchema.parse({}));

    const meRes = CurrentUserResponseSchema.parse({ user: validUser });
    assert.equal(meRes.user.id, validUser.id);
  });

  it('proves UserResponseSchema does not expose password hashes or credential secrets in its schema shape', () => {
    // Assert schema keys strictly only include safe user fields
    const shapeKeys = Object.keys(UserResponseSchema.shape).sort();
    assert.deepEqual(shapeKeys, [
      'createdAt',
      'email',
      'fullName',
      'id',
      'phone',
      'status',
      'updatedAt',
    ]);
    assert.equal(shapeKeys.includes('password'), false);
    assert.equal(shapeKeys.includes('passwordHash'), false);
    assert.equal(shapeKeys.includes('salt'), false);
    assert.equal(shapeKeys.includes('resetToken'), false);
    assert.equal(shapeKeys.includes('secret'), false);
  });
});

describe('Identity API Contracts: Store Profile', () => {
  const validStore = {
    id: 'b0000000-0000-4000-8000-000000000001',
    name: 'Apna Kirana Store',
    code: 'apna-kirana',
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    status: 'ACTIVE' as const,
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:00:00.000Z',
  };

  it('validates a complete store profile', () => {
    const parsed = StoreProfileSchema.parse(validStore);
    assert.equal(parsed.id, validStore.id);
    assert.equal(parsed.name, 'Apna Kirana Store');
    assert.equal(parsed.currency, 'INR');
    assert.equal(parsed.timezone, 'Asia/Kolkata');
  });

  it('applies defaults for currency and timezone if omitted in profile or input', () => {
    const input = {
      name: 'Fresh Fruits',
    };
    const parsedInput = CreateStoreInputSchema.parse(input);
    assert.equal(parsedInput.name, 'Fresh Fruits');
    assert.equal(parsedInput.currency, 'INR');
    assert.equal(parsedInput.timezone, 'Asia/Kolkata');
  });

  it('validates store status enumeration', () => {
    assert.equal(StoreStatusSchema.parse('ACTIVE'), 'ACTIVE');
    assert.equal(StoreStatusSchema.parse('INACTIVE'), 'INACTIVE');
    assert.equal(StoreStatusSchema.parse('SUSPENDED'), 'SUSPENDED');
    assert.throws(() => StoreStatusSchema.parse('DELETED'));
  });

  it('rejects invalid currency codes (must be 3 uppercase letters)', () => {
    assert.throws(() => CreateStoreInputSchema.parse({ name: 'Store', currency: 'inr' }));
    assert.throws(() => CreateStoreInputSchema.parse({ name: 'Store', currency: 'IN' }));
    assert.throws(() => CreateStoreInputSchema.parse({ name: 'Store', currency: 'INDIA' }));
  });

  it('rejects store codes with invalid characters', () => {
    assert.throws(() => CreateStoreInputSchema.parse({ name: 'Store', code: 'Store Code' }));
    assert.throws(() => CreateStoreInputSchema.parse({ name: 'Store', code: 'STORE_CODE' }));
  });
});

describe('Identity API Contracts: Store Membership', () => {
  const storeA = '11111111-1111-4111-8111-111111111111';
  const storeB = '22222222-2222-4222-8222-222222222222';
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it('validates approved store roles: OWNER, MANAGER, STAFF', () => {
    assert.equal(StoreRoleSchema.parse('OWNER'), 'OWNER');
    assert.equal(StoreRoleSchema.parse('MANAGER'), 'MANAGER');
    assert.equal(StoreRoleSchema.parse('STAFF'), 'STAFF');
    assert.throws(() => StoreRoleSchema.parse('ADMIN'));
    assert.throws(() => StoreRoleSchema.parse('SUPERUSER'));
  });

  it('validates membership statuses: ACTIVE, INVITED, SUSPENDED', () => {
    assert.equal(MembershipStatusSchema.parse('ACTIVE'), 'ACTIVE');
    assert.equal(MembershipStatusSchema.parse('INVITED'), 'INVITED');
    assert.equal(MembershipStatusSchema.parse('SUSPENDED'), 'SUSPENDED');
    assert.throws(() => MembershipStatusSchema.parse('TERMINATED'));
  });

  it('supports multi-store memberships with different roles for the same user', () => {
    const membershipA = StoreMembershipSchema.parse({
      id: '90000000-0000-4000-8000-000000000001',
      userId,
      storeId: storeA,
      role: 'OWNER',
      status: 'ACTIVE',
      createdAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-01T10:00:00.000Z',
    });

    const membershipB = StoreMembershipSchema.parse({
      id: '90000000-0000-4000-8000-000000000002',
      userId,
      storeId: storeB,
      role: 'STAFF',
      status: 'ACTIVE',
      createdAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-01T10:00:00.000Z',
    });

    assert.equal(membershipA.userId, userId);
    assert.equal(membershipA.storeId, storeA);
    assert.equal(membershipA.role, 'OWNER');

    assert.equal(membershipB.userId, userId);
    assert.equal(membershipB.storeId, storeB);
    assert.equal(membershipB.role, 'STAFF');
  });

  it('validates AssignMembershipInputSchema', () => {
    const input = {
      userId,
      storeId: storeA,
      role: 'MANAGER',
    };
    const parsed = AssignMembershipInputSchema.parse(input);
    assert.equal(parsed.userId, userId);
    assert.equal(parsed.storeId, storeA);
    assert.equal(parsed.role, 'MANAGER');
  });
});

describe('Identity API Contracts: Internal-Token Claims', () => {
  const validClaims = {
    iss: 'api-gateway',
    aud: 'grocery-internal-service',
    sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    act: 'SHOPKEEPER' as const,
    tid: '11111111-1111-4111-8111-111111111111',
    roles: ['OWNER' as const],
    jti: 'token-nonce-12345678',
    iat: 1772445600,
    exp: 1772445660, // +60s
  };

  it('validates well-formed internal token claims payload', () => {
    const parsed = InternalTokenClaimsSchema.parse(validClaims);
    assert.equal(parsed.sub, validClaims.sub);
    assert.equal(parsed.act, 'SHOPKEEPER');
    assert.equal(parsed.tid, validClaims.tid);
    assert.deepEqual(parsed.roles, ['OWNER']);
    assert.equal(parsed.exp, validClaims.exp);
  });

  it('accepts valid actor personas: SHOPKEEPER, STAFF, CUSTOMER, SYSTEM', () => {
    assert.equal(ActorPersonaSchema.parse('SHOPKEEPER'), 'SHOPKEEPER');
    assert.equal(ActorPersonaSchema.parse('STAFF'), 'STAFF');
    assert.equal(ActorPersonaSchema.parse('CUSTOMER'), 'CUSTOMER');
    assert.equal(ActorPersonaSchema.parse('SYSTEM'), 'SYSTEM');
    assert.throws(() => ActorPersonaSchema.parse('ADMIN'));
  });

  it('rejects claims if tenant context (tid) is missing or invalid UUID', () => {
    const missingTid = { ...validClaims, tid: undefined };
    assert.throws(() => InternalTokenClaimsSchema.parse(missingTid));

    const invalidTid = { ...validClaims, tid: 'not-a-uuid' };
    assert.throws(() => InternalTokenClaimsSchema.parse(invalidTid));
  });

  it('rejects claims when exp is not strictly later than iat', () => {
    // exp === iat
    const equalTimes = { ...validClaims, iat: 1000, exp: 1000 };
    assert.throws(
      () => InternalTokenClaimsSchema.parse(equalTimes),
      /Expiration time \(exp\) must be strictly later than issuance time \(iat\)/,
    );

    // exp < iat
    const expiredBeforeIssue = { ...validClaims, iat: 1000, exp: 999 };
    assert.throws(
      () => InternalTokenClaimsSchema.parse(expiredBeforeIssue),
      /Expiration time \(exp\) must be strictly later than issuance time \(iat\)/,
    );
  });

  it('validates optional nbf and rejects if nbf > exp', () => {
    // valid nbf
    const withValidNbf = { ...validClaims, nbf: 1772445600 };
    assert.equal(InternalTokenClaimsSchema.parse(withValidNbf).nbf, 1772445600);

    // nbf > exp
    const invalidNbf = { ...validClaims, nbf: 1772445661, exp: 1772445660 };
    assert.throws(
      () => InternalTokenClaimsSchema.parse(invalidNbf),
      /Not-before time \(nbf\) cannot be later than expiration time \(exp\)/,
    );
  });

  it('rejects empty roles array in tenant-scoped internal token claims', () => {
    const emptyRoles = { ...validClaims, roles: [] };
    assert.throws(() => InternalTokenClaimsSchema.parse(emptyRoles));
  });

  it('enforces jti nonce length (min 8 characters)', () => {
    const shortJti = { ...validClaims, jti: 'short' };
    assert.throws(() => InternalTokenClaimsSchema.parse(shortJti));
  });
});
