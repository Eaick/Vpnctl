import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { createConfig } from '../src/lib/config.mjs';
import {
  addSubscriptionFromFile,
  loadSubscriptions,
  syncSubscriptions
} from '../src/lib/subscriptions.mjs';

test('failed or empty sync preserves last good provider and reports failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vpnctl-sync-safety-'));
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
    installFile: paths.installFile,
    dataDir: paths.dataDir,
    cacheDir: paths.cacheDir,
    providersDir: paths.providersDir,
    downloadsDir: paths.downloadsDir,
    subscriptionsFile: paths.subscriptionsFile,
    generatedConfigFile: paths.generatedConfigFile,
    configDir: paths.configDir,
    mihomoBin: paths.mihomoBin
  };
  const source = path.join(root, 'subscription.yaml');
  const valid = 'proxies:\n  - name: Good\n    type: ss\n';

  try {
    await fs.writeFile(source, valid);
    const created = await addSubscriptionFromFile(source, 'Safe', config);
    assert.equal((await syncSubscriptions({ id: created.id }, config))[0].ok, true);
    const [before] = await loadSubscriptions(config);
    assert.equal(await fs.readFile(before.providerPath, 'utf8'), valid);

    await fs.writeFile(source, '<html>expired <a href="https://example.com">renew</a></html>');
    const [failed] = await syncSubscriptions({ id: created.id }, config);
    assert.equal(failed.ok, false);
    assert.match(failed.error, /未包含可识别的节点/);

    const [after] = await loadSubscriptions(config);
    assert.equal(after.syncStatus, 'failed');
    assert.deepEqual(after.nodeNames, ['Good']);
    assert.equal(await fs.readFile(after.providerPath, 'utf8'), valid);
    const managed = YAML.parse(await fs.readFile(config.generatedConfigFile, 'utf8'));
    assert.equal(managed['proxy-providers'][after.providerKey].type, 'file');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
