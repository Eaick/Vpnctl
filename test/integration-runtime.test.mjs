import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createConfig } from '../src/lib/config.mjs';
import { buildApplicationEnvironment, resolveApplicationProxy, redactText, runCli, inspectUserProcess, probeApplicationService } from '../src/lib/integrations/runtime.mjs';

test('application environments use current HTTP ports without mutating the shell or bypass rules', () => {
  const original = { HTTP_PROXY: 'http://old.invalid:1234', ALL_PROXY: 'socks5://old.invalid:1234', all_proxy: 'old', NO_PROXY: 'localhost,.internal', no_proxy: 'example.internal', ANTHROPIC_BASE_URL: 'https://gateway.example.com', PATH: 'example' };
  const snapshot = structuredClone(original);
  for (const url of ['http://127.0.0.1:23456', 'http://127.0.0.1:23457']) {
    const env = buildApplicationEnvironment(url, original);
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) assert.equal(env[key], url);
    assert.equal(env.ALL_PROXY, undefined);
    assert.equal(env.all_proxy, undefined);
    assert.equal(env.NO_PROXY, original.NO_PROXY);
    assert.equal(env.no_proxy, original.no_proxy);
    assert.equal(env.ANTHROPIC_BASE_URL, original.ANTHROPIC_BASE_URL);
  }
  assert.deepEqual(original, snapshot);
});

test('managed identity and TCP connectivity are required before using any application proxy', async () => {
  for (const mode of ['mix', 'separate']) {
    const config = { proxyMode: mode, httpProxy: 'http://127.0.0.1:23456' };
    let probes = 0;
    const ready = await resolveApplicationProxy({ config, env: {}, getStatus: async () => ({ managedApiAlive: true }), probe: async (url) => { assert.equal(url, config.httpProxy); probes++; return true; } });
    assert.equal(ready.available, true);
    assert.equal(ready.env.HTTPS_PROXY, config.httpProxy);
    const foreign = await resolveApplicationProxy({ config, env: {}, getStatus: async () => ({ foreignApiAlive: true }), probe: async () => { probes++; return true; } });
    assert.equal(foreign.available, false);
    assert.equal(probes, 1);
    const blocked = await resolveApplicationProxy({ config, env: {}, getStatus: async () => ({ managedApiAlive: true }), probe: async () => false });
    assert.equal(blocked.available, false);
  }
});

test('diagnostics redact URL credentials and common credential fields', () => {
  const safe = redactText('https://test-user:test-password@example.com/?token=test-private-token authorization=Bearer example-token api_key=example-key');
  for (const secret of ['test-user', 'test-password', 'test-private-token', 'example-token', 'example-key']) assert.ok(!safe.includes(secret));
});

test('an unresponsive runtime API does not hang application proxy diagnostics', async () => {
  let signal;
  const result = await resolveApplicationProxy({ config: { proxyMode: 'mix', httpProxy: 'http://127.0.0.1:23456' }, env: {}, timeoutMs: 20,
    getStatus: async (config, options) => { signal = options.signal; return new Promise(() => {}); },
    probe: async () => { throw new Error('unverified runtime must not be used'); }
  });
  assert.equal(result.available, false);
  assert.equal(signal.aborted, true);
});

test('runtime probe timeout aborts a real hanging local HTTP request', async () => {
  const server = http.createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const config = { ...createConfig('user'), mihomoApi: `http://127.0.0.1:${server.address().port}` };
    const result = await resolveApplicationProxy({ config, timeoutMs: 50 });
    assert.equal(result.available, false);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('runner bounds missing executables and timeouts without invoking a shell', async () => {
  const missing = await runCli('vpnctl-test-missing-executable-0000', [], { env: {}, timeoutMs: 1000 });
  assert.equal(missing.missing, true);
  const result = await runCli(process.execPath, ['-e', 'process.stdout.write(process.env.VPNCTL_FIXTURE)'], { env: { ...process.env, VPNCTL_FIXTURE: 'isolated' } });
  assert.equal(result.stdout, 'isolated');
  const timed = await runCli(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeoutMs: 50 });
  assert.equal(timed.timedOut, true);
  assert.equal(timed.ok, false);
});

test('process inspection rejects other users and CODEX_HOME instances and exposes proxy fields only', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vpnctl-proc-fixture-'));
  try {
    const root = path.join(temp, '12345');
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'cmdline'), '/opt/example/codex\0app-server\0');
    const home = path.join(temp, 'home');
    await fs.writeFile(path.join(root, 'environ'), `CODEX_HOME=${home}\0HTTPS_PROXY=http://127.0.0.1:23456\0OPENAI_API_KEY=example-secret\0`);
    const uid = (await fs.stat(root)).uid;
    const match = await inspectUserProcess(12345, { procRoot: temp, platform: 'linux', uid, expectedHome: home });
    assert.equal(match.owned, true);
    assert.equal(match.environment.HTTPS_PROXY, 'http://127.0.0.1:23456');
    assert.equal(match.environment.OPENAI_API_KEY, undefined);
    assert.equal(match.activeTasks, 'unknown');
    assert.equal((await inspectUserProcess(12345, { procRoot: temp, platform: 'linux', uid: uid + 1 })).owned, false);
    assert.equal((await inspectUserProcess(12345, { procRoot: temp, platform: 'linux', uid, expectedHome: `${home}-other` })).owned, false);
    assert.equal((await inspectUserProcess(-1, { procRoot: temp, platform: 'linux', uid })).owned, false);
    await fs.writeFile(path.join(root, 'cmdline'), '/usr/bin/python\0/opt/example/codex\0app-server\0');
    assert.equal((await inspectUserProcess(12345, { procRoot: temp, platform: 'linux', uid, expectedHome: home })).owned, false);
    await fs.writeFile(path.join(root, 'cmdline'), '/opt/example/codex\0app-server\0');
    await fs.writeFile(path.join(root, 'environ'), 'HTTPS_PROXY=http://127.0.0.1:23456\0');
    assert.equal((await inspectUserProcess(12345, { procRoot: temp, platform: 'linux', uid, expectedHome: home, env: { HOME: home } })).owned, false);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('service probes do not equate HTTP 401 with authentication and keep credentials out of argv', async () => {
  const context = { available: true, httpProxy: 'http://user:example-password@127.0.0.1:23456', env: {} };
  const check = await probeApplicationService('codex', context, { run: async (command, args, options) => {
    assert.equal(command, 'curl');
    assert.deepEqual(args, ['--config', '-']);
    assert.ok(options.input.includes(context.httpProxy));
    return { ok: true, stdout: '401' };
  } });
  assert.equal(check.status, 'ok');
  assert.match(check.detail, /不代表登录/);
  assert.ok(!JSON.stringify(check).includes('example-password'));
  const skipped = await probeApplicationService('claude', { available: false }, { run: async () => { throw new Error('must not run'); } });
  assert.equal(skipped.status, 'unknown');
});
