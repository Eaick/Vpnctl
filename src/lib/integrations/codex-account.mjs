import { spawn } from 'node:child_process';
import { VPNCTL_VERSION } from '../version.mjs';
import { runCli } from './runtime.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const allowedMethods = new Set(['initialize', 'account/read', 'account/rateLimits/read']);
const plans = new Set(['free', 'go', 'plus', 'pro', 'team', 'business', 'enterprise', 'edu']);
const identitySignature = result => JSON.stringify([result?.requiresOpenaiAuth, ...['type', 'email', 'planType', 'accountId'].map(key => result?.account?.[key] ?? null)]);

function error(code) { return Object.assign(new Error(code), { code }); }

// 只为这次只读采样建立独立 stdio 连接，不连接或重启共享 Daemon。
export function openCodexReadSession({ env, spawnServer = spawn, timeoutMs = 20000, explicitStdio = true } = {}) {
  const child = spawnServer('codex', ['app-server', ...(explicitStdio ? ['--listen', 'stdio://'] : [])], {
    env: { ...env }, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
  });
  const pending = new Map();
  let sequence = 0, buffer = '', bytes = 0, failure = null, exited = false, closing = false;
  const fail = code => {
    failure = code;
    for (const item of pending.values()) item.reject(error(code));
    pending.clear();
  };
  const send = message => {
    if (failure || closing || exited) throw error(failure || 'CLOSED');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const timer = setTimeout(() => fail('TIMEOUT'), timeoutMs);
  child.on('error', () => fail('UNAVAILABLE'));
  child.on('close', () => { exited = true; if (!closing) fail('CLOSED'); });
  child.stdin.on('error', () => fail('CLOSED'));
  // 不保存 stderr 或通知内容，避免将认证材料带入诊断与日志。
  child.stderr.on('data', () => {});
  child.stderr.on('error', () => fail('CLOSED'));
  child.stdout.on('error', () => fail('CLOSED'));
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    if (failure || closing) return;
    bytes += Buffer.byteLength(chunk);
    if (bytes > 1048576) return fail('OUTPUT_LIMIT');
    buffer += chunk.toString();
    if (buffer.length > 262144) return fail('OUTPUT_LIMIT');
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { fail('PROTOCOL'); return; }
      if (!object(message)) { fail('PROTOCOL'); return; }
      if (message.method) {
        if (message.id !== undefined) {
          try { send({ id: message.id, error: { code: -32601, message: 'VPNCTL only supports read-only diagnostics' } }); }
          catch { fail('CLOSED'); }
        }
        continue;
      }
      const item = pending.get(message.id);
      if (!item) continue;
      pending.delete(message.id);
      if (message.error) item.reject(error(message.error.code === -32601 ? 'UNSUPPORTED' : 'RPC_FAILED'));
      else if (!Object.hasOwn(message, 'result')) item.reject(error('PROTOCOL'));
      else item.resolve(message.result);
    }
  });
  return {
    request(method, params) {
      if (!allowedMethods.has(method)) return Promise.reject(error('READ_ONLY'));
      if (failure || closing || exited) return Promise.reject(error(failure || 'CLOSED'));
      return new Promise((resolve, reject) => {
        const id = `vpnctl-${++sequence}`;
        pending.set(id, { resolve, reject });
        try { send({ id, method, ...(params === undefined ? {} : { params }) }); }
        catch { pending.delete(id); reject(error(failure || 'CLOSED')); }
      });
    },
    initialized() { send({ method: 'initialized', params: {} }); },
    async close() {
      clearTimeout(timer);
      closing = true;
      fail('CLOSED');
      if (exited) return;
      await new Promise(resolve => {
        const stop = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, 300);
        const force = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(); }, 1500);
        child.once('close', () => { clearTimeout(stop); clearTimeout(force); resolve(); });
        try { child.stdin.end(); } catch {}
      });
    }
  };
}

export function normalizeCodexAccount(result) {
  if (!object(result) || !Object.hasOwn(result, 'account') || typeof result.requiresOpenaiAuth !== 'boolean') {
    return { status: 'unverified', label: '账号响应无法识别', type: null, identity: null, planType: null };
  }
  const account = result.account;
  if (account === null) return {
    status: result.requiresOpenaiAuth ? 'signedOut' : 'notRequired', type: null, identity: null, planType: null,
    label: result.requiresOpenaiAuth ? '当前 CLI 未配置登录账号' : '当前提供方不要求 OpenAI 登录'
  };
  if (!object(account)) return { status: 'unverified', label: '账号响应无法识别', type: null, identity: null, planType: null };
  if (account.type === 'apiKey') return { status: 'configured', type: 'apiKey', identity: null, planType: null, label: '已配置 API Key（不展示密钥；额度需到对应平台查看）' };
  if (account.type === 'amazonBedrock') return { status: 'configured', type: 'amazonBedrock', identity: null, planType: null, label: 'Amazon Bedrock（不代表凭据已验证）' };
  if (account.type !== 'chatgpt') return { status: 'unsupported', type: null, identity: null, planType: null, label: '当前账号类型暂不支持展示' };
  const email = typeof account.email === 'string' && account.email.length <= 254 && /^[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d.-]+\.[a-z]{2,}$/i.test(account.email) ? account.email : null;
  const identity = email ? `${email[0]}***@${email.split('@')[1]}` : null;
  return { status: 'configured', type: 'chatgpt', identity, planType: plans.has(account.planType) ? account.planType : null,
    label: '当前 CLI 配置的 ChatGPT 账号（本地状态，非共享 Daemon 账号验证）' };
}

function normalizeWindow(value) {
  if (!object(value)) return null;
  return {
    usedPercent: typeof value.usedPercent === 'number' && Number.isFinite(value.usedPercent) && value.usedPercent >= 0 && value.usedPercent <= 100 ? value.usedPercent : null,
    windowDurationMins: Number.isSafeInteger(value.windowDurationMins) && value.windowDurationMins > 0 ? value.windowDurationMins : null,
    resetsAt: Number.isSafeInteger(value.resetsAt) && value.resetsAt > 0 && value.resetsAt <= 8640000000000 ? value.resetsAt : null
  };
}

export function normalizeCodexLimits(result) {
  if (!object(result) || (!Object.hasOwn(result, 'rateLimits') && !object(result.rateLimitsByLimitId))
    || (Object.hasOwn(result, 'rateLimits') && result.rateLimits !== null && !object(result.rateLimits))
    || (result.rateLimitsByLimitId != null && (!object(result.rateLimitsByLimitId) || Object.values(result.rateLimitsByLimitId).some(value => !object(value))))) {
    return { status: 'unverified', buckets: [], resetCreditsAvailable: null, detail: '额度响应无法识别；不推算余额或重置次数' };
  }
  const entries = object(result.rateLimitsByLimitId) && Object.keys(result.rateLimitsByLimitId).length
    ? Object.entries(result.rateLimitsByLimitId) : object(result.rateLimits) ? [[result.rateLimits.limitId || 'codex', result.rateLimits]] : [];
  entries.sort(([a], [b]) => a === 'codex' ? -1 : b === 'codex' ? 1 : 0);
  const buckets = entries.slice(0, 32).filter(([, value]) => object(value)).map(([id, value], index) => ({
    id: /^[a-z][a-z\d_.-]{0,63}$/i.test(id) && !/^(?:sk-|gh[pousr]_|github_pat_)/i.test(id) ? id : `bucket-${index + 1}`,
    primary: normalizeWindow(value.primary), secondary: normalizeWindow(value.secondary),
    credits: object(value.credits) ? {
      unlimited: value.credits.unlimited === true,
      balance: typeof value.credits.balance === 'string' && /^-?\d{1,20}(?:\.\d{1,8})?$/.test(value.credits.balance) ? value.credits.balance : null
    } : null
  }));
  const count = result.rateLimitResetCredits?.availableCount;
  return { status: 'ok', buckets, truncated: entries.length > 32,
    resetCreditsAvailable: Number.isSafeInteger(count) && count >= 0 ? count : null,
    detail: '官方额度接口已响应；不是现金余额，不代表模型推理可用' };
}

export async function inspectCodexAccount({ context, run = runCli, env = process.env, openSession = openCodexReadSession, spawnServer, timeoutMs = 20000 } = {}) {
  const checkedAt = new Date().toISOString();
  const unknown = detail => ({ account: { status: 'unverified', label: detail, checkedAt }, quota: { status: 'unverified', buckets: [], resetCreditsAvailable: null, detail, checkedAt } });
  if (!context?.available) return unknown('当前受管 HTTP 代理不可用，未读取账号或额度');
  let session, account = null;
  try {
    const help = await run('codex', ['app-server', '--help'], { env: context.env || env, timeoutMs: 5000 });
    if (!help.ok || help.missing) return unknown('当前 CLI 的 App Server 能力无法确认，未读取账号或额度');
    session = openSession({ env: context.env || env, timeoutMs, spawnServer, explicitStdio: /--listen\b/.test(help.stdout || '') });
    await session.request('initialize', { clientInfo: { name: 'vpnctl_diagnostics', title: 'VPNCTL read-only diagnostics', version: VPNCTL_VERSION } });
    session.initialized();
    const initialAccount = await session.request('account/read', { refreshToken: false });
    account = { ...normalizeCodexAccount(initialAccount), checkedAt };
    if (account.type !== 'chatgpt') return { account, quota: { status: 'unavailable', buckets: [], resetCreditsAvailable: null, detail: account.type === 'apiKey' ? 'API Key 模式不提供 ChatGPT 5h/weekly 额度或平台现金余额' : '当前未获得可查询的 ChatGPT 账号', checkedAt } };
    const quota = { ...normalizeCodexLimits(await session.request('account/rateLimits/read')), checkedAt: new Date().toISOString() };
    // 额度成功后复核账号，避免采样期间切号导致将额度归给另一个账号。
    const after = await session.request('account/read', { refreshToken: false });
    if (identitySignature(after) !== identitySignature(initialAccount)) {
      return unknown('采样期间账号发生变化，已丢弃额度，请重新读取');
    }
    return { account, quota };
  } catch (cause) {
    const detail = cause.code === 'UNSUPPORTED' ? '当前版本不支持该账号或额度接口' : cause.code === 'TIMEOUT' ? '读取账号或额度超时；请检查代理、登录与服务状态'
      : '读取账号或额度失败；可能涉及版本、网络或登录状态，未输出原始认证响应';
    return { account: account || { status: 'unverified', label: detail, checkedAt }, quota: { status: 'unverified', buckets: [], resetCreditsAvailable: null, detail, checkedAt } };
  } finally { try { await session?.close(); } catch {} }
}
