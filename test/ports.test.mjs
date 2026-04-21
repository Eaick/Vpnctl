import test from 'node:test';
import assert from 'node:assert/strict';
import { getConfiguredPortPlan, buildPortEnvSnippet, listBusyEndpoints } from '../src/lib/ports.mjs';

test('getConfiguredPortPlan parses mix mode endpoints', () => {
  const plan = getConfiguredPortPlan({
    proxyMode: 'mix',
    mihomoApi: 'http://127.0.0.1:19090',
    httpProxy: 'http://127.0.0.1:17890',
    socksProxy: 'socks5://127.0.0.1:17890'
  });

  assert.deepEqual(plan, {
    mode: 'mix',
    api: { protocol: 'http:', host: '127.0.0.1', port: 19090 },
    mixed: { protocol: 'http:', host: '127.0.0.1', port: 17890 }
  });
});

test('getConfiguredPortPlan parses separate mode endpoints', () => {
  const plan = getConfiguredPortPlan({
    proxyMode: 'separate',
    mihomoApi: 'http://127.0.0.1:19090',
    httpProxy: 'http://127.0.0.1:17890',
    socksProxy: 'socks5://127.0.0.1:17891'
  });

  assert.deepEqual(plan, {
    mode: 'separate',
    api: { protocol: 'http:', host: '127.0.0.1', port: 19090 },
    http: { protocol: 'http:', host: '127.0.0.1', port: 17890 },
    socks: { protocol: 'socks5:', host: '127.0.0.1', port: 17891 }
  });
});

test('buildPortEnvSnippet returns mode-aware export commands', () => {
  const snippet = buildPortEnvSnippet({
    mode: 'mix',
    api: { host: '127.0.0.1', port: 19090 },
    mixed: { host: '127.0.0.1', port: 17890 }
  });

  assert.match(snippet, /MIHOMO_API/);
  assert.match(snippet, /19090/);
  assert.match(snippet, /17890/);
});

test('listBusyEndpoints filters occupied ports only', () => {
  const busy = listBusyEndpoints({
    mode: 'mix',
    api: { host: '127.0.0.1', port: 19090, available: true },
    mixed: { host: '127.0.0.1', port: 17890, available: false }
  });

  assert.equal(busy.length, 1);
  assert.equal(busy[0].name, 'mixed');
});
