import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createConfig } from '../src/lib/config.mjs';
import { getProjectRoot } from '../src/lib/runtime.mjs';

test('createConfig uses dev defaults for sandbox mode', () => {
  const config = createConfig('dev');
  assert.equal(config.mode, 'dev');
  assert.equal(config.mihomoApi, 'http://127.0.0.1:19090');
  assert.equal(config.httpProxy, 'http://127.0.0.1:17890');
  assert.equal(config.socksProxy, 'socks5://127.0.0.1:17891');
  assert.equal(config.paths.root, path.join(getProjectRoot(), '.sandbox'));
});

test('createConfig uses user defaults for user mode', () => {
  const config = createConfig('user');
  assert.equal(config.mode, 'user');
  assert.match(config.mihomoApi, /9090$/);
  assert.match(config.httpProxy, /7890$/);
  assert.match(config.socksProxy, /7891$/);
  assert.match(config.providersDir.replace(/\\/g, '/'), /\/config\/providers$/);
});
