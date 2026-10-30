import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { readPrivateSnapshot, replacePrivateFile, withClaudeLock, encode } from './claude.mjs';
import { normalizeClaudeProvider } from './claude-providers.mjs';
import { runCli } from './runtime.mjs';

function location(env) {
  const dir = path.resolve(env.CODEX_HOME || path.join(env.HOME || env.USERPROFILE || os.homedir(), '.codex'));
  return { dir, file: path.join(dir, '.vpnctl-providers.json'), lockPath: path.join(dir, '.vpnctl-providers.lock') };
}
const publicProfile = profile => ({ id: profile.id, name: profile.name, baseUrl: profile.baseUrl,
  model: profile.model, hasSecret: Boolean(profile.secret) });
async function load(env) {
  const where = location(env);
  const snapshot = await readPrivateSnapshot(where.file, fs);
  const value = snapshot.exists ? JSON.parse(snapshot.text) : { version: 1, profiles: [], activeId: null };
  if (value?.version !== 1 || !Array.isArray(value.profiles) || value.profiles.length > 100) throw new Error('Codex 账号文件无效');
  const seen = new Set();
  for (const profile of value.profiles) {
    normalize(profile, profile.id);
    if (seen.has(profile.id)) throw new Error('Codex 账号标识重复');
    seen.add(profile.id);
  }
  if (value.activeId !== null && !seen.has(value.activeId)) throw new Error('当前 Codex 账号不存在');
  return { where, snapshot, value };
}
function normalize(input, id = randomUUID(), previous) {
  const validated = normalizeClaudeProvider({ ...input, protocol: 'openai-responses', authType: 'bearer' }, previous, id);
  return { id, name: validated.name, baseUrl: validated.baseUrl, secret: validated.secret, model: validated.model };
}
export async function listCodexProviders({ env = process.env } = {}) {
  const { value } = await load(env);
  return { activeId: value.activeId, profiles: value.profiles.map(profile => ({ ...publicProfile(profile), active: value.activeId === profile.id })) };
}
export async function prepareCodexProvider(action, { env = process.env, input, id } = {}) {
  const { value, snapshot } = await load(env);
  const previous = value.profiles.find(item => item.id === (input?.id || id));
  if (action === 'save') normalize(input, previous?.id, previous);
  else if (action !== 'restore' && !previous) throw new Error('账号不存在');
  return { action, id, allowed: true, expectedDigest: snapshot.digest, steps: [{ label:
    `${({ save: '保存', apply: '使用', delete: '删除', restore: '恢复原有配置' })[action] || '无效操作'}${previous ? `：${previous.name}` : ''}；新会话生效` }],
    warnings: ['API 账号使用服务商计费，不能用 ChatGPT 的 5h/weekly 额度表示。已有后台会话需自行结束或重启。'] };
}
export async function editCodexProvider(action, { env = process.env, input, id, confirmed = false, expectedDigest } = {}) {
  if (!confirmed) throw new Error('请确认账号操作');
  const where = location(env);
  return withClaudeLock(where, fs, async () => {
    const { value, snapshot } = await load(env);
    if (expectedDigest && snapshot.digest !== expectedDigest) throw new Error('账号记录已变化，请重新预览');
    if (action === 'save') {
      const previous = value.profiles.find(profile => profile.id === input?.id);
      if (input?.id && !previous) throw new Error('账号不存在');
      const profile = normalize(input, previous?.id, previous);
      if (value.profiles.some(item => item.id !== profile.id && item.name === profile.name)) throw new Error('账号名称重复');
      if (previous) value.profiles[value.profiles.indexOf(previous)] = profile;
      else { if (value.profiles.length >= 100) throw new Error('最多保存 100 个账号'); value.profiles.push(profile); }
      id = profile.id;
    } else if (action === 'restore') value.activeId = null;
    else {
      if (!value.profiles.some(profile => profile.id === id)) throw new Error('账号不存在');
      if (action === 'apply') value.activeId = id;
      else if (action === 'delete') {
        value.profiles = value.profiles.filter(profile => profile.id !== id);
        if (value.activeId === id) value.activeId = null;
      } else throw new Error('不支持的账号操作');
    }
    await replacePrivateFile(where.file, encode(value), snapshot, fs);
    return { ok: true, id, message: '账号设置已保存，新启动的 Codex 会话生效；已有后台会话未改动。' };
  });
}
export async function codexProviderLaunch(args, { env = process.env } = {}) {
  if (!env.CODEX_HOME && !env.HOME && !env.USERPROFILE) return { args, env: { ...env } };
  const { value } = await load(env);
  const profile = value.profiles.find(item => item.id === value.activeId);
  if (!profile || ['login', 'logout', 'app-server', '--version', '-v', '--help', '-h'].includes(args[0])) return { args, env: { ...env } };
  const config = { model_provider: 'vpnctl_api', model: profile.model,
    'model_providers.vpnctl_api.name': profile.name, 'model_providers.vpnctl_api.base_url': profile.baseUrl,
    'model_providers.vpnctl_api.env_key': 'VPNCTL_CODEX_API_KEY', 'model_providers.vpnctl_api.wire_api': 'responses',
    'model_providers.vpnctl_api.requires_openai_auth': false };
  return { apiManaged: true, args: [...Object.entries(config).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`]), ...args],
    env: { ...env, VPNCTL_CODEX_API_KEY: profile.secret } };
}

export async function isolateCodexApiLaunch(launch, { run = runCli } = {}) {
  if (!launch.apiManaged || launch.args.includes('--no-daemon')) return launch;
  const help = await run('codex', ['--help'], { env: launch.env, timeoutMs: 5000 });
  if (!help.ok) throw new Error('无法确认 Codex 启动能力，未将 API 密钥交给已有后台服务');
  if (/--no-daemon\b/.test(help.stdout || '')) return { ...launch, args: ['--no-daemon', ...launch.args] };
  if (/daemon/i.test(help.stdout || '')) throw new Error('当前 Codex 支持后台服务但无法确认独立启动方式，请更新 CLI 后重试');
  return launch;
}
