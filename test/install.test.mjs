import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getProjectRoot } from '../src/lib/runtime.mjs';
import { initializeRuntime, initializeRuntimeWithOptions, cleanSandboxRuntime } from '../src/lib/install.mjs';

const sandboxRoot = path.join(getProjectRoot(), '.sandbox');

test.beforeEach(async () => {
  await fs.rm(sandboxRoot, { recursive: true, force: true });
});

test.after(async () => {
  await fs.rm(sandboxRoot, { recursive: true, force: true });
});

test('initializeRuntime creates dev sandbox layout without downloading', async () => {
  const result = await initializeRuntime({ mode: 'dev', skipDownload: true });
  assert.equal(result.config.mode, 'dev');
  await assert.doesNotReject(fs.access(result.config.installFile));
  await assert.doesNotReject(fs.access(result.config.mihomoBin));
  await assert.doesNotReject(fs.access(result.config.configDir));
  await assert.doesNotReject(fs.access(result.config.dataDir));
});

test('cleanSandboxRuntime removes sandbox tree', async () => {
  await initializeRuntime({ mode: 'dev', skipDownload: true });
  await cleanSandboxRuntime();
  await assert.rejects(fs.access(sandboxRoot));
});

test('initializeRuntimeWithOptions persists custom dev ports', async () => {
  const result = await initializeRuntimeWithOptions({
    mode: 'dev',
    skipDownload: true,
    ports: {
      http: 27890,
      socks: 27891,
      api: 29090
    }
  });

  assert.equal(result.installState.ports.http, 27890);
  assert.equal(result.installState.ports.socks, 27891);
  assert.equal(result.installState.ports.api, 29090);
  assert.equal(result.installState.portSource, 'custom');
});

test('initializeRuntimeWithOptions emits ordered progress steps', async () => {
  const steps = [];
  await initializeRuntimeWithOptions({
    mode: 'dev',
    skipDownload: true,
    onProgress(step) {
      steps.push(`${step.id}:${step.status}`);
    }
  });

  assert.deepEqual(steps, [
    'validate:running',
    'validate:done',
    'directories:running',
    'directories:done',
    'ports:running',
    'ports:done',
    'binary:running',
    'binary:done',
    'install-state:running',
    'install-state:done',
    'subscriptions:running',
    'subscriptions:done',
    'managed-config:running',
    'managed-config:done',
    'complete:running',
    'complete:done'
  ]);
});
