import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDatabaseClient, validateDatabaseConfig } from '../dist/index.js';

describe('Database Client Factory Lifecycle', () => {
  const sampleConfig = validateDatabaseConfig({
    databaseUrl: 'postgres://app:pass@127.0.0.1:5432/grocerystore',
    maxPoolSize: 5,
    connectionTimeoutMs: 2000,
  });

  it('creates pool and Kysely instance without establishing immediate connections', () => {
    const client = createDatabaseClient(sampleConfig);

    assert.ok(client.pool, 'Pool should be initialized');
    assert.ok(client.db, 'Kysely instance should be initialized');
    assert.equal(client.config.maxPoolSize, 5);

    // Verify pool has zero total connections opened on instantiation
    assert.equal(client.pool.totalCount, 0);
    assert.equal(client.pool.idleCount, 0);
    assert.equal(client.pool.waitingCount, 0);

    // Explicit disposal
    void client.destroy();
  });

  it('allows explicit destruction and prevents further operations', async () => {
    const client = createDatabaseClient(sampleConfig);
    await client.destroy();

    // Calling destroy multiple times is safe and idempotent
    await client.destroy();

    // isAlive after destruction returns false fail-closed without throwing
    const alive = await client.isAlive();
    assert.equal(alive, false);
  });

  it('handles concurrent destroy calls race-safely', async () => {
    const client = createDatabaseClient(sampleConfig);
    // Trigger concurrent destroy calls simultaneously
    const results = await Promise.all([client.destroy(), client.destroy(), client.destroy()]);
    assert.equal(results.length, 3);
    assert.equal(await client.isAlive(), false);
  });

  it('returns false fail-closed from isAlive when pool cannot connect', async () => {
    // Configure client targeting an unreachable local port with immediate timeout
    const unreachableConfig = validateDatabaseConfig({
      databaseUrl: 'postgres://app:pass@127.0.0.1:65432/grocerystore',
      connectionTimeoutMs: 200,
    });

    const client = createDatabaseClient(unreachableConfig);
    try {
      const alive = await client.isAlive();
      assert.equal(alive, false, 'isAlive must return false when connection fails');
    } finally {
      await client.destroy();
    }
  });
});
