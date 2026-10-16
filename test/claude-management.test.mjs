import test from 'node:test';
import assert from 'node:assert/strict';
import stringWidth from 'string-width';
import { createClaudeProviderEditor, readClaudeProviderInput, buildClaudeProviderLines, createClaudeProviderPreview, getClaudeProviderPreviewLayout } from '../src/lib/claude-management.mjs';
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

test('existing Claude settings are visible even with no saved accounts and provide an import shortcut', () => {
  const lines = buildClaudeProviderLines({ type: 'claude-providers', selected: 0, listing: { profiles: [], existing: {
    status: 'available', label: '发现已有 Claude API 配置，按 i 预览导入。', profile: { baseUrl: 'https://existing.example.com', model: 'existing-model', hasSecret: true }
  } } }, 76, 14);
  const text = lines.map(line => line.text).join('\n');
  assert.match(text, /已有 Claude API 配置/);
  assert.match(text, /existing\.example\.com/);
  assert.match(text, /i读取配置/);
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

test('Claude account JSON preview maps API fields without revealing credentials or unrelated properties', () => {
  const profile = { protocol: 'anthropic', baseUrl: 'https://preview.example.com', authType: 'api-key', secret: 'fixture-preview-secret',
    hasSecret: true, model: 'main[1m]', sonnet: 'fast', effort: 'high', unexpectedToken: 'fixture-other-secret' };
  const preview = createClaudeProviderPreview(profile);
  assert.equal(preview.env.ANTHROPIC_BASE_URL, profile.baseUrl);
  assert.equal(preview.env.ANTHROPIC_API_KEY, '[已隐藏]');
  assert.equal(preview.env.ANTHROPIC_MODEL, 'main[1m]');
  assert.equal(preview.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'fast');
  assert.equal(preview.env.CLAUDE_CODE_EFFORT_LEVEL, 'high');
  assert.ok(!JSON.stringify(preview).includes('fixture-preview-secret'));
  assert.ok(!JSON.stringify(preview).includes('fixture-other-secret'));
  assert.equal(createClaudeProviderPreview(null), null);
  const unsupported = createClaudeProviderPreview({ ...profile, protocol: 'openai-chat' });
  assert.equal(unsupported.protocol, 'openai-chat');
  assert.equal(unsupported.env, undefined, 'unfinished conversion must not pretend to be an applicable Claude config');
});

test('Claude account viewer uses a 55/45 split and highlights only the selected left row', () => {
  const profiles = [{ id: 'one', name: '第一个账号', protocol: 'anthropic', baseUrl: 'https://first.example.com', model: 'first-model', hasSecret: true },
    { id: 'two', name: '第二个账号', protocol: 'anthropic', baseUrl: 'https://second.example.com', model: 'second-model', hasSecret: true }];
  for (const width of [20, 40, 76, 96, 136]) for (const height of [3, 8, 24]) {
    const modal = { type: 'claude-providers', selected: 1, listing: { profiles } };
    const layout = getClaudeProviderPreviewLayout(modal, width, height);
    assert.equal(layout.leftWidth, Math.floor((width - 1) * 0.55));
    assert.equal(layout.leftWidth + 1 + layout.rightWidth, width);
    const lines = buildClaudeProviderLines(modal, width, height);
    assert.equal(lines.length, height);
    assert.ok(lines.every(line => stringWidth(line.text) <= width));
    for (const line of lines.filter(line => line.segments)) {
      assert.equal(line.segments.map(segment => segment.text).join(''), line.text);
      assert.ok(line.segments.slice(1).every(segment => segment.tone !== 'selected'));
    }
  }
  const modal = { type: 'claude-providers', selected: 1, listing: { profiles } };
  const layout = getClaudeProviderPreviewLayout(modal, 96, 10);
  const text = buildClaudeProviderLines({ ...modal, previewScroll: layout.maxScroll }, 96, 10).flatMap(line => line.segments?.slice(2).map(segment => segment.text) || []).join('');
  assert.ok(text.includes('second-model'));
  assert.ok(!text.includes('first-model'));
});

test('empty account JSON preview says 无阅览 even when an unimported existing configuration was discovered', () => {
  const modal = { type: 'claude-providers', selected: 0, listing: { profiles: [], existing: { status: 'available', label: '发现已有配置', profile: { model: 'not-imported' } } } };
  const lines = buildClaudeProviderLines(modal, 76, 12);
  const right = lines.flatMap(line => line.segments?.slice(2).map(segment => segment.text) || []).join('\n');
  assert.match(right, /无阅览/);
  assert.ok(!right.includes('not-imported'));
});

test('Claude account messages wrap inside the left pane without losing their ending', () => {
  const label = 'settings.json 中未发现 API Key/Token；不读取网页登录凭据或执行 apiKeyHelper。';
  for (const width of [76, 96, 136]) {
    const modal = { type: 'claude-providers', selected: 0, listing: { profiles: [], existing: { status: 'unavailable', label } } };
    const lines = buildClaudeProviderLines(modal, width, 24);
    const left = lines.flatMap(line => line.segments ? [line.segments[0].text.trimEnd()] : []).join('');
    assert.ok(left.includes(`已有配置：${label}`), 'long discovery messages must wrap rather than truncate');
    const layout = getClaudeProviderPreviewLayout(modal, width, 24);
    for (const line of lines.filter(line => line.segments)) {
      assert.equal(stringWidth(line.segments[0].text), layout.leftWidth);
      assert.equal(stringWidth(line.text), width);
    }
    assert.ok(lines.some(line => line.segments?.[2].text.includes('无阅览')));
  }
});

test('long selected account names, URLs and models wrap while keeping selection and the preview separate', () => {
  const profile = { id: 'wrapped', name: '需要完整显示的测试供应商名称'.repeat(3), protocol: 'anthropic',
    baseUrl: `https://gateway.example.com/${'long-api-path/'.repeat(4)}`, model: 'gateway/long-model-name[1m]', secret: 'fixture-wrap-secret' };
  for (const width of [76, 96, 136]) {
    const lines = buildClaudeProviderLines({ type: 'claude-providers', listing: { profiles: [profile] }, selected: 0 }, width, 40);
    const rows = lines.filter(line => line.segments);
    const left = rows.map(line => line.segments[0].text.trimEnd()).join('');
    assert.ok(left.includes(profile.name));
    assert.ok(left.includes(profile.baseUrl));
    assert.ok(left.includes(profile.model));
    assert.ok(rows.filter(line => line.segments[0].tone === 'selected').length > 1);
    assert.ok(rows.every(line => line.segments[2].tone !== 'selected'));
    assert.ok(!JSON.stringify(lines).includes(profile.secret));
  }
});
