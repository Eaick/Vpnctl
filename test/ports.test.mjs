import test from 'node:test';
import assert from 'node:assert/strict';
import { getConfiguredPortPlan, buildPortEnvSnippet, listBusyEndpoints } from '../src/lib/ports.mjs';

test('getConfiguredPortPlan parses configured endpoints', () => {
  const plan = getConfiguredPortPlan({
    mihomoApi: 'http://127.0.0.1:19090',
    httpProxy: 'http://127.0.0.1:17890',
    socksProxy: 'socks5://127.0.0.1:17891'
  });

  assert.deepEqual(plan, {
    api: { protocol: 'http:', host: '127.0.0.1', port: 19090 },
    http: { protocol: 'http:', host: '127.0.0.1', port: 17890 },
    socks: { protocol: 'socks5:', host: '127.0.0.1', port: 17891 }
  });
});

test('buildPortEnvSnippet returns export commands', () => {
  const snippet = buildPortEnvSnippet({
    api: { host: '127.0.0.1', port: 19090 },
    http: { host: '127.0.0.1', port: 17890 },
    socks: { host: '127.0.0.1', port: 17891 }
  });

  assert.match(snippet, /MIHOMO_API/);
  assert.match(snippet, /19090/);
  assert.match(snippet, /17890/);
  assert.match(snippet, /17891/);
});

test('listBusyEndpoints filters occupied ports only', () => {
  const busy = listBusyEndpoints({
    api: { host: '127.0.0.1', port: 19090, available: true },
    http: { host: '127.0.0.1', port: 17890, available: false },
    socks: { host: '127.0.0.1', port: 17891, available: false }
  });

  assert.equal(busy.length, 2);
  assert.equal(busy[0].name, 'http');
  assert.equal(busy[1].name, 'socks');
});
