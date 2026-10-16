import test from 'node:test';
import assert from 'node:assert/strict';
import stringWidth from 'string-width';
import { createClaudeProviderEditor, readClaudeProviderInput, buildClaudeProviderLines } from '../src/lib/claude-management.mjs';

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
