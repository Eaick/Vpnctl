import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/lib/config.mjs';
import { getTheme, getThemeOption, resolveThemeName } from '../src/lib/theme.mjs';
import { getProjectRoot } from '../src/lib/runtime.mjs';

const sandboxRoot = path.join(getProjectRoot(), '.sandbox');
const installFile = path.join(sandboxRoot, 'install.json');

test.beforeEach(async () => {
  delete process.env.VPNCTL_THEME;
  await fs.rm(sandboxRoot, { recursive: true, force: true });
});

test.after(async () => {
  delete process.env.VPNCTL_THEME;
  await fs.rm(sandboxRoot, { recursive: true, force: true });
});

test('resolveThemeName falls back to gemini on invalid input', () => {
  assert.equal(resolveThemeName('claude'), 'claude');
  assert.equal(resolveThemeName('deepseek'), 'deepseek');
  assert.equal(resolveThemeName('codex'), 'codex');
  assert.equal(resolveThemeName('kimi'), 'kimi');
  assert.equal(resolveThemeName('unknown'), 'gemini');
});

test('createConfig uses env theme before install theme', async () => {
  await fs.mkdir(sandboxRoot, { recursive: true });
  await fs.writeFile(installFile, JSON.stringify({ theme: 'light' }, null, 2), 'utf8');
  process.env.VPNCTL_THEME = 'claude';

  const config = createConfig('dev');
  assert.equal(config.theme, 'claude');
});

test('createConfig uses install theme when env is missing', async () => {
  await fs.mkdir(sandboxRoot, { recursive: true });
  await fs.writeFile(installFile, JSON.stringify({ theme: 'dark' }, null, 2), 'utf8');

  const config = createConfig('dev');
  const theme = getTheme(config.theme);

  assert.equal(config.theme, 'dark');
  assert.equal(theme.bannerGradient.length, 3);
  assert.equal(theme.bannerTransitionGradient, true);
});

test('getThemeOption returns display name and tagline for richer UI labels', () => {
  const option = getThemeOption('codex');
  assert.equal(option.id, 'codex');
  assert.match(option.label, /Codex/i);
  assert.ok(option.tagline.length > 0);
});

test('banner gradients are theme-specific and visually distinct', () => {
  assert.deepEqual(getTheme('gemini').bannerGradient, ['#38bdf8', '#8b5cf6', '#f9c74f']);
  assert.deepEqual(getTheme('claude').bannerGradient, ['#9a3412', '#d97706', '#f4a261']);
  assert.deepEqual(getTheme('deepseek').bannerGradient, ['#1e3a8a', '#1d4ed8', '#22d3ee']);
  assert.deepEqual(getTheme('codex').bannerGradient, ['#166534', '#10b981', '#93c5fd']);
  assert.deepEqual(getTheme('kimi').bannerGradient, ['#4d7c0f', '#84cc16', '#4ade80']);
  assert.deepEqual(getTheme('dark').bannerGradient, ['#334155', '#475569', '#a78bfa']);
  assert.deepEqual(getTheme('light').bannerGradient, ['#2563eb', '#38bdf8', '#0f766e']);
});
