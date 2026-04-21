import test from 'node:test';
import assert from 'node:assert/strict';
import { getLatencyTarget, getLatencyTargets } from '../src/lib/latency-targets.mjs';
import { mapGroupToProviderView } from '../src/lib/dashboard.mjs';

test('getLatencyTargets exposes common external test sites', () => {
  const targets = getLatencyTargets();
  assert.ok(targets.some((item) => item.id === 'google'));
  assert.ok(targets.some((item) => item.id === 'openai'));
  assert.ok(targets.some((item) => item.id === 'youtube'));
});

test('getLatencyTarget falls back to gstatic', () => {
  assert.equal(getLatencyTarget('openai').label, 'OpenAI');
  assert.equal(getLatencyTarget('missing').id, 'gstatic');
});

test('provider node views start with idle delay status', () => {
  const provider = mapGroupToProviderView({
    name: 'VPNCTL',
    now: '新加坡 01',
    all: ['新加坡 01', '香港 01']
  });

  assert.equal(provider.nodes[0].delayStatus, 'idle');
  assert.equal(provider.nodes[1].delayStatus, 'idle');
});
