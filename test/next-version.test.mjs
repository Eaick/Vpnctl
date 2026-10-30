import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseSubscriptionUserinfo, subscriptionInfoLines } from '../src/lib/subscription-info.mjs';
import { endpointUrl } from '../src/lib/endpoints.mjs';
import { readApplicationPolicy, setApplicationProxy, resolveApplicationContext } from '../src/lib/integrations/app-policy.mjs';
import { probeApplicationService } from '../src/lib/integrations/runtime.mjs';
import { listCodexProviders, editCodexProvider, codexProviderLaunch, isolateCodexApiLaunch } from '../src/lib/integrations/codex-providers.mjs';
import { readClaudeRequests, recordClaudeRequest } from '../src/lib/integrations/claude-monitor.mjs';
import { setIpv6Enabled } from '../src/lib/network-settings.mjs';

test('IPv6 settings restore the previous configuration if runtime application fails', async () => {
  const config = { installState: { ipv6: false }, ipv6: false };
  const saved = [], written = [];
  await assert.rejects(setIpv6Enabled(true, { confirmed: true, config,
    save: async (_config, state) => saved.push(state.ipv6),
    write: async config => written.push(config.ipv6),
    apply: async config => { if (config.ipv6) throw new Error('fixture-runtime-error'); }
  }), /已恢复旧配置/);
  assert.deepEqual(saved, [true, false]);
  assert.deepEqual(written, [true, false]);
});

test('request monitoring persists only counts and timings in the isolated Claude directory', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vpnctl-monitor-'));
  const env = { HOME: home, CLAUDE_CONFIG_DIR: home };
  try {
    await recordClaudeRequest({ protocol: 'openai-chat', status: 200, durationMs: 45, firstByteMs: 10,
      inputTokens: 5, outputTokens: 6, prompt: 'private-prompt-fixture', secret: 'private-key-fixture' }, { env });
    const rows = await readClaudeRequests({ env });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outputTokens, 6);
    assert.ok(!JSON.stringify(rows).includes('private-'));
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});

test('Codex accounts switch keys without exposing them in arguments or modifying login files', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vpnctl-codex-api-'));
  const env = { HOME: home, CODEX_HOME: home };
  try {
    await fs.writeFile(path.join(home, 'auth.json'), 'existing-login-fixture');
    const saved = await editCodexProvider('save', { env, confirmed: true, input: {
      name: '测试接口', baseUrl: 'https://api.example.com/v1', model: 'model-fixture', secret: 'fixture-codex-key'
    } });
    await editCodexProvider('apply', { env, confirmed: true, id: saved.id });
    const listing = await listCodexProviders({ env });
    assert.ok(!JSON.stringify(listing).includes('fixture-codex-key'));
    const launched = await codexProviderLaunch(['exec', 'hello'], { env });
    assert.equal(launched.env.VPNCTL_CODEX_API_KEY, 'fixture-codex-key');
    assert.ok(!launched.args.join(' ').includes('fixture-codex-key'));
    assert.ok(launched.args.includes('model_provider="vpnctl_api"'));
    const isolated = await isolateCodexApiLaunch(launched, { run: async () => ({ ok: true, stdout: 'Options: --no-daemon' }) });
    assert.equal(isolated.args[0], '--no-daemon');
    await assert.rejects(isolateCodexApiLaunch(launched, { run: async () => ({ ok: true, stdout: 'daemon commands' }) }), /独立启动/);
    assert.deepEqual((await codexProviderLaunch(['login'], { env })).args, ['login']);
    await editCodexProvider('save', { env, confirmed: true, input: {
      id: saved.id, name: '测试接口', baseUrl: 'https://api.example.com/v1', model: 'updated-model', secret: ''
    } });
    assert.equal((await codexProviderLaunch([], { env })).env.VPNCTL_CODEX_API_KEY, 'fixture-codex-key');
    await editCodexProvider('delete', { env, confirmed: true, id: saved.id });
    assert.equal((await listCodexProviders({ env })).profiles.length, 0);
    assert.deepEqual((await codexProviderLaunch(['exec'], { env })).args, ['exec']);
    assert.equal(await fs.readFile(path.join(home, 'auth.json'), 'utf8'), 'existing-login-fixture');
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});

test('subscription quota accepts partial headers and handles invalid expiry without breaking display', () => {
  const info = parseSubscriptionUserinfo('UPLOAD=1024; download=512; total=4096; expire=999999999999', '2026-01-01');
  assert.equal(info.upload, 1024);
  assert.equal(info.download, 512);
  assert.match(subscriptionInfoLines({ subscriptionInfo: info }).join('\n'), /未提供有效到期时间/);
  assert.equal(parseSubscriptionUserinfo('upload=bad; other=12'), null);
  assert.equal(parseSubscriptionUserinfo('upload=0').upload, 0);
});

test('direct connection diagnostics do not configure a proxy', async () => {
  const result = await probeApplicationService('codex', { available: true, proxyEnabled: false, env: {} }, {
    run: async (_command, _args, { input }) => {
      assert.match(input, /noproxy = "\*"/);
      assert.doesNotMatch(input, /\nproxy =/);
      return { ok: true, stdout: '200' };
    }
  });
  assert.match(result.detail, /直接联网/);
});

test('IPv6 endpoint URLs include brackets exactly once', () => {
  assert.equal(endpointUrl('http', '::1', 9090), 'http://[::1]:9090');
  assert.equal(endpointUrl('http', '[::1]', 9090), 'http://[::1]:9090');
});

test('application proxy settings stay independent and direct mode removes inherited proxies', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vpnctl-app-policy-'));
  const env = { HOME: home, HTTP_PROXY: 'http://127.0.0.1:1234', NO_PROXY: 'localhost' };
  try {
    assert.equal((await readApplicationPolicy('codex', { env })).enabled, true);
    await setApplicationProxy('claude', false, { env, confirmed: true });
    assert.equal((await readApplicationPolicy('codex', { env })).enabled, true);
    assert.equal((await readApplicationPolicy('claude', { env })).enabled, false);
    const context = await resolveApplicationContext('claude', { env });
    assert.equal(context.proxyEnabled, false);
    assert.equal(context.env.HTTP_PROXY, undefined);
    assert.equal(context.env.NO_PROXY, 'localhost');
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});
