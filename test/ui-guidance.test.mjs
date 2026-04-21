import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAddSubscriptionModal,
  createDeleteSubscriptionModal,
  createInitProgressModal,
  createShellInstallModal,
  cycleModalFieldOption,
  getPrimaryGuidedAction,
  buildOverviewGuide,
  buildShellGuide
} from '../src/lib/ui-guidance.mjs';

function createSnapshot(overrides = {}) {
  return {
    providers: overrides.providers || [],
    status: {
      initialized: true,
      subscriptionCount: 1,
      apiAlive: true,
      mode: 'user',
      ports: {
        http: { port: 7890, available: true },
        socks: { port: 7891, available: true },
        api: { port: 9090, available: true }
      },
      shellIntegration: { installed: true, codexWrapper: true, bashrcPath: '/home/test/.bashrc' },
      sessionReuse: { state: 'ready', label: 'ready' },
      ...overrides.status
    }
  };
}

test('getPrimaryGuidedAction follows init to ready flow', () => {
  assert.equal(getPrimaryGuidedAction(createSnapshot({ status: { initialized: false } })), 'init-runtime');
  assert.equal(getPrimaryGuidedAction(createSnapshot({ status: { subscriptionCount: 0 } })), 'add-sub');
  assert.equal(getPrimaryGuidedAction(createSnapshot({ providers: [] })), 'sync');
  assert.equal(getPrimaryGuidedAction(createSnapshot({ providers: [{ id: 'VPNCTL' }], status: { apiAlive: false } })), 'start');
  assert.equal(
    getPrimaryGuidedAction(createSnapshot({ providers: [{ id: 'VPNCTL' }], status: { shellIntegration: { installed: false, codexWrapper: false } } })),
    'shell-install'
  );
  assert.equal(
    getPrimaryGuidedAction(createSnapshot({ providers: [{ id: 'VPNCTL' }] })),
    'ready'
  );
});

test('buildOverviewGuide explains next server step and ready state', () => {
  const initGuide = buildOverviewGuide(createSnapshot({ status: { initialized: false } })).join('\n');
  assert.match(initGuide, /初始化/);

  const readyGuide = buildOverviewGuide(createSnapshot({ providers: [{ id: 'VPNCTL' }] })).join('\n');
  assert.match(readyGuide, /codex/);
  assert.match(readyGuide, /B 会话/);
});

test('buildShellGuide explains same-account reuse', () => {
  const notInstalled = buildShellGuide(
    createSnapshot({ status: { shellIntegration: { installed: false, codexWrapper: false } } })
  ).join('\n');
  assert.match(notInstalled, /bashrc/);

  const waiting = buildShellGuide(
    createSnapshot({
      status: {
        apiAlive: false,
        shellIntegration: { installed: true, codexWrapper: true },
        sessionReuse: { state: 'waiting', label: 'waiting' }
      }
    })
  ).join('\n');
  assert.match(waiting, /A 会话/);

  const ready = buildShellGuide(createSnapshot()).join('\n');
  assert.match(ready, /B 会话/);
});

test('wizard modal helpers expose guided fields and option cycling', () => {
  const subModal = createAddSubscriptionModal();
  assert.equal(subModal.fields[0].key, 'sourceType');
  assert.equal(cycleModalFieldOption(subModal.fields[0], 1), 'file');

  const shellModal = createShellInstallModal(createSnapshot());
  assert.equal(shellModal.type, 'shell-install');
  assert.match(shellModal.prompt, /codex/);

  const deleteModal = createDeleteSubscriptionModal({
    id: 'sub-1',
    displayName: 'A',
    source: 'https://example.com/sub',
    cachePath: '/tmp/cache.yaml',
    providerPath: '/tmp/provider.yaml'
  });
  assert.equal(deleteModal.type, 'confirm-remove-sub');
  assert.match(deleteModal.notes.join('\n'), /Provider/);

  const progressModal = createInitProgressModal(createSnapshot());
  assert.equal(progressModal.type, 'init-progress');
  assert.deepEqual(progressModal.steps, []);
});
