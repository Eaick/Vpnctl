import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getProjectRoot } from '../src/lib/runtime.mjs';
import { createConfig } from '../src/lib/config.mjs';
import {
  addSubscriptionFromFile,
  activateSubscription,
  ensureSubscriptionStore,
  loadSubscriptions,
  saveSubscriptions,
  parseNodes,
  parseNodeNames,
  removeSubscription,
  syncSubscriptions
} from '../src/lib/subscriptions.mjs';
import YAML from 'yaml';

const sandboxRoot = path.join(getProjectRoot(), '.sandbox');
const fixtureDir = path.join(getProjectRoot(), 'test', 'fixtures');
const fixtureA = path.join(fixtureDir, 'sub-a.yaml');
const fixtureB = path.join(fixtureDir, 'sub-b.yaml');

async function resetSandbox() {
  await fs.rm(sandboxRoot, { recursive: true, force: true });
}

test.before(async () => {
  await fs.mkdir(fixtureDir, { recursive: true });
});

test.beforeEach(async () => {
  await resetSandbox();
  await fs.writeFile(fixtureA, 'proxies:\n  - name: 日本 01\n  - name: 香港 02\n', 'utf8');
  await fs.writeFile(fixtureB, 'proxies:\n  - name: 美国 01\n', 'utf8');
});

test.after(async () => {
  await resetSandbox();
  await fs.rm(fixtureA, { force: true });
  await fs.rm(fixtureB, { force: true });
});

test('parseNodeNames supports yaml and base64 uri lists', () => {
  assert.deepEqual(parseNodeNames('proxies:\n  - name: 日本 01\n  - name: 香港 02\n'), ['日本 01', '香港 02']);

  const uriList = 'vmess://demo#Tokyo\nss://demo#Singapore';
  const encoded = Buffer.from(uriList, 'utf8').toString('base64');
  assert.deepEqual(parseNodeNames(encoded), ['Tokyo', 'Singapore']);
});

test('parseNodes extracts normalized protocols from yaml and uri lists', () => {
  assert.deepEqual(
    parseNodes('proxies:\n  - name: 日本 01\n    type: vless\n  - name: 香港 02\n    type: ss\n'),
    [
      { name: '日本 01', protocol: 'vless' },
      { name: '香港 02', protocol: 'shadowsocks' }
    ]
  );

  const uriList = 'trojan://demo#Tokyo\nssr://demo#Singapore';
  const encoded = Buffer.from(uriList, 'utf8').toString('base64');
  assert.deepEqual(parseNodes(encoded), [
    { name: 'Tokyo', protocol: 'trojan' },
    { name: 'Singapore', protocol: 'shadowsocksr' }
  ]);
});

test('addSubscriptionFromFile rejects duplicate content and renames same display name', async () => {
  const config = createConfig('dev');
  await ensureSubscriptionStore(config);

  const first = await addSubscriptionFromFile(fixtureA, 'A', config);
  assert.equal(first.displayName, 'A');

  await assert.rejects(
    addSubscriptionFromFile(fixtureA, 'A', config),
    /本地订阅内容已存在/
  );

  const second = await addSubscriptionFromFile(fixtureB, 'A', config);
  assert.equal(second.displayName, 'A (2)');
});

test('syncSubscriptions populates node metadata for local files', async () => {
  const config = createConfig('dev');
  await ensureSubscriptionStore(config);
  const created = await addSubscriptionFromFile(fixtureA, 'Local A', config);

  const results = await syncSubscriptions({ id: created.id }, config);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].nodeCount, 2);

  const subscriptions = await loadSubscriptions(config);
  assert.equal(subscriptions[0].syncStatus, 'synced');
  assert.deepEqual(subscriptions[0].nodeNames, ['日本 01', '香港 02']);
  assert.deepEqual(subscriptions[0].nodes, [
    { name: '日本 01', protocol: 'unknown' },
    { name: '香港 02', protocol: 'unknown' }
  ]);
  assert.match(subscriptions[0].providerPath.replace(/\\/g, '/'), /\/config\/providers\//);
  await assert.doesNotReject(fs.access(config.generatedConfigFile));
});

test('writeManagedConfig uses local provider file after remote subscription sync', async () => {
  const config = createConfig('dev');
  await ensureSubscriptionStore(config);
  const remoteProviderPath = path.join(config.providersDir, 'flybit-abc123.yaml');
  await fs.mkdir(path.dirname(remoteProviderPath), { recursive: true });
  await fs.writeFile(remoteProviderPath, 'proxies:\n  - name: 日本 01\n', 'utf8');

  await saveSubscriptions(config, [
    {
      id: 'remote001',
      type: 'remote',
      source: 'https://example.com/sub',
      displayName: '赔钱',
      providerKey: 'flybit-abc123',
      contentHash: '',
      lastSyncedAt: new Date().toISOString(),
      enabled: true,
      nodes: [{ name: '日本 01', protocol: 'vmess' }],
      nodeNames: ['日本 01'],
      nodeCount: 1,
      syncStatus: 'synced',
      syncError: ''
    }
  ]);

  const { writeManagedConfig } = await import('../src/lib/subscriptions.mjs');
  await writeManagedConfig(config);

  const rendered = YAML.parse(await fs.readFile(config.generatedConfigFile, 'utf8'));
  assert.deepEqual(rendered['proxy-providers']['flybit-abc123'], {
    type: 'file',
    path: remoteProviderPath.replace(/\\/g, '/')
  });
});

test('saveSubscriptions and activation keep exactly one active subscription', async () => {
  const config = createConfig('dev');
  await ensureSubscriptionStore(config);
  await saveSubscriptions(config, [
    {
      id: 'sub1',
      type: 'remote',
      source: 'https://example.com/a',
      displayName: 'A',
      providerKey: 'a-sub1',
      enabled: true
    },
    {
      id: 'sub2',
      type: 'remote',
      source: 'https://example.com/b',
      displayName: 'B',
      providerKey: 'b-sub2',
      enabled: true
    }
  ]);

  let subscriptions = await loadSubscriptions(config);
  assert.deepEqual(subscriptions.map((item) => item.enabled), [true, false]);

  await activateSubscription('sub2', config);
  subscriptions = await loadSubscriptions(config);
  assert.deepEqual(subscriptions.map((item) => item.enabled), [false, true]);
});

test('removeSubscription auto-promotes next subscription as active', async () => {
  const config = createConfig('dev');
  await ensureSubscriptionStore(config);
  await saveSubscriptions(config, [
    {
      id: 'sub1',
      type: 'remote',
      source: 'https://example.com/a',
      displayName: 'A',
      providerKey: 'a-sub1',
      enabled: true
    },
    {
      id: 'sub2',
      type: 'remote',
      source: 'https://example.com/b',
      displayName: 'B',
      providerKey: 'b-sub2',
      enabled: false
    }
  ]);

  await removeSubscription('sub1', config);
  const subscriptions = await loadSubscriptions(config);
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].displayName, 'B');
  assert.equal(subscriptions[0].enabled, true);
});

test('writeManagedConfig only renders active subscription providers', async () => {
  const config = createConfig('dev');
  await ensureSubscriptionStore(config);
  await saveSubscriptions(config, [
    {
      id: 'sub1',
      type: 'remote',
      source: 'https://example.com/a',
      displayName: 'A',
      providerKey: 'a-sub1',
      enabled: true,
      syncStatus: 'pending'
    },
    {
      id: 'sub2',
      type: 'remote',
      source: 'https://example.com/b',
      displayName: 'B',
      providerKey: 'b-sub2',
      enabled: false,
      syncStatus: 'pending'
    }
  ]);

  const { writeManagedConfig } = await import('../src/lib/subscriptions.mjs');
  await writeManagedConfig(config);
  const rendered = YAML.parse(await fs.readFile(config.generatedConfigFile, 'utf8'));
  assert.deepEqual(Object.keys(rendered['proxy-providers']), ['a-sub1']);
  assert.equal(rendered['mixed-port'], 17890);
  assert.equal(rendered['socks-port'], undefined);
  assert.deepEqual(rendered['proxy-groups'][0], {
    name: 'A',
    type: 'select',
    use: ['a-sub1']
  });
});

test('writeManagedConfig renders separate ports when configured', async () => {
  const config = createConfig('dev', {
    proxyMode: 'separate',
    ports: {
      http: 17890,
      socks: 17891,
      api: 19090
    }
  });
  await ensureSubscriptionStore(config);
  await saveSubscriptions(config, [
    {
      id: 'sub1',
      type: 'remote',
      source: 'https://example.com/a',
      displayName: 'A',
      providerKey: 'a-sub1',
      enabled: true,
      syncStatus: 'pending'
    }
  ]);

  const { writeManagedConfig } = await import('../src/lib/subscriptions.mjs');
  await writeManagedConfig(config);
  const rendered = YAML.parse(await fs.readFile(config.generatedConfigFile, 'utf8'));

  assert.equal(rendered.port, 17890);
  assert.equal(rendered['socks-port'], 17891);
  assert.equal(rendered['mixed-port'], undefined);
});

test('loadSubscriptions repairs legacy provider paths into config/providers', async () => {
  const config = createConfig('dev');
  await ensureSubscriptionStore(config);
  await saveSubscriptions(config, [
    {
      id: 'legacy001',
      type: 'local',
      source: fixtureA,
      displayName: 'Legacy A',
      providerKey: 'legacy-a-001',
      contentHash: '',
      lastSyncedAt: '',
      enabled: true,
      nodes: [],
      nodeNames: [],
      nodeCount: 0,
      syncStatus: 'pending',
      syncError: '',
      cachePath: `${config.dataDir}/cache/legacy001.yaml`,
      providerPath: `${config.dataDir}/providers/legacy-a-001.yaml`
    }
  ]);

  const subscriptions = await loadSubscriptions(config);
  assert.match(subscriptions[0].providerPath.replace(/\\/g, '/'), /\/config\/providers\/legacy-a-001\.yaml$/);
});

test('loadSubscriptions backfills nodes for legacy records with nodeNames only', async () => {
  const config = createConfig('dev');
  await ensureSubscriptionStore(config);
  await saveSubscriptions(config, [
    {
      id: 'legacy002',
      type: 'local',
      source: fixtureA,
      displayName: 'Legacy B',
      providerKey: 'legacy-b-002',
      contentHash: '',
      lastSyncedAt: '',
      enabled: true,
      nodeNames: ['日本 01', '香港 02'],
      nodeCount: 2,
      syncStatus: 'pending',
      syncError: ''
    }
  ]);

  const subscriptions = await loadSubscriptions(config);
  assert.deepEqual(subscriptions[0].nodes, [
    { name: '日本 01', protocol: 'unknown' },
    { name: '香港 02', protocol: 'unknown' }
  ]);
});
