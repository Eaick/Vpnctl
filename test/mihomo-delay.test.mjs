import test from 'node:test';
import assert from 'node:assert/strict';
import { testProxyDelay } from '../src/lib/mihomo.mjs';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('provider node delay uses the provider healthcheck endpoint', async () => {
  const originalFetch = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (url) => {
    const request = new URL(url);
    const path = request.pathname;
    paths.push(path);
    if (path.endsWith('/healthcheck')) {
      assert.equal(request.searchParams.get('url'), 'https://cp.cloudflare.com/generate_204');
      assert.equal(request.searchParams.get('timeout'), '10000');
    }
    if (path === '/proxies/Example-Node-01/delay') return jsonResponse({ message: 'Resource not found' }, 404);
    if (path === '/providers/proxies') {
      return jsonResponse({ providers: { 'example-provider': { proxies: [{ name: 'Example-Node-01' }] } } });
    }
    if (path === '/providers/proxies/example-provider/Example-Node-01/healthcheck') return jsonResponse({ delay: 700 });
    throw new Error(`Unexpected request: ${path}`);
  };
  try {
    assert.deepEqual(await testProxyDelay('Example-Node-01', {
      url: 'https://cp.cloudflare.com/generate_204',
      timeout: 10000
    }), { delay: 700 });
    assert.deepEqual(paths, [
      '/proxies/Example-Node-01/delay',
      '/providers/proxies',
      '/providers/proxies/example-provider/Example-Node-01/healthcheck'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ordinary proxy delay does not query providers', async () => {
  const originalFetch = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (url) => {
    paths.push(new URL(url).pathname);
    return jsonResponse({ delay: 42 });
  };
  try {
    assert.deepEqual(await testProxyDelay('DIRECT'), { delay: 42 });
    assert.deepEqual(paths, ['/proxies/DIRECT/delay']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('non-404 delay errors are preserved', async () => {
  const originalFetch = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (url) => {
    paths.push(new URL(url).pathname);
    return jsonResponse({ message: 'Unavailable' }, 503);
  };
  try {
    await assert.rejects(testProxyDelay('Example-Node-01'), /API 503/);
    assert.deepEqual(paths, ['/proxies/Example-Node-01/delay']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
