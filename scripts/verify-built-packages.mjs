import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 1. Verify dist/ artifacts exist for all 5 runtime packages
const packages = [
  'api-contracts',
  'config',
  'database',
  'event-contracts',
  'observability',
  'service-runtime',
];
for (const pkg of packages) {
  const distDir = path.resolve('packages', pkg, 'dist');
  assert.ok(fs.existsSync(path.join(distDir, 'index.js')), `Missing dist/index.js in ${pkg}`);
  assert.ok(fs.existsSync(path.join(distDir, 'index.d.ts')), `Missing dist/index.d.ts in ${pkg}`);
}

// 2. Pure JavaScript imports without experimental TypeScript execution flags
const apiContracts = await import('../packages/api-contracts/dist/index.js');
assert.ok(apiContracts.LivenessResponseSchema, 'Missing LivenessResponseSchema');
assert.ok(apiContracts.ReadinessResponseSchema, 'Missing ReadinessResponseSchema');
assert.ok(apiContracts.RegisterInputSchema, 'Missing RegisterInputSchema');
assert.ok(apiContracts.LoginInputSchema, 'Missing LoginInputSchema');
assert.ok(apiContracts.AuthResponseSchema, 'Missing AuthResponseSchema');
assert.ok(apiContracts.StoreProfileSchema, 'Missing StoreProfileSchema');
assert.ok(apiContracts.StoreMembershipSchema, 'Missing StoreMembershipSchema');
assert.ok(apiContracts.InternalTokenClaimsSchema, 'Missing InternalTokenClaimsSchema');

const config = await import('../packages/config/dist/index.js');
assert.ok(config.CommonEnvSchema, 'Missing CommonEnvSchema');
assert.ok(typeof config.loadConfig === 'function', 'Missing loadConfig');
assert.ok(config.Argon2idEnvSchema, 'Missing Argon2idEnvSchema');
assert.ok(config.InternalTokenEnvSchema, 'Missing InternalTokenEnvSchema');
assert.ok(config.DatabaseEnvSchema, 'Missing DatabaseEnvSchema');
assert.ok(config.IdentityServiceEnvSchema, 'Missing IdentityServiceEnvSchema');
assert.ok(typeof config.loadIdentityServiceConfig === 'function', 'Missing loadIdentityServiceConfig');

const eventContracts = await import('../packages/event-contracts/dist/index.js');
assert.ok(eventContracts.EventEnvelopeBaseSchema, 'Missing EventEnvelopeBaseSchema');

const observability = await import('../packages/observability/dist/index.js');
assert.ok(typeof observability.createLogger === 'function', 'Missing createLogger');
assert.ok(typeof observability.runWithContext === 'function', 'Missing runWithContext');

const serviceRuntime = await import('../packages/service-runtime/dist/index.js');
assert.ok(typeof serviceRuntime.createHttpServer === 'function', 'Missing createHttpServer');
assert.ok(typeof serviceRuntime.createWorker === 'function', 'Missing createWorker');

const database = await import('../packages/database/dist/index.js');
assert.ok(typeof database.createDatabaseClient === 'function', 'Missing createDatabaseClient');
assert.ok(typeof database.withTenantTransaction === 'function', 'Missing withTenantTransaction');
assert.ok(typeof database.runMigrations === 'function', 'Missing runMigrations');
assert.ok(
  fs.existsSync(path.resolve('packages/database/dist/migrations/0002_identity_schema.sql')),
  'Missing built 0002_identity_schema.sql in dist/migrations',
);

// 3. Verify package.json exports mapping
for (const pkg of packages) {
  const pkgJsonPath = path.resolve('packages', pkg, 'package.json');
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  assert.equal(pkgJson.main, './dist/index.js', `${pkg} main must be ./dist/index.js`);
  assert.equal(pkgJson.types, './dist/index.d.ts', `${pkg} types must be ./dist/index.d.ts`);
  assert.equal(
    pkgJson.exports['.']['import'],
    './dist/index.js',
    `${pkg} exports.import must be ./dist/index.js`,
  );
  assert.equal(
    pkgJson.exports['.']['types'],
    './dist/index.d.ts',
    `${pkg} exports.types must be ./dist/index.d.ts`,
  );
}

console.log('✔ All 6 runtime packages verified for pure Node.js ESM execution and dist/ resolution.');
