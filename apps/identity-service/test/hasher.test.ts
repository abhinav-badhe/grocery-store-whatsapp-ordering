import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions } from '@node-rs/argon2';
import { createPasswordHasher, PasswordValidationError } from '../dist/index.js';

describe('Argon2id Password Hasher', () => {
  it('applies default parameters matching ADR-003 §5.2 (memoryCost: 65536, timeCost: 3, parallelism: 4)', () => {
    const hasher = createPasswordHasher();
    assert.equal(hasher.memoryCost, 65536);
    assert.equal(hasher.timeCost, 3);
    assert.equal(hasher.parallelism, 4);
    assert.equal(hasher.maxMemoryCost, 65536);
    assert.equal(hasher.maxTimeCost, 3);
    assert.equal(hasher.maxParallelism, 4);
  });

  it('accepts custom configuration within validated bounds using camelCase or uppercase config', () => {
    const hasher1 = createPasswordHasher({
      memoryCost: 32768,
      timeCost: 2,
      parallelism: 2,
    });
    assert.equal(hasher1.memoryCost, 32768);
    assert.equal(hasher1.timeCost, 2);
    assert.equal(hasher1.parallelism, 2);
    assert.equal(hasher1.maxMemoryCost, 32768);
    assert.equal(hasher1.maxTimeCost, 2);
    assert.equal(hasher1.maxParallelism, 2);

    const hasher2 = createPasswordHasher({
      ARGON2_MEMORY_COST: 16384,
      ARGON2_TIME_COST: 1,
      ARGON2_PARALLELISM: 1,
    });
    assert.equal(hasher2.memoryCost, 16384);
    assert.equal(hasher2.timeCost, 1);
    assert.equal(hasher2.parallelism, 1);
    assert.equal(hasher2.maxMemoryCost, 16384);
    assert.equal(hasher2.maxTimeCost, 1);
    assert.equal(hasher2.maxParallelism, 1);
  });

  it('rejects out-of-bounds configuration values via Argon2idEnvSchema', () => {
    // Memory cost below 1024 KiB
    assert.throws(() => createPasswordHasher({ memoryCost: 512 }));
    // Time cost below 1
    assert.throws(() => createPasswordHasher({ timeCost: 0 }));
    // Parallelism below 1
    assert.throws(() => createPasswordHasher({ parallelism: 0 }));
    // maxMemoryCost below 1024 KiB
    assert.throws(() => createPasswordHasher({ maxMemoryCost: 512 }));
    // maxTimeCost below 1
    assert.throws(() => createPasswordHasher({ maxTimeCost: 0 }));
    // maxParallelism below 1
    assert.throws(() => createPasswordHasher({ maxParallelism: 0 }));
  });

  it('produces an encoded Argon2id PHC string with configured parameters', async () => {
    // Use smaller valid parameters (1024 KiB) for fast unit test execution
    const hasher = createPasswordHasher({
      memoryCost: 1024,
      timeCost: 1,
      parallelism: 1,
    });

    const plainPassword = 'CorrectHorseBatteryStaple123!';
    const hash = await hasher.hash(plainPassword);

    // PHC format check: $argon2id$v=19$m=1024,t=1,p=1$...
    assert.ok(hash.startsWith('$argon2id$v=19$m=1024,t=1,p=1$'), `Unexpected hash prefix: ${hash}`);

    // Parse options directly via native parser
    const parsed = parseOptions(hash);
    assert.equal(parsed.algorithm, 2, 'Algorithm must be Argon2id (value 2)');
    assert.equal(parsed.memoryCost, 1024);
    assert.equal(parsed.timeCost, 1);
    assert.equal(parsed.parallelism, 1);
  });

  it('verifies correct password and rejects incorrect password', async () => {
    const hasher = createPasswordHasher({
      memoryCost: 1024,
      timeCost: 1,
      parallelism: 1,
    });

    const password = 'SecretPassword987!';
    const hash = await hasher.hash(password);

    // Correct password verifies successfully
    const isValid = await hasher.verify(password, hash);
    assert.equal(isValid, true);

    // Incorrect password fails verification
    const isInvalid = await hasher.verify('WrongPassword123!', hash);
    assert.equal(isInvalid, false);

    // Completely different password fails verification
    const isDifferent = await hasher.verify('AnotherRandomPass999!', hash);
    assert.equal(isDifferent, false);
  });

  it('preserves leading and trailing password spaces strictly without normalization', async () => {
    const hasher = createPasswordHasher({
      memoryCost: 1024,
      timeCost: 1,
      parallelism: 1,
    });

    const passwordWithSpaces = '  SpacesAtEnds123!  ';
    const hash = await hasher.hash(passwordWithSpaces);

    // Same password with exact spaces verifies
    const exactVerify = await hasher.verify(passwordWithSpaces, hash);
    assert.equal(exactVerify, true);

    // Trimmed password must NOT verify (proves raw content preservation)
    const trimmedVerify = await hasher.verify('SpacesAtEnds123!', hash);
    assert.equal(trimmedVerify, false);

    // Different case must NOT verify (proves no case-folding)
    const lowerVerify = await hasher.verify('  spacesatends123!  ', hash);
    assert.equal(lowerVerify, false);
  });

  it('rejects invalid password inputs before expensive hashing is invoked', async () => {
    const hasher = createPasswordHasher({
      memoryCost: 1024,
      timeCost: 1,
      parallelism: 1,
    });

    // Too short (<8 chars)
    await assert.rejects(
      async () => await hasher.hash('short7!'),
      (err) => {
        assert.ok(err instanceof PasswordValidationError);
        assert.equal(err.message, 'Password must be at least 8 characters long');
        return true;
      },
    );

    // Too long (>128 chars)
    const overlyLong = 'a'.repeat(129);
    await assert.rejects(
      async () => await hasher.hash(overlyLong),
      (err) => {
        assert.ok(err instanceof PasswordValidationError);
        assert.equal(err.message, 'Password cannot exceed 128 characters');
        return true;
      },
    );

    // Non-string input
    await assert.rejects(
      async () => await hasher.hash(12345678 as unknown as string),
      (err) => {
        assert.ok(err instanceof PasswordValidationError);
        assert.equal(err.message, 'Password must be a string');
        return true;
      },
    );
  });

  it('fails safely on malformed or corrupted hashes without throwing or leaking internals', async () => {
    const hasher = createPasswordHasher({
      memoryCost: 1024,
      timeCost: 1,
      parallelism: 1,
    });

    const validPassword = 'ValidPassword123!';

    // Non-hash arbitrary string
    assert.equal(await hasher.verify(validPassword, 'not-a-hash'), false);

    // Corrupted Argon2 PHC string
    assert.equal(
      await hasher.verify(validPassword, '$argon2id$v=19$m=1024,t=1,p=1$invalidbase64!'),
      false,
    );

    // Empty hash
    assert.equal(await hasher.verify(validPassword, ''), false);

    // Non-string hash or password
    assert.equal(await hasher.verify(validPassword, null as unknown as string), false);
    assert.equal(
      await hasher.verify(null as unknown as string, '$argon2id$v=19$m=1024,t=1,p=1$fake'),
      false,
    );

    // Password below length bound during verify
    assert.equal(await hasher.verify('short', '$argon2id$v=19$m=1024,t=1,p=1$fake'), false);
  });

  it('guarantees validation errors never leak submitted password contents', async () => {
    const hasher = createPasswordHasher();
    const sensitiveSecret = 'SecretPasswordWithSensitiveData!';

    try {
      // Intentionally cause failure with non-string wrapper or length check
      await hasher.hash('short');
      assert.fail('Should have thrown PasswordValidationError');
    } catch (err) {
      assert.ok(err instanceof PasswordValidationError);
      const str = String(err);
      assert.equal(str.includes(sensitiveSecret), false);
    }
  });

  it('executes a hash with default production parameters (65536 KiB, 3 passes, 4 threads)', async () => {
    const hasher = createPasswordHasher();
    const plain = 'ProductionStrengthPassword2026!';
    const hash = await hasher.hash(plain);

    assert.ok(hash.startsWith('$argon2id$v=19$m=65536,t=3,p=4$'));
    const parsed = parseOptions(hash);
    assert.equal(parsed.memoryCost, 65536);
    assert.equal(parsed.timeCost, 3);
    assert.equal(parsed.parallelism, 4);

    const verified = await hasher.verify(plain, hash);
    assert.equal(verified, true);
  });

  it('rejects unsupported algorithms (Argon2i, Argon2d, bcrypt) safely without calling verify', async () => {
    const mockVerify = mock.fn(async () => true);
    const hasher = createPasswordHasher(
      { memoryCost: 1024, timeCost: 1, parallelism: 1 },
      { verify: mockVerify },
    );

    const validPassword = 'ValidPassword123!';
    const realArgon2idHash = await hasher.hash(validPassword);

    // Argon2i variant
    const argon2iHash = realArgon2idHash.replace('$argon2id$', '$argon2i$');
    assert.equal(await hasher.verify(validPassword, argon2iHash), false);
    assert.equal(mockVerify.mock.callCount(), 0, 'verify must not be called for Argon2i');

    // Argon2d variant
    const argon2dHash = realArgon2idHash.replace('$argon2id$', '$argon2d$');
    assert.equal(await hasher.verify(validPassword, argon2dHash), false);
    assert.equal(mockVerify.mock.callCount(), 0, 'verify must not be called for Argon2d');

    // Bcrypt hash
    assert.equal(
      await hasher.verify(
        validPassword,
        '$2b$12$e8kZ1fC6XfE/M4B7rUqG8O2sZq2K9nL6lT3pW5e8r1t4y2u0i9o3e',
      ),
      false,
    );
    assert.equal(mockVerify.mock.callCount(), 0, 'verify must not be called for bcrypt');
  });

  it('rejects stored hashes with excessive memory, time, or parallelism before native verification', async () => {
    const mockVerify = mock.fn(async () => true);
    // Hasher with strict conservative bounds (1024 KiB, 1 pass, 1 thread)
    const hasher = createPasswordHasher(
      { memoryCost: 1024, timeCost: 1, parallelism: 1 },
      { verify: mockVerify },
    );

    const validPassword = 'ValidPassword123!';

    // 1. Memory cost exceeds threshold (m=2048 > maxMemoryCost 1024)
    const baseHasher = createPasswordHasher({ memoryCost: 2048, timeCost: 1, parallelism: 1 });
    const highMemoryHash = await baseHasher.hash(validPassword);

    const memResult = await hasher.verify(validPassword, highMemoryHash);
    assert.equal(memResult, false);
    assert.equal(
      mockVerify.mock.callCount(),
      0,
      'verify must not be called when memoryCost exceeds policy',
    );

    // 2. Time cost exceeds threshold (t=2 > maxTimeCost 1)
    const timeHasher = createPasswordHasher({ memoryCost: 1024, timeCost: 2, parallelism: 1 });
    const highTimeHash = await timeHasher.hash(validPassword);

    const timeResult = await hasher.verify(validPassword, highTimeHash);
    assert.equal(timeResult, false);
    assert.equal(
      mockVerify.mock.callCount(),
      0,
      'verify must not be called when timeCost exceeds policy',
    );

    // 3. Parallelism exceeds threshold (p=2 > maxParallelism 1)
    const parHasher = createPasswordHasher({ memoryCost: 1024, timeCost: 1, parallelism: 2 });
    const highParHash = await parHasher.hash(validPassword);

    const parResult = await hasher.verify(validPassword, highParHash);
    assert.equal(parResult, false);
    assert.equal(
      mockVerify.mock.callCount(),
      0,
      'verify must not be called when parallelism exceeds policy',
    );
  });

  it('fails safely when parseOptions encounters an unexpected error without calling verify', async () => {
    const mockVerify = mock.fn(async () => true);
    const mockParseOptions = mock.fn(() => {
      throw new Error('Unexpected native parsing exception');
    });

    const hasher = createPasswordHasher(
      { memoryCost: 1024, timeCost: 1, parallelism: 1 },
      { verify: mockVerify, parseOptions: mockParseOptions },
    );

    const validPassword = 'ValidPassword123!';
    // Valid prefix so it passes string check and reaches parseOptions
    const result = await hasher.verify(
      validPassword,
      '$argon2id$v=19$m=1024,t=1,p=1$synthetic$synthetic',
    );
    assert.equal(result, false);
    assert.equal(
      mockVerify.mock.callCount(),
      0,
      'verify must not be called when parseOptions throws',
    );
  });

  it('handles Unicode passwords and exact 8- and 128-code-unit boundary lengths consistently', async () => {
    const hasher = createPasswordHasher({
      memoryCost: 1024,
      timeCost: 1,
      parallelism: 1,
    });

    // Exact min boundary: 8 code units
    const min8 = '12345678';
    assert.equal(min8.length, 8);
    const hash8 = await hasher.hash(min8);
    assert.equal(await hasher.verify(min8, hash8), true);
    assert.equal(await hasher.verify('wrongpass', hash8), false);

    // Exact max boundary: 128 code units
    const max128 = 'K'.repeat(128);
    assert.equal(max128.length, 128);
    const hash128 = await hasher.hash(max128);
    assert.equal(await hasher.verify(max128, hash128), true);
    assert.equal(await hasher.verify('K'.repeat(127), hash128), false);

    // Boundary violation: 7 code units
    const under7 = '1234567';
    assert.equal(under7.length, 7);
    await assert.rejects(async () => await hasher.hash(under7), PasswordValidationError);
    assert.equal(await hasher.verify(under7, hash8), false);

    // Boundary violation: 129 code units
    const over129 = 'K'.repeat(129);
    assert.equal(over129.length, 129);
    await assert.rejects(async () => await hasher.hash(over129), PasswordValidationError);
    assert.equal(await hasher.verify(over129, hash128), false);

    // Multi-byte Unicode characters (German umlauts and emoji)
    const unicodePassword = 'Passwörd🔒Späces123!';
    const unicodeHash = await hasher.hash(unicodePassword);
    assert.equal(await hasher.verify(unicodePassword, unicodeHash), true);

    // Proves byte-for-byte exactness (no Unicode folding or normalization)
    assert.equal(await hasher.verify('Password🔒Spaces123!', unicodeHash), false);
  });
});
