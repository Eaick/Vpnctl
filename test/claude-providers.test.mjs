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
  assert.equal(deleteCurrent.allowed, true);
  await assert.rejects(executeClaudeProviderAction(deleteCurrent, { env }), /确认/);
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

test('the sole active account can be deleted after confirmation and owned settings are safely restored', async () => fixture(async ({ env, dir }) => {
  const settingsPath = path.join(dir, 'settings.json');
  const original = { env: { HTTPS_PROXY: 'http://127.0.0.1:23456', NO_PROXY: '.internal' }, hooks: { Stop: [] }, model: 'user-model' };
  await fs.writeFile(settingsPath, JSON.stringify(original));
  const save = await prepareClaudeProviderAction('save', { env, input: account });
  const saved = await executeClaudeProviderAction(save, { env, input: account, confirmed: true });
  const apply = await prepareClaudeProviderAction('apply', { env, id: saved.id, context: { available: true } });
  await executeClaudeProviderAction(apply, { env, confirmed: true, context: { available: true } });
  const deletion = await prepareClaudeProviderAction('delete', { env, id: saved.id });
  assert.equal(deletion.allowed, true);
  assert.match(deletion.steps.map(step => step.label).join('\n'), /退出激活|恢复/);
  await assert.rejects(executeClaudeProviderAction(deletion, { env }), /确认/);
  assert.equal((await listClaudeProviders({ env })).activeId, saved.id);
  const result = await executeClaudeProviderAction(deletion, { env, confirmed: true });
  assert.ok(result.backupPath);
  const listing = await listClaudeProviders({ env });
  assert.equal(listing.profiles.length, 0);
  assert.equal(listing.activeId, null);
  assert.deepEqual(JSON.parse(await fs.readFile(settingsPath, 'utf8')), original);
}));

test('existing settings are discovered without exposing credentials and imported idempotently without source writes', async () => fixture(async ({ env, dir }) => {
  const settingsPath = path.join(dir, 'settings.json');
  const original = JSON.stringify({ model: 'top-level-model', env: { ANTHROPIC_BASE_URL: 'https://existing.example.com', ANTHROPIC_AUTH_TOKEN: 'existing-fixture-secret', ANTHROPIC_DEFAULT_SONNET_MODEL: 'mapped-model' }, mcpServers: { fixture: {} } });
  await fs.writeFile(settingsPath, original);
  const listing = await listClaudeProviders({ env });
  assert.equal(listing.existing.status, 'available');
  assert.equal(listing.existing.profile.model, 'top-level-model');
  assert.equal(listing.profiles.length, 0, 'discovery must not silently create saved accounts');
  assert.ok(!JSON.stringify(listing).includes('existing-fixture-secret'));
  const plan = await prepareClaudeProviderAction('import-settings', { env });
  assert.ok(!JSON.stringify(plan).includes('existing-fixture-secret'));
  await assert.rejects(executeClaudeProviderAction(plan, { env }), /确认/);
  await executeClaudeProviderAction(plan, { env, confirmed: true });
  const imported = await listClaudeProviders({ env });
  assert.equal(imported.profiles.length, 1);
  assert.equal(imported.activeId, null, 'import must not take over the existing account');
  assert.equal(imported.existing.matchingId, imported.profiles[0].id);
  const again = await prepareClaudeProviderAction('import-settings', { env });
  await executeClaudeProviderAction(again, { env, confirmed: true });
  assert.equal((await listClaudeProviders({ env })).profiles.length, 1);
  assert.equal(await fs.readFile(settingsPath, 'utf8'), original);
}));

test('invalid or ambiguous existing settings do not hide saved accounts or guess authentication', async () => fixture(async ({ env, dir }) => {
  const save = await prepareClaudeProviderAction('save', { env, input: account });
  await executeClaudeProviderAction(save, { env, input: account, confirmed: true });
  const settingsPath = path.join(dir, 'settings.json');
  await fs.writeFile(settingsPath, '{invalid');
  assert.equal((await listClaudeProviders({ env })).profiles.length, 1);
  assert.equal((await listClaudeProviders({ env })).existing.status, 'invalid');
  await fs.writeFile(settingsPath, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://existing.example.com', ANTHROPIC_API_KEY: 'key-fixture', ANTHROPIC_AUTH_TOKEN: 'token-fixture' } }));
  assert.equal((await listClaudeProviders({ env })).existing.status, 'ambiguous');
  await assert.rejects(prepareClaudeProviderAction('import-settings', { env }), /两种认证|两种凭据/);
  await fs.writeFile(settingsPath, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://existing.example.com', ANTHROPIC_API_KEY: 'key-fixture' } }));
  const stale = await prepareClaudeProviderAction('import-settings', { env });
  await fs.writeFile(settingsPath, '{}');
  await assert.rejects(executeClaudeProviderAction(stale, { env, confirmed: true }), /变化/);
}));

test('importing existing settings never overwrites a different selected account', async () => fixture(async ({ env, dir }) => {
  const save = await prepareClaudeProviderAction('save', { env, input: account });
  const saved = await executeClaudeProviderAction(save, { env, input: account, confirmed: true });
  await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://another.example.com', ANTHROPIC_API_KEY: 'another-fixture' } }));
  const plan = await prepareClaudeProviderAction('import-settings', { env, id: saved.id });
  assert.notEqual(plan.id, saved.id);
  await executeClaudeProviderAction(plan, { env, confirmed: true });
  const listing = await listClaudeProviders({ env });
  assert.equal(listing.profiles.length, 2);
  assert.equal(listing.profiles.find(profile => profile.id === saved.id).baseUrl, account.baseUrl);
}));

test('deleting an active account preserves external edits and never activates remaining accounts', async () => fixture(async ({ env, dir }) => {
  const firstPlan = await prepareClaudeProviderAction('save', { env, input: account });
  const first = await executeClaudeProviderAction(firstPlan, { env, input: account, confirmed: true });
  const other = { ...account, name: '保留账号', baseUrl: 'https://keep.example.com' };
  const otherPlan = await prepareClaudeProviderAction('save', { env, input: other });
  await executeClaudeProviderAction(otherPlan, { env, input: other, confirmed: true });
  const context = { available: true };
  await executeClaudeProviderAction(await prepareClaudeProviderAction('apply', { env, id: first.id, context }), { env, context, confirmed: true });
  const settingsPath = path.join(dir, 'settings.json');
  const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  settings.env.ANTHROPIC_MODEL = 'external-model-change';
  settings.hooks = { Stop: ['external-hook'] };
  await fs.writeFile(settingsPath, JSON.stringify(settings));
  const deletion = await prepareClaudeProviderAction('delete', { env, id: first.id });
  await executeClaudeProviderAction(deletion, { env, confirmed: true });
  const listing = await listClaudeProviders({ env });
  assert.equal(listing.profiles.length, 1);
  assert.equal(listing.profiles[0].name, other.name);
  assert.equal(listing.activeId, null);
  const kept = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  assert.equal(kept.env.ANTHROPIC_MODEL, 'external-model-change');
  assert.deepEqual(kept.hooks, settings.hooks);
}));

test('settings import preserves 1M consent and does not read browser login credentials', async () => fixture(async ({ env, dir }) => {
  const settingsPath = path.join(dir, 'settings.json');
  await fs.writeFile(settingsPath, JSON.stringify({ env: { ANTHROPIC_API_KEY: 'official-fixture', ANTHROPIC_MODEL: 'model[1m]' } }));
  const listing = await listClaudeProviders({ env });
  assert.equal(listing.existing.profile.baseUrl, 'https://api.anthropic.com');
  const plan = await prepareClaudeProviderAction('import-settings', { env });
  assert.equal(plan.requires1mConfirmation, true);
  await assert.rejects(executeClaudeProviderAction(plan, { env, confirmed: true }), /确认.*1M/);
  await executeClaudeProviderAction(plan, { env, confirmed: true, acknowledge1m: true });
  await fs.writeFile(settingsPath, JSON.stringify({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'oauth-fixture' } }));
  const oauth = await listClaudeProviders({ env });
  assert.equal(oauth.existing.status, 'unavailable');
  assert.ok(!JSON.stringify(oauth).includes('oauth-fixture'));
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

test('1M model declarations require explicit support acknowledgement before save and apply', async () => fixture(async ({ env, dir }) => {
  const input = { ...account, model: 'gateway/main[1m]', sonnet: 'gateway/fast[1m]', opus: 'ordinary-model' };
  const save = await prepareClaudeProviderAction('save', { env, input });
  assert.equal(save.requires1mConfirmation, true);
  assert.match(save.warnings.join('\n'), /确认.*支持.*1M/);
  await assert.rejects(executeClaudeProviderAction(save, { env, input, confirmed: true }), /确认.*1M/);
  await assert.rejects(fs.access(path.join(dir, '.vpnctl-providers.json')));
  const saved = await executeClaudeProviderAction(save, { env, input, confirmed: true, acknowledge1m: true });
  const context = { available: true };
  const apply = await prepareClaudeProviderAction('apply', { env, id: saved.id, context });
  assert.equal(apply.requires1mConfirmation, true);
  await assert.rejects(executeClaudeProviderAction(apply, { env, context, confirmed: true }), /确认.*1M/);
  await executeClaudeProviderAction(apply, { env, context, confirmed: true, acknowledge1m: true });
  const written = JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(written.env.ANTHROPIC_MODEL, 'gateway/main[1m]');
  assert.equal(written.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'gateway/fast[1m]');
  assert.equal(written.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'ordinary-model');
  assert.equal((await listClaudeProviders({ env })).active.model, 'gateway/main[1m]');
  const changed = { ...input, id: saved.id, secret: '', model: 'gateway/main', sonnet: 'gateway/fast' };
  const disable = await prepareClaudeProviderAction('save', { env, input: changed });
  assert.equal(disable.requires1mConfirmation, false);
  await executeClaudeProviderAction(disable, { env, input: changed, confirmed: true });
  assert.equal((await listClaudeProviders({ env })).profiles[0].pending, true);
  const applyDisabled = await prepareClaudeProviderAction('apply', { env, id: saved.id, context });
  await executeClaudeProviderAction(applyDisabled, { env, context, confirmed: true });
  const disabled = JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(disabled.env.ANTHROPIC_MODEL, 'gateway/main');
  assert.equal(disabled.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'gateway/fast');
}));
