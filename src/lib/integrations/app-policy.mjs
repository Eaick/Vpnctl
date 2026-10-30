import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConfig } from '../config.mjs';
import { readPrivateSnapshot, replacePrivateFile, withClaudeLock, encode } from './claude.mjs';
import { buildApplicationEnvironment, resolveApplicationProxy } from './runtime.mjs';

export function applicationPaths(env = process.env) {
  const home = env.HOME || os.homedir();
  const root = env === process.env ? createConfig().paths.root
    : path.join(home, ...(process.platform === 'win32' ? ['.vpnctl'] : ['.local', 'share', 'vpnctl']));
  const dir = path.join(root, 'data', 'applications');
  return { dir, settingsPath: path.join(dir, 'policy.json'), lockPath: path.join(dir, '.lock'), shimDir: path.join(root, 'shims') };
}

export async function readApplicationPolicy(app, { env = process.env } = {}) {
  if (!['codex', 'claude'].includes(app)) throw new Error('应用只支持 codex 或 claude');
  const snapshot = await readPrivateSnapshot(applicationPaths(env).settingsPath, fs);
  const value = snapshot.exists ? JSON.parse(snapshot.text) : {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(x => typeof x !== 'boolean')) throw new Error('应用代理策略无效，未忽略安全设置');
  return { enabled: value[app] !== false, snapshot };
}

export async function setApplicationProxy(app, enabled, { env = process.env, confirmed = false, expectedDigest } = {}) {
  if (!confirmed || typeof enabled !== 'boolean') throw new Error('需要确认后才能修改应用代理');
  const where = applicationPaths(env);
  return withClaudeLock(where, fs, async () => {
    const current = await readApplicationPolicy(app, { env });
    if (expectedDigest && current.snapshot.digest !== expectedDigest) throw new Error('应用策略已变化，请重新预览');
    const settings = current.snapshot.exists ? JSON.parse(current.snapshot.text) : {};
    settings[app] = enabled;
    await replacePrivateFile(where.settingsPath, encode(settings), current.snapshot, fs);
    return { ok: true, enabled, message: `${app} 的 VPNCTL 代理已${enabled ? '开启' : '关闭'}；新启动会话生效，已有 Daemon/后台任务未重启。` };
  });
}

export async function resolveApplicationContext(app, options = {}) {
  const policy = await readApplicationPolicy(app, options);
  if (policy.enabled) return { ...await resolveApplicationProxy(options), proxyEnabled: true };
  return { available: true, proxyEnabled: false, httpProxy: null, displayProxy: '直连（VPNCTL 代理关闭）',
    env: buildApplicationEnvironment(null, options.env || process.env), checks: [
      { id: 'proxy', status: 'ok', label: 'VPNCTL 应用代理关闭', detail: '仅清理该子进程代理变量；未修改当前 Shell，未验证直连网络。' }
    ] };
}
