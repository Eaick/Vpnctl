import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { runCli, redactText } from './runtime.mjs';

const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'];
const GATEWAY_KEYS = ['ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];
const own = (object, key) => Object.hasOwn(object, key);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const encode = (value) => `${JSON.stringify(value, null, 2)}\n`;
const emptySnapshot = () => ({ exists: false, text: null, digest: digest('missing'), value: {} });
const advisory = '未验证 Supervisor 或已运行进程的环境；进程可能保留启动时的环境变量。请自行确认后重启，不会自动重启。';

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function paths(env) {
  const dir = path.resolve(env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), '.claude'));
  return {
    dir,
    settingsPath: path.join(dir, 'settings.json'),
    statePath: path.join(dir, '.vpnctl-proxy.json'),
    lockPath: path.join(dir, '.vpnctl-proxy.lock')
  };
}

function safeProxy(value) {
  if (value === undefined) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'socks:', 'socks4:', 'socks5:', 'socks5h:'].includes(url.protocol)) return '[invalid proxy]';
    return redactText(`${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`);
  } catch {
    return '[invalid proxy]';
  }
}

function httpProxy(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch { return false; }
}

function validateStat(stat, directory = false, checkOwner = true) {
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) fail('UNSAFE_PATH');
  if (!directory && stat.nlink !== 1) fail('UNSAFE_PATH');
  if (checkOwner && process.platform === 'linux' && stat.uid !== process.getuid()) fail('WRONG_OWNER');
}

async function checkDirectory(dir, io) {
  // Check every ancestor: validating only the final component misses symlinked homes.
  const parents = [];
  for (let current = dir; ; current = path.dirname(current)) {
    parents.unshift(current);
    if (path.dirname(current) === current) break;
  }
  for (const current of parents) {
    try { validateStat(await io.lstat(current), true, current === dir); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function sameFile(a, b) {
  // Windows lstat can report dev=0 while fstat reports the volume serial number.
  return (process.platform === 'win32' || a.dev === b.dev) && a.ino === b.ino && a.size === b.size
    && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

async function readSnapshot(file, io) {
  await checkDirectory(path.dirname(file), io);
  let before;
  try { before = await io.lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return emptySnapshot(); throw error; }
  validateStat(before);
  const handle = await io.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    validateStat(opened);
    if (!sameFile(before, opened)) fail('STALE');
    const text = await handle.readFile('utf8');
    if (!sameFile(opened, await handle.stat()) || !sameFile(opened, await io.lstat(file))) fail('STALE');
    return { exists: true, text, digest: digest(`file:${text}`), stat: opened };
  } finally { await handle.close(); }
}

function parseSettings(snapshot) {
  let value;
  try { value = snapshot.exists ? JSON.parse(snapshot.text) : {}; }
  catch { fail('INVALID_JSON'); }
  if (!plain(value) || (own(value, 'env') && !plain(value.env))) fail('INVALID_SETTINGS');
  return { ...snapshot, value };
}

function parseState(snapshot) {
  let value;
  try { value = snapshot.exists ? JSON.parse(snapshot.text) : { version: 1, keys: {} }; }
  catch { fail('INVALID_STATE'); }
  if (!plain(value) || value.version !== 1 || !plain(value.keys)
    || Object.keys(value.keys).some((key) => !PROXY_KEYS.includes(key))) fail('INVALID_STATE');
  for (const entry of Object.values(value.keys)) {
    if (!plain(entry) || typeof entry.written !== 'string' || !plain(entry.previous)
      || typeof entry.previous.exists !== 'boolean'
      || (entry.previous.exists && !own(entry.previous, 'value'))) fail('INVALID_STATE');
  }
  return { ...snapshot, value };
}

async function load(location, io) {
  return {
    settings: parseSettings(await readSnapshot(location.settingsPath, io)),
    state: parseState(await readSnapshot(location.statePath, io))
  };
}

async function expectSnapshot(file, expected, io) {
  const current = await readSnapshot(file, io);
  if (current.digest !== expected.digest || (expected.exists && !sameFile(current.stat, expected.stat))) fail('STALE');
}

async function writePrivate(file, text, io) {
  const handle = await io.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
  let complete = false;
  try {
    await handle.chmod(0o600);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    complete = true;
  } finally {
    await handle.close();
    if (!complete) await io.unlink(file);
  }
}

async function replace(file, text, expected, io) {
  const temporary = path.join(path.dirname(file), `.vpnctl-${randomUUID()}.tmp`);
  await writePrivate(temporary, text, io);
  try {
    await expectSnapshot(file, expected, io);
    await io.rename(temporary, file);
  } finally {
    await io.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
  return { exists: true, text, digest: digest(`file:${text}`), stat: await io.lstat(file) };
}

async function locked(location, io, action) {
  await checkDirectory(location.dir, io);
  await io.mkdir(location.dir, { recursive: true, mode: 0o700 });
  await checkDirectory(location.dir, io);
  try { await writePrivate(location.lockPath, randomUUID(), io); }
  catch (error) { if (error.code === 'EEXIST') fail('LOCKED'); throw error; }
  const lock = await readSnapshot(location.lockPath, io);
  try { return await action(); }
  finally {
    await expectSnapshot(location.lockPath, lock, io);
    await io.unlink(location.lockPath);
  }
}

function reason(error) {
  const labels = {
    INVALID_JSON: 'settings.json 不是有效 JSON，未写入',
    INVALID_SETTINGS: 'settings.json 或 env 不是普通对象，未写入',
    INVALID_STATE: '所有权记录无效，未写入',
    UNSAFE_PATH: '路径包含符号链接、硬链接或非普通文件，已阻止访问',
    WRONG_OWNER: '文件或配置目录不属于当前账户，已阻止访问',
    LOCKED: '另一个写入操作持有锁；未自动清除未知锁',
    STALE: '配置或计划已经变化，请重新预览后确认',
    CONFLICT: '第三方代理存在冲突，需要 acknowledgeConflicts: true',
    CONFIRMATION_REQUIRED: '需要 confirmed: true',
    UNAVAILABLE: '需要可用的 HTTP/HTTPS 代理上下文',
    ROLLBACK_FAILED: '写入失败且无法安全恢复所有权记录，请人工检查受保护的备份'
  };
  const known = own(labels, error?.code);
  return { code: known ? error.code : 'IO_ERROR', detail: known ? labels[error.code] : '无法安全读取或写入 Claude 配置' };
}

function resultError(error, location) {
  return { app: 'claude', ok: false, changed: false, status: 'blocked', settingsPath: location.settingsPath, ...reason(error) };
}

function proxySummary(source) {
  return Object.fromEntries(PROXY_KEYS.filter((key) => own(source, key)).map((key) => [key, safeProxy(source[key])]));
}

function proxyDiagnostics(source, target) {
  const values = PROXY_KEYS.filter((key) => own(source, key) && source[key]);
  return {
    proxies: proxySummary(source),
    conflicts: values.filter((key) => target && source[key] !== target),
    conflictingVariants: new Set(values.map((key) => source[key])).size > 1,
    socksOnly: !values.some((key) => httpProxy(source[key]))
      && [...values.map((key) => source[key]), source.ALL_PROXY, source.all_proxy]
        .some((value) => typeof value === 'string' && /^socks(?:4|5h?)?:\/\//i.test(value)),
    bypassConfigured: Boolean(source.NO_PROXY || source.no_proxy),
    // Presence is conservative: these keys do not prove which service is active.
    gatewayConfigured: GATEWAY_KEYS.some((key) => own(source, key))
  };
}

function makePlan(location, loaded, context, acknowledgeConflicts) {
  const current = loaded.settings.value.env || {};
  const changes = [];
  const conflicts = [];
  const valid = Boolean(context?.available && httpProxy(context.httpProxy));
  if (valid) {
    for (const key of PROXY_KEYS) {
      if (current[key] === context.httpProxy && own(current, key)) continue;
      const change = { key, before: own(current, key) ? safeProxy(current[key]) : null, after: safeProxy(context.httpProxy) };
      changes.push(change);
      const managed = loaded.state.value.keys[key];
      if (own(current, key) && (!managed || current[key] !== managed.written)) conflicts.push({ ...change, reason: 'existing-unmanaged-proxy' });
    }
  }
  return {
    app: 'claude', allowed: valid && (!conflicts.length || acknowledgeConflicts === true),
    settingsPath: location.settingsPath, statePath: location.statePath,
    expectedDigest: loaded.settings.digest, expectedStateDigest: loaded.state.digest,
    targetDigest: digest(valid ? context.httpProxy : ''), changes, conflicts,
    backups: changes.length && loaded.settings.exists ? [{ path: path.join(location.dir, '.vpnctl-settings.<unique>.bak'), mode: '0600' }] : [],
    warnings: [advisory, ...(!valid ? ['代理上下文不可用，禁止同步'] : []),
      ...(conflicts.length ? ['覆盖第三方代理需要额外确认；原始值仅保存在私有备份和所有权记录中'] : [])]
  };
}

export async function planClaudeSync({ context, env = process.env, acknowledgeConflicts = false, io = fs } = {}) {
  const location = paths(env);
  try { return makePlan(location, await load(location, io), context, acknowledgeConflicts); }
  catch (error) {
    return { app: 'claude', allowed: false, settingsPath: location.settingsPath, changes: [], conflicts: [], backups: [], warnings: [reason(error).detail], ...reason(error) };
  }
}

export async function inspectClaude({ context, env = process.env, run = runCli, platform = process.platform, io = fs } = {}) {
  const location = paths(env);
  let cli;
  try { cli = await run('claude', ['--version'], { env: context?.env || env, timeoutMs: 5000 }); }
  catch { cli = { ok: false }; }
  const installed = Boolean(cli?.ok && !cli.missing);
  const cliVersion = installed ? String(cli.stdout || '').match(/\b\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?\b/)?.[0] || null : null;
  let settings;
  let exists = null;
  let gatewayConfigured = false;
  try {
    const snapshot = await readSnapshot(location.settingsPath, io);
    exists = snapshot.exists;
    const parsed = parseSettings(snapshot);
    const source = parsed.value.env || {};
    const diagnostics = proxyDiagnostics(source, context?.httpProxy);
    gatewayConfigured = diagnostics.gatewayConfigured;
    const state = parseState(await readSnapshot(location.statePath, io));
    const keys = PROXY_KEYS.filter((key) => own(source, key));
    settings = {
      path: location.settingsPath, exists: parsed.exists,
      status: !parsed.exists ? 'missing' : !keys.length ? 'unmanaged'
        : !context?.httpProxy ? 'unmanaged' : keys.every((key) => source[key] === context.httpProxy) ? 'match' : 'mismatch',
      managed: Object.keys(state.value.keys).length > 0, ...diagnostics
    };
  } catch (error) {
    settings = { path: location.settingsPath, exists, status: 'invalid', blocked: true, gatewayConfigured, ...reason(error) };
  }
  const processEnvironment = proxyDiagnostics(env, context?.httpProxy);
  const processKeys = PROXY_KEYS.filter((key) => own(env, key) && env[key]);
  const supervisor = { status: platform === 'linux' ? 'unverified' : 'unsupported', label: advisory };
  const checks = [
    { id: 'cli', status: installed ? 'ok' : cli?.missing ? 'warn' : 'unknown', label: installed ? 'Claude Code CLI 已安装' : 'Claude Code CLI 未验证', detail: cliVersion || '未读取账户、凭据或登录状态' },
    { id: 'settings', status: settings.status === 'match' ? 'ok' : settings.status === 'invalid' ? 'error' : 'warn', label: 'Claude 代理设置', detail: settings.detail || settings.status },
    { id: 'process-env', status: processEnvironment.socksOnly || processEnvironment.conflicts.length || processEnvironment.conflictingVariants ? 'warn'
      : !context?.available || !processKeys.length ? 'unknown' : 'ok', label: '当前调用进程环境', detail: processEnvironment.socksOnly ? '仅检测到 SOCKS 代理，Claude 需要 HTTP/HTTPS 代理'
        : processEnvironment.conflicts.length || processEnvironment.conflictingVariants ? 'HTTP/HTTPS 代理或大小写变量冲突；运行中的进程可能保留旧环境'
          : '仅比较当前调用进程；不代表 Supervisor 或后台进程的环境' },
    { id: 'supervisor', status: supervisor.status === 'unsupported' ? 'unsupported' : 'unknown', label: 'Supervisor 环境未验证', detail: advisory }
  ];
  if (settings.socksOnly) checks.push({ id: 'settings-socks', status: 'warn', label: '设置仅包含 SOCKS 代理', detail: '请使用 HTTP/HTTPS 代理；ALL_PROXY 保持不变' });
  if (settings.gatewayConfigured || processEnvironment.gatewayConfigured) checks.push({ id: 'gateway', status: 'warn', label: '检测到用户第三方网关，未修改网关或凭据', detail: '仅检测相关配置键存在，未验证其是否生效；默认 Anthropic 服务探测不代表当前连接' });
  return { app: 'claude', installed, cliVersion, settings, supervisor, processEnvironment, checks, checkedAt: new Date().toISOString() };
}

async function commitSettings(location, loaded, nextSettings, nextState, io) {
  await expectSnapshot(location.settingsPath, loaded.settings, io);
  await expectSnapshot(location.statePath, loaded.state, io);
  let backupPath = null;
  if (loaded.settings.exists) {
    backupPath = path.join(location.dir, `.vpnctl-settings.${randomUUID()}.bak`);
    await writePrivate(backupPath, loaded.settings.text, io);
  }
  // Record ownership first; a failed settings replacement must restore the old record.
  const writtenState = await replace(location.statePath, encode(nextState), loaded.state, io);
  try {
    await expectSnapshot(location.statePath, writtenState, io);
    await replace(location.settingsPath, encode(nextSettings), loaded.settings, io);
  } catch (error) {
    try {
      if (loaded.state.exists) await replace(location.statePath, loaded.state.text, writtenState, io);
      else {
        await expectSnapshot(location.statePath, writtenState, io);
        await io.unlink(location.statePath);
      }
    } catch { fail('ROLLBACK_FAILED'); }
    throw error;
  }
  return backupPath;
}

export async function syncClaudeSettings({ context, env = process.env, confirmed = false, acknowledgeConflicts = false, plan, io = fs } = {}) {
  const location = paths(env);
  try {
    if (confirmed !== true) fail('CONFIRMATION_REQUIRED');
    if (!context?.available || !httpProxy(context.httpProxy)) fail('UNAVAILABLE');
    return await locked(location, io, async () => {
      const loaded = await load(location, io);
      const fresh = makePlan(location, loaded, context, acknowledgeConflicts);
      if (plan && (plan.settingsPath !== fresh.settingsPath || plan.expectedDigest !== fresh.expectedDigest
        || plan.expectedStateDigest !== fresh.expectedStateDigest || plan.targetDigest !== fresh.targetDigest)) fail('STALE');
      if (fresh.conflicts.length && acknowledgeConflicts !== true) fail('CONFLICT');
      if (!fresh.changes.length) return { app: 'claude', ok: true, changed: false, status: 'unchanged', settingsPath: location.settingsPath, warnings: fresh.warnings };
      const next = structuredClone(loaded.settings.value);
      const state = structuredClone(loaded.state.value);
      if (!own(next, 'env')) next.env = {};
      for (const { key } of fresh.changes) {
        const previous = state.keys[key];
        // A user edit supersedes old ownership; preserve it as the new rollback value.
        if (!previous || next.env[key] !== previous.written) {
          state.keys[key] = { previous: own(next.env, key) ? { exists: true, value: next.env[key] } : { exists: false }, written: context.httpProxy };
        } else state.keys[key].written = context.httpProxy;
        next.env[key] = context.httpProxy;
      }
      const backupPath = await commitSettings(location, loaded, next, state, io);
      return { app: 'claude', ok: true, changed: true, status: 'synced', settingsPath: location.settingsPath, backupPath, changes: fresh.changes, warnings: fresh.warnings };
    });
  } catch (error) { return resultError(error, location); }
}

export async function uninstallClaudeSettings({ env = process.env, confirmed = false, io = fs } = {}) {
  const location = paths(env);
  try {
    if (confirmed !== true) fail('CONFIRMATION_REQUIRED');
    // Without ownership, unrelated settings must not block shell uninstall.
    const state = parseState(await readSnapshot(location.statePath, io));
    if (!state.exists) return { app: 'claude', ok: true, changed: false, status: 'unmanaged', settingsPath: location.settingsPath, restored: [], preserved: [] };
    const initial = { state, settings: parseSettings(await readSnapshot(location.settingsPath, io)) };
    return await locked(location, io, async () => {
      const loaded = await load(location, io);
      if (initial.state.digest !== loaded.state.digest || initial.settings.digest !== loaded.settings.digest) fail('STALE');
      const next = structuredClone(loaded.settings.value);
      const current = next.env || {};
      const restored = [];
      const preserved = [];
      for (const [key, entry] of Object.entries(loaded.state.value.keys)) {
        if (!own(current, key) || current[key] !== entry.written) { preserved.push(key); continue; }
        if (entry.previous.exists) current[key] = entry.previous.value;
        else delete current[key];
        restored.push(key);
      }
      let backupPath = null;
      if (restored.length) backupPath = await commitSettings(location, loaded, next, { version: 1, keys: {} }, io);
      else await expectSnapshot(location.settingsPath, loaded.settings, io);
      const state = restored.length ? await readSnapshot(location.statePath, io) : loaded.state;
      await expectSnapshot(location.statePath, state, io);
      await io.unlink(location.statePath);
      return { app: 'claude', ok: true, changed: restored.length > 0, status: 'uninstalled', settingsPath: location.settingsPath, backupPath, restored, preserved, warnings: [advisory] };
    });
  } catch (error) { return resultError(error, location); }
}

// API 账号管理复用相同的用户归属检查、配置锁和原子文件替换。
export { paths as claudePaths, readSnapshot as readPrivateSnapshot, parseSettings, expectSnapshot,
  replace as replacePrivateFile, locked as withClaudeLock, writePrivate, digest, encode };
