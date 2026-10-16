import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createConfig } from '../config.mjs';
import { getManagedRuntimeStatus } from '../managed-runtime.mjs';

const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'];

export function redactText(value) {
  return String(value ?? '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/(https?:\/\/|socks5h?:\/\/)[^\s/@]+@/gi, '$1[已隐藏]@')
    .replace(/([?&](?:token|key|api_key|auth|access_token)=)[^\s&#]+/gi, '$1[已隐藏]')
    .replace(/\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{12,}|github_pat_[\w]{12,})/g, '[已隐藏]')
    .replace(/((?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password)\s*[=:]\s*)(?:Bearer\s+)?[^\s,;}]+/gi, '$1[已隐藏]')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

export function runCli(command, args, { env = process.env, timeoutMs = 6000, input } = {}) {
  return new Promise((resolve) => {
    let stdout = '', stderr = '', timedOut = false, settled = false;
    let child;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr, missing: false, timedOut, ...result });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child?.kill('SIGTERM');
      finish({ stderr: '命令超时，未验证' });
    }, timeoutMs);
    try {
      child = spawn(command, args, { env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const capture = (key, chunk) => {
        if (key === 'stdout') stdout += chunk.toString();
        else stderr += chunk.toString();
        if (stdout.length + stderr.length > 262144) {
          child.kill('SIGTERM');
          finish({ stdout: '', stderr: '命令输出过大，已停止读取' });
        }
      };
      child.stdout.on('data', (chunk) => capture('stdout', chunk));
      child.stderr.on('data', (chunk) => capture('stderr', chunk));
      child.on('error', (error) => finish({ missing: error.code === 'ENOENT', stderr: redactText(error.message) }));
      child.on('close', (code) => finish({ ok: code === 0 && !timedOut, code }));
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    } catch (error) {
      finish({ stderr: redactText(error.message), missing: error.code === 'ENOENT' });
    }
  });
}

export function buildApplicationEnvironment(httpProxy, baseEnv = process.env) {
  const env = { ...baseEnv };
  delete env.ALL_PROXY;
  delete env.all_proxy;
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) {
    if (httpProxy) env[key] = httpProxy;
    else delete env[key];
  }
  return env;
}

export function probeProxyPort(endpoint, timeoutMs = 1000) {
  return new Promise((resolve) => {
    let socket;
    const finish = (available) => { socket?.destroy(); resolve(available); };
    try {
      const url = new URL(endpoint);
      if (!['http:', 'https:'].includes(url.protocol)) return finish(false);
      socket = net.createConnection({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) });
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.once('timeout', () => finish(false));
    } catch { finish(false); }
  });
}

export async function resolveApplicationProxy({ config = createConfig(), env = process.env, getStatus = getManagedRuntimeStatus, probe = probeProxyPort, timeoutMs = 3000 } = {}) {
  let runtime;
  let timer;
  const controller = new AbortController();
  const timeout = new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs); });
  try { runtime = await Promise.race([Promise.resolve().then(() => getStatus(config, { signal: controller.signal })), timeout]); }
  catch { runtime = null; }
  finally { clearTimeout(timer); }
  const managed = Boolean(runtime?.managedApiAlive);
  const connected = managed && await probe(config.httpProxy);
  const available = Boolean(managed && connected);
  const detail = !managed
    ? runtime?.foreignApiAlive ? '当前 API 属于其他实例，不使用其代理' : '本账户受管 Mihomo 未启动或身份无法确认'
    : !connected ? '当前 HTTP 代理端口不可连接' : '本账户受管 Mihomo 与 HTTP 代理端口已验证；尚未验证外网或登录';
  return {
    available,
    httpProxy: config.httpProxy,
    displayProxy: redactText(config.httpProxy),
    proxyMode: config.proxyMode,
    env: buildApplicationEnvironment(available ? config.httpProxy : null, env),
    issues: available ? [] : [detail],
    checks: [{ id: 'proxy', status: available ? 'ok' : 'error', label: available ? 'VPNCTL 代理可用' : 'VPNCTL 代理不可用', detail }]
  };
}

export async function inspectUserProcess(pid, { expectedHome, env = process.env, procRoot = '/proc', platform = process.platform, uid = process.getuid?.() } = {}) {
  const unavailable = { owned: false, environment: null, activeTasks: 'unknown' };
  if (platform !== 'linux' || !Number.isSafeInteger(Number(pid)) || Number(pid) <= 1) return unavailable;
  try {
    const root = path.join(procRoot, String(Number(pid)));
    const stat = await fs.stat(root);
    if (stat.uid !== uid) return unavailable;
    const command = (await fs.readFile(path.join(root, 'cmdline'), 'utf8')).split('\0');
    if (!/(?:^|[/\\])codex(?:-daemon)?(?:\.exe)?$/.test(command[0] || '') || !command.some((arg) => /^(?:app-server|daemon)$/.test(arg))) return unavailable;
    const raw = (await fs.readFile(path.join(root, 'environ'), 'utf8')).split('\0');
    const fields = Object.fromEntries(raw.filter(Boolean).map((item) => { const at = item.indexOf('='); return [item.slice(0, at), item.slice(at + 1)]; }));
    if (!fields.CODEX_HOME && !fields.HOME) return unavailable;
    const home = fields.CODEX_HOME || path.join(fields.HOME, '.codex');
    if (expectedHome && path.resolve(home) !== path.resolve(expectedHome)) return unavailable;
    return { owned: true, environment: Object.fromEntries(PROXY_KEYS.filter((key) => fields[key] !== undefined).map((key) => [key, fields[key]])), activeTasks: 'unknown' };
  } catch { return unavailable; }
}

export async function probeApplicationService(app, context, { run = runCli } = {}) {
  if (!context.available) return { id: 'network', status: 'unknown', label: '服务网络未检测', detail: '请先启动本账户受管 Mihomo 并检查代理端口' };
  const url = app === 'claude' ? 'https://api.anthropic.com/' : 'https://auth.openai.com/';
  const quote = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, '')}"`;
  // 代理凭据通过 stdin 传递，不放进可被进程列表读取的参数。
  const input = `proxy = ${quote(context.httpProxy)}\nnoproxy = ""\nurl = ${quote(url)}\nconnect-timeout = 5\nmax-time = 12\nsilent\nshow-error\noutput = ${quote(process.platform === 'win32' ? 'NUL' : '/dev/null')}\nwrite-out = "%{http_code}"\n`;
  const result = await run('curl', ['--config', '-'], { env: context.env, timeoutMs: 15000, input });
  const status = /^\d{3}$/.test(result.stdout?.trim()) ? Number(result.stdout.trim()) : 0;
  if (result.missing) return { id: 'network', status: 'unknown', label: '服务网络未检测', detail: '缺少 curl；其他诊断不受影响' };
  if (!result.ok || !status) return { id: 'network', status: 'error', label: '服务连接失败', detail: redactText(result.stderr || '未收到有效 HTTP 响应').slice(0, 240) };
  return { id: 'network', status: status === 403 || status >= 500 ? 'warn' : 'ok', label: `服务已响应 HTTP ${status}`, detail: '本次强制经 VPNCTL 测试；HTTP 响应不代表登录、额度或模型推理成功' };
}
