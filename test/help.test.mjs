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
  assert.equal(VPNCTL_VERSION, '0.1.1');
  for (const flag of ['--version', '-v', 'version']) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../src/index.mjs', import.meta.url)), flag], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'VPNCTL 0.1.1');
    assert.equal(result.stderr, '');
  }
});
