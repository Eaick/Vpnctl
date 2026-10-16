import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectClaude, planClaudeSync, syncClaudeSettings, uninstallClaudeSettings } from '../src/lib/integrations/claude.mjs';

const keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'];
const proxy = 'http://127.0.0.1:7890';
const context = (value = proxy) => ({ available: true, httpProxy: value, displayProxy: value, env: Object.fromEntries(keys.map((key) => [key, value])), issues: [] });
const cli = async () => ({ ok: true, code: 0, stdout: '2.1.0 (Claude Code)\n', stderr: '' });
const json = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

async function fixture(t, { custom = false, settings } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vpnctl-claude-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const env = { HOME: path.join(root, 'home'), ...(custom ? { CLAUDE_CONFIG_DIR: path.join(root, 'custom') } : {}) };
  const dir = env.CLAUDE_CONFIG_DIR || path.join(env.HOME, '.claude');
  const settingsPath = path.join(dir, 'settings.json');
  const statePath = path.join(dir, '.vpnctl-proxy.json');
  const put = async (value) => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(settingsPath, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
  };
  if (settings !== undefined) await put(settings);
  return { root, dir, env, settingsPath, statePath, put };
}

test('Claude inspect resolves isolated HOME and custom config directory without reading credentials', async (t) => {
  for (const custom of [false, true]) {
    const f = await fixture(t, { custom, settings: { model: 'private-model', apiKey: 'private-key', env: { ANTHROPIC_API_KEY: 'private-env-key' }, mcpServers: { private: {} } } });
    await fs.writeFile(path.join(f.dir, '.credentials.json'), 'private-credentials');
    const reads = [];
    const io = { ...fs, open: async (file, ...args) => { reads.push(path.basename(file)); return fs.open(file, ...args); } };
    const report = await inspectClaude({ context: context(), env: f.env, run: async (command, args, options) => {
      assert.equal(command, 'claude');
      assert.deepEqual(args, ['--version']);
      assert.deepEqual(options.env, context().env);
      return { ...await cli(), stderr: 'private-cli-error' };
    }, io });
    assert.equal(report.app, 'claude');
    assert.equal(report.installed, true);
    assert.equal(report.cliVersion, '2.1.0');
    assert.equal(report.settings.path, f.settingsPath);
    assert.equal(report.settings.status, 'unmanaged', JSON.stringify(report.settings));
    assert.equal(report.settings.gatewayConfigured, false);
    assert.equal(report.processEnvironment.gatewayConfigured, false);
    assert.ok(!reads.includes('.credentials.json'));
    assert.doesNotMatch(JSON.stringify(report), /private-/);
    assert.ok(['unverified', 'unsupported'].includes(report.supervisor.status));
    assert.ok(report.checks.every((check) => ['ok', 'warn', 'error', 'unknown', 'unsupported'].includes(check.status)));
    assert.ok(Number.isFinite(Date.parse(report.checkedAt)));
  }
});

test('Claude exposes only gateway presence for settings and process environment independently', async (t) => {
  const gatewayKeys = ['ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];
  for (const source of ['settings', 'process']) {
    for (const key of gatewayKeys) {
      const value = key === 'ANTHROPIC_BASE_URL' ? 'https://gateway-user:gateway-password@gateway-private.invalid/private?token=gateway-token' : '1';
      const f = await fixture(t, { settings: { env: source === 'settings' ? { [key]: value, ANTHROPIC_API_KEY: 'private-gateway-key' } : {} } });
      const before = await fs.readFile(f.settingsPath, 'utf8');
      const env = source === 'process' ? { ...f.env, [key]: value, ANTHROPIC_API_KEY: 'private-gateway-key' } : f.env;
      const report = await inspectClaude({ env, context: context(), run: cli });
      assert.equal(report.settings.gatewayConfigured, source === 'settings');
      assert.equal(report.processEnvironment.gatewayConfigured, source === 'process');
      const warnings = report.checks.filter((check) => check.id === 'gateway');
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0].status, 'warn');
      assert.equal(warnings[0].label, '检测到用户第三方网关，未修改网关或凭据');
      assert.doesNotMatch(JSON.stringify(report), /gateway-user|gateway-password|gateway-private|gateway-token|private-gateway-key/);
      assert.equal(await fs.readFile(f.settingsPath, 'utf8'), before);
    }
  }
});

test('Claude gateway marker is conservative presence detection, not verification of active routing', async (t) => {
  const f = await fixture(t, { settings: { env: { CLAUDE_CODE_USE_BEDROCK: '0' } } });
  const report = await inspectClaude({ env: { ...f.env, ANTHROPIC_BASE_URL: '' }, run: cli });
  assert.equal(report.settings.gatewayConfigured, true);
  assert.equal(report.processEnvironment.gatewayConfigured, true);
  assert.equal(report.checks.find((check) => check.id === 'gateway').status, 'warn');
  await fs.writeFile(f.statePath, '{ invalid-private-state');
  const invalidState = await inspectClaude({ env: f.env, run: cli });
  assert.equal(invalidState.settings.status, 'invalid');
  assert.equal(invalidState.settings.gatewayConfigured, true);
  assert.equal(invalidState.checks.find((check) => check.id === 'gateway').status, 'warn');
  assert.doesNotMatch(JSON.stringify(invalidState), /invalid-private-state/);
});

test('Claude missing CLI and unverified Supervisor never imply verified background environment', async (t) => {
  const f = await fixture(t);
  const report = await inspectClaude({ env: f.env, context: context(), platform: 'linux', run: async () => ({ ok: false, missing: true, stdout: '', stderr: 'secret-token' }) });
  assert.equal(report.installed, false);
  assert.equal(report.cliVersion, null);
  assert.equal(report.settings.status, 'missing');
  assert.equal(report.supervisor.status, 'unverified');
  assert.match(report.supervisor.label, /未验证/);
  assert.equal(report.checks.find((item) => item.id === 'process-env').status, 'unknown');
  assert.doesNotMatch(JSON.stringify(report), /secret-token/);
  const thrown = await inspectClaude({ env: f.env, run: async () => { throw new Error('private-error'); } });
  assert.equal(thrown.installed, false);
  assert.doesNotMatch(JSON.stringify(thrown), /private-error/);
});

test('Claude rejects unconfirmed/unavailable/SOCKS sync without creating configuration', async (t) => {
  const f = await fixture(t);
  for (const options of [{ context: context() }, { confirmed: true }, { confirmed: true, context: { ...context(), available: false } }, { confirmed: true, context: context('socks5://localhost:1080') }]) {
    const result = await syncClaudeSettings({ env: f.env, ...options });
    assert.equal(result.ok, false);
    assert.equal(await fs.stat(f.dir).then(() => true, () => false), false);
  }
  assert.equal((await uninstallClaudeSettings({ env: f.env })).code, 'CONFIRMATION_REQUIRED');
  assert.equal((await uninstallClaudeSettings({ env: f.env, confirmed: true })).status, 'unmanaged');
  assert.equal(await fs.stat(f.dir).then(() => true, () => false), false);
});

test('Claude sync preserves every unrelated setting, bypass and SOCKS keys and is idempotent', async (t) => {
  const original = { apiKey: 'keep-api', model: 'keep-model', mcpServers: { foo: { env: { token: 'keep-mcp' } } }, env: { ANTHROPIC_API_KEY: 'keep-env', ANTHROPIC_BASE_URL: 'https://private-gateway.invalid/private?token=keep-gateway-token', CLAUDE_CODE_USE_BEDROCK: '0', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_FOUNDRY: '0', NO_PROXY: 'localhost,.private', no_proxy: 'private.test', ALL_PROXY: 'socks5://localhost:1080', all_proxy: 'socks5://localhost:1081' } };
  const f = await fixture(t, { custom: true, settings: original });
  const before = await fs.readFile(f.settingsPath, 'utf8');
  const plan = await planClaudeSync({ env: f.env, context: context() });
  assert.equal(plan.allowed, true, JSON.stringify(plan));
  assert.equal(plan.changes.length, 4);
  assert.equal(plan.backups.length, 1);
  assert.doesNotMatch(JSON.stringify(plan), /keep-api|keep-model|keep-mcp|keep-env|keep-gateway-token|private-gateway|\.private/);
  const result = await syncClaudeSettings({ env: f.env, context: context(), confirmed: true, plan });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(await fs.readFile(result.backupPath, 'utf8'), before);
  const saved = await json(f.settingsPath);
  for (const key of keys) assert.equal(saved.env[key], proxy);
  for (const key of keys) delete saved.env[key];
  assert.deepEqual(saved, original);
  const entries = await fs.readdir(f.dir);
  const state = await json(f.statePath);
  assert.deepEqual(Object.keys(state.keys).sort(), [...keys].sort());
  const unchanged = await syncClaudeSettings({ env: f.env, context: context(), confirmed: true });
  assert.equal(unchanged.ok, true);
  assert.equal(unchanged.changed, false);
  assert.deepEqual(await fs.readdir(f.dir), entries);
  if (process.platform !== 'win32') {
    for (const file of [f.settingsPath, f.statePath, result.backupPath]) assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  }
  const inspected = await inspectClaude({ env: f.env, context: context(), run: cli });
  assert.equal(inspected.settings.status, 'match');
  assert.equal(inspected.settings.managed, true);
});

test('Claude plans redact proxy credentials and require explicit conflict acknowledgement', async (t) => {
  const old = 'http://alice:old-password@proxy.example:8080/private?token=old-secret';
  const target = 'http://bob:new-password@localhost:7890/private?token=new-secret';
  const f = await fixture(t, { settings: { env: { HTTPS_PROXY: old } } });
  const before = await fs.readFile(f.settingsPath, 'utf8');
  const plan = await planClaudeSync({ env: f.env, context: context(target) });
  assert.equal(plan.allowed, false);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].key, 'HTTPS_PROXY');
  assert.doesNotMatch(JSON.stringify(plan), /alice|bob|password|old-secret|new-secret|\/private/);
  assert.equal((await syncClaudeSettings({ env: f.env, context: context(target), confirmed: true, plan })).code, 'CONFLICT');
  assert.equal(await fs.readFile(f.settingsPath, 'utf8'), before);
  const accepted = await planClaudeSync({ env: f.env, context: context(target), acknowledgeConflicts: true });
  assert.equal(accepted.allowed, true);
  // A pre-approved plan cannot bypass acknowledgement on the actual write.
  assert.equal((await syncClaudeSettings({ env: f.env, context: context(target), confirmed: true, plan: accepted })).code, 'CONFLICT');
  const result = await syncClaudeSettings({ env: f.env, context: context(target), confirmed: true, acknowledgeConflicts: true, plan: accepted });
  assert.equal(result.ok, true);
  assert.doesNotMatch(JSON.stringify(result), /password|old-secret|new-secret/);
  assert.equal((await json(f.statePath)).keys.HTTPS_PROXY.previous.value, old);
  assert.equal((await uninstallClaudeSettings({ env: f.env, confirmed: true })).ok, true);
  assert.deepEqual(await json(f.settingsPath), { env: { HTTPS_PROXY: old } });
});

test('Claude rejects invalid JSON, non-object settings/env and invalid ownership without writes', async (t) => {
  for (const value of ['{ invalid-secret', 'null', '[]', '{"env":null}', '{"env":[]}', '{"env":"secret"}']) {
    const f = await fixture(t, { settings: value });
    const plan = await planClaudeSync({ env: f.env, context: context() });
    assert.equal(plan.allowed, false);
    const report = await inspectClaude({ env: f.env, context: context(), run: cli });
    assert.equal(report.settings.status, 'invalid');
    assert.doesNotMatch(JSON.stringify({ plan, report }), /invalid-secret|"secret"/);
    const result = await syncClaudeSettings({ env: f.env, context: context(), confirmed: true });
    assert.equal(result.ok, false);
    assert.equal(await fs.readFile(f.settingsPath, 'utf8'), value);
    assert.deepEqual(await fs.readdir(f.dir), ['settings.json']);
  }
  const f = await fixture(t, { settings: {} });
  await fs.writeFile(f.statePath, '{"version":1,"keys":{"API_KEY":"secret"}}');
  assert.equal((await syncClaudeSettings({ env: f.env, context: context(), confirmed: true })).code, 'INVALID_STATE');
  assert.equal((await uninstallClaudeSettings({ env: f.env, confirmed: true })).code, 'INVALID_STATE');
});

test('Claude diagnoses lowercase variants, SOCKS-only settings and changed ports', async (t) => {
  const f = await fixture(t, { settings: { env: { https_proxy: 'socks5://localhost:1080', ALL_PROXY: 'socks5://localhost:1080' } } });
  let report = await inspectClaude({ env: { ...f.env, http_proxy: 'socks5://localhost:1080' }, context: context(), run: cli });
  assert.equal(report.settings.socksOnly, true);
  assert.equal(report.processEnvironment.socksOnly, true);
  assert.equal(report.settings.status, 'mismatch');
  await f.put({ env: { https_proxy: proxy } });
  report = await inspectClaude({ env: { ...f.env, HTTPS_PROXY: proxy, https_proxy: 'http://localhost:7891' }, context: context(), run: cli });
  assert.equal(report.settings.status, 'match');
  assert.equal(report.processEnvironment.conflictingVariants, true);
  assert.equal(report.checks.find((item) => item.id === 'process-env').status, 'warn');
  report = await inspectClaude({ env: { ...f.env, https_proxy: proxy }, context: context('http://127.0.0.1:7891'), run: cli });
  assert.equal(report.settings.status, 'mismatch');
  assert.deepEqual(report.processEnvironment.conflicts, ['https_proxy']);
});

test('Claude stale settings, ownership and target plans cannot overwrite edits', async (t) => {
  const f = await fixture(t, { settings: { model: 'initial' } });
  const options = { env: f.env, context: context(), confirmed: true };
  let plan = await planClaudeSync(options);
  await f.put({ model: 'manual-edit' });
  assert.equal((await syncClaudeSettings({ ...options, plan })).code, 'STALE');
  assert.equal((await json(f.settingsPath)).model, 'manual-edit');
  plan = await planClaudeSync(options);
  assert.equal((await syncClaudeSettings({ ...options, plan, context: context('http://localhost:9999') })).code, 'STALE');
  await fs.writeFile(f.statePath, JSON.stringify({ version: 1, keys: {} }));
  assert.equal((await syncClaudeSettings({ ...options, plan })).code, 'STALE');
});

test('Claude serializes concurrent writers and does not remove unknown locks', async (t) => {
  const f = await fixture(t, { settings: {} });
  let entered;
  let release;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const io = { ...fs, rename: async (from, to) => {
    if (to === f.statePath) { entered(); await gate; }
    return fs.rename(from, to);
  } };
  const options = { env: f.env, context: context(), confirmed: true };
  const first = syncClaudeSettings({ ...options, io });
  await waiting;
  try { assert.equal((await syncClaudeSettings(options)).code, 'LOCKED'); }
  finally { release(); }
  assert.equal((await first).ok, true);
  const lockPath = path.join(f.dir, '.vpnctl-proxy.lock');
  await fs.writeFile(lockPath, 'unknown-lock');
  assert.equal((await uninstallClaudeSettings({ env: f.env, confirmed: true })).code, 'LOCKED');
  assert.equal(await fs.readFile(lockPath, 'utf8'), 'unknown-lock');
});

test('Claude compare-before-replace guards late manual edits and rolls back ownership', async (t) => {
  const f = await fixture(t, { settings: { model: 'before' } });
  const io = { ...fs, rename: async (from, to) => {
    await fs.rename(from, to);
    if (to === f.statePath) await f.put({ model: 'manual-edit' });
  } };
  const result = await syncClaudeSettings({ env: f.env, context: context(), confirmed: true, io });
  assert.equal(result.code, 'STALE');
  assert.deepEqual(await json(f.settingsPath), { model: 'manual-edit' });
  assert.equal(await fs.stat(f.statePath).then(() => true, () => false), false);
  assert.ok(!(await fs.readdir(f.dir)).some((name) => /\.tmp$|\.lock$/.test(name)));
});

test('Claude failed settings replacement restores old ownership and settings', async (t) => {
  const f = await fixture(t, { settings: { model: 'unchanged' } });
  assert.equal((await syncClaudeSettings({ env: f.env, context: context(), confirmed: true })).ok, true);
  const settingsBefore = await fs.readFile(f.settingsPath, 'utf8');
  const stateBefore = await fs.readFile(f.statePath, 'utf8');
  const io = { ...fs, rename: async (from, to) => {
    if (to === f.settingsPath) throw Object.assign(new Error('sensitive failure'), { code: 'EACCES' });
    return fs.rename(from, to);
  } };
  const result = await syncClaudeSettings({ env: f.env, context: context('http://localhost:7891'), confirmed: true, io });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'IO_ERROR');
  assert.doesNotMatch(JSON.stringify(result), /sensitive failure/);
  assert.equal(await fs.readFile(f.settingsPath, 'utf8'), settingsBefore);
  assert.equal(await fs.readFile(f.statePath, 'utf8'), stateBefore);
});

test('Claude uninstall restores original proxies after multiple port changes and preserves manual overrides', async (t) => {
  const original = { model: 'preserved', env: { HTTPS_PROXY: 'http://old-proxy:8080', NO_PROXY: 'private', ANTHROPIC_API_KEY: 'secret' } };
  const f = await fixture(t, { settings: original });
  const options = { env: f.env, confirmed: true };
  assert.equal((await syncClaudeSettings({ ...options, context: context(), acknowledgeConflicts: true })).ok, true);
  assert.equal((await syncClaudeSettings({ ...options, context: context('http://localhost:7891') })).ok, true);
  const manual = await json(f.settingsPath);
  manual.env.http_proxy = 'http://manual:9000';
  delete manual.env.https_proxy;
  manual.extra = 'manual-setting';
  await f.put(manual);
  const removed = await uninstallClaudeSettings(options);
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.restored.sort(), ['HTTP_PROXY', 'HTTPS_PROXY'].sort());
  assert.deepEqual(removed.preserved.sort(), ['http_proxy', 'https_proxy'].sort());
  assert.deepEqual(await json(f.settingsPath), { ...original, extra: 'manual-setting', env: { ...original.env, http_proxy: 'http://manual:9000' } });
  assert.equal(await fs.stat(f.statePath).then(() => true, () => false), false);
  const entries = await fs.readdir(f.dir);
  assert.equal((await uninstallClaudeSettings(options)).changed, false);
  assert.deepEqual(await fs.readdir(f.dir), entries);
});

test('Claude re-acknowledged manual proxy becomes new rollback value', async (t) => {
  const f = await fixture(t);
  const options = { env: f.env, confirmed: true, context: context() };
  await syncClaudeSettings(options);
  const manual = await json(f.settingsPath);
  manual.env.HTTP_PROXY = 'http://new-manual:8000';
  await f.put(manual);
  assert.equal((await syncClaudeSettings(options)).code, 'CONFLICT');
  assert.equal((await syncClaudeSettings({ ...options, acknowledgeConflicts: true })).ok, true);
  assert.equal((await uninstallClaudeSettings({ env: f.env, confirmed: true })).ok, true);
  assert.deepEqual(await json(f.settingsPath), { env: { HTTP_PROXY: 'http://new-manual:8000' } });
});

test('Claude uninstall does not recreate settings deleted by the user', async (t) => {
  const f = await fixture(t);
  await syncClaudeSettings({ env: f.env, context: context(), confirmed: true });
  await fs.unlink(f.settingsPath);
  const result = await uninstallClaudeSettings({ env: f.env, confirmed: true });
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.preserved.length, 4);
  assert.equal(await fs.stat(f.settingsPath).then(() => true, () => false), false);
  assert.equal(await fs.stat(f.statePath).then(() => true, () => false), false);
});

test('Claude uninstall ignores unrelated invalid settings when ownership is absent', async (t) => {
  for (const settings of ['{ invalid-private-settings', 'null', '{"env":null}']) {
    const f = await fixture(t, { settings });
    const entries = await fs.readdir(f.dir);
    const io = { ...fs, lstat: async (file) => {
      assert.notEqual(file, f.settingsPath, 'unmanaged uninstall must not inspect settings');
      return fs.lstat(file);
    }, open: async (file, ...args) => {
      assert.notEqual(file, f.settingsPath, 'unmanaged uninstall must not read settings');
      return fs.open(file, ...args);
    } };
    const result = await uninstallClaudeSettings({ env: f.env, confirmed: true, io });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.status, 'unmanaged');
    assert.equal(result.changed, false);
    assert.deepEqual(result.restored, []);
    assert.deepEqual(result.preserved, []);
    assert.equal(await fs.readFile(f.settingsPath, 'utf8'), settings);
    assert.deepEqual(await fs.readdir(f.dir), entries);
    assert.doesNotMatch(JSON.stringify(result), /invalid-private-settings/);
  }
});

test('Claude uninstall still blocks unsafe ownership with unrelated invalid settings', async (t) => {
  const f = await fixture(t, { settings: '{ unrelated-invalid-settings' });
  await fs.writeFile(f.statePath, '{"version":1,"keys":{}}');
  const io = { ...fs, lstat: async (file) => {
    const stat = await fs.lstat(file);
    if (file === f.statePath) stat.isSymbolicLink = () => true;
    return stat;
  } };
  const result = await uninstallClaudeSettings({ env: f.env, confirmed: true, io });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNSAFE_PATH');
  assert.equal(await fs.readFile(f.settingsPath, 'utf8'), '{ unrelated-invalid-settings');
  assert.equal(await fs.readFile(f.statePath, 'utf8'), '{"version":1,"keys":{}}');
});

test('Claude refuses symlinked settings, state and directory without touching targets', async (t) => {
  for (const kind of ['settings', 'state', 'directory']) {
    const f = await fixture(t, { settings: {} });
    const target = path.join(f.root, 'target');
    let link;
    if (kind === 'directory') {
      await fs.mkdir(target);
      await fs.writeFile(path.join(target, 'settings.json'), '{}');
      link = path.join(f.root, 'linked-config');
    } else {
      await fs.writeFile(target, '{}');
      link = kind === 'settings' ? f.settingsPath : f.statePath;
      if (kind === 'settings') await fs.unlink(link);
    }
    try { await fs.symlink(target, link, kind === 'directory' ? 'junction' : 'file'); }
    catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.diagnostic(`symlink ${kind}: unavailable on this platform`); continue; } throw error; }
    const env = kind === 'directory' ? { ...f.env, CLAUDE_CONFIG_DIR: link } : f.env;
    if (kind === 'settings') await fs.writeFile(f.statePath, '{"version":1,"keys":{}}');
    const report = await inspectClaude({ env, context: context(), run: cli });
    assert.equal(report.settings.status, 'invalid');
    assert.equal(report.settings.code, 'UNSAFE_PATH');
    assert.equal((await syncClaudeSettings({ env, context: context(), confirmed: true })).code, 'UNSAFE_PATH');
    assert.equal((await uninstallClaudeSettings({ env, confirmed: true })).code, 'UNSAFE_PATH');
    assert.equal(await fs.readFile(kind === 'directory' ? path.join(target, 'settings.json') : target, 'utf8'), '{}');
  }
});

test('Claude rejects hardlinked settings', async (t) => {
  const f = await fixture(t, { settings: {} });
  await fs.link(f.settingsPath, path.join(f.root, 'linked-settings'));
  assert.equal((await planClaudeSync({ env: f.env, context: context() })).code, 'UNSAFE_PATH');
  assert.equal((await syncClaudeSettings({ env: f.env, context: context(), confirmed: true })).code, 'UNSAFE_PATH');
});

test('Claude rejects symlink file metadata even when native file symlinks are unavailable', async (t) => {
  for (const name of ['settingsPath', 'statePath']) {
    const f = await fixture(t, { settings: {} });
    await fs.writeFile(f.statePath, '{"version":1,"keys":{}}');
    const io = { ...fs, lstat: async (file) => {
      const stat = await fs.lstat(file);
      if (file === f[name]) stat.isSymbolicLink = () => true;
      return stat;
    } };
    assert.equal((await planClaudeSync({ env: f.env, context: context(), io })).code, 'UNSAFE_PATH');
    assert.equal((await inspectClaude({ env: f.env, context: context(), run: cli, io })).settings.code, 'UNSAFE_PATH');
    assert.equal((await syncClaudeSettings({ env: f.env, context: context(), confirmed: true, io })).code, 'UNSAFE_PATH');
    assert.equal((await uninstallClaudeSettings({ env: f.env, confirmed: true, io })).code, 'UNSAFE_PATH');
  }
});

test('Claude plan for a missing file is stale if another writer creates it', async (t) => {
  const f = await fixture(t);
  const plan = await planClaudeSync({ env: f.env, context: context() });
  await f.put({ model: 'created-manually' });
  assert.equal((await syncClaudeSettings({ env: f.env, context: context(), confirmed: true, plan })).code, 'STALE');
  assert.deepEqual(await json(f.settingsPath), { model: 'created-manually' });
});

test('Claude partial private-file write failure cleans up and never changes settings', async (t) => {
  const f = await fixture(t, { settings: { model: 'original' } });
  const io = { ...fs, open: async (file, ...args) => {
    const handle = await fs.open(file, ...args);
    if (file.endsWith('.tmp')) handle.sync = async () => { throw new Error('private-file-failure'); };
    return handle;
  } };
  const result = await syncClaudeSettings({ env: f.env, context: context(), confirmed: true, io });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'IO_ERROR');
  assert.deepEqual(await json(f.settingsPath), { model: 'original' });
  assert.equal(await fs.stat(f.statePath).then(() => true, () => false), false);
  assert.ok(!(await fs.readdir(f.dir)).some((name) => /\.tmp$|\.lock$/.test(name)));
});

test('Claude rejects wrong-owner files on Linux using mock metadata only', { skip: process.platform !== 'linux' }, async (t) => {
  const f = await fixture(t, { settings: {} });
  const io = { ...fs, lstat: async (file) => {
    const stat = await fs.lstat(file);
    if (file === f.settingsPath) stat.uid = process.getuid() + 1;
    return stat;
  } };
  assert.equal((await planClaudeSync({ env: f.env, context: context(), io })).code, 'WRONG_OWNER');
  assert.equal((await inspectClaude({ env: f.env, run: cli, io })).settings.code, 'WRONG_OWNER');
});
