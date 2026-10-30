import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';

export async function* readSse(chunks) {
  const decoder = new StringDecoder('utf8');
  let pending = '', data = [];
  const parse = line => {
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    if (data.reduce((size, part) => size + part.length, 0) > 1048576) throw new Error('上游事件过大');
    if (line !== '' || !data.length) return undefined;
    const payload = data.join('\n'); data = [];
    if (payload === '[DONE]') return { done: true };
    try { return JSON.parse(payload); } catch { throw new Error('上游流式事件不是有效 JSON'); }
  };
  for await (const chunk of chunks) {
    pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    let at;
    while ((at = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, at).replace(/\r$/, ''); pending = pending.slice(at + 1);
      const event = parse(line);
      if (event !== undefined) yield event;
    }
    if (pending.length > 1048576) throw new Error('上游事件过大');
  }
  pending += decoder.end();
  if (pending.trim() || data.length) throw new Error('上游事件未完整结束');
}

export async function* convertOpenAIStream(chunks, profile, model, { onUsage = () => {} } = {}) {
  if (!['openai-chat', 'openai-responses'].includes(profile.protocol)) throw new Error('不支持的流式协议');
  const blocks = new Map();
  let index = 0, reason = null, completed = false;
  const usage = { input_tokens: 0, output_tokens: 0 };
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const startBlock = (key, block) => {
    if (blocks.has(key)) return null;
    const state = { index: index++, block, args: '' }; blocks.set(key, state);
    return { type: 'content_block_start', index: state.index, content_block: block };
  };
  yield { type: 'message_start', message: { id: `msg_${randomUUID().replaceAll('-', '')}`, type: 'message', role: 'assistant',
    model: model || profile.model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage } } };
  for await (const event of readSse(chunks)) {
    if (event.error || ['error', 'response.failed'].includes(event.type)) throw new Error('上游返回流式错误');
    if (event.done) { if (profile.protocol === 'openai-chat' && reason) completed = true; break; }
    if (profile.protocol === 'openai-chat') {
      if (event.usage) {
        usage.input_tokens = count(event.usage.prompt_tokens); usage.output_tokens = count(event.usage.completion_tokens);
        onUsage({ input_tokens: event.usage.prompt_tokens ?? null, output_tokens: event.usage.completion_tokens ?? null });
      }
      const choice = event.choices?.find(item => item.index === 0) || event.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) {
        if (!['stop', 'length', 'tool_calls', 'content_filter'].includes(choice.finish_reason)) throw new Error('不支持的结束原因');
        reason = choice.finish_reason === 'length' ? 'max_tokens' : choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn';
      }
      const delta = choice.delta || {};
      if (typeof delta.content === 'string' && delta.content) {
        const start = startBlock('text', { type: 'text', text: '' }); if (start) yield start;
        yield { type: 'content_block_delta', index: blocks.get('text').index, delta: { type: 'text_delta', text: delta.content } };
      }
      for (const call of delta.tool_calls || []) {
        const key = `tool:${call.index}`;
        if (!blocks.has(key)) {
          if (!call.id || !call.function?.name) throw new Error('上游未提供工具名称或标识');
          yield startBlock(key, { type: 'tool_use', id: call.id, name: call.function.name, input: {} });
        }
        if (typeof call.function?.arguments === 'string' && call.function.arguments) {
          const state = blocks.get(key); state.args += call.function.arguments;
          if (state.args.length > 1048576) throw new Error('工具参数过大');
          yield { type: 'content_block_delta', index: state.index, delta: { type: 'input_json_delta', partial_json: call.function.arguments } };
        }
      }
    } else {
      if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
        yield startBlock(`tool:${event.output_index}`, { type: 'tool_use', id: event.item.call_id, name: event.item.name, input: {} });
      }
      if (event.type === 'response.output_text.delta') {
        const key = `text:${event.output_index}:${event.content_index}`;
        const start = startBlock(key, { type: 'text', text: '' }); if (start) yield start;
        yield { type: 'content_block_delta', index: blocks.get(key).index, delta: { type: 'text_delta', text: event.delta } };
      }
      if (event.type === 'response.function_call_arguments.delta') {
        const state = blocks.get(`tool:${event.output_index}`);
        if (!state) throw new Error('工具事件顺序无效');
        state.args += event.delta;
        if (state.args.length > 1048576) throw new Error('工具参数过大');
        yield { type: 'content_block_delta', index: state.index, delta: { type: 'input_json_delta', partial_json: event.delta } };
      }
      if (['response.completed', 'response.incomplete'].includes(event.type)) {
        completed = true;
        reason = event.type === 'response.incomplete' ? 'max_tokens' : [...blocks.values()].some(state => state.block.type === 'tool_use') ? 'tool_use' : 'end_turn';
        usage.input_tokens = count(event.response?.usage?.input_tokens); usage.output_tokens = count(event.response?.usage?.output_tokens);
        onUsage({ input_tokens: event.response?.usage?.input_tokens ?? null, output_tokens: event.response?.usage?.output_tokens ?? null });
      }
    }
  }
  if (!completed || !reason) throw new Error('上游响应中断，未收到完整结束事件');
  for (const state of blocks.values()) {
    if (state.block.type === 'tool_use') {
      let args; try { args = JSON.parse(state.args || '{}'); } catch { throw new Error('上游工具参数不是完整 JSON'); }
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('上游工具参数必须为对象');
    }
    yield { type: 'content_block_stop', index: state.index };
  }
  yield { type: 'message_delta', delta: { stop_reason: reason, stop_sequence: null }, usage };
  yield { type: 'message_stop' };
}
