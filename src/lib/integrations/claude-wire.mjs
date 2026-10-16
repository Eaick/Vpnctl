import { randomUUID } from 'node:crypto';

// 协议转换原型仅供隔离测试，尚未接入 Claude 运行时。
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const reject = () => { throw new Error('当前转换不支持此消息或工具格式，请使用 Anthropic 原生接口'); };
const text = blocks => typeof blocks === 'string' ? blocks : Array.isArray(blocks) ? blocks.map(block => {
  if (block.type !== 'text' || typeof block.text !== 'string') return reject();
  return block.text;
}).join('\n') : blocks == null ? '' : reject();

export function resolveClaudeModel(model, profile) {
  if (typeof model !== 'string' || !model) return profile.model;
  for (const alias of ['opus', 'sonnet', 'haiku']) {
    if (model === alias || model.startsWith(`claude-${alias}-`)) return profile[alias] || profile.model;
  }
  return model === 'default' ? profile.model : model;
}

function contentParts(blocks) {
  if (typeof blocks === 'string') return [{ type: 'text', text: blocks }];
  if (!Array.isArray(blocks)) return reject();
  return blocks.flatMap(block => {
    if (block.type === 'text' && typeof block.text === 'string') return [{ type: 'text', text: block.text }];
    if (block.type === 'thinking' || block.type === 'redacted_thinking') return [];
    if (block.type === 'image') {
      const source = block.source;
      const url = source?.type === 'base64' && /^image\/(?:png|jpeg|gif|webp)$/.test(source.media_type) && typeof source.data === 'string'
        ? `data:${source.media_type};base64,${source.data}` : source?.type === 'url' && /^https?:\/\//.test(source.url || '') ? source.url : null;
      if (url) return [{ type: 'image_url', image_url: { url } }];
    }
    return reject();
  });
}

function chatMessages(body) {
  const result = [];
  if (body.system) result.push({ role: 'system', content: text(body.system) });
  for (const message of body.messages) {
    if (!['assistant', 'user'].includes(message.role)) return reject();
    const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
    if (!Array.isArray(blocks)) return reject();
    if (message.role === 'assistant') {
      const calls = blocks.filter(block => block.type === 'tool_use').map(block => {
        if (!block.id || !block.name || !plain(block.input)) return reject();
        return { id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input) } };
      });
      const parts = contentParts(blocks.filter(block => block.type !== 'tool_use'));
      if (parts.some(part => part.type !== 'text')) return reject();
      result.push({ role: 'assistant', content: parts.map(part => part.text).join('\n') || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      let group = [];
      const flush = () => { if (group.length) result.push({ role: 'user', content: contentParts(group) }); group = []; };
      for (const block of blocks) {
        if (block.type !== 'tool_result') { group.push(block); continue; }
        flush();
        if (typeof block.tool_use_id !== 'string' || !block.tool_use_id) return reject();
        result.push({ role: 'tool', tool_call_id: block.tool_use_id, content: `${block.is_error ? '[tool_error] ' : ''}${text(block.content)}` });
      }
      flush();
    }
  }
  return result;
}

export function toOpenAIRequest(body, profile) {
  if (!plain(body) || !Array.isArray(body.messages) || !Number.isSafeInteger(body.max_tokens) || body.max_tokens <= 0) throw new Error('messages 或 max_tokens 无效');
  const messages = chatMessages(body);
  const tools = (body.tools || []).map(tool => {
    if ((tool.type && tool.type !== 'custom') || typeof tool.name !== 'string' || !plain(tool.input_schema)) return reject();
    return { type: 'function', function: { name: tool.name, description: tool.description || '', parameters: tool.input_schema } };
  });
  const common = { model: resolveClaudeModel(body.model, profile), stream: false };
  if (!common.model) throw new Error('请先配置默认上游模型');
  if (typeof body.temperature === 'number') common.temperature = body.temperature;
  if (typeof body.top_p === 'number') common.top_p = body.top_p;
  const choice = body.tool_choice;
  if (choice?.disable_parallel_tool_use) common.parallel_tool_calls = false;
  const toolChoice = !choice || choice.type === 'auto' ? 'auto' : choice.type === 'any' ? 'required' : choice.type === 'none' ? 'none'
    : choice.type === 'tool' && choice.name ? { type: 'function', function: { name: choice.name } } : reject();
  // 保持 system/tools 的稳定前缀，交由支持缓存的上游做自动前缀缓存；不缓存用户响应。
  if (profile.protocol === 'openai-chat') return {
    ...common, messages, [profile.tokenField || 'max_tokens']: body.max_tokens,
    ...(tools.length ? { tools, tool_choice: toolChoice } : {}),
    ...(body.stop_sequences?.length ? { stop: body.stop_sequences } : {})
  };
  if (profile.protocol !== 'openai-responses' || body.stop_sequences?.length) return reject();
  const input = messages.flatMap(message => {
    if (message.role === 'tool') return [{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }];
    const parts = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content || [];
    const content = parts.map(part => part.type === 'text'
      ? { type: message.role === 'assistant' ? 'output_text' : 'input_text', text: part.text }
      : { type: 'input_image', image_url: part.image_url.url });
    return [...(content.length ? [{ role: message.role, content }] : []), ...(message.tool_calls || []).map(call => ({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments }))];
  });
  return { ...common, input, store: false, max_output_tokens: body.max_tokens,
    ...(tools.length ? { tools: tools.map(tool => ({ type: 'function', ...tool.function })), tool_choice: typeof toolChoice === 'string' ? toolChoice : { type: 'function', name: toolChoice.function.name } } : {}) };
}

function toolBlock(id, name, args) {
  let input;
  try { input = typeof args === 'string' ? JSON.parse(args) : args; } catch { throw new Error('上游工具参数不是完整 JSON，请检查模型及输出长度'); }
  if (typeof id !== 'string' || !id || typeof name !== 'string' || !name || !plain(input)) throw new Error('上游工具调用格式无效');
  return { type: 'tool_use', id, name, input };
}

export function fromOpenAIResponse(data, profile, requestedModel) {
  const content = [];
  let reason = 'end_turn', usage;
  if (profile.protocol === 'openai-chat') {
    const choice = data.choices?.[0];
    if (!choice?.message || !['stop', 'length', 'tool_calls', 'content_filter'].includes(choice.finish_reason)) throw new Error('上游未返回受支持的完整 Chat Completions 响应');
    if (choice.message.content) content.push({ type: 'text', text: text(choice.message.content) });
    if (choice.message.refusal) content.push({ type: 'text', text: String(choice.message.refusal) });
    for (const call of choice.message.tool_calls || []) content.push(toolBlock(call.id, call.function?.name, call.function?.arguments));
    reason = choice.finish_reason === 'length' ? 'max_tokens' : content.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn';
    usage = { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 };
  } else {
    if (!Array.isArray(data.output) || !['completed', 'incomplete'].includes(data.status)) throw new Error('上游未返回受支持的完整 Responses 响应');
    for (const item of data.output) {
      if (item.type === 'function_call') content.push(toolBlock(item.call_id, item.name, item.arguments));
      else if (item.type === 'message') for (const part of item.content || []) {
        if (part.type === 'output_text') content.push({ type: 'text', text: part.text });
        else if (part.type === 'refusal') content.push({ type: 'text', text: part.refusal });
        else return reject();
      }
      else if (item.type !== 'reasoning') return reject();
    }
    reason = data.status === 'incomplete' ? 'max_tokens' : content.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn';
    usage = { input_tokens: data.usage?.input_tokens ?? 0, output_tokens: data.usage?.output_tokens ?? 0 };
  }
  if (!content.length) content.push({ type: 'text', text: '' });
  for (const key of Object.keys(usage)) if (!Number.isSafeInteger(usage[key]) || usage[key] < 0) usage[key] = 0;
  return { id: `msg_${randomUUID().replaceAll('-', '')}`, type: 'message', role: 'assistant', model: requestedModel || profile.model, content, stop_reason: reason, stop_sequence: null, usage };
}

export function anthropicEvents(message) {
  const events = [{ type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { ...message.usage, output_tokens: 0 } } }];
  message.content.forEach((block, index) => {
    events.push({ type: 'content_block_start', index, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } });
    events.push({ type: 'content_block_delta', index, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
    events.push({ type: 'content_block_stop', index });
  });
  events.push({ type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: message.usage.output_tokens } }, { type: 'message_stop' });
  return events;
}
