import test from 'node:test';
import assert from 'node:assert/strict';
import { getVisibleLatencyTargets } from '../src/lib/tui-latency.mjs';

test('getVisibleLatencyTargets only returns unmeasured nodes in viewport', () => {
  const nodes = Array.from({ length: 8 }, (_, index) => ({
    id: `node-${index}`,
    label: `Node ${index}`
  }));

  const targets = getVisibleLatencyTargets(nodes, 'node-4', 4, {
    'node-3': 123
  });

  assert.deepEqual(targets, ['node-2', 'node-4', 'node-5']);
});

test('getVisibleLatencyTargets returns empty list for empty nodes', () => {
  assert.deepEqual(getVisibleLatencyTargets([], null, 4, {}), []);
});
