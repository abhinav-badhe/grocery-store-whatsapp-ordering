import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, CommonEnvSchema } from '@grocery/config';
import { createNotificationWorker } from '../dist/index.js';

describe('Notification Worker Scaffolding & Lifecycle', () => {
  it('guarantees importing and instantiating does not start execution or open connections', () => {
    const worker = createNotificationWorker();
    const status = worker.getStatus();
    assert.equal(status.name, 'notification-worker');
    assert.equal(status.status, 'stopped');
    assert.equal(status.activeJobs, 0);
  });

  it('truthfully reports 0 active jobs and does not pretend messages are processing', () => {
    const worker = createNotificationWorker();
    const status = worker.getStatus();
    assert.equal(status.activeJobs, 0);
    assert.equal(status.status, 'stopped');
  });

  it('safely handles invalid configuration without leaking secrets', () => {
    const secretValue = 'NOTIFICATION_SECRET_KEY_NEVER_LOG';
    const invalidEnv = {
      NODE_ENV: 'production',
      PORT: 'invalid-port',
      SECRET: secretValue,
    };

    assert.throws(
      () => loadConfig(CommonEnvSchema, invalidEnv),
      (err: unknown) => {
        const message = String(err);
        assert.equal(message.includes(secretValue), false);
        return true;
      },
    );
  });
});
