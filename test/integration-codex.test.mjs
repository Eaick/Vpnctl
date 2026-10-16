import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectCodex, planCodexRepair, repairCodex, readDaemonPid } from '../src/lib/integrations/codex.mjs';

const VERSION = '0.162.1';
const OLD = '0.160.0';
const proxy = 'http://alice:proxy-secret@127.0.0.1:7890';
const appEnv = Object.freeze({
  HOME: '/home/fixture', HTTP_PROXY: proxy, HTTPS_PROXY: proxy,
  http_proxy: proxy, https_proxy: proxy, NO_PROXY: 'localhost,.internal',
  no_proxy: 'localhost,.internal', OPENAI_API_KEY: 'fixture-private-api-key'
});
const context = Object.freeze({ available: true, httpProxy: proxy,
  displayProxy: 'http://[已隐藏]@127.0.0.1:7890', proxyMode: 'rule', env: appEnv, issues: [] });
const commands = 'Usage: codex app-server daemon <COMMAND>\n\nCommands:\n  bootstrap  Install durable local app-server management for SSH-driven use\n  start      Start the local app server daemon if it is not already running\n  restart    Restart the local app server daemon\n  update     Update the daemon package (may interrupt running work)\n  enable-remote-control   Enable remote control\n  disable-remote-control  Disable remote control\n  stop       Stop the local app server daemon\n  version    Print local CLI and running app-server versions as JSON\n  help       Print help\n\nOptions:\n  -h, --help  Print help';
const help = 'Usage: codex app-server daemon update [OPTIONS]\n\nOptions:\n      --from-cli  Copy and pin this CLI package\n  -y, --yes       Confirm replacing the daemon package without an interactive prompt';
const success = (stdout = '') => ({ ok: true, code: 0, stdout, stderr: '' });

function fixture(options = {}) {
  const calls = [];
  const inspections = [];
  const pidReads = [];
  let managed = options.managed ?? OLD;
  let server = options.server ?? OLD;
  let running = options.running ?? true;
  let started = false;
  let versionReads = 0;
  const run = async (command, args, settings) => {
    calls.push({ command, args: [...args], env: settings.env, timeoutMs: settings.timeoutMs });
    assert.equal(command, 'codex');
    const key = args.join(' ');
    const overridden = await options.override?.(key, { versionReads, started });
    if (overridden !== undefined) return overridden;
    if (key === '--version') return success(`codex-cli ${options.cli ?? VERSION}\n`);
    if (key === 'app-server daemon --help') return success(options.commands ?? commands);
    if (key === 'app-server daemon update --help') return success(options.updateHelp ?? help);
    if (key === 'app-server daemon version --help') return success('Print local CLI and running app-server versions as JSON\nUsage: codex app-server daemon version\nOptions:\n  -h, --help  Print help');
    if (/^app-server daemon (?:start|stop) --help$/.test(key)) return success('Options:\n  -h, --help  Help');
    if (key === 'app-server daemon version') {
      versionReads++;
      return success(JSON.stringify({ status: running ? 'running' : 'notRunning',
        ...(running ? { backend: 'pid', appServerVersion: server } : {}),
        managedCodexPath: '/home/fixture/.codex/packages/app-server-daemon/current/bin/codex',
        managedCodexVersion: managed, cliVersion: options.cli ?? VERSION,
        socketPath: '/home/fixture/.codex/app-server.sock' }));
    }
    if (key === 'app-server daemon stop') { running = false; return success(); }
    if (key === 'app-server daemon update --from-cli --yes') { managed = VERSION; return success(); }
    if (key === 'app-server daemon start') { running = true; started = true; server = options.finalServer ?? managed; return success(); }
    throw new Error(`Unexpected mock command: ${key}`);
  };
  const inspectProcess = async (pid, settings) => {
    inspections.push({ pid, settings });
    return { owned: options.owned ?? true,
      environment: options.unknownEnvironment ? null : started ? { ...appEnv } : { HTTP_PROXY: 'http://127.0.0.1:1234' },
      activeTasks: options.activeTasks ?? 'unknown' };
  };
  const readPid = async (settings) => { pidReads.push(settings); return options.pid === undefined ? 4312 : options.pid; };
  return { run, inspectProcess, calls, inspections, pidReads,
    args: { context, run, inspectProcess, readDaemonPid: readPid, platform: 'linux', env: appEnv } };
}

const mutations = (f) => f.calls.filter(({ args }) =>
  args[0] === 'app-server' && args[1] === 'daemon' &&
  ['start', 'stop', 'update'].includes(args[2]) && !args.includes('--help'));

test('Codex inspection separates package/server versions and exposes inherited old environment', async () => {
  const f = fixture({ managed: VERSION });
  const report = await inspectCodex(f.args);
  assert.equal(report.app, 'codex');
  assert.equal(report.installed, true);
  assert.equal(report.cliVersion, VERSION);
  assert.equal(report.daemon.managedCodexVersion, VERSION);
  assert.equal(report.daemon.appServerVersion, OLD);
  assert.equal(report.daemon.versionMismatch, true);
  assert.equal(report.daemon.environment.status, 'mismatch');
  assert.equal(report.daemon.activeTasks.status, 'unknown');
  assert.equal(report.daemon.capabilities.updateFromCli, true);
  assert.equal(report.daemon.capabilities.updateYes, true);
  assert.equal(mutations(f).length, 0);
  assert.equal(f.inspections[0].settings.expectedHome, '/home/fixture/.codex');
  assert.equal(typeof report.checkedAt, 'string');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(report)));
  assert.doesNotMatch(JSON.stringify(report), /proxy-secret|fixture-private-api-key|alice|OPENAI_API_KEY/);
});

test('Codex handles missing CLI, timeout and malformed JSON without mutation', async (t) => {
  for (const [label, override, installed] of [
    ['missing', (key) => key === '--version' ? { ok: false, missing: true } : undefined, false],
    ['timeout', (key) => key === '--version' ? { ok: false, timedOut: true } : undefined, null],
    ['JSON', (key) => key === 'app-server daemon version' ? success('{broken') : undefined, true]
  ]) await t.test(label, async () => {
    const f = fixture({ override });
    const report = await inspectCodex(f.args);
    assert.equal(report.installed, installed);
    assert.equal(report.daemon.running, null);
    assert.equal(planCodexRepair(report).allowed, false);
    assert.equal(mutations(f).length, 0);
  });
});

test('Codex surfaces incompatible features with sanitized diagnostics and no config deletion', async () => {
  const f = fixture({ override: (key) => key === 'app-server daemon version'
    ? { ok: false, stderr: `unsupported feature: new_feature ${proxy} api_key=fixture-private-api-key` } : undefined });
  const report = await inspectCodex(f.args);
  assert.ok(report.checks.some((c) => /unsupported feature: new_feature/.test(c.detail)));
  assert.doesNotMatch(JSON.stringify(report), /proxy-secret|fixture-private-api-key/);
  assert.equal(planCodexRepair(report).allowed, false);
  assert.equal(mutations(f).length, 0);
});

test('Codex absent daemon is not treated as a running daemon or inspected', async () => {
  const f = fixture({ running: false, managed: VERSION });
  const report = await inspectCodex(f.args);
  assert.equal(report.daemon.running, false);
  assert.equal(report.daemon.appServerVersion, null);
  assert.equal(report.daemon.environment.status, 'unverified');
  assert.equal(f.inspections.length, 0);
  assert.deepEqual(planCodexRepair(report).steps.map((s) => s.id), ['start']);
});

test('Codex even a start-only repair requires acknowledgement when task state is unknown', async () => {
  const f = fixture({ running: false, managed: VERSION });
  const refused = await repairCodex({ ...f.args, confirmed: true });
  assert.equal(refused.status, 'refused');
  assert.equal(mutations(f).length, 0);
  const result = await repairCodex({ ...f.args, confirmed: true, acknowledgeActive: true });
  assert.equal(result.verified, true);
  assert.deepEqual(mutations(f).map((c) => c.args[2]), ['start']);
});

test('Codex repair plan is pure, deterministic and requires unknown-task acknowledgement', async () => {
  const f = fixture();
  const report = await inspectCodex(f.args);
  const before = JSON.stringify(report);
  const plan = planCodexRepair(report);
  assert.equal(plan.allowed, true);
  assert.equal(plan.requiresActiveConfirmation, true);
  assert.deepEqual(plan.steps.map((s) => s.id), ['stop', 'update', 'start']);
  assert.deepEqual(plan.steps[1].args, ['app-server', 'daemon', 'update', '--from-cli', '--yes']);
  assert.deepEqual(planCodexRepair(report), plan);
  assert.equal(JSON.stringify(report), before);
  assert.equal(mutations(f).length, 0);
});

test('Codex repair refuses missing confirmation, unavailable proxy and non-Linux', async (t) => {
  for (const [label, changes, confirmed] of [
    ['confirmation', {}, false], ['proxy', { context: { ...context, available: false } }, true],
    ['platform', { platform: 'win32' }, true]
  ]) await t.test(label, async () => {
    const f = fixture();
    const result = await repairCodex({ ...f.args, ...changes, confirmed, acknowledgeActive: true });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'refused');
    assert.equal(mutations(f).length, 0);
  });
});

test('Codex repair refuses unknown/active work unless separately acknowledged', async (t) => {
  for (const activeTasks of ['unknown', { status: 'active', count: 2 }]) await t.test(JSON.stringify(activeTasks), async () => {
    const f = fixture({ activeTasks });
    const report = await inspectCodex(f.args);
    const result = await repairCodex({ ...f.args, report, confirmed: true });
    assert.equal(result.status, 'refused');
    assert.equal(mutations(f).length, 0);
  });
});

test('Codex repair verifies fresh help, ownership and versions before ordered mutations', async () => {
  const f = fixture();
  const report = await inspectCodex(f.args);
  const progress = [];
  const result = await repairCodex({ ...f.args, report, confirmed: true,
    acknowledgeActive: true, onProgress: (event) => progress.push(event) });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(result.status, 'verified');
  assert.deepEqual(mutations(f).map((c) => c.args.join(' ')),
    ['app-server daemon stop', 'app-server daemon update --from-cli --yes', 'app-server daemon start']);
  assert.ok(f.calls.filter((c) => c.args.join(' ') === 'app-server daemon version').length >= 3);
  const firstMutation = f.calls.findIndex((c) => c.args.join(' ') === 'app-server daemon stop');
  assert.ok(f.calls.slice(0, firstMutation).filter((c) => c.args.join(' ') === 'app-server daemon update --help').length >= 2);
  for (const c of mutations(f)) {
    assert.deepEqual(c.env, appEnv);
    assert.notEqual(c.env, appEnv);
    assert.equal(c.env.NO_PROXY, 'localhost,.internal');
    assert.equal(c.env.ALL_PROXY, undefined);
    assert.equal(c.env.all_proxy, undefined);
  }
  assert.equal(context.env, appEnv);
  assert.ok(progress.some((e) => e.id === 'start'));
  assert.doesNotMatch(JSON.stringify(result), /proxy-secret|fixture-private-api-key/);
});

test('Codex refuses unsupported required commands and flags before stopping', async (t) => {
  for (const options of [{ updateHelp: 'Options:\n  --yes  Confirm' },
    { updateHelp: 'Options:\n  --from-cli  Copy' },
    { commands: commands.replace(/^  start\s+.*\n/m, '') },
    { commands: commands.replace(/^  stop\s+.*\n/m, '') }]) await t.test(JSON.stringify(options), async () => {
    const f = fixture(options);
    const result = await repairCodex({ ...f.args, confirmed: true, acknowledgeActive: true });
    assert.equal(result.status, 'refused');
    assert.equal(mutations(f).length, 0);
  });
});

test('Codex does not require update support for an environment-only restart', async () => {
  const f = fixture({ managed: VERSION, server: VERSION, updateHelp: 'Options:\n -h, --help Help', activeTasks: 'idle' });
  const report = await inspectCodex(f.args);
  assert.equal(planCodexRepair(report).allowed, true);
  const result = await repairCodex({ ...f.args, report, confirmed: true });
  assert.equal(result.verified, true);
  assert.deepEqual(mutations(f).map((c) => c.args[2]), ['stop', 'start']);
});

test('Codex rejects foreign ownership and missing process identity even with work acknowledgement', async (t) => {
  for (const options of [{ owned: false }, { pid: null }]) await t.test('ownership', async () => {
    const f = fixture(options);
    const result = await repairCodex({ ...f.args, confirmed: true, acknowledgeActive: true });
    assert.equal(result.status, 'refused');
    assert.equal(mutations(f).length, 0);
  });
});

test('Codex detects stale version/plan or target proxy before mutation', async (t) => {
  for (const change of ['version', 'proxy']) await t.test(change, async () => {
    let drifted = false;
    const f = fixture({ override: (key) => drifted && key === '--version' ? success('codex-cli 0.163.0') : undefined });
    const report = await inspectCodex(f.args);
    drifted = change === 'version';
    const args = change === 'proxy' ? { ...f.args, context: { ...context, env: { ...appEnv, NO_PROXY: '*' } } } : f.args;
    const result = await repairCodex({ ...args, report, confirmed: true, acknowledgeActive: true });
    assert.equal(result.status, 'refused');
    assert.match(result.detail, /变化|重新确认/);
    assert.equal(mutations(f).length, 0);
  });
});

test('Codex unknown process environment after repair is unverified, never verified success', async () => {
  const f = fixture({ unknownEnvironment: true });
  const result = await repairCodex({ ...f.args, confirmed: true, acknowledgeActive: true });
  assert.equal(result.status, 'unverified');
  assert.equal(result.verified, false);
  assert.equal(result.report.daemon.environment.status, 'unverified');
});

test('Codex wrong final server version is failure, with no retry or fallback config deletion', async () => {
  const f = fixture({ finalServer: OLD });
  const result = await repairCodex({ ...f.args, confirmed: true, acknowledgeActive: true });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.report.daemon.appServerVersion, OLD);
  assert.match(result.suggestion, /codex --no-daemon/);
  assert.equal(mutations(f).length, 3);
});

test('Codex command failure stops remaining steps and sanitizes errors and progress', async () => {
  const f = fixture({ override: (key) => key === 'app-server daemon update --from-cli --yes'
    ? { ok: false, stderr: `unsupported feature: fixture ${proxy} api_key=fixture-private-api-key` } : undefined });
  const progress = [];
  const result = await repairCodex({ ...f.args, confirmed: true, acknowledgeActive: true,
    onProgress: (event) => progress.push(event) });
  assert.equal(result.status, 'failed');
  assert.equal(result.changed, true);
  assert.match(result.detail, /unsupported feature: fixture/);
  assert.match(result.suggestion, /codex --no-daemon/);
  assert.deepEqual(mutations(f).map((c) => c.args[2]), ['stop', 'update']);
  assert.doesNotMatch(JSON.stringify({ result, progress }), /proxy-secret|fixture-private-api-key/);
});

test('Codex unsupported network option never invokes login, inference, curl or fetch', async () => {
  const f = fixture();
  await inspectCodex({ ...f.args, network: true });
  assert.ok(f.calls.every((c) => c.command === 'codex' &&
    (c.args[0] === '--version' || c.args.includes('--help') || c.args.join(' ') === 'app-server daemon version')));
  assert.ok(f.calls.every((c) => c.args[0] === '--version' ||
    (c.args[0] === 'app-server' && c.args[1] === 'daemon')));
});

test('Codex malformed version schemas and secret-bearing version strings stay unknown', async (t) => {
  for (const data of [null, [], {}, { managedCodexVersion: OLD, appServerVersion: 'fixture-private-api-key', pid: 4312 },
    { managedCodexVersion: { token: 'fixture-private-api-key' }, appServerVersion: OLD, pid: 4312 },
    { managedCodexVersion: OLD, appServerVersion: OLD, running: false, pid: 4312 }]) {
    await t.test('schema', async () => {
      const f = fixture({ override: (key) => key === 'app-server daemon version' ? success(JSON.stringify(data)) : undefined });
      const report = await inspectCodex(f.args);
      assert.equal(report.daemon.running, null);
      assert.equal(planCodexRepair(report).allowed, false);
      assert.doesNotMatch(JSON.stringify(report), /fixture-private-api-key/);
      assert.equal(mutations(f).length, 0);
    });
  }
});

test('Codex daemon version/help timeouts and thrown run errors remain non-mutating unknowns', async (t) => {
  for (const key of ['app-server daemon --help', 'app-server daemon version', 'app-server daemon version --help']) await t.test(key, async () => {
    const f = fixture({ override: (value) => value === key ? { ok: false, timedOut: true } : undefined });
    const report = await inspectCodex(f.args);
    assert.equal(report.daemon.running, null);
    assert.equal(planCodexRepair(report).allowed, false);
    assert.equal(mutations(f).length, 0);
  });
  const f = fixture({ override: () => { throw new Error(`timeout ${proxy}`); } });
  const report = await inspectCodex(f.args);
  assert.equal(report.installed, null);
  assert.doesNotMatch(JSON.stringify(report), /proxy-secret/);
});

test('Codex version --json is used only when its flag is advertised', async () => {
  const f = fixture({ override: (key) => key === 'app-server daemon version --help'
    ? success('Options:\n      --json  JSON\n  -h, --help Help') : key === 'app-server daemon version --json'
      ? success(JSON.stringify({ status: 'notRunning', managedCodexVersion: VERSION, cliVersion: VERSION })) : undefined });
  const report = await inspectCodex(f.args);
  assert.equal(report.daemon.running, false);
  assert.ok(f.calls.some((c) => c.args.join(' ') === 'app-server daemon version --json'));
});

test('Codex rechecks process ownership and tasks immediately before stop', async (t) => {
  for (const changed of [{ owned: false, activeTasks: 'idle' }, { owned: true, activeTasks: 'active' }]) {
    await t.test(JSON.stringify(changed), async () => {
      const f = fixture({ activeTasks: 'idle' });
      let reads = 0;
      const inspectProcess = async () => ({ owned: true, environment: null, activeTasks: 'idle', ...(++reads > 1 ? changed : {}) });
      const result = await repairCodex({ ...f.args, inspectProcess, confirmed: true });
      assert.equal(result.status, 'refused');
      assert.equal(mutations(f).length, 0);
    });
  }
});

test('Codex zero exit with incompatible feature output still aborts subsequent mutation', async () => {
  const f = fixture({ override: (key) => key === 'app-server daemon update --from-cli --yes'
    ? success(`unsupported feature: fixture ${proxy}`) : undefined });
  const result = await repairCodex({ ...f.args, confirmed: true, acknowledgeActive: true });
  assert.equal(result.status, 'failed');
  assert.deepEqual(mutations(f).map((c) => c.args[2]), ['stop', 'update']);
  assert.doesNotMatch(JSON.stringify(result), /proxy-secret/);
});

test('Codex successful command diagnostics and observer exceptions cannot leak or alter caller environment', async () => {
  const f = fixture({ override: (key) => key === 'app-server daemon stop' ? success(`api_key=fixture-private-api-key ${proxy}`) : undefined });
  const result = await repairCodex({ ...f.args, confirmed: true, acknowledgeActive: true,
    onProgress: () => { throw new Error('observer'); } });
  assert.equal(result.verified, true);
  assert.doesNotMatch(JSON.stringify(result), /proxy-secret|fixture-private-api-key/);
  assert.equal(context.env.NO_PROXY, 'localhost,.internal');
});

test('Codex unknown or extra ALL_PROXY remains mismatched even if HTTP proxy matches', async () => {
  const f = fixture({ managed: VERSION, server: VERSION });
  const report = await inspectCodex({ ...f.args, inspectProcess: async () => ({ owned: true,
    environment: { ...appEnv, ALL_PROXY: 'socks5://127.0.0.1:9999' }, activeTasks: 'unknown' }) });
  assert.equal(report.daemon.environment.status, 'mismatch');
  const inaccessible = await inspectCodex({ ...f.args, inspectProcess: async () => { throw new Error('cannot inspect'); } });
  assert.equal(inaccessible.daemon.environment.status, 'unverified');
  assert.equal(planCodexRepair(inaccessible).allowed, false);
});

test('Codex semver-shaped secrets cannot escape through extracted version fields', async (t) => {
  for (const target of ['cli', 'server']) await t.test(target, async () => {
    const f = fixture({ cli: target === 'cli' ? `${VERSION}+fixture-private-api-key` : VERSION,
      override: (key) => target === 'server' && key === 'app-server daemon version'
        ? success(JSON.stringify({ status: 'running', managedCodexVersion: OLD,
          appServerVersion: `${OLD}+fixture-private-api-key`, pid: 4312 })) : undefined });
    const report = await inspectCodex(f.args);
    assert.doesNotMatch(JSON.stringify(report), /fixture-private-api-key/);
    assert.equal(planCodexRepair(report).allowed, false);
  });
});

test('Codex failed or timed-out stop never updates or starts a service', async (t) => {
  for (const failure of [{ ok: false, timedOut: true }, { ok: false, stderr: 'stop failed' }]) {
    await t.test(JSON.stringify(failure), async () => {
      const f = fixture({ override: (key) => key === 'app-server daemon stop' ? failure : undefined });
      const result = await repairCodex({ ...f.args, confirmed: true, acknowledgeActive: true });
      assert.equal(result.status, 'failed');
      assert.match(result.suggestion, /codex --no-daemon/);
      assert.deepEqual(mutations(f).map((c) => c.args[2]), ['stop']);
    });
  }
});

test('Codex run injections receive isolated environments, including unchanged NO_PROXY', async () => {
  const f = fixture();
  const run = async (command, args, options) => {
    assert.equal(options.env.NO_PROXY, 'localhost,.internal');
    const result = await f.run(command, args, options);
    options.env.NO_PROXY = '*';
    options.env.ALL_PROXY = 'socks5://127.0.0.1:9999';
    return result;
  };
  const result = await repairCodex({ ...f.args, run, confirmed: true, acknowledgeActive: true });
  assert.equal(result.verified, true);
  assert.equal(context.env.NO_PROXY, 'localhost,.internal');
  assert.equal(context.env.ALL_PROXY, undefined);
});

test('Codex reads a PID hint only from the custom CODEX_HOME daemon record', async () => {
  const paths = [];
  const env = Object.freeze({ ...appEnv, CODEX_HOME: '/srv/fixture-codex' });
  const pid = await readDaemonPid({ env, platform: 'linux', readFile: async (file, encoding) => {
    paths.push(file);
    assert.equal(encoding, 'utf8');
    return JSON.stringify({ pid: 5432, processStartTime: 'fixture-start', processIdentity: { startTicks: 123 } });
  } });
  assert.equal(pid, 5432);
  assert.deepEqual(paths, ['/srv/fixture-codex/app-server-daemon/daemon.pid',
    '/srv/fixture-codex/app-server-daemon/app-server.pid']);
  assert.equal(env.CODEX_HOME, '/srv/fixture-codex');
});

test('Codex falls back to the legacy PID record only when the new file is absent', async () => {
  const paths = [];
  const pid = await readDaemonPid({ env: appEnv, platform: 'linux', readFile: async (file) => {
    paths.push(file);
    if (file.endsWith('/daemon.pid')) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return JSON.stringify({ pid: 4312, processStartTime: 'fixture-start' });
  } });
  assert.equal(pid, 4312);
  assert.deepEqual(paths, ['/home/fixture/.codex/app-server-daemon/daemon.pid',
    '/home/fixture/.codex/app-server-daemon/app-server.pid']);
});

test('Codex legacy managed installation chooses the legacy PID namespace', async () => {
  const paths = [];
  const pid = await readDaemonPid({ env: appEnv, platform: 'linux',
    managedCodexPath: '/home/fixture/.codex/packages/standalone/local-main/bin/codex',
    readFile: async (file) => { paths.push(file); return JSON.stringify({ pid: 4312 }); } });
  assert.equal(pid, 4312);
  assert.deepEqual(paths, ['/home/fixture/.codex/app-server-daemon/app-server.pid',
    '/home/fixture/.codex/app-server-daemon/daemon.pid']);
});

test('Codex invalid or inaccessible primary PID records do not fall back to stale files', async (t) => {
  for (const raw of ['{broken', 'null', '[]', '4312', '{}', '{"pid":"4312"}',
    '{"pid":0}', '{"pid":1}', '{"pid":-3}', '{"pid":1.5}', '{"pid":4294967296}',
    '{"pid":9007199254740992}', ' '.repeat(65537)]) {
    await t.test(raw.length > 60 ? 'oversized' : raw, async () => {
      const paths = [];
      const pid = await readDaemonPid({ env: appEnv, platform: 'linux',
        readFile: async (file) => { paths.push(file); return raw; } });
      assert.equal(pid, null);
      assert.equal(paths.length, 1);
    });
  }
  let reads = 0;
  const pid = await readDaemonPid({ env: appEnv, platform: 'linux', readFile: async () => {
    reads++;
    throw Object.assign(new Error('denied'), { code: 'EACCES' });
  } });
  assert.equal(pid, null);
  assert.equal(reads, 1);
});

test('Codex missing PID records and unsupported platforms do not inspect arbitrary processes', async () => {
  const paths = [];
  const readFile = async (file) => {
    paths.push(file);
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  };
  assert.equal(await readDaemonPid({ env: appEnv, platform: 'linux', readFile }), null);
  assert.equal(paths.length, 2);
  paths.length = 0;
  assert.equal(await readDaemonPid({ env: appEnv, platform: 'win32', readFile }), null);
  assert.equal(paths.length, 0);
  const f = fixture({ pid: null });
  await inspectCodex(f.args);
  assert.equal(f.inspections.length, 0);
});

test('Codex real version JSON omits PID and resolves it through the verified record hint', async () => {
  const f = fixture();
  const report = await inspectCodex(f.args);
  assert.equal(report.daemon.running, true);
  assert.equal(report.daemon.process.pid, 4312);
  assert.equal(report.daemon.process.owned, true);
  assert.equal(f.pidReads.length, 1);
  assert.equal(f.pidReads[0].env.HOME, appEnv.HOME);
  assert.equal(f.inspections[0].pid, 4312);
  assert.equal(f.inspections[0].settings.expectedHome, '/home/fixture/.codex');
  assert.ok(f.calls.some((c) => c.args.join(' ') === 'app-server daemon version'));
  assert.ok(f.calls.every((c) => !c.args.includes('--json')));
  assert.doesNotMatch(JSON.stringify(report), /socketPath|managedCodexPath|\/home\/fixture/);
});

test('Codex optional JSON PID is never trusted without a matching scoped file hint', async (t) => {
  for (const pid of [null, 9876]) await t.test(String(pid), async () => {
    const f = fixture({ pid, override: (key) => key === 'app-server daemon version'
      ? success(JSON.stringify({ status: 'running', managedCodexVersion: OLD, appServerVersion: OLD, pid: 4312 })) : undefined });
    const result = await repairCodex({ ...f.args, confirmed: true, acknowledgeActive: true });
    assert.equal(result.status, 'refused');
    assert.equal(f.inspections.length, 0);
    assert.equal(mutations(f).length, 0);
  });
});

test('Codex PID changes between fresh inspection and stop prevent all mutations', async () => {
  const f = fixture();
  let reads = 0;
  const result = await repairCodex({ ...f.args, confirmed: true, acknowledgeActive: true,
    readDaemonPid: async () => ++reads === 1 ? 4312 : 9876 });
  assert.equal(result.status, 'refused');
  assert.match(result.detail, /PID.*变化/);
  assert.equal(mutations(f).length, 0);
});

test('Codex legacy PID namespace remains consistent during pre-stop recheck', async () => {
  let versionReads = 0;
  const f = fixture({ override: (key) => key === 'app-server daemon version' && ++versionReads === 1
    ? success(JSON.stringify({ status: 'running', managedCodexVersion: OLD, appServerVersion: OLD,
      managedCodexPath: '/home/fixture/.codex/packages/standalone/local-main/bin/codex' })) : undefined });
  const namespaces = [];
  const result = await repairCodex({ ...f.args, confirmed: true, acknowledgeActive: true,
    readDaemonPid: async ({ namespace }) => { namespaces.push(namespace); return 4312; } });
  assert.equal(result.verified, true);
  assert.deepEqual(namespaces.slice(0, 2), ['legacy', 'legacy']);
});

test('Codex CODEX_HOME changes invalidate an approved repair plan', async () => {
  const f = fixture();
  const report = await inspectCodex(f.args);
  const result = await repairCodex({ ...f.args, report, confirmed: true, acknowledgeActive: true,
    context: { ...context, env: { ...appEnv, CODEX_HOME: '/srv/other-codex' } } });
  assert.equal(result.status, 'refused');
  assert.equal(mutations(f).length, 0);
});

test('Codex parses real offline lifecycle statuses without requiring appServerVersion', async (t) => {
  for (const status of ['notRunning', 'stopped']) await t.test(status, async () => {
    const f = fixture({ override: (key) => key === 'app-server daemon version'
      ? success(JSON.stringify({ status, managedCodexVersion: VERSION, cliVersion: VERSION })) : undefined });
    const report = await inspectCodex(f.args);
    assert.equal(report.daemon.running, false);
    assert.equal(report.daemon.appServerVersion, null);
    assert.equal(f.pidReads.length, 0);
    assert.equal(f.inspections.length, 0);
  });
});

test('Codex separate CLI and LifecycleOutput cliVersion disagreement blocks repair', async () => {
  const f = fixture({ override: (key) => key === 'app-server daemon version'
    ? success(JSON.stringify({ status: 'running', cliVersion: '0.163.0',
      managedCodexVersion: OLD, appServerVersion: OLD })) : undefined });
  const result = await repairCodex({ ...f.args, confirmed: true, acknowledgeActive: true });
  assert.equal(result.status, 'refused');
  assert.equal(mutations(f).length, 0);
});

test('Codex distinct new and legacy PID hints are ambiguous and never selected by filename', async () => {
  const pid = await readDaemonPid({ env: appEnv, platform: 'linux', readFile: async (file) =>
    JSON.stringify({ pid: file.endsWith('/daemon.pid') ? 4312 : 9876 }) });
  assert.equal(pid, null);
  const f = fixture({ pid });
  const result = await repairCodex({ ...f.args, confirmed: true, acknowledgeActive: true });
  assert.equal(result.status, 'refused');
  assert.equal(f.inspections.length, 0);
  assert.equal(mutations(f).length, 0);
});

test('Codex all real running lifecycle statuses parse without a JSON PID', async (t) => {
  for (const status of ['running', 'alreadyRunning', 'started', 'restarted']) await t.test(status, async () => {
    const f = fixture({ override: (key) => key === 'app-server daemon version'
      ? success(JSON.stringify({ status, managedCodexVersion: OLD, appServerVersion: OLD, cliVersion: VERSION })) : undefined });
    const report = await inspectCodex(f.args);
    assert.equal(report.daemon.running, true);
    assert.equal(report.daemon.process.pid, 4312);
    assert.equal(report.daemon.process.owned, true);
  });
});

test('Codex mutation timeout is long and independent from the diagnostic timeout', async (t) => {
  for (const options of [{}, { timeoutMs: 17, mutationTimeoutMs: 234567 }]) await t.test(JSON.stringify(options), async () => {
    const f = fixture();
    const result = await repairCodex({ ...f.args, ...options, confirmed: true, acknowledgeActive: true });
    assert.equal(result.verified, true);
    assert.ok(mutations(f).every((c) => c.timeoutMs === (options.mutationTimeoutMs ?? 180000)));
    assert.ok(f.calls.filter((c) => !mutations(f).includes(c))
      .every((c) => c.timeoutMs === (options.timeoutMs ?? 6000)));
  });
});

test('Codex zero-exit mutation failure JSON aborts each phase and preserves sanitized detail', async (t) => {
  for (const step of ['stop', 'update', 'start']) for (const status of ['unsupported', 'failed', 'error', 'busy', 'declined']) {
    await t.test(`${step}:${status}`, async () => {
      const f = fixture({ override: (key) => key === `app-server daemon ${step}${step === 'update' ? ' --from-cli --yes' : ''}`
        ? success(JSON.stringify({ status, message: `fixture message ${proxy} api_key=fixture-private-api-key` })) : undefined });
      const result = await repairCodex({ ...f.args, confirmed: true, acknowledgeActive: true });
      assert.equal(result.ok, false);
      assert.equal(result.status, 'failed');
      assert.equal(result.changed, true);
      assert.match(result.detail, new RegExp(status));
      assert.match(result.detail, /fixture message/);
      assert.doesNotMatch(JSON.stringify(result), /proxy-secret|fixture-private-api-key/);
      assert.deepEqual(mutations(f).map((c) => c.args[2]),
        step === 'stop' ? ['stop'] : step === 'update' ? ['stop', 'update'] : ['stop', 'update', 'start']);
      assert.equal(result.steps.at(-1).status, 'error');
    });
  }
});

test('Codex unknown, partial and malformed mutation JSON cannot count as success', async (t) => {
  for (const stdout of ['{"status":"partial"}', '{"status":"unknown"}', '{"status":"updated","ok":false}',
    '{"status":"updated","error":"fixture error"}', '{"message":"cannot verify"}', '{broken', 'null', '[]']) {
    await t.test(stdout, async () => {
      const f = fixture({ override: (key) => key === 'app-server daemon update --from-cli --yes' ? success(stdout) : undefined });
      const result = await repairCodex({ ...f.args, confirmed: true, acknowledgeActive: true });
      assert.equal(result.status, 'failed');
      assert.equal(result.verified, false);
      assert.match(result.detail, /部分更改|无法核验/);
      assert.deepEqual(mutations(f).map((c) => c.args[2]), ['stop', 'update']);
    });
  }
});

test('Codex official positive mutation statuses are accepted before final reinspection', async () => {
  const f = fixture();
  const run = async (command, args, options) => {
    const result = await f.run(command, args, options);
    if (!args.includes('--help') && ['stop', 'update', 'start'].includes(args[2])) {
      return success(JSON.stringify({ status: { stop: 'stopped', update: 'updated', start: 'started' }[args[2]] }));
    }
    return result;
  };
  const result = await repairCodex({ ...f.args, run, confirmed: true, acknowledgeActive: true });
  assert.equal(result.status, 'verified');
});
