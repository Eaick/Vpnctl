import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManagedBashrcBlock,
  installShellIntegration,
  uninstallShellIntegration,
  detectShellIntegration
} from '../src/lib/shell.mjs';

const tempDir = path.join(os.tmpdir(), 'vpnctl-shell-test');
const bashrcPath = path.join(tempDir, '.bashrc');
const originalHome = process.env.HOME;

test.beforeEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.mkdir(tempDir, { recursive: true });
  process.env.HOME = tempDir;
});

test.after(async () => {
  process.env.HOME = originalHome;
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('buildManagedBashrcBlock contains proxy functions and aliases', () => {
  const block = buildManagedBashrcBlock();
  assert.match(block, /vpnctl-proxy-on/);
  assert.match(block, /vpnctl-codex/);
  assert.match(block, /codex\(\)/);
  assert.match(block, /vpnon/);
  assert.match(block, /codexvpn/);
  assert.match(block, /vpnstat/);
});

test(process.platform === 'win32' ? 'shell integration is skipped on windows' : 'installShellIntegration writes and removes managed bashrc block', async () => {
  if (process.platform === 'win32') {
    await assert.rejects(installShellIntegration({ bashrcPath }));
    return;
  }

  await installShellIntegration({ bashrcPath });
  const installed = await detectShellIntegration({ bashrcPath });
  assert.equal(installed.installed, true);

  const content = await fs.readFile(bashrcPath, 'utf8');
  assert.match(content, /# >>> vpnctl >>>/);

  await uninstallShellIntegration({ bashrcPath });
  const removed = await detectShellIntegration({ bashrcPath });
  assert.equal(removed.installed, false);
});
