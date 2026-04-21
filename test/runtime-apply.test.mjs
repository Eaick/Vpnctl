import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/lib/config.mjs';
import { applyManagedConfigToRuntime } from '../src/lib/runtime-apply.mjs';

const config = createConfig('dev');

test.beforeEach(async () => {
  await fs.rm(config.paths.root, { recursive: true, force: true });
});

test.after(async () => {
  await fs.rm(config.paths.root, { recursive: true, force: true });
});

test('applyManagedConfigToRuntime returns none when mihomo api is offline', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('offline');
  };

  try {
    const result = await applyManagedConfigToRuntime(config);
    assert.equal(result.mode, 'none');
    assert.equal(result.applied, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('applyManagedConfigToRuntime does not touch foreign api instances', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ version: 'test' })
  });

  try {
    const result = await applyManagedConfigToRuntime(config);
    assert.equal(result.mode, 'none');
    assert.equal(result.applied, false);
    assert.match(result.message, /其他账户|API 端口/);
  } finally {
    global.fetch = originalFetch;
  }
});
