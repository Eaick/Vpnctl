import { getVisibleWindow, padText } from './tui-layout.mjs';
import stringWidth from 'string-width';

export const CLAUDE_PROTOCOL_LABELS = { anthropic: 'Anthropic Messages（原生）', 'openai-chat': 'OpenAI Chat（转换未接通）', 'openai-responses': 'OpenAI Responses（转换未接通）' };
const field = (key, label, value, extra = {}) => ({ key, label, value: value || '', ...extra });
const modelRoles = [['model', '默认实际模型', 'ANTHROPIC_MODEL'], ['sonnet', 'Sonnet → 实际模型', 'ANTHROPIC_DEFAULT_SONNET_MODEL'], ['opus', 'Opus → 实际模型', 'ANTHROPIC_DEFAULT_OPUS_MODEL'], ['haiku', 'Haiku → 实际模型', 'ANTHROPIC_DEFAULT_HAIKU_MODEL'], ['subagent', 'Subagent → 实际模型', 'CLAUDE_CODE_SUBAGENT_MODEL']];
const contextSuffix = /(?:\[1m\])+$/i;

function modelFields(profile) {
  return modelRoles.flatMap(([key, label], index) => {
    const value = profile[key] || '';
    return [field(key, label, value.replace(contextSuffix, ''), {
      ...(index === 0 ? { group: '模型映射' } : {}), hint: '填写实际模型 ID；留空不覆盖。1M 声明在下一项独立选择。'
    }), field(`${key}1m`, `${label.split(' →')[0]} · 声明 1M`, contextSuffix.test(value) ? 'on' : 'off', {
      options: ['off', 'on'], labels: { off: '关闭（不追加后缀）', on: '开启 [1m]（保存前需确认支持）' },
      hint: '须自行确认模型及服务商支持 1M；VPNCTL 不验证容量，也不会扩展模型能力。'
    })];
  });
}

export function createClaudeProviderEditor(profile = {}) {
  return { type: 'claude-editor', id: profile.id, activeField: 0, fields: [
    field('name', '供应商名称 *', profile.name, { group: '基本配置', hint: '自定义名称；每套 API 账号使用不同名称' }),
    field('baseUrl', '请求根地址 *', profile.baseUrl, { hint: 'HTTPS 根地址；不要填 /messages 或 /chat/completions 完整路径' }),
    field('secret', 'API Key / Bearer Token *', '', { secret: true, hint: profile.id ? '留空保留原密钥；密钥不会回显' : '密钥不会回显；仅写入本账户私有配置文件' }),
    field('protocol', '上游格式', profile.protocol || 'anthropic', { group: '协议与认证', options: Object.keys(CLAUDE_PROTOCOL_LABELS), labels: CLAUDE_PROTOCOL_LABELS, hint: '原生可激活；OpenAI 格式目前只能保存，不能激活' }),
    field('authType', '认证字段', profile.authType || 'bearer', { options: ['bearer', 'api-key'], labels: { bearer: 'ANTHROPIC_AUTH_TOKEN（Bearer）', 'api-key': 'ANTHROPIC_API_KEY（x-api-key）' }, hint: '按 API 服务商要求选择；OpenAI 格式仅支持 Bearer' }),
    ...modelFields(profile),
    field('effort', '思考强度', profile.effort, { group: '可选参数', options: ['', 'low', 'medium', 'high', 'max'], hint: '仅在上游模型支持时设置，默认不覆盖' }),
    field('tokenField', 'OpenAI 输出长度字段', profile.tokenField || 'max_tokens', { options: ['max_tokens', 'max_completion_tokens'], hint: '仅影响未来 OpenAI Chat 转换；原生忽略' })
  ] };
}

export function readClaudeProviderInput(modal) {
  const input = { ...(modal.id ? { id: modal.id } : {}), ...Object.fromEntries(modal.fields.map(item => [item.key, item.value])) };
  for (const [key, label] of modelRoles) {
    const base = input[key].trim().replace(contextSuffix, '');
    if (input[`${key}1m`] === 'on' && !base) throw new Error(`请先填写${label}的模型 ID，再声明 1M 上下文`);
    input[key] = base && input[`${key}1m`] === 'on' ? `${base}[1m]` : base;
    delete input[`${key}1m`];
  }
  return input;
}

export function createClaudeProviderPreview(profile) {
  if (!profile) return null;
  if (profile.protocol && profile.protocol !== 'anthropic') {
    return { protocol: profile.protocol, baseUrl: profile.baseUrl, authType: profile.authType || 'bearer', secret: '[已隐藏]',
      ...Object.fromEntries(modelRoles.filter(([key]) => profile[key]).map(([key]) => [key, profile[key]])) };
  }
  const env = { ANTHROPIC_BASE_URL: profile.baseUrl, [profile.authType === 'api-key' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN']: '[已隐藏]' };
  for (const [key, , variable] of modelRoles) if (profile[key]) env[variable] = profile[key];
  if (profile.effort) env.CLAUDE_CODE_EFFORT_LEVEL = profile.effort;
  return { env };
}

function wrapPreview(text, width) {
  if (width <= 0) return [];
  return text.split('\n').flatMap(paragraph => {
    const lines = [];
    let row = '', used = 0;
    for (const char of paragraph) {
      const glyph = stringWidth(char) > width ? '?' : char;
      const size = stringWidth(glyph);
      if (used + size > width) { lines.push(row); row = ''; used = 0; }
      row += glyph; used += size;
    }
    lines.push(row);
    return lines;
  });
}

export function getClaudeProviderPreviewLayout(modal, width, height) {
  const w = Math.max(1, width), h = Math.max(1, height);
  const dividerWidth = w >= 3 ? 1 : 0;
  const leftWidth = dividerWidth ? Math.floor((w - 1) * 0.55) : w;
  const rightWidth = w - dividerWidth - leftWidth;
  const profiles = modal.listing?.profiles || [];
  const profile = profiles[Math.max(0, Math.min(modal.selected || 0, profiles.length - 1))];
  const preview = createClaudeProviderPreview(profile);
  const content = wrapPreview(preview ? JSON.stringify(preview, null, 2) : '无阅览', rightWidth);
  const pageHeight = Math.max(0, h - 3);
  const maxScroll = pageHeight ? Math.max(0, content.length - pageHeight) : 0;
  const offset = Math.max(0, Math.min(modal.previewScroll || 0, maxScroll));
  const title = profile?.protocol && profile.protocol !== 'anthropic' ? 'JSON 预览（未接通，仅保存）' : 'JSON 预览（脱敏，只读）';
  const lines = [{ text: padText(title, rightWidth), tone: 'accent' }, ...content.slice(offset, offset + pageHeight).map(text => ({ text: padText(text, rightWidth), tone: 'normal' }))];
  return { leftWidth, rightWidth, dividerWidth, lines, pageHeight, maxScroll };
}

export function buildClaudeProviderLines(modal, width, height) {
  const w = Math.max(1, width), h = Math.max(1, height);
  const preview = modal.type === 'claude-providers' ? getClaudeProviderPreviewLayout(modal, w, h) : null;
  const line = (text, tone = 'normal', size = w) => ({ text: padText(String(text).replace(/[\x00-\x1f\x7f]/g, ' '), size), tone });
  const bodyLine = (text, tone = 'normal') => line(text, tone, preview?.leftWidth || w);
  const title = modal.type === 'claude-editor' ? `${modal.id ? '编辑' : '新增'} Claude API 账号 · 仅保存，不自动切换` : 'Claude Code · API 账号管理';
  const footer = modal.type === 'claude-editor'
    ? 'Tab/↑↓ 字段 · ←→ 选项 · Ctrl+U 清空 · Enter 保存预览 · Esc 返回'
    : '↑↓账号 a增 e改 x删 i读取配置 Enter应用 b恢复 PgUp/Dn预览 Esc返回';
  const body = [];
  let focus = 0;
  if (modal.type === 'claude-editor') {
    for (const [index, item] of modal.fields.entries()) {
      if (item.group) body.push(line(`── ${item.group} ──`, 'accent'));
      const selected = index === modal.activeField;
      if (selected) focus = body.length;
      const value = item.secret ? item.value ? '********（已输入）' : modal.id ? '（留空保留原密钥）' : '（未填写）' : item.labels?.[item.value] || item.value || '（留空）';
      body.push(line(`${selected ? '►' : ' '} ${item.label}：${value}`, selected ? 'selected' : 'normal'));
      if (selected && item.hint) body.push(line(item.hint, 'dim'));
    }
  } else {
    body.push(bodyLine('API 中转地址 ≠ VPNCTL 网络代理；应用账号不会测试或扣费。', 'dim'));
    const existing = modal.listing?.existing;
    if (existing) {
      body.push(bodyLine(`已有配置：${existing.label}`, ['invalid', 'ambiguous'].includes(existing.status) ? 'warn' : 'dim'));
      if (existing.profile) body.push(bodyLine(`  ${existing.profile.baseUrl} · 模型 ${existing.profile.model || 'Claude 默认'} · 凭据已隐藏`, 'dim'));
    }
    const profiles = modal.listing?.profiles || [];
    if (!profiles.length) body.push(bodyLine(existing?.status === 'available' ? '尚无 API 账号，按 i 导入已有配置或 a 新增。' : '尚无 API 账号，按 a 新增。'));
    for (const [index, profile] of profiles.entries()) {
      const selected = index === modal.selected;
      if (selected) focus = body.length;
      body.push(bodyLine(`${selected ? '►' : ' '} ${profile.active ? '[当前]' : '[已保存]'} ${profile.name}${profile.pending ? '（修改未应用）' : ''}`, selected ? 'selected' : 'normal'));
      body.push(bodyLine(`  ${CLAUDE_PROTOCOL_LABELS[profile.protocol]}${profile.protocol !== 'anthropic' ? ' · 不可激活' : ''}`, 'dim'));
      body.push(bodyLine(`  ${profile.baseUrl} · 模型 ${profile.model || 'Claude 默认'}`, 'dim'));
    }
    if (modal.listing?.active) body.push(bodyLine(`已应用：${modal.listing.active.name}；请在新 Claude 会话中使用。`, 'accent'));
  }
  const available = Math.max(0, h - 2);
  const visible = available ? getVisibleWindow(body, focus, available).items : [];
  const result = [line(title, 'accent')];
  for (let index = 0; index < available; index++) {
    const left = visible[index] || bodyLine('');
    if (!preview?.rightWidth) result.push(left);
    else {
      const right = preview.lines[index] || line('', 'normal', preview.rightWidth);
      const segments = [left, { text: '│', tone: 'dim' }, right];
      result.push({ text: segments.map(segment => segment.text).join(''), tone: 'normal', segments });
    }
  }
  while (result.length < h - 1) result.push(line(''));
  if (h > 1) result.push(line(footer, 'dim'));
  return result.slice(0, h);
}
