import test from 'node:test';
import assert from 'node:assert/strict';
import stringWidth from 'string-width';
import { createClaudeProviderEditor, readClaudeProviderInput, buildClaudeProviderLines } from '../src/lib/claude-management.mjs';
import { buildIntegrationModalLines } from '../src/lib/cli-management.mjs';

test('Claude provider form contains essential sections and never preloads a saved credential', () => {
  const modal = createClaudeProviderEditor({ id: 'example', name: '测试账号', protocol: 'anthropic', authType: 'api-key', secret: 'fixture-secret', model: 'upstream-model' });
  assert.equal(modal.fields.find(field => field.key === 'secret').value, '');
  assert.equal(modal.fields.find(field => field.key === 'authType').value, 'api-key');
  assert.deepEqual(['name', 'baseUrl', 'protocol', 'authType', 'secret', 'model', 'sonnet', 'opus', 'haiku', 'subagent'].filter(key => !modal.fields.some(field => field.key === key)), []);
  assert.equal(readClaudeProviderInput(modal).id, 'example');
  modal.fields.find(field => field.key === 'secret').value = 'new-fixture-secret';
  for (const width of [20, 76, 96, 136]) for (const height of [3, 8, 20]) {
    const lines = buildClaudeProviderLines(modal, width, height);
    assert.equal(lines.length, height);
    assert.ok(lines.every(line => stringWidth(line.text) <= width));
    assert.ok(!JSON.stringify(lines).includes('new-fixture-secret'));
  }
});

test('Claude accounts view exposes supported state without claiming OpenAI conversion is ready', () => {
  const lines = buildClaudeProviderLines({ type: 'claude-providers', selected: 0, listing: { profiles: [{ id: 'example', name: '测试账号', protocol: 'openai-chat', baseUrl: 'https://example.com', model: 'model', active: false }] } }, 76, 18);
  assert.match(lines.map(line => line.text).join('\n'), /未接通|不可激活/);
  const empty = buildClaudeProviderLines({ type: 'claude-providers', selected: 0, listing: { profiles: [] } }, 76, 10);
  assert.match(empty.map(line => line.text).join('\n'), /新增/);
});

test('each mapped Claude model has an independent opt-in 1M suffix with an idempotent edit roundtrip', () => {
  const modal = createClaudeProviderEditor({ model: 'gateway/main[1M]', sonnet: 'gateway/fast', opus: 'gateway/large[1m][1m]' });
  for (const key of ['model', 'sonnet', 'opus', 'haiku', 'subagent']) {
    assert.ok(modal.fields.some(field => field.key === `${key}1m`));
  }
  assert.equal(modal.fields.find(field => field.key === 'model').value, 'gateway/main');
  assert.equal(modal.fields.find(field => field.key === 'model1m').value, 'on');
  assert.equal(modal.fields.find(field => field.key === 'sonnet1m').value, 'off');
  const input = readClaudeProviderInput(modal);
  assert.equal(input.model, 'gateway/main[1m]');
  assert.equal(input.opus, 'gateway/large[1m]');
  assert.equal(input.sonnet, 'gateway/fast');
  assert.ok(!Object.hasOwn(input, 'model1m'));
  assert.equal(readClaudeProviderInput(createClaudeProviderEditor(input)).model, 'gateway/main[1m]');
  modal.fields.find(field => field.key === 'model1m').value = 'off';
  assert.equal(readClaudeProviderInput(modal).model, 'gateway/main');
  modal.fields.find(field => field.key === 'haiku1m').value = 'on';
  assert.throws(() => readClaudeProviderInput(modal), /模型.*填写|填写.*模型/);
});

test('1M confirmation stays cancel-first and clearly requires support acknowledgement', () => {
  for (const confirmSelected of [false, true]) {
    const lines = buildIntegrationModalLines({ type: 'cli-confirm', confirmationLabel: '确认支持1M并执行', confirmSelected, lines: ['请确认模型和服务商支持 1M 上下文'] }, 76, 8);
    assert.match(lines.at(-1).text, /确认支持1M并执行/);
    assert.ok(lines.at(-1).text.includes(confirmSelected ? '[确认支持1M并执行]' : '[取消]'));
  }
});
