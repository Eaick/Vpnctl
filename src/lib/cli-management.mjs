import { getVisibleWindow, padText } from './tui-layout.mjs';
import stringWidth from 'string-width';

const STATUS = { ok: '正常', warn: '警告', error: '失败', unknown: '未验证', unsupported: '不支持' };
const SETTINGS = { missing: '尚无配置', unmanaged: '未受管', match: '代理一致', mismatch: '代理不一致', invalid: '配置无效' };

function wrapLines(lines, width) {
  return lines.flatMap((line) => {
    const result = [];
    for (const paragraph of String(line.text ?? '').split('\n')) {
      let text = '';
      for (const char of paragraph) {
        if (text && stringWidth(text + char) > width) { result.push({ ...line, text }); text = ''; }
        text += char;
      }
      result.push({ ...line, text });
    }
    return result;
  });
}

export function getCliActions(app) {
  if (app === 'codex') return [
    { id: 'doctor', label: '检测 CLI 与 Daemon 版本、代理环境' },
    { id: 'network', label: '检测 OpenAI 连通性（不发送登录凭据）' },
    { id: 'account', label: '刷新账号与额度（官方只读查询）' },
    { id: 'repair', label: '修复 Codex Daemon（版本/代理，需确认）' }
  ];
  return [
    { id: 'doctor', label: '执行本地诊断' },
    { id: 'network', label: '检测服务网络（不发送登录凭据）' },
    { id: 'install', label: '安装或更新终端代理包装' },
    { id: 'sync', label: '预览用户级代理配置同步' },
    { id: 'providers', label: 'API 账号管理（增删改查 / 切换 / 模型）' }
  ];
}

export function formatQuotaProgress(window, width = 30) {
  const used = window?.usedPercent;
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0 || used > 100) return '未提供';
  if (window.resetsAt && window.resetsAt * 1000 <= Date.now()) return '已到重置时间，请刷新';
  const remaining = Math.round((100 - used) * 10) / 10;
  const size = Math.max(3, Math.min(20, width - 14));
  const filled = Math.round(size * remaining / 100);
  return `[${'#'.repeat(filled)}${'-'.repeat(size - filled)}] ${remaining}% 剩余`;
}

function windowLabel(window) {
  const minutes = window?.windowDurationMins;
  if (minutes === 300) return '5h';
  if (minutes === 10080) return 'weekly';
  if (!minutes) return '时长未提供';
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}min`;
}

function bucketQuotaLines(bucket, width) {
  const windows = [bucket.primary, bucket.secondary].filter(Boolean);
  const lines = [];
  for (const window of windows) {
    lines.push(`${windowLabel(window)} ${formatQuotaProgress(window, width - windowLabel(window).length - 1)}`);
    const reset = Number.isSafeInteger(window.resetsAt) && window.resetsAt > 0 && window.resetsAt <= 8640000000000
      ? new Date(window.resetsAt * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : '未提供';
    lines.push(`重置：${reset}`);
  }
  if (!windows.some(window => window.windowDurationMins === 300)) lines.push('5h 未提供');
  if (!windows.some(window => window.windowDurationMins === 10080)) lines.push('weekly 未提供');
  if (bucket.credits?.unlimited) lines.push('服务返回额外余额：不限额');
  else if (bucket.credits?.balance !== null && bucket.credits?.balance !== undefined) lines.push(`服务返回额外余额：${bucket.credits.balance}（非现金）`);
  return lines;
}

export function formatCodexQuotaLines(quota, width = 60) {
  return [
    ...(quota?.buckets?.length ? quota.buckets.flatMap(bucket => [`额度桶：${bucket.id}`, ...bucketQuotaLines(bucket, width)]) : ['5h 未提供', 'weekly 未提供']),
    `可用重置次数：${quota?.resetCreditsAvailable ?? '未提供'}（仅展示）`,
    ...(quota?.truncated ? ['仅展示前 32 个额度桶'] : []),
    ...(quota?.detail ? [quota.detail] : []),
    ...(quota?.checkedAt ? [`额度采样：${quota.checkedAt}（非实时）`] : [])
  ];
}

function renderCliCards(cards, width) {
  const columns = width >= 72 ? 2 : 1;
  const cardWidth = Math.floor((width - columns + 1) / columns);
  const inner = cardWidth - 2;
  const body = [];
  for (let index = 0; index < cards.length; index += columns) {
    const row = cards.slice(index, index + columns).map(card => ({ ...card, lines: wrapLines(card.lines.map(text => ({ text })), inner).map(line => line.text) }));
    const height = Math.max(...row.map(card => card.lines.length)) + 3;
    const rendered = row.map(card => [
      `╭${'─'.repeat(inner)}╮`, `│${padText(card.title, inner)}│`,
      ...Array.from({ length: height - 3 }, (_, at) => `│${padText(card.lines[at] || '', inner)}│`),
      `╰${'─'.repeat(inner)}╯`
    ]);
    for (let at = 0; at < height; at++) {
      const segments = rendered.flatMap((card, slot) => [...(slot ? [{ text: ' ', tone: 'normal' }] : []), { text: card[at], tone: 'normal' }]);
      const text = segments.map(segment => segment.text).join('');
      segments.push({ text: ' '.repeat(Math.max(0, width - stringWidth(text))), tone: 'normal' });
      body.push({ text: segments.map(segment => segment.text).join(''), tone: 'normal', segments });
    }
    if (index + columns < cards.length) body.push({ text: ' '.repeat(width), tone: 'normal' });
  }
  return body;
}

export function buildCliManagementLines({ app = 'codex', report, loading = false, selectedAction = 0, width, height, offset = 0 }) {
  const safeWidth = Math.max(1, width), safeHeight = Math.max(1, height);
  const lines = [{ text: padText(app === 'codex' ? '[1 Codex]   2 Claude Code' : '1 Codex   [2 Claude Code]', safeWidth), tone: 'accent' }];
  if (safeHeight > 1) lines.push({ text: padText(`HTTP ${report?.proxy?.endpoint || '读取中'} · ${loading ? '诊断中' : report?.proxy?.available ? '代理可连接' : '代理未就绪'}`, safeWidth), tone: report?.proxy?.available ? 'active' : 'dim' });
  const checks = (report?.checks || []).map((check) => ({
    text: `[${STATUS[check.status] || '未验证'}] ${check.label}${check.detail ? `：${check.detail}` : ''}`,
    tone: check.status === 'error' ? 'error' : check.status === 'warn' ? 'warn' : check.status === 'ok' ? 'normal' : 'dim'
  }));
  const cards = app === 'codex' ? [{
    title: `Codex 版本${report?.daemon?.versionMismatch === true ? ' · 不一致' : ''}`,
    lines: [`CLI ${report?.cliVersion || '未验证'}`, `Daemon ${report?.daemon?.appServerVersion || '未验证'}`, `受管包 ${report?.daemon?.managedCodexVersion || '未验证'}`]
  }, {
    title: '当前 CLI 账号与 OpenAI 网络',
    lines: [report?.account?.identity || report?.account?.label || '尚未读取账号（邮箱默认脱敏）',
      `套餐 ${report?.account?.planType || '未提供'} · 非 Daemon 账号验证`,
      report?.checks?.find(check => check.id === 'network')?.label || '尚未检测 OpenAI']
  }, ...((report?.quota?.buckets?.length ? report.quota.buckets : [{ id: 'Codex' }]).map(bucket => ({
    title: `额度 · ${bucket.id}`,
    lines: bucketQuotaLines(bucket, (safeWidth >= 72 ? Math.floor((safeWidth - 1) / 2) : safeWidth) - 2)
  }))), {
    title: 'Daemon 环境与重置次数',
    lines: [`可用重置次数 ${report?.quota?.resetCreditsAvailable ?? '未提供'}（仅展示）`, report?.daemon?.environment?.label || 'Daemon 环境未验证',
      `后台 ${report?.daemon?.running === true ? '运行中' : report?.daemon?.running === false ? '未运行' : '未验证'} · 任务 ${report?.daemon?.activeTasks?.status === 'idle' ? '空闲' : report?.daemon?.activeTasks?.status === 'active' ? '活跃' : '未确认'}`,
      ...(report?.quota?.status && report.quota.status !== 'ok' ? [report.quota.detail] : []),
      ...(report?.quota?.truncated ? ['仅展示前 32 个额度桶'] : []),
      ...(report?.quota?.checkedAt ? [`额度采样 ${report.quota.checkedAt}（非实时）`] : [])]
  }] : [{
    title: '程序与终端集成',
    lines: [`CLI ${report?.installed ? report.cliVersion || '版本未知' : '未安装或未检测'}`, `代理包装 ${report?.shell?.installed ? '已安装' : '未安装'}`]
  }, {
    title: 'API 账号与模型',
    lines: [`已保存 ${report?.providers?.count ?? '未检测'} 套账号`,
      `当前 ${report?.providers?.active?.name || '未选择 VPNCTL 账号'}`,
      `模型 ${report?.providers?.active?.model || 'Claude 默认'}`,
      ...(report?.providers?.pending ? ['账号有修改尚未应用'] : []),
      '原生可切换；OpenAI 转换尚未接通']
  }, {
    title: 'Claude 后台代理',
    lines: [`持久配置 ${SETTINGS[report?.settings?.status] || '未验证'}`, report?.supervisor?.label || 'Supervisor 生效状态未验证，禁止自动重启']
  }];
  const actions = getCliActions(app);
  const actionHeight = Math.min(actions.length, Math.max(1, Math.floor((safeHeight - lines.length) / 2)));
  const bodyHeight = Math.max(0, safeHeight - lines.length - actionHeight - 1);
  const body = bodyHeight >= 5 && safeWidth >= 12
    ? [...renderCliCards(cards, safeWidth), ...wrapLines(checks, safeWidth)]
    : [...wrapLines(cards.flatMap(card => [card.title, ...card.lines]).map(text => ({ text, tone: 'normal' })), safeWidth), ...wrapLines(checks, safeWidth)];
  const maxScroll = Math.max(0, body.length - bodyHeight);
  const start = Math.max(0, Math.min(offset, maxScroll));
  for (const line of body.slice(start, start + bodyHeight)) lines.push({ ...line, text: padText(line.text, safeWidth) });
  if (lines.length < safeHeight) lines.push({ text: '─'.repeat(safeWidth), tone: 'dim' });
  for (const action of getVisibleWindow(actions, selectedAction, actionHeight).items) {
    if (lines.length >= safeHeight) break;
    lines.push({ text: padText(`${action.id === actions[selectedAction]?.id ? '►' : ' '} ${action.label}`, safeWidth), tone: action.id === actions[selectedAction]?.id ? 'selected' : 'normal' });
  }
  while (lines.length < safeHeight) lines.push({ text: ' '.repeat(safeWidth), tone: 'normal' });
  return { lines: lines.slice(0, safeHeight), maxScroll };
}

export function buildIntegrationModalLines(modal, width, height) {
  const safeWidth = Math.max(1, width), safeHeight = Math.max(1, height);
  const confirm = modal.type === 'cli-confirm';
  const title = confirm ? '确认应用集成操作' : modal.error ? '应用集成失败' : '应用集成执行进度';
  const confirmationLabel = modal.confirmationLabel || '确认执行';
  const footer = confirm ? `${modal.confirmSelected ? `取消   [${confirmationLabel}]` : `[取消]   ${confirmationLabel}`} · Tab/左右切换 · Enter 确认 · Esc 取消`
    : modal.done || modal.error ? '操作结束 · Esc 返回 · PgUp/PgDn 查看结果' : '正在执行，请等待当前步骤结束';
  const body = wrapLines([...(modal.lines || []), ...(modal.error ? [`失败：${modal.error}`, '未清除账号凭据或历史会话；请重新诊断后决定是否重试。'] : [])].map(text => ({ text })), safeWidth);
  const start = Math.min(Math.max(0, modal.scroll || 0), Math.max(0, body.length - Math.max(0, safeHeight - 2)));
  const lines = [{ text: padText(title, safeWidth), tone: modal.error ? 'error' : 'accent' }, ...body.slice(start, start + Math.max(0, safeHeight - 2)).map((line) => ({ text: padText(line.text, safeWidth), tone: 'normal' }))];
  while (lines.length < safeHeight - 1) lines.push({ text: ' '.repeat(safeWidth), tone: 'normal' });
  if (safeHeight > 1) lines.push({ text: padText(footer, safeWidth), tone: confirm && modal.confirmSelected ? 'warn' : 'dim' });
  return lines.slice(0, safeHeight);
}
