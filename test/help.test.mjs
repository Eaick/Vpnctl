import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { VPNCTL_VERSION } from '../src/lib/version.mjs';
import { formatCliHelpText, getTuiHelpSections } from '../src/lib/help.mjs';

test('formatCliHelpText explains proxy mode, port, and shell commands', () => {
  const text = formatCliHelpText();
  assert.match(text, /vpnctl dev init/);
  assert.match(text, /vpnctl config set-ports/);
  assert.match(text, /proxy-mode/);
  assert.match(text, /mix/);
  assert.match(text, /vpnctl shell install/);
  assert.match(text, /vpnctl integrate codex doctor/);
  assert.match(text, /vpnctl integrate claude doctor/);
  assert.match(text, /--dry-run/);
});

test('getTuiHelpSections includes navigation, actions, and legend descriptions', () => {
  const sections = getTuiHelpSections();
  assert.equal(sections.length, 4);
  assert.match(sections.find(s => s.title === '导航').lines.join('\n'), /\?/);
  const actions = sections.find(s => s.title === '动作').lines.join('\n');
  for (const pattern of [/i:/, /f:/, /mix/, /Google/]) assert.match(actions, pattern);
  assert.match(sections.find(s => s.title === '图例').lines.join('\n'), /port source/);
  const cli = sections.find(s => s.title === 'CLI 管理').lines.join('\n');
  assert.match(cli, /Codex \/ Claude Code/);
  assert.match(cli, /默认取消/);
});

test('VPNCTL application version matches metadata and is available without initializing a runtime', () => {
  const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VPNCTL_VERSION, metadata.version);
  assert.equal(VPNCTL_VERSION, '0.2.0');
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(lock.version, VPNCTL_VERSION);
  assert.equal(lock.packages[''].version, VPNCTL_VERSION);
  for (const flag of ['--version', '-v', 'version']) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../src/index.mjs', import.meta.url)), flag], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'VPNCTL 0.2.0');
    assert.equal(result.stderr, '');
  }
});

test('README keeps three recent updates and marks subscription header parsing as a future plan', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(readme, /VPNCTL-0\.2\.0-/);
  assert.match(readme, /VPNCTL 当前版本：\*\*0\.2\.0\*\*/);
  const updates = readme.split('## 最新动态\n')[1]?.split('\n## ')[0] || '';
  assert.equal((updates.match(/^\*\*\d{4}-\d{2}-\d{2}.*\*\*$/gm) || []).length, 3);
  assert.match(updates, /VPNCTL 0\.2\.0/);
  const plan = readme.split('## 下个版本计划\n')[1]?.split('\n## ')[0] || '';
  assert.match(plan, /subscription-userinfo/);
  assert.match(plan, /尚未实现/);
});
