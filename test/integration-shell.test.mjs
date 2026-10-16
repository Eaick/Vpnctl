import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/lib/config.mjs';
import { buildManagedBashrcBlock, installShellIntegration, uninstallShellIntegration, detectShellIntegration } from '../src/lib/shell.mjs';
import { syncClaudeSettings } from '../src/lib/integrations/claude.mjs';
import { prepareClaudeProviderAction, executeClaudeProviderAction, listClaudeProviders } from '../src/lib/integrations/claude-providers.mjs';

test('application wrappers delegate arguments without an eval of user input or background restarts', () => {
  const block = buildManagedBashrcBlock();
  assert.match(block, /command vpnctl integrate codex run -- "\$@"/);
  assert.match(block, /command vpnctl integrate claude run -- "\$@"/);
  assert.match(block, /alias claudevpn='vpnctl-claude'/);
  assert.match(block, /--app codex/);
  assert.match(block, /--app claude/);
  assert.ok(!block.includes('daemon stop'));
  assert.ok(!block.includes('daemon update'));
  assert.ok(!block.includes('NO_PROXY='));
});

const bash = process.env.VPNCTL_TEST_BASH || 'bash';
const bashAvailable = spawnSync(bash, ['--version'], { encoding: 'utf8', timeout: 5000 }).status === 0;
test('generated Bash wrappers pass syntax validation', { skip: !bashAvailable }, () => {
  const result = spawnSync(bash, ['-n'], { input: buildManagedBashrcBlock(), encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
});

test('shell install and uninstall are idempotent and restore only owned Claude proxy fields', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vpnctl-shell-integration-'));
  const keys = ['HOME', 'CLAUDE_CONFIG_DIR'];
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.HOME = temp;
    process.env.CLAUDE_CONFIG_DIR = path.join(temp, 'claude-custom');
    const config = createConfig('user');
    const bashrcPath = path.join(temp, '.bashrc');
    const original = 'export USER_SETTING=keep\n';
    await fs.writeFile(bashrcPath, original);
    await installShellIntegration({ bashrcPath, currentConfig: config, platform: 'linux' });
    const first = await fs.readFile(bashrcPath, 'utf8');
    const files = await fs.readdir(temp);
    await installShellIntegration({ bashrcPath, currentConfig: config, platform: 'linux' });
    assert.equal(await fs.readFile(bashrcPath, 'utf8'), first);
    assert.deepEqual(await fs.readdir(temp), files);
    const detected = await detectShellIntegration({ bashrcPath });
    assert.equal(detected.codexWrapper, true);
    assert.equal(detected.claudeWrapper, true);
    assert.equal(first.match(/# >>> vpnctl >>>/g).length, 1);
    const settingsPath = path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json');
    await fs.mkdir(process.env.CLAUDE_CONFIG_DIR);
    await fs.writeFile(settingsPath, JSON.stringify({ model: 'user-choice', env: { NO_PROXY: '.internal', ANTHROPIC_BASE_URL: 'https://gateway.example.com' } }));
    const sync = await syncClaudeSettings({ env: process.env, confirmed: true, context: { available: true, httpProxy: 'http://127.0.0.1:23456' } });
    assert.equal(sync.ok, true);
    const input = { name: '卸载测试', baseUrl: 'https://new.example.com', secret: 'uninstall-fixture' };
    const save = await prepareClaudeProviderAction('save', { input });
    const saved = await executeClaudeProviderAction(save, { input, confirmed: true });
    const apply = await prepareClaudeProviderAction('apply', { id: saved.id, context: { available: true } });
    await executeClaudeProviderAction(apply, { confirmed: true, context: { available: true } });
    await uninstallShellIntegration({ bashrcPath, currentConfig: config, platform: 'linux' });
    assert.equal(await fs.readFile(bashrcPath, 'utf8'), original);
    assert.deepEqual(JSON.parse(await fs.readFile(settingsPath, 'utf8')), { model: 'user-choice', env: { NO_PROXY: '.internal', ANTHROPIC_BASE_URL: 'https://gateway.example.com' } });
    const accounts = await listClaudeProviders();
    assert.equal(accounts.activeId, null);
    assert.equal(accounts.profiles.length, 1, 'uninstall preserves saved API accounts');
    await uninstallShellIntegration({ bashrcPath, currentConfig: config, platform: 'linux' });
    assert.equal(await fs.readFile(bashrcPath, 'utf8'), original);
  } finally {
    for (const key of keys) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; }
    await fs.rm(temp, { recursive: true, force: true });
  }
});
