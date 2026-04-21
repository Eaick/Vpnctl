import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNodeTags, mapGroupToProviderView, getSessionReuseStatus } from '../src/lib/dashboard.mjs';

test('buildNodeTags marks current nodes and extracts region hint', () => {
  const tags = buildNodeTags('日本 03', { isCurrent: true });
  assert.deepEqual(tags, ['CURRENT', '日本']);
});

test('mapGroupToProviderView keeps order and filters hidden nodes', () => {
  const provider = mapGroupToProviderView({
    name: '龙猫云 - TotoroCloud',
    now: '日本 03',
    all: ['剩余流量 99G', '日本 03', '香港 02', '套餐到期 2026-12-01']
  });

  assert.equal(provider.id, '龙猫云 - TotoroCloud');
  assert.equal(provider.nodeCount, 2);
  assert.deepEqual(
    provider.nodes.map((item) => item.label),
    ['日本 03', '香港 02']
  );
  assert.equal(provider.nodes[0].isCurrent, true);
  assert.equal(provider.nodes[0].protocol, 'unknown');
});

test('getSessionReuseStatus reflects same-account codex reuse readiness', () => {
  assert.equal(
    getSessionReuseStatus({
      apiAlive: false,
      shellIntegration: { installed: false, codexWrapper: false }
    }).state,
    'unavailable'
  );

  assert.equal(
    getSessionReuseStatus({
      apiAlive: false,
      shellIntegration: { installed: true, codexWrapper: true }
    }).state,
    'waiting'
  );

  assert.equal(
    getSessionReuseStatus({
      apiAlive: true,
      shellIntegration: { installed: true, codexWrapper: true }
    }).state,
    'ready'
  );
});
