import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

function runCli(home, ...args) {
  return spawnSync(process.execPath, ['src/index.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      VPNCTL_MODE: 'user',
      MIHOMO_API: '',
      MIHOMO_HTTP_PROXY: '',
      MIHOMO_SOCKS_PROXY: ''
    }
  });
}

test('CLI imports and syncs a valid local subscription in an isolated home', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vpnctl-cli-sub-'));
  const source = path.join(home, 'nodes.yaml');
  try {
    await fs.writeFile(source, 'proxies:\n  - name: Test\n    type: ss\n');
    const added = runCli(home, 'add-sub', '--file', source, '--name', 'Local Test');
    assert.equal(added.status, 0, added.stderr);
    assert.match(added.stdout, /Local Test/);

    const synced = runCli(home, 'sync');
    assert.equal(synced.status, 0, synced.stderr);
    const subscriptions = JSON.parse(await fs.readFile(path.join(home, '.vpnctl', 'data', 'subscriptions.json'), 'utf8'));
    assert.equal(subscriptions[0].syncStatus, 'synced');
    assert.equal(subscriptions[0].nodeCount, 1);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('CLI rejects a local file without nodes without activating it', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vpnctl-cli-invalid-sub-'));
  const source = path.join(home, 'invalid.txt');
  try {
    await fs.writeFile(source, '# Not a subscription\n');
    const added = runCli(home, 'add-sub', '--file', source, '--name', 'Invalid');
    assert.notEqual(added.status, 0);
    assert.match(added.stderr, /本地订阅未包含可识别的节点，未添加/);

    const subscriptions = JSON.parse(await fs.readFile(path.join(home, '.vpnctl', 'data', 'subscriptions.json'), 'utf8'));
    assert.deepEqual(subscriptions, []);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('CLI edits subscription source and name without changing its ID', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vpnctl-cli-edit-sub-'));
  const firstSource = path.join(home, 'first.yaml');
  const nextSource = path.join(home, 'next.yaml');
  try {
    await fs.writeFile(firstSource, 'proxies:\n  - name: First\n    type: ss\n');
    await fs.writeFile(nextSource, 'proxies:\n  - name: Next\n    type: trojan\n');
    const added = runCli(home, 'add-sub', '--file', firstSource, '--name', 'Original');
    assert.equal(added.status, 0, added.stderr);
    const storePath = path.join(home, '.vpnctl', 'data', 'subscriptions.json');
    const [before] = JSON.parse(await fs.readFile(storePath, 'utf8'));

    const edited = runCli(home, 'edit-sub', '--id', before.id, '--file', nextSource, '--name', 'Updated');
    assert.equal(edited.status, 0, edited.stderr);
    const [after] = JSON.parse(await fs.readFile(storePath, 'utf8'));
    assert.equal(after.id, before.id);
    assert.equal(after.providerKey, before.providerKey);
    assert.equal(after.source, nextSource);
    assert.equal(after.displayName, 'Updated');
    assert.deepEqual(after.nodes, [{ name: 'Next', protocol: 'trojan' }]);

    const rejected = runCli(home, 'edit-sub', '--id', before.id, '--file', path.join(home, 'missing.yaml'));
    assert.notEqual(rejected.status, 0);
    assert.deepEqual(JSON.parse(await fs.readFile(storePath, 'utf8')), [after]);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
