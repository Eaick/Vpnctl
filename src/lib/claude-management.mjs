import { getVisibleWindow, padText } from './tui-layout.mjs';

export const CLAUDE_PROTOCOL_LABELS = { anthropic: 'Anthropic Messages（原生）', 'openai-chat': 'OpenAI Chat（转换未接通）', 'openai-responses': 'OpenAI Responses（转换未接通）' };
const field = (key, label, value, extra = {}) => ({ key, label, value: value || '', ...extra });

export function createClaudeProviderEditor(profile = {}) {
  return { type: 'claude-editor', id: profile.id, activeField: 0, fields: [
    field('name', '供应商名称 *', profile.name, { group: '基本配置', hint: '自定义名称；每套 API 账号使用不同名称' }),
    field('baseUrl', '请求根地址 *', profile.baseUrl, { hint: 'HTTPS 根地址；不要填 /messages 或 /chat/completions 完整路径' }),
    field('secret', 'API Key / Bearer Token *', '', { secret: true, hint: profile.id ? '留空保留原密钥；密钥不会回显' : '密钥不会回显；仅写入本账户私有配置文件' }),
    field('protocol', '上游格式', profile.protocol || 'anthropic', { group: '协议与认证', options: Object.keys(CLAUDE_PROTOCOL_LABELS), labels: CLAUDE_PROTOCOL_LABELS, hint: '原生可激活；OpenAI 格式目前只能保存，不能激活' }),
    field('authType', '认证字段', profile.authType || 'bearer', { options: ['bearer', 'api-key'], labels: { bearer: 'ANTHROPIC_AUTH_TOKEN（Bearer）', 'api-key': 'ANTHROPIC_API_KEY（x-api-key）' }, hint: '按 API 服务商要求选择；OpenAI 格式仅支持 Bearer' }),
    field('model', '默认实际模型', profile.model, { group: '模型映射', hint: '填写服务商实际模型 ID；原生留空沿用 Claude 默认值' }),
    field('sonnet', 'Sonnet → 实际模型', profile.sonnet),
    field('opus', 'Opus → 实际模型', profile.opus),
    field('haiku', 'Haiku → 实际模型', profile.haiku),
    field('subagent', 'Subagent → 实际模型', profile.subagent, { hint: '映射留空表示不覆盖；不声明未经验证的上下文长度' }),
    field('effort', '思考强度', profile.effort, { group: '可选参数', options: ['', 'low', 'medium', 'high', 'max'], hint: '仅在上游模型支持时设置，默认不覆盖' }),
    field('tokenField', 'OpenAI 输出长度字段', profile.tokenField || 'max_tokens', { options: ['max_tokens', 'max_completion_tokens'], hint: '仅影响未来 OpenAI Chat 转换；原生忽略' })
  ] };
}

export function readClaudeProviderInput(modal) {
  return { ...(modal.id ? { id: modal.id } : {}), ...Object.fromEntries(modal.fields.map(item => [item.key, item.value])) };
}

export function buildClaudeProviderLines(modal, width, height) {
  const w = Math.max(1, width), h = Math.max(1, height);
  const line = (text, tone = 'normal') => ({ text: padText(String(text).replace(/[\x00-\x1f\x7f]/g, ' '), w), tone });
  const title = modal.type === 'claude-editor' ? `${modal.id ? '编辑' : '新增'} Claude API 账号 · 仅保存，不自动切换` : 'Claude Code · API 账号管理';
  const footer = modal.type === 'claude-editor'
    ? 'Tab/↑↓ 字段 · ←→ 选项 · Ctrl+U 清空 · Enter 保存预览 · Esc 返回'
    : '↑↓ 选择 · a 新增 · e 编辑 · x 删除 · Enter 应用 · b 恢复 · Esc 返回';
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
    body.push(line('API 中转地址 ≠ VPNCTL 网络代理；应用账号不会测试或扣费。', 'dim'));
    const profiles = modal.listing?.profiles || [];
    if (!profiles.length) body.push(line('尚无 API 账号，按 a 新增。'));
    for (const [index, profile] of profiles.entries()) {
      const selected = index === modal.selected;
      if (selected) focus = body.length;
      body.push(line(`${selected ? '►' : ' '} ${profile.active ? '[当前]' : '[已保存]'} ${profile.name}${profile.pending ? '（修改未应用）' : ''}`, selected ? 'selected' : 'normal'));
      body.push(line(`  ${CLAUDE_PROTOCOL_LABELS[profile.protocol]}${profile.protocol !== 'anthropic' ? ' · 不可激活' : ''}`, 'dim'));
      body.push(line(`  ${profile.baseUrl} · 模型 ${profile.model || 'Claude 默认'}`, 'dim'));
    }
    if (modal.listing?.active) body.push(line(`已应用：${modal.listing.active.name}；请在新 Claude 会话中使用。`, 'accent'));
  }
  const available = Math.max(0, h - 2);
  const result = [line(title, 'accent'), ...getVisibleWindow(body, focus, available).items];
  while (result.length < h - 1) result.push(line(''));
  if (h > 1) result.push(line(footer, 'dim'));
  return result.slice(0, h);
}
