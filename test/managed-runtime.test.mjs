import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getManagedRuntimeStatus } from '../src/lib/managed-runtime.mjs';
import { writeRuntimeLock } from '../src/lib/runtime-lock.mjs';
import { getProcessIdentity } from '../src/lib/process-identity.mjs';

const runtimeRoot = path.join(process.cwd(), '.tmp-managed-runtime-test');
const config = {
  mode: 'user',
  proxyMode: 'mix',
  paths: { root: runtimeRoot },
  dataDir: path.join(runtimeRoot, 'data'),
  pidFile: path.join(runtimeRoot, 'data', 'mihomo.pid'),
  lockFile: path.join(runtimeRoot, 'data', 'runtime-lock.json'),
  mihomoBin: process.execPath,
  mihomoDir: path.join(runtimeRoot, 'config'),
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
  const child = spawn(process.execPath, [
    '-e', 'setInterval(() => {}, 1000)', '--', '-d', config.mihomoDir
  ], { stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  await fs.writeFile(config.pidFile, String(child.pid), 'utf8');
  await writeRuntimeLock(config, child.pid, await getProcessIdentity(child.pid));
  global.fetch = async () => ({
    ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ version: 'test' })
  });

  try {
    const status = await getManagedRuntimeStatus(config);
    assert.equal(status.pidAlive, true);
    assert.equal(status.lockOwned, true);
    assert.equal(status.processOwned, true);
    assert.equal(status.managedApiAlive, true);
    assert.equal(status.foreignApiAlive, false);
  } finally {
    child.kill();
    global.fetch = originalFetch;
  }
});
