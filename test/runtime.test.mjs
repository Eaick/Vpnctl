import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createConfig } from '../src/lib/config.mjs';
import { getProjectRoot } from '../src/lib/runtime.mjs';

test('createConfig uses dev mix defaults for sandbox mode', () => {
  const config = createConfig('dev');
  assert.equal(config.mode, 'dev');
  assert.equal(config.proxyMode, 'mix');
  assert.equal(config.mihomoApi, 'http://127.0.0.1:19090');
  assert.equal(config.httpProxy, 'http://127.0.0.1:17890');
  assert.equal(config.socksProxy, 'socks5://127.0.0.1:17890');
  assert.equal(config.paths.root, path.join(getProjectRoot(), '.sandbox'));
});

test('createConfig supports separate mode overrides', () => {
  const config = createConfig('user', {
    proxyMode: 'separate',
    ports: {
      http: 7890,
      socks: 7891,
      api: 9090
    }
  });

  assert.equal(config.mode, 'user');
  assert.equal(config.proxyMode, 'separate');
  assert.match(config.mihomoApi, /9090$/);
  assert.match(config.httpProxy, /7890$/);
  assert.match(config.socksProxy, /7891$/);
  assert.match(config.providersDir.replace(/\\/g, '/'), /\/config\/providers$/);
});
