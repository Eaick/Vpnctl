import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/lib/config.mjs';
import { getProcessIdentity } from '../src/lib/process-identity.mjs';
import { writeRuntimeLock } from '../src/lib/runtime-lock.mjs';
import { getManagedRuntimeStatus } from '../src/lib/managed-runtime.mjs';
import { readPid, isPidAlive, stopByPid, stopManagedRuntime } from '../src/lib/process.mjs';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vpnctl-safe-runtime-'));
  const base = createConfig('dev');
  const paths = Object.fromEntries(Object.entries(base.paths).map(([key, value]) => [
    key,
    typeof value === 'string' && value.startsWith(base.paths.root)
      ? path.join(root, path.relative(base.paths.root, value))
      : value
  ]));
  const config = {
    ...base,
    paths,
    mihomoBin: process.execPath,
    mihomoDir: paths.mihomoDir,
    dataDir: paths.dataDir,
    pidFile: paths.pidFile,
    lockFile: paths.lockFile,
    httpProxy: 'http://127.0.0.1:27890',
    mihomoApi: 'http://127.0.0.1:29090'
  };
  await fs.mkdir(config.dataDir, { recursive: true });
  return { root, config };
}

async function startFixtureProcess(config) {
  const child = spawn(process.execPath, [
    '-e', 'setInterval(() => {}, 1000)', '--', '-d', config.mihomoDir
  ], { stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  return child;
}

test('stop refuses a live pid when the lock belongs to another process', async () => {
  const { root, config } = await fixture();
  try {
    await fs.writeFile(config.pidFile, String(process.pid));
    await writeRuntimeLock(config, process.pid + 1);
    await assert.rejects(stopManagedRuntime(config), /拒绝停止/);
    assert.equal(await fs.readFile(config.pidFile, 'utf8'), String(process.pid));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('stop refuses a reused pid with a different start identity', async () => {
  const { root, config } = await fixture();
  const child = await startFixtureProcess(config);
  try {
    await fs.writeFile(config.pidFile, String(child.pid));
    await writeRuntimeLock(config, child.pid, { startedAt: 'stale-start' });
    await assert.rejects(stopManagedRuntime(config), /拒绝停止/);
    assert.ok((await getProcessIdentity(child.pid))?.startedAt);
  } finally {
    child.kill();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('stop terminates only the process matching its lock and start identity', async () => {
  const { root, config } = await fixture();
  const child = await startFixtureProcess(config);
  try {
    const identity = await getProcessIdentity(child.pid);
    assert.ok(identity?.startedAt);
    await fs.writeFile(config.pidFile, String(child.pid));
    await writeRuntimeLock(config, child.pid, identity);
    const result = await stopManagedRuntime(config);
    assert.equal(result.stopped, true);
    await assert.rejects(fs.access(config.pidFile));
  } finally {
    child.kill();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('runtime status rejects a lock with a mismatched pid', async () => {
  const { root, config } = await fixture();
  const originalFetch = global.fetch;
  try {
    await fs.writeFile(config.pidFile, String(process.pid));
    await writeRuntimeLock(config, process.pid + 1);
    global.fetch = async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ version: 'test' })
    });
    const status = await getManagedRuntimeStatus(config);
    assert.equal(status.lockOwned, false);
    assert.equal(status.managedApiAlive, false);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('invalid and negative pid values cannot signal a process group', async () => {
  const { root, config } = await fixture();
  try {
    await fs.writeFile(config.pidFile, '-1');
    assert.equal(await readPid(config), null);
    assert.equal(await isPidAlive(-1), false);
    assert.equal(await stopByPid(-1), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
