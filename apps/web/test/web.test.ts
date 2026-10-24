import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LivenessResponseSchema, ReadinessResponseSchema } from '@grocery/api-contracts';
import { loadConfig, CommonEnvSchema } from '@grocery/config';
import { createWebService } from '../dist/index.js';

describe('Web App Scaffolding & Health Endpoints', () => {
  it('guarantees importing and instantiating web app does not bind ports or open connections', () => {
    const service = createWebService({ port: 0 });
    assert.equal(service.server.listening, false);
  });

  it('serves valid /health/live and /health/ready responses', async () => {
    const service = createWebService({ port: 0 });
    const { port } = await service.start();

    try {
      const liveRes = await fetch(`http://127.0.0.1:${port}/health/live`);
      assert.equal(liveRes.status, 200);
      const liveBody = await liveRes.json();
      const parsedLive = LivenessResponseSchema.safeParse(liveBody);
      assert.equal(parsedLive.success, true);
      if (parsedLive.success) {
        assert.equal(parsedLive.data.status, 'ok');
      }

      const readyRes = await fetch(`http://127.0.0.1:${port}/health/ready`);
      assert.equal(readyRes.status, 200);
      const readyBody = await readyRes.json();
      const parsedReady = ReadinessResponseSchema.safeParse(readyBody);
      assert.equal(parsedReady.success, true);
      if (parsedReady.success) {
        assert.equal(parsedReady.data.status, 'ready');
      }
    } finally {
      await service.stop();
    }
  });

  it('safely handles invalid configuration without leaking secrets', () => {
    const secretValue = 'SUPER_SECRET_KEY_NEVER_LOG';
    const invalidEnv = {
      NODE_ENV: 'production',
      PORT: 'not-a-number',
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
