import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { launchIntegratedApplication, formatActionPreview, formatIntegrationReport } from '../src/integrate.mjs';
import { buildApplicationEnvironment, runCli } from '../src/lib/integrations/runtime.mjs';
import { executeIntegrationAction, inspectIntegration } from '../src/lib/integrations/index.mjs';
import { prepareClaudeProviderAction, executeClaudeProviderAction } from '../src/lib/integrations/claude-providers.mjs';

const context = { available: true, httpProxy: 'http://127.0.0.1:23456', displayProxy: 'http://127.0.0.1:23456', proxyMode: 'mix', env: buildApplicationEnvironment('http://127.0.0.1:23456', { NO_PROXY: 'localhost,.internal', ANTHROPIC_BASE_URL: 'https://gateway.example.com' }), checks: [] };

test('ordinary Claude and independent Codex launches receive HTTP proxy without touching daemon or global environment', async () => {
  const before = structuredClone(process.env);
  for (const [app, args] of [['claude', []], ['codex', ['--no-daemon']], ['codex', ['login', '--device-auth']]]) {
    const result = await launchIntegratedApplication(app, args, { context, resolveClaudeEnvironment: async ({ env }) => ({ ...env }), inspect: async () => { throw new Error('must not inspect daemon for explicit subcommands'); }, spawnApp: (command, forwarded, options) => {
      assert.equal(command, app);
      assert.deepEqual(forwarded, args);
      assert.equal(options.shell, false);
      assert.equal(options.stdio, 'inherit');
      assert.equal(options.env.HTTPS_PROXY, context.httpProxy);
      assert.equal(options.env.ALL_PROXY, undefined);
      assert.equal(options.env.NO_PROXY, 'localhost,.internal');
      assert.equal(options.env.ANTHROPIC_BASE_URL, 'https://gateway.example.com');
      const child = new EventEmitter();
      setTimeout(() => child.emit('close', 0), 0);
      return child;
    } });
    assert.equal(result.code, 0);
  }
  assert.deepEqual({ ...process.env }, before);
});

test('interactive Codex diagnoses before launch but never automatically repairs or restarts', async () => {
  const calls = [];
  await launchIntegratedApplication('codex', [], { context, inspect: async () => { calls.push('inspect'); return { checks: [], daemon: {} }; }, spawnApp: () => {
    calls.push('spawn'); const child = new EventEmitter(); setTimeout(() => child.emit('close', 0), 0); return child;
  } });
  assert.deepEqual(calls, ['inspect', 'spawn']);
});

test('Claude wrapper uses the active managed API account and the current dynamic network proxy', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vpnctl-claude-launch-'));
  try {
    const env = { HOME: home, CLAUDE_CONFIG_DIR: home, ...buildApplicationEnvironment('http://127.0.0.1:34567', { ANTHROPIC_BASE_URL: 'https://stale.example.com', ANTHROPIC_AUTH_TOKEN: 'stale-fixture', NO_PROXY: '.internal' }) };
    const input = { name: '启动测试', baseUrl: 'https://active.example.com', authType: 'api-key', secret: 'active-fixture' };
    const save = await prepareClaudeProviderAction('save', { env, input });
    const saved = await executeClaudeProviderAction(save, { env, input, confirmed: true });
    const apply = await prepareClaudeProviderAction('apply', { env, id: saved.id, context });
    await executeClaudeProviderAction(apply, { env, confirmed: true, context });
    await launchIntegratedApplication('claude', [], { context: { ...context, env }, spawnApp: (_command, _args, options) => {
      assert.equal(options.env.ANTHROPIC_BASE_URL, 'https://active.example.com');
      assert.equal(options.env.ANTHROPIC_API_KEY, 'active-fixture');
      assert.equal(options.env.ANTHROPIC_AUTH_TOKEN, undefined);
      assert.equal(options.env.HTTPS_PROXY, 'http://127.0.0.1:34567');
      assert.equal(options.env.NO_PROXY, '.internal');
      const child = new EventEmitter(); setTimeout(() => child.emit('close', 0), 0); return child;
    } });
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});

test('offline proxy blocks app launch but not read-only version/help', async () => {
  await assert.rejects(launchIntegratedApplication('claude', [], { context: { ...context, available: false } }), /代理不可用/);
  const result = await launchIntegratedApplication('claude', ['--version'], { context: { ...context, available: false }, spawnApp: () => {
    const child = new EventEmitter(); setTimeout(() => child.emit('close', 0), 0); return child;
  } });
  assert.equal(result.code, 0);
});

test('integration action rejects stale port and missing consent before executing adapters', async () => {
  const prepared = { app: 'codex', action: 'repair', proxy: context.displayProxy, plan: { allowed: true } };
  await assert.rejects(executeIntegrationAction(prepared, { context }), /确认/);
  await assert.rejects(executeIntegrationAction(prepared, { confirmed: true, context: { ...context, displayProxy: 'http://127.0.0.1:34567' } }), /端口已改变/);
  await assert.rejects(executeIntegrationAction(prepared, { confirmed: true, context: { ...context, available: false } }), /不可用/);
});

test('diagnosis and previews are redacted and do not imply authentication from an HTTP response', () => {
  const proxy = 'http://user:example-password@127.0.0.1:23456';
  const text = formatActionPreview({ app: 'claude', proxy, plan: { allowed: true, changes: [{ key: 'HTTPS_PROXY', before: proxy, after: 'http://127.0.0.1:23456' }], warnings: ['后台环境未验证'] } });
  assert.ok(!text.includes('example-password'));
  const report = formatIntegrationReport({ app: 'codex', installed: true, checks: [{ status: 'unknown', label: '账号认证未验证', detail: 'HTTP 401 不等于登录成功' }] });
  assert.match(report, /未验证/);
});

test('TUI repair confirmation describes execution rather than a suggestion-only preview', () => {
  const prepared = { app: 'codex', action: 'repair', plan: { allowed: true, steps: [
    { label: '停止本账户 Codex 守护进程' }, { label: '从当前 CLI 更新受管 Codex 包' }, { label: '使用 VPNCTL 应用环境启动守护进程' }
  ] } };
  const confirmation = formatActionPreview(prepared, { confirmation: true });
  assert.match(confirmation, /^Codex Daemon 修复确认/);
  assert.ok(!confirmation.includes('预览'));
  assert.match(confirmation, /1\. 停止.*\n2\. 从当前 CLI 更新.*\n3\. 使用 VPNCTL/);
  assert.match(formatActionPreview(prepared), /^Codex Daemon 修复预览/);
});

test('integration CLI doctor and dry-run work in an empty user home without installed apps or writes', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vpnctl-integration-cli-'));
  const server = http.createServer((request, response) => { response.setHeader('Content-Type', 'application/json'); response.end('{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const env = { ...process.env, HOME: home, CODEX_HOME: path.join(home, 'codex'), CLAUDE_CONFIG_DIR: path.join(home, 'claude'), VPNCTL_MODE: 'user', MIHOMO_API: `http://127.0.0.1:${server.address().port}`, PATH: home };
    delete env.Path;
    const entry = fileURLToPath(new URL('../src/index.mjs', import.meta.url));
    for (const app of ['codex', 'claude']) {
      const output = await runCli(process.execPath, [entry, 'integrate', app, 'doctor', '--json'], { env });
      assert.equal(output.ok, true, output.stderr);
      const report = JSON.parse(output.stdout);
      assert.equal(report.app, app);
      assert.equal(report.installed, false);
      assert.equal(report.proxy.available, false);
      assert.ok(!Object.hasOwn(report, 'env'));
      assert.ok(report.checks.some(check => check.id === 'authentication' && check.status === 'unknown'));
      const preview = await runCli(process.execPath, [entry, 'integrate', app, app === 'codex' ? 'repair' : 'sync', '--dry-run'], { env });
      assert.equal(preview.ok, true, preview.stderr);
      assert.match(preview.stdout, /不满足执行条件/);
      const refused = await runCli(process.execPath, [entry, 'integrate', app, app === 'codex' ? 'repair' : 'sync'], { env });
      assert.equal(refused.code, 1, 'a refused mutation must not report success to automation');
    }
    assert.deepEqual(await fs.readdir(home), []);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('custom Claude gateways suppress unrelated public Anthropic network probes', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vpnctl-gateway-'));
  try {
    const report = await inspectIntegration('claude', { context, network: true, env: { CLAUDE_CONFIG_DIR: home, ANTHROPIC_BASE_URL: 'https://gateway.example.com/private' }, run: async (command) => {
      assert.equal(command, 'claude', 'must not invoke curl against the default service');
      return { ok: true, stdout: '1.2.3' };
    } });
    assert.ok(report.checks.some(check => check.id === 'network' && check.status === 'unknown'));
    assert.ok(!JSON.stringify(report).includes('/private'));
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});
