import { detectShellIntegration, installShellIntegration } from '../shell.mjs';
import { inspectCodex, planCodexRepair, repairCodex } from './codex.mjs';
import { inspectClaude, planClaudeSync, syncClaudeSettings, uninstallClaudeSettings } from './claude.mjs';
import { resolveApplicationProxy, probeApplicationService, redactText } from './runtime.mjs';
import { inspectCodexAccount } from './codex-account.mjs';
import { listClaudeProviders } from './claude-providers.mjs';

export function validateApplication(app) {
  if (app !== 'codex' && app !== 'claude') throw new Error('应用只支持 codex 或 claude');
  return app;
}

export async function inspectIntegration(app, { network = false, account = false, context, ...options } = {}) {
  validateApplication(app);
  const current = context || await resolveApplicationProxy(options);
  const report = await (app === 'codex' ? inspectCodex : inspectClaude)({ ...options, context: current });
  const shell = await detectShellIntegration().catch(() => ({ installed: false }));
  const installed = app === 'codex' ? shell.codexWrapper : shell.claudeWrapper;
  const sample = app === 'codex' && account && report.installed === true ? await inspectCodexAccount({ ...options, context: current }) : null;
  let providers, providerCheck;
  if (app === 'claude') {
    try {
      const saved = await listClaudeProviders(options);
      providers = { count: saved.profiles.length, active: saved.active ? { name: saved.active.name, model: saved.active.model, protocol: saved.active.protocol } : null,
        pending: saved.profiles.some(profile => profile.active && profile.pending) };
    } catch {
      providerCheck = { id: 'providers', status: 'error', label: 'API 账号存储无法安全读取', detail: '未输出文件内容，未修改配置；请检查文件格式、路径及所有权。' };
    }
  }
  return {
    ...report,
    ...(sample || {}),
    ...(providers ? { providers } : {}),
    proxy: { available: current.available, endpoint: current.displayProxy, mode: current.proxyMode },
    shell: { installed: Boolean(installed), path: shell.bashrcPath || '' },
    checks: [
      ...(current.checks || []),
      ...(providerCheck ? [providerCheck] : []),
      { id: 'shell', status: installed ? 'ok' : 'warn', label: installed ? '终端包装已安装' : '终端包装未安装', detail: '仅影响加载该包装的终端，不代表已有后台进程的环境' },
      ...(report.checks || []).filter((check) => !(network && check.id === 'network') && check.id !== 'proxy'),
      ...(network ? [app === 'claude' && (report.settings?.gatewayConfigured || report.processEnvironment?.gatewayConfigured)
        ? { id: 'network', status: 'unknown', label: '自定义网关网络未验证', detail: '检测到用户自定义网关；未修改网关、未向默认官方地址发送替代认证请求，请在应用中验证实际服务' }
        : await probeApplicationService(app, current, options)] : []),
      ...(sample ? [
        { id: 'account', status: sample.account.status === 'signedOut' ? 'warn' : 'unknown', label: sample.account.label,
          detail: [sample.account.identity, sample.account.planType, '由当前 CLI 的官方只读接口取得，不读取或输出 Token'].filter(Boolean).join('；') },
        { id: 'quota', status: sample.quota.status === 'ok' ? 'ok' : 'unknown', label: sample.quota.status === 'ok' ? '官方额度接口已响应' : '账号额度未验证', detail: sample.quota.detail },
        { id: 'authentication', status: sample.quota.status === 'ok' ? 'ok' : 'unknown', label: sample.quota.status === 'ok' ? '额度查询获得授权响应' : '远程账号认证未验证', detail: '本地登录状态与网络响应不能代替认证；本次未执行模型推理，也未兑换额度重置' }
      ] : [{ id: 'authentication', status: 'unknown', label: '账号认证未验证', detail: app === 'codex'
        ? '选择“刷新账号与额度”读取官方只读数据；普通诊断不读取账号，网络响应不等于认证成功'
        : '此诊断不发送登录凭据或执行模型推理，网络响应不等于认证成功' }])
    ]
  };
}

export async function prepareIntegrationAction(app, action, options = {}) {
  validateApplication(app);
  const context = options.context || await resolveApplicationProxy(options);
  if (action === 'repair' && app === 'codex') {
    const report = await inspectCodex({ ...options, context });
    return { app, action, report, plan: planCodexRepair(report), proxy: context.displayProxy };
  }
  if (action === 'sync' && app === 'claude') {
    // 预览允许展示冲突；真正写入仍由执行阶段单独要求确认。
    return { app, action, plan: await planClaudeSync({ ...options, context, acknowledgeConflicts: true }), proxy: context.displayProxy };
  }
  throw new Error('不支持的应用管理动作');
}

export async function executeIntegrationAction(prepared, { confirmed = false, ...options } = {}) {
  if (!confirmed) throw new Error('需要确认后才能修改应用集成');
  const context = options.context || await resolveApplicationProxy(options);
  if (!context.available) throw new Error('本账户受管 HTTP 代理不可用，未执行修复或同步');
  if (context.displayProxy !== prepared.proxy) throw new Error('代理端口已改变，请重新生成操作预览');
  if (prepared.app === 'codex' && prepared.action === 'repair') {
    const result = await repairCodex({ ...options, context, report: prepared.report, confirmed });
    if (!result.ok && result.status !== 'unverified') throw new Error(redactText(`${result.detail || 'Daemon 修复未完成'} ${result.suggestion || ''}`));
    return { ...result, message: result.detail, warning: result.status === 'unverified' };
  }
  if (prepared.app === 'claude' && prepared.action === 'sync') {
    const result = await syncClaudeSettings({ ...options, context, plan: prepared.plan, confirmed });
    if (!result.ok) throw new Error(redactText(result.detail || 'Claude 代理配置同步失败'));
    return { ...result, message: result.changed ? 'Claude 用户级代理已同步并备份；已运行 Supervisor 的环境仍未验证，请自行确认后重启。' : 'Claude 用户级代理配置已一致；未重启任何后台进程。', warning: true };
  }
  throw new Error('操作预览无效');
}

export async function installApplicationIntegration(app, options = {}) {
  validateApplication(app);
  // 兼容旧 Shell 命令，仍写入同一个受管块，重复安装不会叠加函数。
  return installShellIntegration(options);
}

export { uninstallClaudeSettings, redactText };
