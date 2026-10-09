import test from 'node:test';
import assert from 'node:assert/strict';
import { getNodeNotices, getSelectableNodes, isNodeNotice } from '../src/lib/tui-node-view.mjs';
import { createInitialTuiState, ensureSelections, getAvailableProtocols, getNodes, getSelectedNode } from '../src/lib/tui-state.mjs';
import { moveNodeCardSelection } from '../src/lib/tui-cards.mjs';
import { chooseNode } from '../src/lib/mihomo.mjs';
import { measureNode } from '../src/lib/dashboard.mjs';

function makeProvider() {
  return {
    id: 'example / provider', label: '示例订阅', currentNodeLabel: '香港 / 01 # IEPL',
    nodes: [
      { id: 'quota', label: '剩余: 26.98 GB, 到期: 2026-11-15', protocol: 'vless' },
      { id: '香港 / 01 # IEPL', label: '香港 / 01 # IEPL', protocol: 'trojan', isCurrent: true },
      { id: 'announcement', label: '请关注网站首页的公告信息', protocol: 'vless' },
      { id: 'SG-X5-1', label: 'SG-X5-1', protocol: 'shadowsocks' }
    ]
  };
}

test('only explicit subscription notice names are separated from node cards', () => {
  for (const label of [
    '剩余: 26.98 GB, 到期: 2026-11-15', '剩余流量：99.5GB',
    '套餐到期 2026-12-01', '距离下次重置剩余 7 天', '邀请返佣40%',
    '有问题重新从网站获取订阅', '请关注网站首页的公告信息', '最新网址：https://example.com'
  ]) assert.equal(isNodeNotice({ label }), true, label);
  for (const label of [
    'SG-X5-1', '香港流量节点 01', '剩余流量专线 01', '到期时间 JP 02',
    '香港 01 IEPL', 'DIRECT', 'GLOBAL', 'VPNCTL', '100 GB 新加坡', 'Invite HK 01'
  ]) assert.equal(isNodeNotice({ label }), false, label);
});

test('notices include stored metadata hidden by the live dashboard without mutating the snapshot', () => {
  const provider = makeProvider();
  const subscriptions = [
    { displayName: '其他订阅', nodes: [{ name: '剩余流量 1GB' }] },
    { displayName: provider.label, nodes: [
      { name: '剩余: 26.98 GB, 到期: 2026-11-15' },
      { name: '套餐到期 2026-12-01' },
      { name: '请关注网站首页的公告信息' },
      { name: '香港 / 01 # IEPL' }
    ] }
  ];
  const original = structuredClone({ provider, subscriptions });
  assert.deepEqual(getNodeNotices(provider, subscriptions), [
    '剩余: 26.98 GB, 到期: 2026-11-15', '套餐到期 2026-12-01', '请关注网站首页的公告信息'
  ]);
  assert.deepEqual(getSelectableNodes(provider).map((node) => node.id), ['香港 / 01 # IEPL', 'SG-X5-1']);
  assert.equal(getSelectableNodes(provider)[0], provider.nodes[1]);
  assert.deepEqual({ provider, subscriptions }, original);
  assert.deepEqual(getNodeNotices(null, subscriptions), []);
});

test('search, protocol filters, selection and batch targets all use the original real nodes', () => {
  const provider = makeProvider();
  const state = createInitialTuiState({ selectedProviderId: provider.id, providers: [provider] });
  ensureSelections(state);
  assert.equal(getSelectedNode(state).id, '香港 / 01 # IEPL');
  assert.deepEqual(getAvailableProtocols(provider), ['all', 'shadowsocks', 'trojan']);
  assert.deepEqual(getNodes(state).map((node) => node.id), ['香港 / 01 # IEPL', 'SG-X5-1']);
  state.protocolFilter = 'trojan';
  state.filters.nodes = '香港';
  assert.deepEqual(getNodes(state).map((node) => node.id), ['香港 / 01 # IEPL']);
  state.filters.nodes = 'SG';
  assert.deepEqual(getNodes(state), []);
  state.protocolFilter = 'all';
  ensureSelections(state);
  assert.equal(getSelectedNode(state).id, 'SG-X5-1');
});

test('a notice-only group cannot become a selectable or measurable node', () => {
  const provider = makeProvider();
  provider.nodes = provider.nodes.filter(isNodeNotice);
  const state = createInitialTuiState({ selectedProviderId: provider.id, providers: [provider] });
  ensureSelections(state);
  assert.equal(getSelectedNode(state), null);
  assert.deepEqual(getNodes(state), []);
  assert.deepEqual(getAvailableProtocols(provider), ['all']);
});

test('card-selected nodes preserve exact API names and provider healthcheck fallback', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const provider = makeProvider();
  const state = createInitialTuiState({ selectedProviderId: provider.id, providers: [provider] });
  ensureSelections(state);
  state.selectedNodeIds[provider.id] = moveNodeCardSelection(getNodes(state), getSelectedNode(state).id, 'right', 80);
  const node = getSelectedNode(state);
  globalThis.fetch = async (url, options = {}) => {
    const request = new URL(url);
    requests.push({ path: request.pathname, options });
    if (options.method === 'PUT') {
      assert.equal(request.pathname, `/proxies/${encodeURIComponent(provider.id)}`);
      assert.deepEqual(JSON.parse(options.body), { name: node.id });
      return new Response(null, { status: 204 });
    }
    let body;
    if (request.pathname === '/proxies/SG-X5-1/delay') return new Response('', { status: 404 });
    if (request.pathname === '/providers/proxies') {
      body = { providers: { 'source / 123': { proxies: [{ name: node.id }] } } };
    } else {
      assert.equal(request.pathname, '/providers/proxies/source%20%2F%20123/SG-X5-1/healthcheck');
      assert.equal(request.searchParams.get('url'), 'https://cp.cloudflare.com/generate_204');
      body = { delay: 700 };
    }
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  try {
    await chooseNode(provider.id, node.id);
    const result = await measureNode(provider.id, node.id, { url: 'https://cp.cloudflare.com/generate_204' });
    assert.equal(result.providerId, provider.id);
    assert.equal(result.nodeId, 'SG-X5-1');
    assert.equal(result.delayMs, 700);
    assert.equal(requests.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
