import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { inspectCodexAccount, normalizeCodexAccount, normalizeCodexLimits, openCodexReadSession } from '../src/lib/integrations/codex-account.mjs';
import { inspectIntegration } from '../src/lib/integrations/index.mjs';

const context = { available: true, httpProxy: 'http://127.0.0.1:23456', env: { HOME: '/home/fixture', CODEX_HOME: '/home/fixture/codex-custom', HTTPS_PROXY: 'http://127.0.0.1:23456', NO_PROXY: 'localhost,.internal' } };
const accountResult = { account: { type: 'chatgpt', email: 'user@example.com', planType: 'plus', token: 'fixture-private-token' }, requiresOpenaiAuth: true };
const limitResult = {
  rateLimits: { limitId: 'codex', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 4102444800 }, secondary: { usedPercent: 70, windowDurationMins: 10080, resetsAt: 4102444800 } },
  rateLimitResetCredits: { availableCount: 2, credits: [{ id: 'private-reset-id', title: 'fixture-secret' }] }
};

function fixture({ account = accountResult, limits = limitResult, changedAccount, rejectLimits = false } = {}) {
  const calls = [];
  let reads = 0, closed = false;
  return {
    calls, isClosed: () => closed,
    options: { context, run: async (command, args, settings) => {
      assert.equal(command, 'codex'); assert.deepEqual(args, ['app-server', '--help']);
      assert.equal(settings.env.CODEX_HOME, context.env.CODEX_HOME);
      return { ok: true, stdout: 'Options:\n --listen <LISTEN>' };
    }, openSession: settings => {
      assert.equal(settings.env.HTTPS_PROXY, context.httpProxy);
      return {
        request: async (method, params) => {
          calls.push({ method, params });
          if (method === 'initialize') return {};
          if (method === 'account/read') { reads++; return reads > 1 && changedAccount ? changedAccount : account; }
          if (method === 'account/rateLimits/read') {
            if (rejectLimits) throw Object.assign(new Error('fixture-private-token'), { code: 'UNSUPPORTED' });
            return limits;
          }
          throw new Error('unapproved RPC');
        }, initialized: () => calls.push({ method: 'initialized' }), close: async () => { closed = true; }
      };
    } }
  };
}

test('account and quota reads expose a masked identity, actual windows and authoritative reset count only', async () => {
  const f = fixture();
  const result = await inspectCodexAccount(f.options);
  assert.equal(result.account.identity, 'u***@example.com');
  assert.equal(result.account.planType, 'plus');
  assert.equal(result.quota.buckets[0].primary.windowDurationMins, 300);
  assert.equal(result.quota.buckets[0].secondary.windowDurationMins, 10080);
  assert.equal(result.quota.resetCreditsAvailable, 2);
  assert.equal(f.isClosed(), true);
  assert.deepEqual(f.calls.map(call => call.method), ['initialize', 'initialized', 'account/read', 'account/rateLimits/read', 'account/read']);
  assert.ok(f.calls.filter(call => call.method === 'account/read').every(call => call.params.refreshToken === false));
  assert.doesNotMatch(JSON.stringify(result), /user@example|fixture-private-token|private-reset-id|fixture-secret/);
});

test('missing allowance, reset count and credits are not invented or converted into zero', () => {
  const result = normalizeCodexLimits({ rateLimits: { primary: null, secondary: null } });
  assert.equal(result.resetCreditsAvailable, null);
  assert.equal(result.buckets[0].primary, null);
  assert.equal(result.buckets[0].credits, null);
  assert.equal(normalizeCodexLimits({ rateLimits: null, rateLimitResetCredits: { availableCount: 0 } }).resetCreditsAvailable, 0);
  assert.equal(normalizeCodexLimits({ rateLimits: null, rateLimitResetCredits: { credits: [{ status: 'available' }] } }).resetCreditsAvailable, null);
});

test('multi-bucket limits retain their independent windows without treating primary as five hours', () => {
  const result = normalizeCodexLimits({ rateLimits: limitResult.rateLimits, rateLimitsByLimitId: {
    codex_other: { primary: { usedPercent: 42, windowDurationMins: 60, resetsAt: null } },
    codex: { primary: { usedPercent: 5, windowDurationMins: 15, resetsAt: 4102444800 }, credits: { balance: '12.34', unlimited: false, apiKey: 'fixture-secret' } }
  } });
  assert.deepEqual(result.buckets.map(bucket => bucket.id), ['codex', 'codex_other']);
  assert.equal(result.buckets[0].primary.windowDurationMins, 15);
  assert.equal(result.buckets[1].primary.windowDurationMins, 60);
  assert.equal(result.buckets[0].credits.balance, '12.34');
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|apiKey/);
});

test('malformed fields remain unavailable and raw tokens or terminal control codes never escape', () => {
  for (const value of [null, [], {}, { account: 'private-token' }]) assert.equal(normalizeCodexAccount(value).status, 'unverified');
  const result = normalizeCodexAccount({ ...accountResult, account: { ...accountResult.account, email: '\x1b]0;private-token\x07@example.com', planType: 'private-token' } });
  assert.equal(result.identity, null);
  assert.equal(result.planType, null);
  const quota = normalizeCodexLimits({ rateLimits: { primary: { usedPercent: '99', windowDurationMins: -1, resetsAt: 'private-token' }, credits: { balance: 'private-token' } }, rateLimitResetCredits: { availableCount: -1 } });
  assert.deepEqual(quota.buckets[0].primary, { usedPercent: null, windowDurationMins: null, resetsAt: null });
  assert.equal(quota.resetCreditsAvailable, null);
  assert.equal(quota.buckets[0].credits.balance, null);
  for (const invalid of [{ rateLimits: 'private-token' }, { rateLimits: [] }, { rateLimitsByLimitId: { codex: 'private-token' } }]) {
    const result = normalizeCodexLimits(invalid);
    assert.equal(result.status, 'unverified');
    assert.doesNotMatch(JSON.stringify(result), /private-token/);
  }
});

test('API key, signed-out and non-OpenAI accounts never query ChatGPT quotas or cash balance', async () => {
  for (const account of [
    { account: { type: 'apiKey', apiKey: 'fixture-private-token' }, requiresOpenaiAuth: true },
    { account: null, requiresOpenaiAuth: true },
    { account: null, requiresOpenaiAuth: false },
    { account: { type: 'amazonBedrock' }, requiresOpenaiAuth: false }
  ]) {
    const f = fixture({ account });
    const result = await inspectCodexAccount(f.options);
    assert.equal(result.quota.resetCreditsAvailable, null);
    assert.ok(!f.calls.some(call => call.method === 'account/rateLimits/read'));
    assert.doesNotMatch(JSON.stringify(result), /fixture-private-token/);
    assert.ok(f.isClosed());
  }
});

test('an unavailable proxy never starts an account diagnostic subprocess', async () => {
  const result = await inspectCodexAccount({ context: { available: false }, run: async () => { throw new Error('must not run'); }, openSession: () => { throw new Error('must not spawn'); } });
  assert.equal(result.quota.status, 'unverified');
});

test('unsupported or failed limits preserve the local identity but never report authenticated quota success', async () => {
  const f = fixture({ rejectLimits: true });
  const result = await inspectCodexAccount(f.options);
  assert.equal(result.account.identity, 'u***@example.com');
  assert.equal(result.quota.status, 'unverified');
  assert.doesNotMatch(JSON.stringify(result), /fixture-private-token/);
  assert.ok(f.isClosed());
});

test('switching between accounts with identical masked emails discards the sampled limits', async () => {
  const f = fixture({ changedAccount: { ...accountResult, account: { ...accountResult.account, email: 'unrelated@example.com' } } });
  const result = await inspectCodexAccount(f.options);
  assert.equal(result.account.identity, undefined);
  assert.equal(result.quota.status, 'unverified');
  assert.deepEqual(result.quota.buckets, []);
  assert.match(result.quota.detail, /账号发生变化/);
});

test('the management report includes account quotas only when explicitly requested and never infers them from HTTP 401', async () => {
  const f = fixture();
  const run = async (command, args) => {
    if (command === 'curl') return { ok: true, stdout: '401' };
    if (args[0] === '--version') return { ok: true, stdout: 'codex-cli 0.162.1' };
    if (args.join(' ') === 'app-server daemon --help') return { ok: false, stderr: '' };
    if (args.join(' ') === 'app-server --help') return { ok: true, stdout: '--listen <LISTEN>' };
    throw new Error('unexpected command');
  };
  const ordinary = await inspectIntegration('codex', { context, run, openSession: () => { throw new Error('must not open'); }, network: true });
  assert.equal(ordinary.account, undefined);
  assert.ok(ordinary.checks.some(check => check.id === 'authentication' && check.status === 'unknown'));
  const full = await inspectIntegration('codex', { context, run, openSession: f.options.openSession, account: true, network: true });
  assert.equal(full.account.identity, 'u***@example.com');
  assert.equal(full.quota.resetCreditsAvailable, 2);
  assert.ok(full.checks.some(check => check.id === 'authentication' && check.status === 'ok'));
});

const fakeServer = `
  import readline from 'node:readline';
  const reader = readline.createInterface({ input: process.stdin });
  const reply = obj => process.stdout.write(JSON.stringify(obj) + '\\n');
  let initialized = false;
  reader.on('line', line => {
    const m = JSON.parse(line);
    if (process.env.VPNCTL_FIXTURE_MODE === 'hang') return;
    if (m.method === 'initialize') {
      reply({ method: 'fixture/notification', params: { token: 'private-notification' } });
      process.stderr.write('private-stderr');
      reply({ id: m.id, result: {} });
    } else if (m.method === 'initialized') initialized = true;
    else if (m.method === 'account/read') {
      if (!initialized || m.params.refreshToken !== false) process.exit(3);
      reply({ id: m.id, result: { account: { type: 'chatgpt', email: 'user@example.com', planType: 'plus' }, requiresOpenaiAuth: true } });
    } else if (m.method === 'account/rateLimits/read') {
      reply({ id: 99, method: 'account/chatgptAuthTokens/refresh', params: { accessToken: 'private-token' } });
      reply({ id: m.id, result: { rateLimits: null, rateLimitResetCredits: { availableCount: 0 } } });
    } else if (m.id === 99 && m.error?.code === -32601) { }
    else process.exit(4);
  });
`;

test('real stdio JSONL transport performs the handshake and cleans up only its temporary read-only child', async () => {
  let child, spawned = 0;
  const result = await inspectCodexAccount({ context, run: async () => ({ ok: true, stdout: '--listen <LISTEN>' }), spawnServer: (command, args, options) => {
    assert.equal(command, 'codex');
    assert.deepEqual(args, ['app-server', '--listen', 'stdio://']);
    assert.equal(options.shell, false);
    assert.equal(options.env.CODEX_HOME, context.env.CODEX_HOME);
    spawned++;
    child = spawn(process.execPath, ['--input-type=module', '-e', fakeServer], { ...options, env: { ...process.env, ...options.env } });
    return child;
  } });
  assert.equal(spawned, 1);
  assert.equal(result.account.identity, 'u***@example.com');
  assert.equal(result.quota.resetCreditsAvailable, 0);
  assert.equal(child.exitCode, 0);
  assert.doesNotMatch(JSON.stringify(result), /private-notification|private-stderr|private-token/);
});

test('metadata transport rejects all mutation and conversation methods before sending them', async () => {
  const session = openCodexReadSession({ env: process.env, spawnServer: (command, args, options) => spawn(process.execPath, ['--input-type=module', '-e', fakeServer], options) });
  try {
    for (const method of ['account/login/start', 'account/logout', 'thread/start', 'turn/start', 'account/rateLimitResetCredit/consume']) {
      await assert.rejects(session.request(method), /READ_ONLY/);
    }
  } finally { await session.close(); }
});

test('hanging app-server reads have a bounded timeout without restarting any shared daemon', async () => {
  const result = await inspectCodexAccount({ context, timeoutMs: 100, run: async () => ({ ok: true, stdout: '--listen <LISTEN>' }), spawnServer: (command, args, options) => {
    assert.ok(!args.includes('daemon'));
    return spawn(process.execPath, ['--input-type=module', '-e', fakeServer], { ...options, env: { ...process.env, VPNCTL_FIXTURE_MODE: 'hang' } });
  } });
  assert.equal(result.account.status, 'unverified');
  assert.match(result.quota.detail, /超时/);
});

test('malformed and excessive protocol output never leaks raw process responses', async () => {
  for (const output of ['private-process-token\n', 'x'.repeat(300000)]) {
    const result = await inspectCodexAccount({ context, timeoutMs: 3000, run: async () => ({ ok: true, stdout: '--listen <LISTEN>' }), spawnServer: (command, args, options) => {
      const script = output.length > 100 ? 'process.stdout.write("x".repeat(300000));process.stdin.resume();' : 'process.stdout.write("private-process-token\\n");process.stdin.resume();';
      return spawn(process.execPath, ['-e', script], { ...options, env: process.env });
    } });
    assert.equal(result.quota.status, 'unverified');
    assert.doesNotMatch(JSON.stringify(result), /private-process-token|x{50}/);
  }
});
