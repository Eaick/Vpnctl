import test from 'node:test';
import assert from 'node:assert/strict';
import { toOpenAIRequest, fromOpenAIResponse, anthropicEvents } from '../src/lib/integrations/claude-wire.mjs';

const profile = { protocol: 'openai-chat', model: 'upstream-main', sonnet: 'upstream-fast', tokenField: 'max_tokens' };
const request = { model: 'sonnet', max_tokens: 100, system: [{ type: 'text', text: 'system' }], messages: [
  { role: 'user', content: 'hello' },
  { role: 'assistant', content: [{ type: 'tool_use', id: 'call_a', name: 'Read', input: { path: 'a.txt' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_a', content: 'file contents' }] }
], tools: [{ name: 'Read', description: 'read file', input_schema: { type: 'object' } }] };

test('Anthropic text, model aliases and tool history map to OpenAI Chat Completions', () => {
  const result = toOpenAIRequest(request, profile);
  assert.equal(result.model, 'upstream-fast');
  assert.equal(result.stream, false);
  assert.equal(result.messages[0].role, 'system');
  assert.equal(result.messages[2].tool_calls[0].id, 'call_a');
  assert.equal(result.messages[3].role, 'tool');
  assert.equal(result.messages[3].tool_call_id, 'call_a');
});

test('OpenAI tool calls convert to Anthropic tools and a complete SSE lifecycle', () => {
  const message = fromOpenAIResponse({ choices: [{ message: { content: 'ok', tool_calls: [{ id: 'call_b', type: 'function', function: { name: 'Read', arguments: '{"path":"b.txt"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 9 } }, profile, 'sonnet');
  assert.equal(message.stop_reason, 'tool_use');
  assert.equal(message.content[1].input.path, 'b.txt');
  const events = anthropicEvents(message);
  assert.equal(events[0].type, 'message_start');
  assert.equal(events.at(-1).type, 'message_stop');
  assert.ok(events.some(event => event.type === 'content_block_delta' && event.delta.type === 'input_json_delta'));
});
