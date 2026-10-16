import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { claudePaths, readPrivateSnapshot, parseSettings, expectSnapshot, replacePrivateFile, withClaudeLock, writePrivate, digest, encode } from './claude.mjs';

export const CLAUDE_PROVIDER_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_EFFORT_LEVEL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_OAUTH_TOKEN', 'NO_PROXY', 'no_proxy'];
const models = { model: 'ANTHROPIC_MODEL', opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL', sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL', haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', subagent: 'CLAUDE_CODE_SUBAGENT_MODEL', effort: 'CLAUDE_CODE_EFFORT_LEVEL' };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const fail = message => { throw new Error(message); };
const location = env => { const base = claudePaths(env); return { ...base, storePath: path.join(base.dir, '.vpnctl-providers.json') }; };
const clean = (value, label, max = 256) => {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail(`${label}格式无效`);
  return value.trim();
};
const modelsWith1m = profile => Object.keys(models).filter(key => key !== 'effort' && /\[1m\]$/i.test(profile[key] || '')).map(key => `${key}: ${profile[key]}`);
const require1mAcknowledgement = (profiles, acknowledged) => {
  if (acknowledged !== true && profiles.some(profile => modelsWith1m(profile).length)) fail('请明确确认模型及服务商支持 1M 上下文，未修改配置');
};

export function normalizeClaudeProvider(input, previous, id = previous?.id || randomUUID()) {
  if (!object(input)) fail('账号配置格式无效');
  const name = clean(input.name || '', '名称', 80);
  if (!name) fail('请输入账号名称');
  const protocol = input.protocol || 'anthropic';
  if (!['anthropic', 'openai-chat', 'openai-responses'].includes(protocol)) fail('不支持此 API 格式');
  const authType = input.authType || 'bearer';
  if (!['api-key', 'bearer'].includes(authType) || (protocol !== 'anthropic' && authType !== 'bearer')) fail('OpenAI 格式请选择 Bearer 认证；原生 Anthropic 可选 API Key');
  const baseUrl = clean(input.baseUrl || '', 'API 地址', 1024).replace(/\/+$/, '');
  let url;
  try { url = new URL(baseUrl); } catch { fail('API 地址必须是完整的 HTTP(S) 地址'); }
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) fail('API 地址不能包含凭据、查询参数或片段');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) fail('远程 API 必须使用 HTTPS，避免明文发送密钥');
  if (/\/(?:messages|chat\/completions|responses)$/.test(url.pathname)) fail('请填写 API 根地址，而非 messages/chat/completions/responses 完整请求路径');
  const secret = input.secret === '' || input.secret === undefined ? previous?.secret : clean(input.secret, '凭据', 8192);
  if (!secret || /\s/.test(secret)) fail('请输入有效凭据；编辑时留空才表示保留原密钥');
  const profile = { id, name, protocol, authType, baseUrl, secret, tokenField: input.tokenField || 'max_tokens' };
  if (!['max_tokens', 'max_completion_tokens'].includes(profile.tokenField)) fail('输出长度字段无效');
  for (const key of Object.keys(models)) profile[key] = clean(input[key] || '', '模型或努力级别');
  if (protocol !== 'anthropic' && !profile.model) fail('OpenAI 转换必须填写默认上游模型');
  if (!['', 'low', 'medium', 'high', 'max'].includes(profile.effort)) fail('努力级别请选择 low/medium/high/max 或留空');
  return profile;
}

const publicProfile = profile => Object.fromEntries([...['id', 'name', 'protocol', 'authType', 'baseUrl', 'tokenField', ...Object.keys(models)].map(key => [key, profile[key]]), ['hasSecret', Boolean(profile.secret)]]);

export async function readClaudeProviderStore({ env = process.env } = {}) {
  const where = location(env);
  const snapshot = await readPrivateSnapshot(where.storePath, fs);
  let value;
  try { value = snapshot.exists ? JSON.parse(snapshot.text) : { version: 1, profiles: [], activeId: null, applied: null, ownership: {} }; }
  catch { fail('API 账号存储不是有效 JSON，未修改'); }
  if (!object(value) || value.version !== 1 || !Array.isArray(value.profiles) || !object(value.ownership) || value.profiles.length > 100) fail('API 账号存储格式无效');
  const ids = new Set(), names = new Set();
  value.profiles = value.profiles.map(profile => {
    if (!object(profile) || typeof profile.id !== 'string' || !/^[a-f\d-]{36}$/.test(profile.id) || ids.has(profile.id)) fail('API 账号标识或名称重复');
    const normalized = normalizeClaudeProvider(profile, null, profile.id);
    if (names.has(normalized.name)) fail('API 账号标识或名称重复');
    ids.add(normalized.id); names.add(normalized.name);
    return normalized;
  });
  for (const [key, entry] of Object.entries(value.ownership)) {
    if (!CLAUDE_PROVIDER_KEYS.includes(key) || !object(entry) || !object(entry.previous) || typeof entry.previous.exists !== 'boolean'
      || (entry.written !== null && typeof entry.written !== 'string') || (entry.previous.exists && typeof entry.previous.value !== 'string')) fail('API 配置所有权记录无效');
  }
  if (value.activeId !== null && !ids.has(value.activeId)) fail('当前激活账号不存在');
  if (value.applied !== null) {
    if (!object(value.applied) || !object(value.applied.target) || !/^[a-f\d]{64}$/.test(value.applied.revision)) fail('已应用账号快照无效');
    if (!value.activeId || value.applied.profile?.id !== value.activeId) fail('已应用账号标识无效');
    value.applied.profile = normalizeClaudeProvider(value.applied.profile, null, value.activeId);
    if (digest(encode(value.applied.profile)) !== value.applied.revision) fail('已应用账号快照不一致');
    if (Object.keys(value.applied.target).some(key => !CLAUDE_PROVIDER_KEYS.includes(key) || (value.applied.target[key] !== null && typeof value.applied.target[key] !== 'string'))) fail('已应用配置字段无效');
    if (value.applied.profile.protocol !== 'anthropic') fail('尚不支持已激活的 OpenAI 转换账号');
    const expected = targetFor(value.applied.profile);
    if (Object.keys(value.applied.target).length !== Object.keys(expected).length || Object.entries(expected).some(([key, entry]) => value.applied.target[key] !== entry)) fail('已应用 API 字段与账号不一致');
  }
  if (value.activeId && !value.applied) fail('已激活账号缺少应用快照');
  return { where, snapshot, value };
}

export async function listClaudeProviders(options = {}) {
  const loaded = await readClaudeProviderStore(options);
  return { profiles: loaded.value.profiles.map(profile => ({ ...publicProfile(profile), active: profile.id === loaded.value.activeId,
    pending: profile.id === loaded.value.activeId && digest(encode(profile)) !== loaded.value.applied?.revision })), activeId: loaded.value.activeId,
    active: loaded.value.applied ? publicProfile(loaded.value.applied.profile) : null, path: loaded.where.storePath };
}

export function parseLegacyAccounts(source) {
  const result = [];
  let current;
  for (const raw of String(source).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^\[[^\[\]]+\]$/.test(line)) { current = { name: line.slice(1, -1), protocol: 'anthropic' }; result.push(current); continue; }
    const at = line.indexOf('=');
    if (!current || at <= 0) fail('旧账号文件格式无效；不会执行 Shell 内容');
    const key = line.slice(0, at).trim(), value = line.slice(at + 1);
    if (key === 'ANTHROPIC_BASE_URL') current.baseUrl = value;
    else if (key === 'ANTHROPIC_AUTH_TOKEN' || key === 'ANTHROPIC_API_KEY') {
      if (current.secret) fail('同一旧账号存在两种认证，请先整理后导入');
      current.authType = key === 'ANTHROPIC_API_KEY' ? 'api-key' : 'bearer'; current.secret = value;
    } else {
      const field = Object.keys(models).find(field => models[field] === key);
      if (!field) fail('旧账号文件包含不支持的字段');
      current[field] = value;
    }
  }
  if (!result.length) fail('旧账号文件没有账号');
  return result;
}

function targetFor(profile) {
  if (profile.protocol !== 'anthropic') fail('OpenAI 协议转换尚未接通');
  const target = Object.fromEntries(CLAUDE_PROVIDER_KEYS.filter(key => !['NO_PROXY', 'no_proxy'].includes(key)).map(key => [key, null]));
  for (const [field, key] of Object.entries(models)) target[key] = profile[field] || null;
  target.ANTHROPIC_BASE_URL = profile.baseUrl;
  target[profile.authType === 'api-key' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN'] = profile.secret;
  return target;
}

export async function prepareClaudeProviderAction(action, { env = process.env, input, id, file, context } = {}) {
  const loaded = await readClaudeProviderStore({ env });
  const settings = parseSettings(await readPrivateSnapshot(loaded.where.settingsPath, fs));
  const profile = loaded.value.profiles.find(profile => profile.id === id || profile.id === input?.id);
  const plan = { action, id: id || input?.id || randomUUID(), allowed: true, settingsPath: loaded.where.settingsPath,
    storeDigest: loaded.snapshot.digest, settingsDigest: settings.digest, steps: [], warnings: ['只管理 API 账号字段；不会删除登录凭据、MCP、hooks 或其他用户设置。', '已运行 Claude 会话需重新加载配置或重启；不强制中断任务。'] };
  let declarations = [];
  if (action === 'save') {
    if (input?.id && !profile) fail('账号不存在，请重新载入');
    const next = normalizeClaudeProvider(input, profile, plan.id);
    declarations = modelsWith1m(next);
    if (loaded.value.profiles.some(item => item.id !== next.id && item.name === next.name)) fail('账号名称已存在');
    plan.payloadDigest = digest(encode(next)); plan.profile = publicProfile(next);
    plan.steps.push({ label: `保存账号 ${next.name}；凭据仅写入当前用户的 0600 私有文件，尚不激活` });
  } else if (action === 'apply') {
    if (!profile) fail('请先选择账号');
    plan.profile = publicProfile(profile); plan.payloadDigest = digest(encode(profile));
    declarations = modelsWith1m(profile);
    if (!context?.available) { plan.allowed = false; plan.warnings.push('请先启动本账户 VPNCTL 代理，未应用账号'); }
    plan.steps.push({ label: `应用 ${profile.name}（${profile.protocol}）并备份 settings.json` });
    if (profile.protocol !== 'anthropic') {
      plan.allowed = false;
      plan.warnings.push('OpenAI 协议转换服务尚未接通；此账号只能保存，不能激活，不会写入不可用地址。');
    }
    plan.warnings.push('将替换 BASE_URL、认证、模型及云提供方选择字段；网络代理由 VPNCTL 动态解析。');
    if (settings.value.apiKeyHelper) plan.warnings.push('检测到 apiKeyHelper，未修改；请检查它是否与新凭据冲突。');
  } else if (action === 'delete') {
    if (!profile) fail('账号不存在');
    if (loaded.value.activeId === profile.id) { plan.allowed = false; plan.warnings.push('请先恢复原配置或激活其他账号，再删除当前账号'); }
    plan.steps.push({ label: `删除保存的账号 ${profile.name}，不删除其他账号` });
  } else if (action === 'restore') {
    plan.steps.push({ label: '仅恢复 VPNCTL 写入且未被用户更改的 API 字段，保留账号列表' });
  } else if (action === 'import') {
    const snapshot = await readPrivateSnapshot(path.resolve(file), fs);
    if (!snapshot.exists || snapshot.text.length > 1048576) fail('导入文件不存在或过大');
    const profiles = parseLegacyAccounts(snapshot.text).map(value => normalizeClaudeProvider(value));
    declarations = profiles.flatMap(modelsWith1m);
    const names = new Set(loaded.value.profiles.map(profile => profile.name));
    for (const item of profiles) { if (names.has(item.name)) fail('导入账号名称重复，请先更名'); names.add(item.name); }
    plan.file = path.resolve(file); plan.fileDigest = snapshot.digest; plan.names = profiles.map(profile => profile.name);
    plan.steps.push({ label: `将 ${profiles.length} 套旧账号导入私有存储，不执行文件、不修改 bashrc、不自动激活` });
  } else fail('不支持的账号操作');
  plan.requires1mConfirmation = declarations.length > 0;
  if (plan.requires1mConfirmation) {
    plan.steps.unshift({ label: `声明 1M 上下文：${declarations.slice(0, 8).join('；')}${declarations.length > 8 ? `；共 ${declarations.length} 项` : ''}` });
    plan.warnings.unshift('必须确认所选模型及服务商确实支持 1M 上下文；[1m] 仅为声明，不代表 VPNCTL 已验证容量或费用。');
    if (settings.value.env?.CLAUDE_CODE_DISABLE_1M_CONTEXT === '1' || env.CLAUDE_CODE_DISABLE_1M_CONTEXT === '1') {
      plan.warnings.push('检测到 CLAUDE_CODE_DISABLE_1M_CONTEXT=1，可能覆盖 1M 声明；保持用户原设置不变。');
    }
  }
  return plan;
}

async function commit(loaded, settings, next, nextSettings) {
  let backup;
  await expectSnapshot(loaded.where.settingsPath, settings, fs);
  if (nextSettings && settings.exists) {
    backup = path.join(loaded.where.dir, `.vpnctl-api-settings.${randomUUID()}.bak`);
    await writePrivate(backup, settings.text, fs);
  }
  const stored = await replacePrivateFile(loaded.where.storePath, encode(next), loaded.snapshot, fs);
  try { if (nextSettings) await replacePrivateFile(loaded.where.settingsPath, encode(nextSettings), settings, fs); }
  catch (error) {
    try { await replacePrivateFile(loaded.where.storePath, loaded.snapshot.exists ? loaded.snapshot.text : encode({ version: 1, profiles: [], activeId: null, applied: null, ownership: {} }), stored, fs); }
    catch { fail('写入失败且无法安全回滚；请检查受保护备份，未删除用户配置'); }
    throw error;
  }
  return backup;
}

export async function executeClaudeProviderAction(plan, { env = process.env, input, context, confirmed = false, acknowledge1m = false } = {}) {
  if (!confirmed) fail('需要明确确认后才能修改 API 账号');
  if (!plan.allowed) fail('当前不满足执行条件，请重新预览');
  if (plan.requires1mConfirmation && acknowledge1m !== true) fail('请明确确认模型及服务商支持 1M 上下文，未修改配置');
  if (plan.action === 'apply') {
    if (!context?.available) fail('当前 VPNCTL 代理不可用，未应用账号');
    if (plan.profile.protocol !== 'anthropic') fail('OpenAI 协议转换尚未接通，未应用账号');
  }
  const where = location(env);
  return withClaudeLock(where, fs, async () => {
    const loaded = await readClaudeProviderStore({ env });
    const settings = parseSettings(await readPrivateSnapshot(where.settingsPath, fs));
    if (loaded.snapshot.digest !== plan.storeDigest || settings.digest !== plan.settingsDigest) fail('账号或用户配置已变化，请重新预览');
    const next = structuredClone(loaded.value);
    let nextSettings;
    if (plan.action === 'save') {
      const index = next.profiles.findIndex(profile => profile.id === plan.id);
      const profile = normalizeClaudeProvider(input, next.profiles[index], plan.id);
      if (digest(encode(profile)) !== plan.payloadDigest) fail('输入已改变，请重新预览');
      require1mAcknowledgement([profile], acknowledge1m);
      if (next.profiles.some(item => item.id !== profile.id && item.name === profile.name)) fail('账号名称已存在');
      if (index >= 0) next.profiles[index] = profile; else next.profiles.push(profile);
    } else if (plan.action === 'delete') {
      if (next.activeId === plan.id) fail('请先恢复原配置或切换其他账号，再删除当前账号');
      next.profiles = next.profiles.filter(profile => profile.id !== plan.id);
    }
    else if (plan.action === 'import') {
      const imported = await readPrivateSnapshot(plan.file, fs);
      if (imported.digest !== plan.fileDigest) fail('导入文件已改变，请重新预览');
      const profiles = parseLegacyAccounts(imported.text).map(value => normalizeClaudeProvider(value));
      require1mAcknowledgement(profiles, acknowledge1m);
      next.profiles.push(...profiles);
    } else if (plan.action === 'apply') {
      const profile = next.profiles.find(profile => profile.id === plan.id);
      if (!profile || digest(encode(profile)) !== plan.payloadDigest) fail('账号已变化，请重新预览');
      require1mAcknowledgement([profile], acknowledge1m);
      if (profile.protocol !== 'anthropic') fail('OpenAI 协议转换尚未接通，未应用账号');
      const target = targetFor(profile);
      nextSettings = structuredClone(settings.value); nextSettings.env ||= {};
      for (const [key, value] of Object.entries(target)) {
        const current = nextSettings.env[key];
        if (current !== undefined && typeof current !== 'string') fail('已有 API 环境变量不是字符串，未覆盖');
        if (!next.ownership[key] || (current ?? null) !== next.ownership[key].written) next.ownership[key] = { previous: { exists: own(nextSettings.env, key), ...(own(nextSettings.env, key) ? { value: current } : {}) }, written: value };
        else next.ownership[key].written = value;
        if (value === null) delete nextSettings.env[key]; else nextSettings.env[key] = value;
      }
      next.activeId = profile.id;
      next.applied = { revision: digest(encode(profile)), profile: structuredClone(profile), target };
    } else if (plan.action === 'restore') {
      nextSettings = structuredClone(settings.value); nextSettings.env ||= {};
      for (const [key, entry] of Object.entries(next.ownership)) {
        if ((nextSettings.env[key] ?? null) !== entry.written) continue;
        if (entry.previous.exists) nextSettings.env[key] = entry.previous.value; else delete nextSettings.env[key];
      }
      next.ownership = {}; next.activeId = null; next.applied = null;
    }
    if (next.profiles.length > 100) fail('最多保存 100 套 API 账号');
    const backupPath = await commit(loaded, settings, next, nextSettings);
    return { ok: true, id: plan.id, backupPath, message: plan.action === 'apply' ? 'API 账号已应用；新会话生效。网络代理继续由 VPNCTL 动态提供。' : 'API 账号操作已完成；未修改 Codex 或 bashrc。' };
  });
}

export async function restoreClaudeProviders({ env = process.env, confirmed = false } = {}) {
  const loaded = await readClaudeProviderStore({ env });
  if (!loaded.value.activeId && !Object.keys(loaded.value.ownership).length) return { ok: true };
  const plan = await prepareClaudeProviderAction('restore', { env });
  return executeClaudeProviderAction(plan, { env, confirmed });
}

export async function claudeProviderEnvironment({ env = process.env } = {}) {
  const { value } = await readClaudeProviderStore({ env });
  if (!value.applied) return { ...env };
  if (value.applied.profile.protocol !== 'anthropic') {
    fail('OpenAI 转换服务尚未接通，请在 CLI 管理应用原生 Anthropic 账号');
  }
  const result = { ...env };
  for (const [key, entry] of Object.entries(value.applied.target)) { if (entry === null) delete result[key]; else result[key] = entry; }
  return result;
}
