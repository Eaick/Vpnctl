import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCliHelpText, getTuiHelpSections } from '../src/lib/help.mjs';

test('formatCliHelpText explains proxy mode, port, and shell commands', () => {
  const text = formatCliHelpText();
  assert.match(text, /vpnctl dev init/);
  assert.match(text, /vpnctl config set-ports/);
  assert.match(text, /proxy-mode/);
  assert.match(text, /mix/);
  assert.match(text, /vpnctl shell install/);
});

test('getTuiHelpSections includes navigation, actions, and legend descriptions', () => {
  const sections = getTuiHelpSections();
  assert.equal(sections.length, 3);
  assert.match(sections[0].lines.join('\n'), /\?/);
  assert.match(sections[1].lines.join('\n'), /i:/);
  assert.match(sections[1].lines.join('\n'), /f:/);
  assert.match(sections[1].lines.join('\n'), /mix/);
  assert.match(sections[1].lines.join('\n'), /Google/);
  assert.match(sections[2].lines.join('\n'), /port source/);
});
