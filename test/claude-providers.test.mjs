import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listClaudeProviders, prepareClaudeProviderAction, executeClaudeProviderAction, parseLegacyAccounts, claudeProviderEnvironment, restoreClaudeProviders } from '../src/lib/integrations/claude-providers.mjs';

export async function fixture(action) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vpnctl-claude-accounts-'));
  try { return await action({ dir, env: { CLAUDE_CONFIG_DIR: dir, HOME: dir } }); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
}
const account = { name: '示例账号', protocol: 'anthropic', authType: 'bearer', baseUrl: 'https://gateway.example.com', secret: 'fixture-private-key', model: 'model-main', sonnet: 'model-fast' };

test('API accounts support private CRUD and public listing never contains credentials', async () => fixture(async ({ env }) => {
  const preview = await prepareClaudeProviderAction('save', { input: account, env });
  assert.ok(!JSON.stringify(preview).includes(account.secret));
  await assert.rejects(executeClaudeProviderAction(preview, { env }), /确认/);
  const saved = await executeClaudeProviderAction(preview, { env, input: account, confirmed: true });
  const listing = await listClaudeProviders({ env });
  assert.equal(listing.profiles.length, 1);
  assert.equal(listing.profiles[0].name, account.name);
  assert.ok(!JSON.stringify(listing).includes(account.secret));
  const edited = { ...listing.profiles[0], name: '改名', secret: '' };
  const plan = await prepareClaudeProviderAction('save', { env, input: edited });
  await executeClaudeProviderAction(plan, { env, input: edited, confirmed: true });
  assert.equal((await listClaudeProviders({ env })).profiles[0].name, '改名');
  const removal = await prepareClaudeProviderAction('delete', { env, id: saved.id });
  await executeClaudeProviderAction(removal, { env, confirmed: true });
  assert.equal((await listClaudeProviders({ env })).profiles.length, 0);
}));

test('legacy accounts are parsed as data, including equals signs in secrets, never as shell code', () => {
  const parsed = parseLegacyAccounts('[A]\nANTHROPIC_BASE_URL=https://gateway.example.com\nANTHROPIC_AUTH_TOKEN=fixture=a=b\nANTHROPIC_MODEL=model-1\n');
  assert.equal(parsed[0].secret, 'fixture=a=b');
  assert.throws(() => parseLegacyAccounts('[A]\nexec echo bad\n'), /格式/);
});

test('native accounts apply, switch, and restore only owned API fields while preserving proxy and user settings', async () => fixture(async ({ env, dir }) => {
  const settingsPath = path.join(dir, 'settings.json');
  const original = { env: { ANTHROPIC_BASE_URL: 'https://original.example.com', ANTHROPIC_API_KEY: 'original-fixture', HTTPS_PROXY: 'http://127.0.0.1:23456', NO_PROXY: '.internal' }, hooks: { Stop: [] }, model: 'existing-model', apiKeyHelper: 'user-helper' };
  await fs.writeFile(settingsPath, JSON.stringify(original));
  const context = { available: true };
  async function save(input) {
    const plan = await prepareClaudeProviderAction('save', { input, env });
    return executeClaudeProviderAction(plan, { input, env, confirmed: true });
  }
  const first = await save(account);
  const second = await save({ ...account, name: '第二账号', authType: 'api-key', secret: 'second-fixture' });
  for (const id of [first.id, second.id]) {
    const plan = await prepareClaudeProviderAction('apply', { id, env, context });
    assert.ok(!JSON.stringify(plan).includes(account.secret));
    assert.equal(plan.allowed, true);
    const result = await executeClaudeProviderAction(plan, { env, context, confirmed: true });
    assert.ok(result.backupPath);
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    assert.deepEqual(written.hooks, original.hooks);
    assert.equal(written.apiKeyHelper, original.apiKeyHelper);
    assert.equal(written.env.HTTPS_PROXY, original.env.HTTPS_PROXY);
    assert.equal(written.env.NO_PROXY, '.internal');
  }
  const child = await claudeProviderEnvironment({ env: { ...env, ANTHROPIC_AUTH_TOKEN: 'stale-fixture', HTTPS_PROXY: 'http://127.0.0.1:34567' } });
  assert.equal(child.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(child.ANTHROPIC_API_KEY, 'second-fixture');
  assert.equal(child.HTTPS_PROXY, 'http://127.0.0.1:34567');
  const deleteCurrent = await prepareClaudeProviderAction('delete', { env, id: second.id });
  assert.equal(deleteCurrent.allowed, false);
  await assert.rejects(executeClaudeProviderAction(deleteCurrent, { env, confirmed: true }), /条件/);
  const changed = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  changed.env.ANTHROPIC_MODEL = 'user-edited-model';
  await fs.writeFile(settingsPath, JSON.stringify(changed));
  await restoreClaudeProviders({ env, confirmed: true });
  const restored = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  assert.equal(restored.env.ANTHROPIC_MODEL, 'user-edited-model');
  delete restored.env.ANTHROPIC_MODEL;
  assert.deepEqual(restored, original);
  assert.equal((await listClaudeProviders({ env })).profiles.length, 2);
}));

test('unfinished conversion never changes Claude settings and stale previews are rejected', async () => fixture(async ({ env, dir }) => {
  const input = { ...account, protocol: 'openai-chat' };
  const plan = await prepareClaudeProviderAction('save', { env, input });
  const saved = await executeClaudeProviderAction(plan, { env, input, confirmed: true });
  const apply = await prepareClaudeProviderAction('apply', { env, id: saved.id, context: { available: true } });
  assert.equal(apply.allowed, false);
  await assert.rejects(executeClaudeProviderAction(apply, { env, context: { available: true }, confirmed: true }), /条件|未接通/);
  await assert.rejects(fs.access(path.join(dir, 'settings.json')));
  const stale = await prepareClaudeProviderAction('delete', { env, id: saved.id });
  await fs.writeFile(path.join(dir, 'settings.json'), '{}');
  await assert.rejects(executeClaudeProviderAction(stale, { env, confirmed: true }), /变化/);
}));

test('public listing whitelists fields and invalid endpoints or duplicate normalized names are rejected', async () => fixture(async ({ env, dir }) => {
  for (const baseUrl of ['http://remote.example.com', 'https://user:pass@example.com', 'https://example.com?key=fixture', 'https://example.com/v1/messages']) {
    await assert.rejects(prepareClaudeProviderAction('save', { env, input: { ...account, baseUrl } }));
  }
  const plan = await prepareClaudeProviderAction('save', { env, input: account });
  await executeClaudeProviderAction(plan, { env, input: account, confirmed: true });
  await assert.rejects(prepareClaudeProviderAction('save', { env, input: { ...account, name: ` ${account.name} ` } }), /名称/);
  const storePath = path.join(dir, '.vpnctl-providers.json');
  const store = JSON.parse(await fs.readFile(storePath, 'utf8'));
  store.profiles[0].unexpectedSecret = 'unexpected-fixture-secret';
  await fs.writeFile(storePath, JSON.stringify(store));
  assert.ok(!JSON.stringify(await listClaudeProviders({ env })).includes('unexpected-fixture-secret'));
}));
