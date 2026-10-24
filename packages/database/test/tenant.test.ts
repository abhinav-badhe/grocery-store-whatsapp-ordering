import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
} from 'kysely';
import {
  assertValidTenantId,
  InvalidTenantContextError,
  isValidTenantId,
  withTenantTransaction,
} from '../dist/index.js';

function createMockKysely(
  options: {
    onExecuteQuery?: (sql: string, parameters: readonly unknown[]) => void;
    onBeginTransaction?: () => void;
    onCommitTransaction?: () => void;
    onRollbackTransaction?: () => void;
  } = {},
) {
  const connection: DatabaseConnection = {
    executeQuery: async (compiledQuery) => {
      options.onExecuteQuery?.(compiledQuery.sql, compiledQuery.parameters);
      return { rows: [] };
    },
    streamQuery: () => {
      throw new Error('Streaming not implemented in mock');
    },
  };

  const driver: Driver = {
    init: async () => {},
    acquireConnection: async () => connection,
    beginTransaction: async () => {
      options.onBeginTransaction?.();
    },
    commitTransaction: async () => {
      options.onCommitTransaction?.();
    },
    rollbackTransaction: async () => {
      options.onRollbackTransaction?.();
    },
    releaseConnection: async () => {},
    destroy: async () => {},
  };

  return new Kysely({
    dialect: {
      createDriver: () => driver,
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createAdapter: () => new PostgresAdapter(),
      createIntrospector: (db) => new PostgresIntrospector(db),
    },
  });
}

describe('Tenant Context & Transaction Validation', () => {
  const validStoreId = 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d';

  it('validates canonical RFC 4122 UUIDv4 identifiers', () => {
    assert.equal(isValidTenantId(validStoreId), true);
    assert.equal(isValidTenantId('00000000-0000-4000-8000-000000000000'), true);
    assert.equal(isValidTenantId(validStoreId.toUpperCase()), true);
  });

  it('rejects invalid, malformed, empty, or injection store identifiers', () => {
    assert.equal(isValidTenantId(null), false);
    assert.equal(isValidTenantId(undefined), false);
    assert.equal(isValidTenantId(''), false);
    assert.equal(isValidTenantId('   '), false);
    assert.equal(isValidTenantId('store-123'), false);
    assert.equal(isValidTenantId('12345'), false);
    // Non-canonical whitespace
    assert.equal(isValidTenantId(` ${validStoreId}`), false);
    assert.equal(isValidTenantId(`${validStoreId} `), false);
    // UUIDv1 (non-v4)
    assert.equal(isValidTenantId('a1b2c3d4-e5f6-1a1b-8c2d-3e4f5a6b7c8d'), false);
    // SQL injection payload
    assert.equal(
      isValidTenantId("a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d'; DROP TABLE users; --"),
      false,
    );
  });

  it('assertValidTenantId sanitizes CRLF injection in error messages', () => {
    assert.throws(
      () => assertValidTenantId('malicious\r\nheader: injection'),
      (err: unknown) => {
        assert.ok(err instanceof InvalidTenantContextError);
        assert.ok(!err.message.includes('\r'));
        assert.ok(!err.message.includes('\n'));
        return true;
      },
    );
  });

  it('assertValidTenantId throws InvalidTenantContextError on invalid input', () => {
    assert.throws(
      () => assertValidTenantId('malformed_tenant_id'),
      (err: unknown) => {
        assert.ok(err instanceof InvalidTenantContextError);
        assert.equal(err.code, 'INVALID_TENANT_CONTEXT');
        assert.match(err.message, /must be a canonical RFC 4122 UUIDv4/);
        return true;
      },
    );
  });

  it('withTenantTransaction rejects invalid tenant before initiating transaction', async () => {
    const mockDb = {
      transaction: () => {
        assert.fail('db.transaction should not be called if tenant validation fails');
      },
    };

    await assert.rejects(
      async () => {
        // @ts-expect-error Testing invalid tenant ID input
        await withTenantTransaction(mockDb, 'not-a-valid-uuid', async () => 'ok');
      },
      (err: unknown) => {
        assert.ok(err instanceof InvalidTenantContextError);
        return true;
      },
    );
  });

  it('withTenantTransaction executes set_config and commits on success with mock transaction', async () => {
    const executedQueries: string[] = [];
    const parametersList: Array<readonly unknown[]> = [];
    let transactionBegun = false;
    let transactionCommitted = false;

    const db = createMockKysely({
      onExecuteQuery: (sqlText, parameters) => {
        executedQueries.push(sqlText);
        parametersList.push(parameters);
      },
      onBeginTransaction: () => {
        transactionBegun = true;
      },
      onCommitTransaction: () => {
        transactionCommitted = true;
      },
    });

    const result = await withTenantTransaction(db, validStoreId, async (trx) => {
      assert.ok(trx);
      return { success: true, count: 42 };
    });

    assert.deepEqual(result, { success: true, count: 42 });
    assert.equal(transactionBegun, true, 'Transaction must begin');
    assert.equal(transactionCommitted, true, 'Transaction must commit');

    // Verify set_config call and parameters
    const setConfigIndex = executedQueries.findIndex((q) =>
      q.includes("set_config('app.current_store_id'"),
    );
    assert.ok(setConfigIndex >= 0, 'Must execute set_config');
    assert.deepEqual(parametersList[setConfigIndex], [validStoreId]);
  });

  it('withTenantTransaction guarantees rollback when callback throws', async () => {
    let transactionRolledBack = false;

    const db = createMockKysely({
      onRollbackTransaction: () => {
        transactionRolledBack = true;
      },
    });

    await assert.rejects(async () => {
      await withTenantTransaction(db, validStoreId, async () => {
        throw new Error('Database operational failure inside transaction');
      });
    }, /Database operational failure inside transaction/);

    assert.equal(transactionRolledBack, true, 'Transaction must roll back on error');
  });
});
