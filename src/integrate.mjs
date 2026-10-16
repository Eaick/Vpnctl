import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { inspectIntegration, prepareIntegrationAction, executeIntegrationAction, installApplicationIntegration, validateApplication } from './lib/integrations/index.mjs';
import { resolveApplicationProxy, redactText } from './lib/integrations/runtime.mjs';
import { formatCodexQuotaLines } from './lib/cli-management.mjs';
import { claudeProviderEnvironment } from './lib/integrations/claude-providers.mjs';

const STATUS = { ok: '正常', warn: '警告', error: '失败', unknown: '未验证', unsupported: '不支持' };

export function formatIntegrationReport(report) {
  return [
    `${report.app === 'codex' ? 'Codex' : 'Claude Code'} 集成诊断`,
    `程序：${report.installed ? report.cliVersion || '已安装，版本未知' : '未安装或不可执行'}`,
    `VPNCTL HTTP 代理：${report.proxy?.endpoint || '未知'}（${report.proxy?.available ? '可连接' : '不可用'}）`,
    ...(report.account ? [`当前 CLI 账号：${report.account.identity || report.account.label}；套餐 ${report.account.planType || '未提供'}`, ...formatCodexQuotaLines(report.quota, 60)] : []),
    ...(report.checks || []).map((check) => `[${STATUS[check.status] || '未验证'}] ${check.label}${check.detail ? `：${check.detail}` : ''}`)
  ].map(redactText).join('\n');
}

export function formatActionPreview(prepared, { confirmation = false } = {}) {
  const plan = prepared.plan;
  return [
    `${prepared.app === 'codex' ? 'Codex Daemon 修复' : prepared.action === 'provider' ? 'Claude API 账号操作' : 'Claude Code 代理同步'}${confirmation ? '确认' : '预览'}`,
    ...(prepared.proxy ? [`当前代理：${prepared.proxy}`] : []),
    ...(plan.settingsPath ? [`配置文件：${plan.settingsPath}`] : []),
    ...((plan.steps || []).map((step, index) => `${index + 1}. ${step.label}`)),
    ...((plan.changes || []).map((change) => `${change.key}：${change.before ?? '未设置'} -> ${change.after ?? '移除'}`)),
    ...(plan.warnings || []).map((warning) => `注意：${warning}`),
    ...(plan.backups || []).map((backup) => `备份：${backup.path}（${backup.mode || '受保护'}）`),
    ...(plan.conflicts || []).map((conflict) => `冲突：${typeof conflict === 'string' ? conflict : conflict.key || '已有配置'}`),
    ...(!plan.allowed ? ['当前不满足执行条件，未修改任何配置或后台进程。'] : [])
  ].map(redactText).join('\n');
}

async function confirmAction(message) {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('需要交互确认；非交互运行请显式提供 --yes 及所需的风险确认参数');
  const prompt = createInterface({ input: stdin, output: stdout });
  try { return (await prompt.question(`${message}\n输入 yes 继续，其他输入取消：`)).trim() === 'yes'; }
  finally { prompt.close(); }
}

export async function launchIntegratedApplication(app, args = [], { context, spawnApp = spawn, inspect = inspectIntegration, resolveClaudeEnvironment = claudeProviderEnvironment, ...options } = {}) {
  validateApplication(app);
  const current = context || await resolveApplicationProxy(options);
  const informational = args.length > 0 && (['--version', '-v', '--help', '-h'].includes(args[0]) || args.includes('--help'));
  if (!current.available && !informational) throw new Error('VPNCTL 代理不可用；请启动本账户 Mihomo 后重试，未启动应用');
  if (app === 'codex' && args.length === 0) {
    const report = await inspect(app, { ...options, context: current });
    for (const check of report.checks.filter((item) => ['warn', 'error'].includes(item.status))) {
      console.error(redactText(`[VPNCTL] ${check.label}：${check.detail || ''}`));
    }
    if (report.daemon?.versionMismatch || report.daemon?.environment?.status === 'mismatch') {
      console.error('[VPNCTL] 建议进入 CLI 管理预览修复，或使用 codex --no-daemon 独立运行；不会自动重启 Daemon。');
    }
  }
  const applicationEnv = app === 'claude' && !informational ? await resolveClaudeEnvironment({ env: current.env }) : current.env;
  return new Promise((resolve, reject) => {
    const child = spawnApp(app, args, { env: applicationEnv, stdio: 'inherit', shell: false });
    const keepParent = () => {};
    process.on('SIGINT', keepParent);
    child.once('error', (error) => { process.off('SIGINT', keepParent); reject(new Error(redactText(error.code === 'ENOENT' ? `未安装 ${app} 或不在 PATH 中` : error.message))); });
    child.once('close', (code, signal) => { process.off('SIGINT', keepParent); resolve({ code: code ?? (signal ? 130 : 1) }); });
  });
}

export async function runIntegrationCommand(args, flags = {}) {
  const [app, action = 'doctor', ...rest] = args;
  if (!app || app === '--help' || app === '-h' || (flags.help && action !== 'run')) {
    console.log('用法：vpnctl integrate codex|claude doctor|status|install|run\nCodex：doctor [--account] [--network]；repair [--dry-run] [--yes --allow-active]\nClaude：sync [--dry-run] [--yes --replace-proxy]\ndoctor/status 可加 --json；--account 只读查询账号与额度，不兑换重置；install 不安装应用本体。');
    return;
  }
  validateApplication(app);
  if (action === 'run') {
    const forwarded = rest[0] === '--' ? rest.slice(1) : rest;
    const result = await launchIntegratedApplication(app, forwarded);
    process.exitCode = result.code;
    return;
  }
  if (action === 'doctor' || action === 'status') {
    const report = await inspectIntegration(app, { network: Boolean(flags.network), account: Boolean(flags.account) });
    console.log(flags.json ? JSON.stringify(report, null, 2) : formatIntegrationReport(report));
    return;
  }
  if (action === 'install') {
    if (!flags.yes && !await confirmAction('将更新当前账户 bashrc 中 VPNCTL 的 Codex/Claude 受管包装，不安装应用本体。')) return;
    const result = await installApplicationIntegration(app, { ...(flags['bashrc-path'] ? { bashrcPath: flags['bashrc-path'] } : {}) });
    console.log(redactText(`终端集成已安装：${result.bashrcPath}；请在新终端使用，或手动 source 对应配置文件。`));
    return;
  }
  if (action === 'repair' || action === 'sync') {
    const prepared = await prepareIntegrationAction(app, action);
    console.log(formatActionPreview(prepared));
    if (flags['dry-run']) return;
    if (!prepared.plan.allowed) { process.exitCode = 1; return; }
    if (!flags.yes && !await confirmAction('该操作会修改当前账户的应用配置，或重启其后台服务，可能影响活跃任务。')) return;
    const riskyTasks = prepared.plan.requiresActiveConfirmation;
    if (riskyTasks && flags.yes && !flags['allow-active']) throw new Error('后台任务活跃或无法确认，需要 --allow-active 明确认可中断风险');
    if (prepared.plan.conflicts?.length && flags.yes && !flags['replace-proxy']) throw new Error('存在用户手动配置的代理，需要 --replace-proxy 明确认可替换');
    const result = await executeIntegrationAction(prepared, {
      confirmed: true,
      acknowledgeActive: Boolean(flags['allow-active'] || !flags.yes),
      acknowledgeConflicts: Boolean(flags['replace-proxy'] || !flags.yes),
      onProgress: (step) => console.log(redactText(typeof step === 'string' ? step : step.label || step.id || '执行中'))
    });
    console.log(redactText(result.message || '操作完成；请重新诊断确认后台环境，未验证项不代表正常。'));
    return;
  }
  throw new Error('用法：vpnctl integrate codex|claude doctor|status|install|run；Codex 支持 repair，Claude 支持 sync');
}
