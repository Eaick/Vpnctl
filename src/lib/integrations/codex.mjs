import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { posix as path } from 'node:path';
import { runCli, redactText, inspectUserProcess } from './runtime.mjs';

const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy',
  'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'];
const FALLBACK = '可暂用 codex --no-daemon；不会删除凭据、历史或配置。';
const DAEMON_ARGS = ['app-server', 'daemon'];
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const incompatible = (value) => /(?:unsupported|unrecognized|unknown|invalid|incompatible)[^\n]{0,60}feature|feature[^\n]{0,60}(?:unsupported|unrecognized|unknown|incompatible)/i.test(value);

function processOptions(env, platform) {
  return {
    expectedHome: env.CODEX_HOME || `${(env.HOME || env.USERPROFILE || homedir()).replace(/[\\/]$/, '')}/.codex`,
    env: { ...env }, platform
  };
}

function pidNamespace(env, managedCodexPath) {
  const legacyRoot = `${path.join(processOptions(env, 'linux').expectedHome, 'packages', 'standalone')}/`;
  return typeof managedCodexPath === 'string' && path.normalize(managedCodexPath).startsWith(legacyRoot) ? 'legacy' : 'current';
}

async function readPidRecordFile(file) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 65536 || stat.uid !== process.getuid?.()) throw new Error('PID 记录不是本账户的常规文件');
    return await handle.readFile('utf8');
  } finally { await handle.close(); }
}

export async function readDaemonPid({ env = process.env, platform = process.platform,
  managedCodexPath, namespace = pidNamespace(env, managedCodexPath), readFile = readPidRecordFile } = {}) {
  if (platform !== 'linux') return null;
  const home = processOptions(env, platform).expectedHome;
  if (!path.isAbsolute(home) || !['legacy', 'current'].includes(namespace)) return null;
  const names = namespace === 'legacy' ? ['app-server.pid', 'daemon.pid'] : ['daemon.pid', 'app-server.pid'];
  let pid = null;
  for (const name of names) {
    let raw;
    try { raw = await readFile(path.join(home, 'app-server-daemon', name), 'utf8'); }
    catch (error) {
      if (error?.code === 'ENOENT') continue;
      return null;
    }
    try {
      if (typeof raw !== 'string' || raw.length > 65536) return null;
      const record = JSON.parse(raw);
      if (!Number.isSafeInteger(record?.pid) || record.pid <= 1 || record.pid > 0xffffffff) return null;
      if (pid !== null && pid !== record.pid) return null;
      pid = record.pid;
    } catch { return null; }
  }
  return pid;
}

function safeDetail(value, context, env) {
  let text = String(value ?? '');
  const secrets = new Set([context?.httpProxy]);
  for (const source of [env, context?.env]) {
    for (const [key, item] of Object.entries(source || {})) {
      if ((PROXY_KEYS.includes(key) && !/no_proxy/i.test(key)) ||
          /token|password|secret|authorization|cookie|credential|api[_-]?key/i.test(key)) {
        if (typeof item === 'string' && item) secrets.add(item);
      }
    }
  }
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join('[已隐藏]');
  }
  return redactText(text).slice(0, 3000);
}

function version(value) {
  if (typeof value !== 'string' || value.length > 120) return null;
  return value.trim().match(/^(?:codex(?:-cli)?\s+)?v?(\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?)$/)?.[1] || null;
}

function listed(help, command) {
  const section = help.split(/^Commands:\s*$/m)[1]?.split(/^\S.*:\s*$/m)[0] || '';
  return new RegExp(`^\\s{1,8}${command}(?:\\s|$)`, 'm').test(section);
}

function flag(help, name) {
  return new RegExp(`^\\s+(?:-\\w,\\s*)?--${name}(?=[\\s=,]|$)`, 'm').test(help);
}

async function command(run, args, env, timeoutMs) {
  try {
    const result = await run('codex', args, { env: { ...env }, timeoutMs });
    if (!result || typeof result !== 'object') return { ok: false, stdout: '', stderr: '命令未返回有效结果' };
    return { ...result, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? ''),
      ok: result.ok === true && (result.code == null || result.code === 0) && !result.timedOut && !result.missing };
  } catch (error) {
    return { ok: false, missing: error?.code === 'ENOENT', stdout: '', stderr: String(error?.message || error) };
  }
}

function mutationFailure(stdout, step) {
  if (!stdout.trim()) return null;
  let data;
  try { data = JSON.parse(stdout); }
  catch { return /^[\s]*[\[{]/.test(stdout) ? '命令返回无效 JSON，执行结果未知，可能已产生部分更改。' : null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '命令返回的 JSON 结构无法核验，可能已产生部分更改。';
  const accepted = { stop: ['stopped', 'notRunning'], update: ['updated', 'noUpdate'], start: ['started', 'alreadyRunning'] };
  if (data.ok === false || data.success === false || data.error || !accepted[step].includes(data.status)) {
    return '命令报告拒绝、失败、忙碌或未知状态，已停止后续操作；请重新诊断可能的部分更改。';
  }
  return null;
}

function tasks(value) {
  const status = typeof value === 'string' ? value : value?.status;
  if (!['idle', 'active'].includes(status)) return { status: 'unknown' };
  const count = value?.count;
  if (status === 'idle' && Number.isSafeInteger(count) && count > 0) return { status: 'unknown' };
  return { status, ...(Number.isSafeInteger(count) && count >= 0 ? { count } : {}) };
}

function readDaemon(data, parseVersion) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const managedRaw = data.managedCodexVersion;
  const serverRaw = data.appServerVersion;
  const managedCodexVersion = parseVersion(managedRaw);
  const appServerVersion = parseVersion(serverRaw);
  const cliVersion = data.cliVersion == null ? null : parseVersion(data.cliVersion);
  if ((managedRaw != null && !managedCodexVersion) || (serverRaw != null && !appServerVersion) ||
      (data.cliVersion != null && !cliVersion)) return null;
  const pid = Number.isSafeInteger(data.pid) && data.pid > 1 && data.pid <= 0xffffffff ? data.pid : null;
  if (data.pid != null && !pid) return null;
  const running = ['running', 'alreadyRunning', 'started', 'restarted'].includes(data.status) ? true :
    data.status === 'notRunning' || data.status === 'stopped' ? false : null;
  if (running === null || (typeof data.running === 'boolean' && data.running !== running)) return null;
  if (running === false && (pid || appServerVersion)) return null;
  return { managedCodexVersion, appServerVersion, running, pid,
    managedCodexPath: typeof data.managedCodexPath === 'string' ? data.managedCodexPath : null,
    cliVersion };
}

export async function inspectCodex({ context, run = runCli, env = process.env,
  inspectProcess = inspectUserProcess, platform = process.platform, network = false,
  readDaemonPid: readPid = readDaemonPid, timeoutMs = 6000 } = {}) {
  const appEnv = { ...(context?.env || env) };
  const publicVersion = (value) => {
    const parsed = version(value);
    return parsed && safeDetail(parsed, context, env) === parsed ? parsed : null;
  };
  const report = {
    app: 'codex', installed: null, cliVersion: null, platform,
    proxyAvailable: context?.available === true,
    proxyFingerprint: hash([context?.available === true, context?.httpProxy || null,
      processOptions(appEnv, platform).expectedHome,
      context?.proxyMode || null, PROXY_KEYS.map((key) => [key, appEnv[key] ?? null])]),
    daemon: {
      supported: false, running: null, managedCodexVersion: null, appServerVersion: null,
      versionMismatch: null, process: { pid: null, owned: false },
      environment: { status: 'unverified', label: '守护进程代理环境未验证' },
      activeTasks: { status: 'unknown' },
      capabilities: { version: false, versionJson: false, start: false, stop: false,
        update: false, updateFromCli: false, updateYes: false }
    },
    checks: [], checkedAt: new Date().toISOString()
  };
  const check = (id, status, label, detail) => report.checks.push({ id, status, label,
    detail: safeDetail(detail, context, env) });
  const invoke = async (args) => {
    const result = await command(run, args, appEnv, timeoutMs);
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    if (incompatible(output)) {
      check('feature-compatibility', 'error', 'Codex 功能配置与当前版本不兼容', output);
    }
    return result;
  };
  const finish = () => {
    const daemon = report.daemon;
    check('daemon-environment', daemon.environment.status === 'match' ? 'ok' :
      daemon.environment.status === 'mismatch' ? 'warn' : 'unknown', daemon.environment.label,
    daemon.environment.status === 'mismatch'
      ? '旧守护进程会保留启动时的环境；仅设置当前 CLI 环境不会更新已有进程。'
      : '只核对进程代理变量，不读取认证文件，也不验证登录或推理。');
    check('active-tasks', daemon.activeTasks.status === 'idle' ? 'ok' :
      daemon.activeTasks.status === 'active' ? 'warn' : 'unknown',
    '守护进程任务状态', daemon.activeTasks.status === 'unknown'
      ? '无法确认是否有任务运行；停止前必须额外确认可能中断工作。' : daemon.activeTasks.status === 'idle' ? '当前无活动任务。' : '存在活动任务，停止可能中断工作。');
    check('network', 'unknown', '服务网络未检测', network
      ? '此适配器不发起登录或模型推理请求；网络连通性由外层单独检查。'
      : '未发起服务网络、登录或模型推理请求。');
    return report;
  };
  check('proxy', report.proxyAvailable ? 'ok' : 'error', report.proxyAvailable ? 'VPNCTL 代理可用' : 'VPNCTL 代理不可用',
    report.proxyAvailable ? '使用调用方提供的应用代理环境；修复前调用方仍须重新检查代理可用性。' : '请先由调用方检查本账户受管代理。');
  check('platform', platform === 'linux' ? 'ok' : 'unsupported', 'Codex 守护进程修复平台',
    platform === 'linux' ? '允许继续检查修复前提。' : '仅支持在 Linux 上修复；其他平台仅诊断。');
  const cli = await invoke(['--version']);
  report.installed = cli.missing ? false : cli.ok ? true : null;
  report.cliVersion = cli.ok ? publicVersion(cli.stdout) : null;
  check('cli', report.cliVersion ? 'ok' : cli.missing ? 'unsupported' : 'unknown',
    cli.missing ? '未安装 Codex CLI' : report.cliVersion ? 'Codex CLI 已安装' : 'Codex CLI 版本未验证',
    cli.timedOut ? '读取 CLI 版本超时。' : cli.stderr || (report.cliVersion ? `CLI ${report.cliVersion}` : '未获取有效 CLI 版本。'));
  if (!cli.ok) return finish();
  const daemonHelp = await invoke([...DAEMON_ARGS, '--help']);
  if (!daemonHelp.ok) {
    check('daemon', daemonHelp.timedOut ? 'unknown' : 'unsupported', '守护进程功能未验证',
      daemonHelp.timedOut ? '读取帮助超时。' : daemonHelp.stderr || '当前 CLI 未提供可用的 app-server daemon 帮助。');
    return finish();
  }
  const caps = report.daemon.capabilities;
  const daemonCommands = ['version', 'start', 'stop', 'update'].filter((name) => listed(daemonHelp.stdout, name));
  report.daemon.supported = daemonCommands.includes('version');
  for (const name of daemonCommands) {
    const result = await invoke([...DAEMON_ARGS, name, '--help']);
    caps[name] = result.ok;
    if (name === 'version') caps.versionJson = result.ok && flag(result.stdout, 'json');
    if (name === 'update') {
      caps.updateFromCli = result.ok && flag(result.stdout, 'from-cli');
      caps.updateYes = result.ok && flag(result.stdout, 'yes');
    }
    if (!result.ok) check(`help-${name}`, 'unknown', '守护进程命令能力未验证',
      result.timedOut ? '读取命令帮助超时。' : result.stderr || '无法读取命令帮助。');
  }
  if (!caps.version) {
    check('daemon', 'unsupported', '不支持读取守护进程版本', '帮助中没有已验证的 app-server daemon version 命令。');
    return finish();
  }
  const output = await invoke([...DAEMON_ARGS, 'version', ...(caps.versionJson ? ['--json'] : [])]);
  let state;
  try { state = output.ok ? readDaemon(JSON.parse(output.stdout), publicVersion) : null; } catch { state = null; }
  if (!state) {
    check('daemon', 'unknown', '守护进程状态未验证', output.timedOut ? '读取守护进程版本超时。' :
      output.stderr || '未返回可识别的版本 JSON；不推断进程已停止，也不修改配置。');
    return finish();
  }
  const daemon = report.daemon;
  Object.assign(daemon, { running: state.running, managedCodexVersion: state.managedCodexVersion,
    appServerVersion: state.appServerVersion });
  if (state.cliVersion && state.cliVersion !== report.cliVersion) {
    check('cli-version-drift', 'error', '诊断期间 CLI 版本发生变化', '独立 CLI 版本与守护进程报告中的 cliVersion 不一致，请重新诊断。');
    return finish();
  }
  const versions = [state.managedCodexVersion, ...(state.running === true ? [state.appServerVersion] : [])];
  daemon.versionMismatch = report.cliVersion && versions.some((item) => item && item !== report.cliVersion)
    ? true : report.cliVersion && state.running !== null && versions.every(Boolean) ? false : null;
  check('daemon', state.running === true ? 'ok' : state.running === false ? 'warn' : 'unknown',
    state.running === true ? '守护进程正在运行' : state.running === false ? '守护进程未运行' : '守护进程状态未知',
    '受管 Codex 包版本与运行中的 app-server 版本分别检查。');
  check('daemon-versions', daemon.versionMismatch === true ? 'warn' : daemon.versionMismatch === false ? 'ok' : 'unknown',
    daemon.versionMismatch === true ? 'CLI、受管包或 app-server 版本不一致' : '守护进程版本检查',
    `CLI：${report.cliVersion || '未知'}；受管包：${state.managedCodexVersion || '未知'}；app-server：${state.appServerVersion || '未知或未运行'}。`);
  if (state.running === true) {
    daemon.process.namespace = pidNamespace(appEnv, state.managedCodexPath);
    let pid;
    try { pid = await readPid({ env: { ...appEnv }, platform, namespace: daemon.process.namespace }); }
    catch (error) { check('daemon-pid', 'unknown', '守护进程 PID 记录未验证', error?.message || '无法读取 PID 记录。'); }
    if (!Number.isSafeInteger(pid) || pid <= 1 || pid > 0xffffffff || (state.pid && state.pid !== pid)) {
      check('daemon-pid', 'unknown', '守护进程 PID 记录未验证', '当前应用目录中的 PID 记录缺失、无效或与报告冲突，禁止使用任意 PID。');
    } else {
      daemon.process.pid = pid;
    }
  }
  if (state.running === true && daemon.process.pid) {
    let processInfo;
    try {
      processInfo = await inspectProcess(daemon.process.pid, processOptions(appEnv, platform));
    } catch (error) {
      check('daemon-process', 'unknown', '进程归属检查失败', error?.message || '无法检查守护进程。');
    }
    daemon.process.owned = processInfo?.owned === true;
    if (daemon.process.owned) {
      daemon.activeTasks = tasks(processInfo.activeTasks);
      if (context?.env && processInfo.environment && typeof processInfo.environment === 'object') {
        const matches = PROXY_KEYS.every((key) => (processInfo.environment[key] ?? '') === (appEnv[key] ?? ''));
        daemon.environment = { status: matches ? 'match' : 'mismatch',
          label: matches ? '守护进程代理环境与 VPNCTL 一致' : '守护进程仍使用不同的代理环境' };
      }
    }
  }
  if (state.running === true) check('daemon-ownership', daemon.process.owned ? 'ok' : 'unknown',
    '守护进程归属', daemon.process.owned ? '已核对本账户、Codex 进程与应用目录。' : '无法确认进程属于本账户及预期应用目录，禁止停止。');
  return finish();
}

export function planCodexRepair(report) {
  const daemon = report?.daemon;
  const caps = daemon?.capabilities || {};
  const warnings = [];
  const steps = [];
  if (report?.installed !== true || !version(report?.cliVersion)) warnings.push('Codex CLI 安装或版本尚未验证。');
  if (report?.platform !== 'linux') warnings.push('仅支持在 Linux 上修复守护进程。');
  if (report?.proxyAvailable !== true) warnings.push('VPNCTL 代理不可用，禁止修复。');
  if (!daemon?.supported || !caps.version || typeof daemon.running !== 'boolean') warnings.push('守护进程状态或版本命令尚未验证。');
  if (typeof daemon?.versionMismatch !== 'boolean') warnings.push('无法确认完整版本关系，禁止猜测更新。');
  if (report?.checks?.some((item) => item.id === 'feature-compatibility' && item.status === 'error')) {
    warnings.push('检测到不兼容功能配置；请人工检查，不会自动删除配置。');
  }
  if (report?.checks?.some((item) => item.id === 'cli-version-drift')) warnings.push('诊断期间 CLI 版本发生变化，请重新诊断。');
  const needsRestart = daemon?.running !== true || daemon?.environment?.status !== 'match' || daemon?.versionMismatch !== false;
  if (needsRestart) {
    if (daemon?.running === true) {
      steps.push({ id: 'stop', label: '停止本账户 Codex 守护进程', args: [...DAEMON_ARGS, 'stop'] });
      if (!caps.stop) warnings.push('当前 CLI 未验证支持 app-server daemon stop。');
      if (daemon.process?.owned !== true || !Number.isSafeInteger(daemon.process?.pid) || daemon.process.pid <= 1) warnings.push('无法确认运行进程归属，禁止停止其他账户或未知进程。');
    }
    if (daemon?.versionMismatch === true) {
      steps.push({ id: 'update', label: '从当前 CLI 更新受管 Codex 包', args: [...DAEMON_ARGS, 'update', '--from-cli', '--yes'] });
      if (!caps.update || !caps.updateFromCli || !caps.updateYes) warnings.push('未验证支持 app-server daemon update --from-cli --yes。');
    }
    steps.push({ id: 'start', label: '使用 VPNCTL 应用环境启动守护进程', args: [...DAEMON_ARGS, 'start'] });
    if (!caps.start) warnings.push('当前 CLI 未验证支持 app-server daemon start。');
  }
  const requiresActiveConfirmation = steps.length > 0 && daemon?.activeTasks?.status !== 'idle';
  const blocking = warnings.length > 0;
  if (daemon?.versionMismatch === true) warnings.push('从 CLI 更新会选择并固定当前 CLI 的包版本；之后不会自动改用其他版本的包，请按 CLI 帮助管理更新来源。');
  if (requiresActiveConfirmation) warnings.push('活动任务未知或仍在运行；必须额外确认允许中断。');
  if (daemon?.environment?.status === 'unverified') warnings.push('无法读取代理环境时，执行后也只能报告未验证。');
  warnings.push('调用方须在执行前重新检查代理可用性；不删除凭据、历史或配置。');
  const fingerprint = hash({ cli: report?.cliVersion ?? null, platform: report?.platform ?? null,
    proxy: report?.proxyFingerprint ?? null, available: report?.proxyAvailable === true,
    daemon: daemon ? { supported: daemon.supported, running: daemon.running,
      managed: daemon.managedCodexVersion, server: daemon.appServerVersion,
      mismatch: daemon.versionMismatch, process: daemon.process,
      environment: daemon.environment?.status, tasks: daemon.activeTasks, caps } : null,
    steps, blocking });
  return { allowed: !blocking, steps, warnings, requiresActiveConfirmation, fingerprint };
}

export async function repairCodex({ context, report, confirmed = false, acknowledgeActive = false,
  run = runCli, env = process.env, inspectProcess = inspectUserProcess,
  platform = process.platform, readDaemonPid: readPid = readDaemonPid,
  timeoutMs = 6000, mutationTimeoutMs = 180000, onProgress } = {}) {
  let changed = false;
  const completed = [];
  const result = (status, detail, fresh) => ({ app: 'codex', ok: status === 'verified',
    status, verified: status === 'verified', changed, steps: completed,
    detail: safeDetail(detail, context, env), suggestion: FALLBACK, ...(fresh ? { report: fresh } : {}) });
  if (confirmed !== true) return result('refused', '修复需要明确确认，尚未执行任何更改。');
  if (platform !== 'linux') return result('refused', '仅支持在 Linux 上修复守护进程。');
  if (context?.available !== true || !context.httpProxy || !context.env) return result('refused', 'VPNCTL 代理不可用或应用环境缺失；请先重新检查代理。');
  const snapshot = { ...context, env: { ...context.env } };
  const options = { context: snapshot, run, env, inspectProcess, platform, readDaemonPid: readPid, timeoutMs };
  const fresh = await inspectCodex(options);
  const plan = planCodexRepair(fresh);
  if (report && planCodexRepair(report).fingerprint !== plan.fingerprint) {
    return result('refused', '版本、任务、进程归属或修复计划发生变化，请重新诊断并重新确认。', fresh);
  }
  if (!plan.allowed) return result('refused', plan.warnings.join('\n'), fresh);
  if (plan.requiresActiveConfirmation && acknowledgeActive !== true) {
    return result('refused', '任务状态未知或存在活动任务，需要额外确认允许中断工作。', fresh);
  }
  const progress = (event) => {
    try { onProgress?.(event); } catch { /* 界面回调失败不得改变服务操作顺序。 */ }
  };
  for (const step of plan.steps) {
    if (step.id === 'stop') {
      let pid;
      try { pid = await readPid({ env: { ...snapshot.env }, platform, namespace: fresh.daemon.process.namespace }); }
      catch { return result('refused', '停止前无法重新读取 PID 记录，未执行停止。', fresh); }
      if (pid !== fresh.daemon.process.pid) return result('refused', '停止前 PID 记录发生变化，请重新诊断并确认。', fresh);
      let processInfo;
      try { processInfo = await inspectProcess(fresh.daemon.process.pid, processOptions(snapshot.env, platform)); }
      catch (error) { return result('refused', `停止前无法重新确认进程归属：${error?.message || '检查失败'}`, fresh); }
      if (processInfo?.owned !== true) return result('refused', '停止前进程归属发生变化或无法确认，未执行停止。', fresh);
      if (tasks(processInfo.activeTasks).status !== 'idle' && acknowledgeActive !== true) {
        return result('refused', '停止前任务状态发生变化或未知，需要重新确认允许中断。', fresh);
      }
    }
    // 启动、更新和停止均只继承独立副本，绝不修改调用方的环境。
    progress({ id: step.id, status: 'running', label: step.label });
    const outcome = await command(run, step.args, snapshot.env, mutationTimeoutMs);
    changed = true;
    const failure = outcome.ok ? mutationFailure(outcome.stdout, step.id) : null;
    const detail = safeDetail(outcome.timedOut ? '命令超时；可能已产生部分更改，请重新诊断。' :
      [failure, outcome.stderr, outcome.stdout].filter(Boolean).join('\n'), snapshot, env);
    const ok = outcome.ok && !failure && !incompatible([outcome.stdout, outcome.stderr].join('\n'));
    const item = { id: step.id, label: step.label, status: ok ? 'ok' : 'error', detail };
    completed.push(item);
    progress(item);
    if (!ok) return result('failed', `${step.label}失败。${detail}`);
  }
  const verified = await inspectCodex(options);
  const daemon = verified.daemon;
  if (verified.cliVersion !== fresh.cliVersion || daemon.running === false || daemon.versionMismatch === true ||
      daemon.environment.status === 'mismatch' || verified.checks.some((item) => item.id === 'feature-compatibility' && item.status === 'error')) {
    return result('failed', '执行后版本、运行状态或代理环境仍不符合预期；请重新诊断，不会自动重试或删除配置。', verified);
  }
  if (daemon.running !== true || daemon.versionMismatch !== false || daemon.environment.status !== 'match' || !daemon.process.owned) {
    return result('unverified', '命令已执行，但无法完整核验守护进程版本、归属与代理环境；不能认定修复验证成功。', verified);
  }
  return result('verified', '已重新读取版本并核对本账户守护进程代理环境；未验证登录或模型推理。', verified);
}
