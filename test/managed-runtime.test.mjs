import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getManagedRuntimeStatus } from '../src/lib/managed-runtime.mjs';
import { writeRuntimeLock } from '../src/lib/runtime-lock.mjs';

const runtimeRoot = path.join(process.cwd(), '.tmp-managed-runtime-test');
const config = {
  mode: 'user',
  proxyMode: 'mix',
  paths: { root: runtimeRoot },
  dataDir: path.join(runtimeRoot, 'data'),
  pidFile: path.join(runtimeRoot, 'data', 'mihomo.pid'),
  lockFile: path.join(runtimeRoot, 'data', 'runtime-lock.json'),
  httpProxy: 'http://127.0.0.1:27890',
  socksProxy: 'socks5://127.0.0.1:27890',
  mihomoApi: 'http://127.0.0.1:29090'
};

test.beforeEach(async () => {
  await fs.rm(runtimeRoot, { recursive: true, force: true });
  await fs.mkdir(config.dataDir, { recursive: true });
});

test.after(async () => {
  await fs.rm(runtimeRoot, { recursive: true, force: true });
});

test('getManagedRuntimeStatus marks api-only responses as foreign instances', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ version: 'test' })
  });

  try {
    const status = await getManagedRuntimeStatus(config);
    assert.equal(status.apiReachable, true);
    assert.equal(status.managedApiAlive, false);
    assert.equal(status.foreignApiAlive, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('getManagedRuntimeStatus only treats own pid and lock as managed runtime', async () => {
  const originalFetch = global.fetch;
  const pid = process.pid;
  await fs.writeFile(config.pidFile, String(pid), 'utf8');
  await writeRuntimeLock(config, pid);
  global.fetch = async () => ({
    ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ version: 'test' })
  });

  try {
    const status = await getManagedRuntimeStatus(config);
    assert.equal(status.pidAlive, true);
    assert.equal(status.lockOwned, true);
    assert.equal(status.managedApiAlive, true);
    assert.equal(status.foreignApiAlive, false);
  } finally {
    global.fetch = originalFetch;
  }
});
