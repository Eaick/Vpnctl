import test from 'node:test';
import assert from 'node:assert/strict';
import { applyManagedConfigToRuntime } from '../src/lib/runtime-apply.mjs';

test('applyManagedConfigToRuntime returns none when mihomo api is offline', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('offline');
  };

  try {
    const result = await applyManagedConfigToRuntime();
    assert.equal(result.mode, 'none');
    assert.equal(result.applied, false);
  } finally {
    global.fetch = originalFetch;
  }
});
