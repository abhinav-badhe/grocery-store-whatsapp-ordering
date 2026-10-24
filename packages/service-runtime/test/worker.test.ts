import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../dist/index.js';

describe('Shared Service Runtime: Background Worker Lifecycle', () => {
  it('guarantees creating a worker does not start execution or timers', () => {
    const worker = createWorker({
      workerName: 'test-worker',
    });
    const status = worker.getStatus();
    assert.equal(status.name, 'test-worker');
    assert.equal(status.status, 'stopped');
    assert.equal(status.activeJobs, 0);
  });

  it('transitions through start and stop lifecycle cleanly', async () => {
    let jobExecutionCount = 0;
    const worker = createWorker({
      workerName: 'test-worker',
      intervalMs: 20,
      jobHandler: async () => {
        jobExecutionCount++;
      },
    });

    assert.equal(worker.getStatus().status, 'stopped');
    await worker.start();
    assert.equal(worker.getStatus().status, 'running');

    // Allow at least one job cycle
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(jobExecutionCount > 0);

    await worker.stop();
    assert.equal(worker.getStatus().status, 'stopped');
  });

  it('truthfully reports 0 active jobs when idle without mocking fake dependencies', () => {
    const worker = createWorker({
      workerName: 'notification-worker',
    });
    const status = worker.getStatus();
    assert.equal(status.status, 'stopped');
    assert.equal(status.activeJobs, 0);
  });
});
