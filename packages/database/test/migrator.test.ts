import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  computeMigrationChecksum,
  ConcurrentMigrationError,
  getDefaultMigrationsDir,
  isMigrationTransactional,
  loadMigrationFiles,
  MigrationChecksumMismatchError,
  MigrationDiscoveryError,
  MigrationError,
  MigrationExecutionError,
  runMigrations,
  type MigrationDatabaseClient,
} from '../dist/index.js';

describe('SQL Migration Mechanics & Security Runner', () => {
  it('computes deterministic SHA-256 checksums across CRLF and LF line endings', () => {
    const unixSql = 'CREATE TABLE test (\n  id SERIAL PRIMARY KEY\n);\n';
    const windowsSql = 'CREATE TABLE test (\r\n  id SERIAL PRIMARY KEY\r\n);\r\n';

    const unixHash = computeMigrationChecksum(unixSql);
    const windowsHash = computeMigrationChecksum(windowsSql);

    assert.equal(unixHash.length, 64);
    assert.equal(
      unixHash,
      windowsHash,
      'Checksums must be identical regardless of OS line endings',
    );
  });

  it('detects non-transactional directive in migration file header only with exact syntax', () => {
    const transactionalSql = '-- Standard DDL\nCREATE TABLE foo (id INT);';
    const nonTransactionalSql =
      '-- grocery-no-transaction\nCREATE INDEX CONCURRENTLY idx ON foo (id);';
    const alternativeHeader =
      '-- Migration: add concurrent index\n-- NO-TRANSACTION\nCREATE INDEX CONCURRENTLY;';
    const mentionOnlyComment =
      '-- Note: this migration does NOT use no-transaction because it needs ACID\nCREATE TABLE bar (id INT);';

    assert.equal(isMigrationTransactional(transactionalSql), true);
    assert.equal(isMigrationTransactional(nonTransactionalSql), false);
    assert.equal(isMigrationTransactional(alternativeHeader), false);
    assert.equal(isMigrationTransactional(mentionOnlyComment), true);
  });

  it('loads migration files in stable, ascending alphanumeric sort order', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grocery-migrations-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '0010_order_schema.sql'), '-- order\nSELECT 1;');
      fs.writeFileSync(path.join(tmpDir, '0001_bootstrap.sql'), '-- bootstrap\nSELECT 1;');
      fs.writeFileSync(path.join(tmpDir, '0002_identity.sql'), '-- identity\nSELECT 1;');

      const files = loadMigrationFiles(tmpDir);
      assert.equal(files.length, 3);
      assert.equal(files[0]!.version, '0001');
      assert.equal(files[0]!.name, 'bootstrap');
      assert.equal(files[1]!.version, '0002');
      assert.equal(files[1]!.name, 'identity');
      assert.equal(files[2]!.version, '0010');
      assert.equal(files[2]!.name, 'order_schema');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects malformed migration filenames with MigrationDiscoveryError', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grocery-malformed-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'invalid_name.sql'), 'SELECT 1;');

      assert.throws(
        () => loadMigrationFiles(tmpDir),
        (err: unknown) => {
          assert.ok(err instanceof MigrationDiscoveryError);
          assert.match(err.message, /Malformed migration filename/);
          return true;
        },
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects duplicate migration version numbers across different files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grocery-dups-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '0001_bootstrap.sql'), 'SELECT 1;');
      fs.writeFileSync(path.join(tmpDir, '0001_init.sql'), 'SELECT 2;');

      assert.throws(
        () => loadMigrationFiles(tmpDir),
        (err: unknown) => {
          assert.ok(err instanceof MigrationDiscoveryError);
          assert.match(err.message, /Duplicate migration version '0001'/);
          return true;
        },
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects empty migration files or files with only comments', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grocery-empty-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '0001_empty.sql'), '   \n  ');

      assert.throws(
        () => loadMigrationFiles(tmpDir),
        (err: unknown) => {
          assert.ok(err instanceof MigrationDiscoveryError);
          assert.match(err.message, /is completely empty/);
          return true;
        },
      );

      fs.writeFileSync(
        path.join(tmpDir, '0001_empty.sql'),
        '-- only comments\n-- second comment line\n',
      );

      assert.throws(
        () => loadMigrationFiles(tmpDir),
        (err: unknown) => {
          assert.ok(err instanceof MigrationDiscoveryError);
          assert.match(err.message, /contains no executable SQL statements/);
          return true;
        },
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('finds the default bootstrap migration file in the package', () => {
    const dir = getDefaultMigrationsDir();
    assert.ok(fs.existsSync(dir), `Migrations directory must exist at ${dir}`);

    const files = loadMigrationFiles(dir);
    assert.ok(files.length >= 1, 'Should find at least 0001_bootstrap.sql');
    assert.equal(files[0]!.version, '0001');
    assert.equal(files[0]!.name, 'bootstrap');
    assert.equal(files[0]!.isTransactional, true);
  });

  it('runs pending migrations with advisory locking and ledger persistence using mock client', async () => {
    const executedQueries: string[] = [];
    const ledger: Array<{
      version: string;
      name: string;
      checksum: string;
      applied_at: Date;
      execution_time_ms: number;
    }> = [];

    const mockClient: MigrationDatabaseClient = {
      query: async <R = Record<string, unknown>>(
        sqlText: string,
        values?: readonly unknown[],
      ): Promise<{ rows: R[] }> => {
        executedQueries.push(sqlText.trim());

        if (sqlText.includes('pg_try_advisory_lock')) {
          return { rows: [{ acquired: true }] as unknown as R[] };
        }
        if (sqlText.includes('pg_advisory_unlock')) {
          return { rows: [{ pg_advisory_unlock: true }] as unknown as R[] };
        }
        if (sqlText.includes('SELECT version, name, checksum, applied_at, execution_time_ms')) {
          return { rows: [...ledger] as unknown as R[] };
        }
        if (sqlText.includes('INSERT INTO public.schema_migrations')) {
          const [version, name, checksum, executionTimeMs] = values as [
            string,
            string,
            string,
            number,
          ];
          ledger.push({
            version,
            name,
            checksum,
            applied_at: new Date(),
            execution_time_ms: executionTimeMs,
          });
          return { rows: [] as R[] };
        }
        return { rows: [] as R[] };
      },
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grocery-test-run-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '0001_init.sql'), 'CREATE TABLE test_items (id INT);');

      const report = await runMigrations('postgres://unused', {
        migrationsDir: tmpDir,
        client: mockClient,
      });

      assert.equal(report.applied.length, 1);
      assert.equal(report.applied[0]!.version, '0001');
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0]!.version, '0001');

      // Verify execution sequence
      assert.ok(executedQueries.some((q) => q.includes('pg_try_advisory_lock')));
      assert.ok(
        executedQueries.some((q) =>
          q.includes('CREATE TABLE IF NOT EXISTS public.schema_migrations'),
        ),
      );
      assert.ok(executedQueries.some((q) => q.includes('BEGIN;')));
      assert.ok(executedQueries.some((q) => q.includes('CREATE TABLE test_items')));
      assert.ok(executedQueries.some((q) => q.includes('COMMIT;')));
      assert.ok(executedQueries.some((q) => q.includes('pg_advisory_unlock')));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails closed with ConcurrentMigrationError when advisory lock cannot be acquired', async () => {
    let unlockCalled = false;
    const busyLockClient: MigrationDatabaseClient = {
      query: async <R = Record<string, unknown>>(sqlText: string): Promise<{ rows: R[] }> => {
        if (sqlText.includes('pg_try_advisory_lock')) {
          return { rows: [{ acquired: false }] as unknown as R[] };
        }
        if (sqlText.includes('pg_advisory_unlock')) {
          unlockCalled = true;
          return { rows: [{ pg_advisory_unlock: true }] as unknown as R[] };
        }
        return { rows: [] as R[] };
      },
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grocery-busy-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '0001_init.sql'), 'SELECT 1;');

      await assert.rejects(
        async () => {
          await runMigrations('postgres://unused', {
            migrationsDir: tmpDir,
            client: busyLockClient,
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof ConcurrentMigrationError);
          assert.equal(err.code, 'CONCURRENT_MIGRATION_LOCKED');
          return true;
        },
      );
      assert.equal(unlockCalled, false, 'Unlock should not be called if lock was never acquired');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails closed with MigrationChecksumMismatchError when an applied migration has been altered', async () => {
    const ledger = [
      {
        version: '0001',
        name: 'init',
        checksum: '1111111111111111111111111111111111111111111111111111111111111111',
        applied_at: new Date(),
        execution_time_ms: 10,
      },
    ];

    let unlocked = false;
    const client: MigrationDatabaseClient = {
      query: async <R = Record<string, unknown>>(sqlText: string): Promise<{ rows: R[] }> => {
        if (sqlText.includes('pg_try_advisory_lock')) {
          return { rows: [{ acquired: true }] as unknown as R[] };
        }
        if (sqlText.includes('SELECT version, name, checksum, applied_at, execution_time_ms')) {
          return { rows: [...ledger] as unknown as R[] };
        }
        if (sqlText.includes('pg_advisory_unlock')) {
          unlocked = true;
          return { rows: [{ pg_advisory_unlock: true }] as unknown as R[] };
        }
        return { rows: [] as R[] };
      },
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grocery-mismatch-'));
    try {
      // Create migration file whose checksum differs from ledger's recorded 11111...
      fs.writeFileSync(path.join(tmpDir, '0001_init.sql'), 'ALTER TABLE users ADD COLUMN age INT;');

      await assert.rejects(
        async () => {
          await runMigrations('postgres://unused', {
            migrationsDir: tmpDir,
            client,
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof MigrationChecksumMismatchError);
          assert.equal(err.code, 'MIGRATION_CHECKSUM_MISMATCH');
          assert.equal(err.version, '0001');
          return true;
        },
      );

      // Verify advisory lock is released even on failure
      assert.equal(unlocked, true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails closed when migration name mismatches recorded ledger name', async () => {
    const ledger = [
      {
        version: '0001',
        name: 'original_name',
        checksum: 'valid_checksum',
        applied_at: new Date(),
        execution_time_ms: 10,
      },
    ];

    const client: MigrationDatabaseClient = {
      query: async <R = Record<string, unknown>>(sqlText: string): Promise<{ rows: R[] }> => {
        if (sqlText.includes('pg_try_advisory_lock')) {
          return { rows: [{ acquired: true }] as unknown as R[] };
        }
        if (sqlText.includes('SELECT version, name, checksum, applied_at, execution_time_ms')) {
          return { rows: [...ledger] as unknown as R[] };
        }
        if (sqlText.includes('pg_advisory_unlock')) {
          return { rows: [{ pg_advisory_unlock: true }] as unknown as R[] };
        }
        return { rows: [] as R[] };
      },
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grocery-name-mismatch-'));
    try {
      // File has name 'renamed' instead of 'original_name'
      fs.writeFileSync(path.join(tmpDir, '0001_renamed.sql'), 'SELECT 1;');

      await assert.rejects(
        async () => {
          await runMigrations('postgres://unused', {
            migrationsDir: tmpDir,
            client,
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof MigrationError);
          assert.match(err.message, /name mismatch/);
          return true;
        },
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('surfaces an error when advisory unlock reports that lock was not held', async () => {
    const mockClient: MigrationDatabaseClient = {
      query: async <R = Record<string, unknown>>(sqlText: string): Promise<{ rows: R[] }> => {
        if (sqlText.includes('pg_try_advisory_lock')) {
          return { rows: [{ acquired: true }] as unknown as R[] };
        }
        if (sqlText.includes('SELECT version, name, checksum, applied_at, execution_time_ms')) {
          return { rows: [] as R[] };
        }
        if (sqlText.includes('INSERT INTO public.schema_migrations')) {
          return { rows: [] as R[] };
        }
        if (sqlText.includes('pg_advisory_unlock')) {
          // Unlock returns false (lock not held)
          return { rows: [{ pg_advisory_unlock: false }] as unknown as R[] };
        }
        return { rows: [] as R[] };
      },
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grocery-unlock-fail-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '0001_init.sql'), 'SELECT 1;');

      await assert.rejects(
        async () => {
          await runMigrations('postgres://unused', {
            migrationsDir: tmpDir,
            client: mockClient,
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof MigrationError);
          assert.match(err.message, /Failed to release PostgreSQL advisory lock/);
          return true;
        },
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rolls back transaction on SQL execution error and releases advisory lock', async () => {
    const executedQueries: string[] = [];
    let unlocked = false;

    const errorClient: MigrationDatabaseClient = {
      query: async <R = Record<string, unknown>>(sqlText: string): Promise<{ rows: R[] }> => {
        executedQueries.push(sqlText.trim());

        if (sqlText.includes('pg_try_advisory_lock')) {
          return { rows: [{ acquired: true }] as unknown as R[] };
        }
        if (sqlText.includes('SELECT version, name, checksum, applied_at, execution_time_ms')) {
          return { rows: [] as R[] };
        }
        if (sqlText.includes('SYNTAX_ERROR_QUERY')) {
          throw new Error('syntax error at or near "SYNTAX_ERROR_QUERY"');
        }
        if (sqlText.includes('pg_advisory_unlock')) {
          unlocked = true;
          return { rows: [{ pg_advisory_unlock: true }] as unknown as R[] };
        }
        return { rows: [] as R[] };
      },
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grocery-fail-'));
    try {
      fs.writeFileSync(path.join(tmpDir, '0001_broken.sql'), 'SYNTAX_ERROR_QUERY;');

      await assert.rejects(
        async () => {
          await runMigrations('postgres://unused', {
            migrationsDir: tmpDir,
            client: errorClient,
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof MigrationExecutionError);
          assert.equal(err.code, 'MIGRATION_EXECUTION_FAILED');
          assert.equal(err.version, '0001');
          return true;
        },
      );

      assert.ok(executedQueries.includes('ROLLBACK;'), 'ROLLBACK must be executed on error');
      assert.equal(unlocked, true, 'Advisory lock must be unlocked');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
