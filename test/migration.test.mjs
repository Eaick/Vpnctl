import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectOldInstall, migrateOldInstall } from '../src/lib/migration.mjs';
import { cleanSandboxRuntime } from '../src/lib/install.mjs';
import { createConfig } from '../src/lib/config.mjs';
import { loadSubscriptions } from '../src/lib/subscriptions.mjs';

const tempDir = path.join(os.tmpdir(), 'vpnctl-migration-test');
const legacyRoot = path.join(tempDir, '.vpnctl-old');
const originalHome = process.env.HOME;

async function writeLegacyFixture() {
  await fs.mkdir(path.join(legacyRoot, 'data'), { recursive: true });
  await fs.writeFile(path.join(legacyRoot, 'install.json'), JSON.stringify({
    defaultGroup: 'VPNCTL',
    theme: 'claude',
    ports: {
      http: 27890,
      socks: 27891,
      api: 29090
    }
  }, null, 2));
  await fs.writeFile(path.join(legacyRoot, 'data', 'subscriptions.json'), JSON.stringify([
    {
      id: 'oldsub001',
      type: 'remote',
      source: 'https://example.com/sub',
      displayName: 'Legacy',
      enabled: true,
      nodeNames: ['HK 01'],
      nodeCount: 1,
      syncStatus: 'synced'
    }
  ], null, 2));
}

test.beforeEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.mkdir(tempDir, { recursive: true });
  process.env.HOME = tempDir;
  process.env.VPNCTL_OLD_ROOT = legacyRoot;
  await cleanSandboxRuntime().catch(() => {});
});

test.after(async () => {
  process.env.HOME = originalHome;
  delete process.env.VPNCTL_OLD_ROOT;
  await fs.rm(tempDir, { recursive: true, force: true });
  await cleanSandboxRuntime().catch(() => {});
});

test('detectOldInstall returns legacy root and metadata', async () => {
  await writeLegacyFixture();
  const legacy = await detectOldInstall();
  assert.equal(legacy.root, legacyRoot);
  assert.equal(legacy.installState.theme, 'claude');
  assert.equal(legacy.subscriptions.length, 1);
});

test('migrateOldInstall imports legacy subscriptions into dev sandbox', async () => {
  await writeLegacyFixture();
  await migrateOldInstall({ mode: 'dev', skipDownload: true });
  const config = createConfig('dev');
  const subscriptions = await loadSubscriptions(config);
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].displayName, 'Legacy');
  assert.equal(config.installState.migration.status, 'migrated');
});
