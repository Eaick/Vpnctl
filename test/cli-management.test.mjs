import test from 'node:test';
import assert from 'node:assert/strict';
import stringWidth from 'string-width';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Writable, PassThrough } from 'node:stream';
import React from 'react';
import { render } from 'ink';
import { buildCliManagementLines, buildIntegrationModalLines, getCliActions, formatCodexQuotaLines, formatQuotaProgress } from '../src/lib/cli-management.mjs';

const report = {
  installed: true, cliVersion: '0.162.1', proxy: { available: true, endpoint: 'http://127.0.0.1:23456' },
  shell: { installed: true }, daemon: { appServerVersion: '0.162.0', managedCodexVersion: '0.162.0', environment: { label: '未验证' }, activeTasks: { status: 'unknown' } },
  settings: { status: 'mismatch' }, supervisor: { label: 'Supervisor 环境未验证' },
  checks: [{ status: 'warn', label: '后台版本不一致', detail: '需要确认后修复' }, { status: 'unknown', label: '账号认证未验证' }, ...Array.from({ length: 8 }, (_, i) => ({ status: 'unknown', label: `诊断项 ${i}` }))]
};

test('CLI management has two app-specific action lists with diagnostic and confirmation boundaries', () => {
  assert.ok(getCliActions('codex').some((action) => action.id === 'repair'));
  assert.match(getCliActions('codex').find(action => action.id === 'repair').label, /修复 Codex Daemon/);
  assert.match(getCliActions('codex').find(action => action.id === 'repair').label, /确认/);
  assert.ok(getCliActions('codex').some((action) => action.id === 'account'));
  for (const app of ['codex', 'claude']) assert.ok(getCliActions(app).every(action => !['standalone', 'launch'].includes(action.id)));
  assert.ok(!getCliActions('codex').some((action) => action.id === 'sync'));
  assert.ok(getCliActions('claude').some((action) => action.id === 'sync'));
  assert.ok(getCliActions('claude').some((action) => action.id === 'providers'));
  assert.ok(!getCliActions('claude').some((action) => action.id === 'repair'));
});

test('CLI management separates diagnostics and actions with a plain divider instead of an operation heading', () => {
  for (const app of ['codex', 'claude']) for (const width of [40, 76, 136]) for (const height of [10, 18, 30]) {
    const panel = buildCliManagementLines({ app, report, width, height, offset: 999, selectedAction: getCliActions(app).length - 1 });
    const divider = panel.lines.findIndex(line => line.text === '─'.repeat(width));
    assert.ok(divider > 1, 'a divider must follow the report area');
    assert.ok(!panel.lines.some(line => line.text.includes('操作 ·')));
    assert.ok(panel.lines.slice(divider + 1).some(line => line.tone === 'selected'), 'selected action must appear below the divider');
    assert.ok(panel.lines.slice(0, divider).every(line => line.tone !== 'selected'));
    if (app === 'codex') assert.ok(panel.lines.slice(divider + 1).some(line => line.text.includes('修复 Codex Daemon')));
  }
});

test('quota bars show remaining allowance and distinguish missing from zero and expired snapshots', () => {
  const resetsAt = 4102444800;
  assert.match(formatQuotaProgress({ usedPercent: 25, resetsAt }), /75% 剩余/);
  assert.match(formatQuotaProgress({ usedPercent: 100, resetsAt }), /0% 剩余/);
  assert.equal(formatQuotaProgress({ usedPercent: null }), '未提供');
  assert.equal(formatQuotaProgress({ usedPercent: 101 }), '未提供');
  assert.match(formatQuotaProgress({ usedPercent: 25, resetsAt: 1 }), /请刷新/);
  const text = formatCodexQuotaLines({ buckets: [{ id: 'codex', primary: { usedPercent: 25, windowDurationMins: 60, resetsAt } }], resetCreditsAvailable: 0 }).join('\n');
  assert.match(text, /1h/);
  assert.match(text, /5h 未提供/);
  assert.match(text, /weekly 未提供/);
  assert.match(text, /可用重置次数：0/);
  assert.match(formatCodexQuotaLines(null).join('\n'), /可用重置次数：未提供/);
});

test('every Codex card remains reachable by scrolling, including quota windows and reset count', () => {
  const quota = { status: 'ok', buckets: [{ id: 'codex', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 4102444800 }, secondary: { usedPercent: 80, windowDurationMins: 10080, resetsAt: 4102444800 } }], resetCreditsAvailable: 2 };
  for (const width of [40, 76, 96, 136]) {
    let rendered = '';
    const args = { app: 'codex', report: { ...report, account: { identity: 'u***@example.com', planType: 'plus' }, quota }, width, height: 18 };
    const { maxScroll } = buildCliManagementLines(args);
    for (let offset = 0; offset <= maxScroll; offset++) {
      const panel = buildCliManagementLines({ ...args, offset });
      assert.ok(panel.lines.every(line => stringWidth(line.text) <= width));
      rendered += panel.lines.map(line => line.text).join('\n');
    }
    assert.match(rendered, /5h/);
    assert.match(rendered, /weekly/);
    assert.match(rendered, /75% 剩余/);
    assert.match(rendered, /20% 剩余/);
    assert.match(rendered, /可用重置次数 2/);
    assert.ok(!rendered.includes('启动 Codex'));
  }
});

test('CLI management keeps selected actions visible across terminal sizes and scrolls diagnosis separately', () => {
  for (const app of ['codex', 'claude']) {
    for (const width of [12, 40, 76, 96, 136]) {
      for (const height of [6, 10, 18, 24]) {
        const selectedAction = getCliActions(app).length - 1;
        const panel = buildCliManagementLines({ app, report, selectedAction, width, height, offset: 999 });
        assert.equal(panel.lines.length, height);
        assert.ok(panel.lines.every((line) => stringWidth(line.text) <= width));
        assert.ok(panel.lines.some((line) => line.tone === 'selected'));
        assert.ok(panel.lines[0].text.startsWith(app === 'codex' ? '[1 Codex]' : '1 Codex'));
        for (const line of panel.lines.filter((line) => line.segments)) assert.equal(line.segments.map((segment) => segment.text).join(''), line.text);
      }
    }
  }
});

test('CLI management does not label unknown environment or authentication as verified', () => {
  const panel = buildCliManagementLines({ app: 'codex', report, width: 100, height: 30 });
  assert.ok(panel.lines.some((line) => line.text.includes('未验证')));
  const empty = buildCliManagementLines({ app: 'claude', report: null, width: 76, height: 16, loading: true });
  assert.ok(empty.lines.some((line) => line.text.includes('诊断中')));
  assert.ok(!empty.lines.some((line) => line.text.includes('已认证')));
});

test('integration confirmation defaults to cancel and progress stays within a short panel', () => {
  for (const width of [20, 76, 120]) {
    const confirm = buildIntegrationModalLines({ type: 'cli-confirm', lines: ['将停止后台服务', '活跃任务无法确认'], confirmSelected: false }, width, 6);
    assert.ok(confirm.at(-1).text.startsWith('[取消]'));
    assert.ok(confirm.every((line) => stringWidth(line.text) <= width));
    const progress = buildIntegrationModalLines({ type: 'cli-progress', lines: Array.from({ length: 20 }, (_, i) => `步骤 ${i}`), done: true, error: '失败，未删除凭据', scroll: 999 }, width, 6);
    assert.equal(progress.length, 6);
    assert.ok(progress.some((line) => line.text.includes('失败')));
    assert.ok(progress.every((line) => stringWidth(line.text) <= width));
  }
});

test('narrow confirmation wraps warnings instead of hiding their ending', () => {
  const warning = '后台任务无法确认，继续可能中断正在执行的工作，请先确认任务安全。';
  const frame = buildIntegrationModalLines({ type: 'cli-confirm', lines: [warning] }, 20, 16);
  assert.equal(frame.slice(1, -1).map(line => line.text.trim()).join(''), warning);
});

test('actual CLI page switches apps, opens a cancel-first preview and fits common terminal widths', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vpnctl-cli-ui-'));
  const keys = ['HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'VPNCTL_MODE', 'MIHOMO_API', 'PATH', 'Path'];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const server = http.createServer((request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ version: 'fixture' })); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    process.env.HOME = temp;
    process.env.CODEX_HOME = path.join(temp, 'codex');
    process.env.CLAUDE_CONFIG_DIR = path.join(temp, 'claude');
    process.env.VPNCTL_MODE = 'user';
    process.env.MIHOMO_API = `http://127.0.0.1:${server.address().port}`;
    delete process.env.Path;
    process.env.PATH = temp;
    const appUrl = new URL('../src/ui/App.jsx', import.meta.url);
    const source = (await fs.readFile(appUrl, 'utf8')).replace(/from\s+(['"])([^'"]+)\1/g, (match, quote, specifier) =>
      `from ${JSON.stringify(specifier.startsWith('.') ? new URL(specifier, appUrl).href : import.meta.resolve(specifier))}`);
    const { default: App } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    for (const width of [80, 100, 140]) {
      const chunks = [];
      const stdout = new Writable({ write(chunk, encoding, callback) { chunks.push(chunk.toString()); callback(); } });
      stdout.columns = width;
      stdout.rows = 30;
      stdout.isTTY = false;
      const stdin = new PassThrough();
      stdin.isTTY = true;
      stdin.setRawMode = () => {};
      stdin.ref = () => {};
      stdin.unref = () => {};
      const app = render(React.createElement(App, { initialSection: 'cli' }), { stdout, stdin, stderr: stdout, debug: true, patchConsole: false, exitOnCtrlC: false });
      const frame = () => (chunks.at(-1) || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
      const waitFor = async (predicate) => {
        const deadline = Date.now() + 5000;
        while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
        assert.ok(predicate(), `UI state not reached at ${width} columns`);
      };
      const key = async (value) => { stdin.write(value); await new Promise((resolve) => setTimeout(resolve, 50)); };
      try {
        await waitFor(() => frame().includes('CLI 管理'));
        await key('\t');
        await waitFor(() => frame().includes('[1 Codex]'));
        for (let i = 0; i < getCliActions('codex').findIndex(action => action.id === 'repair'); i++) await key('\x1b[B');
        await waitFor(() => frame().includes('修复 Codex Daemon'));
        assert.ok(!frame().includes('操作 ·'));
        await key('\r');
        await waitFor(() => frame().includes('Codex Daemon 修复确认'));
        assert.ok(frame().includes('[取消]'));
        await key('\x1b');
        await waitFor(() => frame().includes('[1 Codex]'));
        await key('2');
        await waitFor(() => frame().includes('[2 Claude Code]'));
        await key('\x1b[B'); await key('\x1b[B'); await key('\x1b[B');
        await key('\r');
        await waitFor(() => frame().includes('确认应用集成操作'));
        assert.ok(frame().includes('[取消]'));
        assert.ok(frame().trimEnd().split('\n').every((line) => stringWidth(line) <= width));
        await key('\r');
        await waitFor(() => frame().includes('[2 Claude Code]'));
        assert.ok(!await fs.stat(path.join(temp, 'claude', 'settings.json')).then(() => true, () => false));
        await key('\x1b[B'); await key('\r');
        await waitFor(() => frame().includes('API 账号管理'));
        await key('a');
        await waitFor(() => frame().includes('供应商名称'));
        await key(`测试账号${width}`); await key('\t');
        await key('https://fixture.example.com'); await key('\t');
        await key('ui-fixture-secret');
        assert.ok(!frame().includes('ui-fixture-secret'));
        await key('\t'); await key('\t'); await key('\x1b[C');
        await key('\t'); await key('fixture-model');
        await key('\r');
        await waitFor(() => frame().includes('确认应用集成操作'));
        assert.ok(frame().includes('[取消]'));
        assert.ok(!frame().includes('ui-fixture-secret'));
        await key('\t'); await key('\r');
        await waitFor(() => frame().includes('操作结束'));
        await key('\x1b');
        await waitFor(() => frame().includes('API 账号管理'));
        assert.ok(frame().includes(`测试账号${width}`));
        await key('e');
        await waitFor(() => frame().includes('编辑 Claude API'));
        assert.ok(!frame().includes('ui-fixture-secret'));
        await key('\x1b');
        await waitFor(() => frame().includes('API 账号管理'));
        await key('x');
        await waitFor(() => frame().includes('确认应用集成操作'));
        await key('\r');
        await waitFor(() => frame().includes('API 账号管理'));
        assert.ok(frame().includes(`测试账号${width}`), 'cancel must preserve the selected account');
        await key('x');
        await waitFor(() => frame().includes('确认应用集成操作'));
        await key('\t'); await key('\r');
        await waitFor(() => frame().includes('操作结束'));
        await key('\x1b');
        await waitFor(() => frame().includes('尚无 API 账号'));
        assert.ok(!chunks.join('').includes('ui-fixture-secret'), 'credentials must never reach terminal output');
      } finally { app.unmount(); app.cleanup(); }
    }
  } finally {
    for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; }
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
