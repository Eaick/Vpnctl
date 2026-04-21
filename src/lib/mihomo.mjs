import { createConfig, authHeaders } from './config.mjs';

const HIDDEN_NODE_PATTERNS = [
  /^最新网址/,
  /^最新网址/,
  /^剩余流量/,
  /^距离下次重置剩余/,
  /^套餐到期/
];

export function cleanCandidates(names = []) {
  return names.filter((name) => !HIDDEN_NODE_PATTERNS.some((re) => re.test(name)));
}

export async function api(path, options = {}) {
  const config = createConfig();
  const res = await fetch(`${config.mihomoApi}${path}`, {
    ...options,
    headers: {
      ...authHeaders({ json: options.body !== undefined, config }),
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res.text();
}

export async function isApiAlive() {
  try {
    await getVersion();
    return true;
  } catch {
    return false;
  }
}

export async function getVersion() {
  return api('/version');
}

export async function reloadConfig(path = '') {
  return api(`/configs?force=true`, {
    method: 'PUT',
    body: JSON.stringify({
      path,
      payload: ''
    })
  });
}

export async function restartKernel() {
  return api('/restart', {
    method: 'POST',
    body: JSON.stringify({
      path: '',
      payload: ''
    })
  });
}

export async function getProxies() {
  const data = await api('/proxies');
  return data.proxies || {};
}

export async function getGroups() {
  const proxies = await getProxies();
  return Object.entries(proxies)
    .map(([name, value]) => ({ name, ...value }))
    .filter((item) => Array.isArray(item.all) && item.all.length > 0);
}

export async function getGroupByName(name) {
  const groups = await getGroups();
  return groups.find((g) => g.name === name) || null;
}

export async function chooseNode(groupName, nodeName) {
  return api(`/proxies/${encodeURIComponent(groupName)}`, {
    method: 'PUT',
    body: JSON.stringify({ name: nodeName })
  });
}

export async function testProxyDelay(proxyName, { url = 'https://www.gstatic.com/generate_204', timeout = 5000 } = {}) {
  const qs = new URLSearchParams({ url, timeout: String(timeout) });
  return api(`/proxies/${encodeURIComponent(proxyName)}/delay?${qs.toString()}`);
}

export async function getCurrentNode(groupName) {
  const group = await getGroupByName(groupName);
  return group?.now || null;
}

export async function switchByCountry(keyword, groupName = createConfig().defaultGroup) {
  const group = await getGroupByName(groupName);
  if (!group) {
    throw new Error(`找不到策略组：${groupName}`);
  }

  const candidates = cleanCandidates(group.all || []).filter((name) => name.includes(keyword));
  if (candidates.length === 0) {
    throw new Error(`策略组「${groupName}」里没有包含「${keyword}」的节点`);
  }

  await chooseNode(groupName, candidates[0]);
  return {
    group: groupName,
    node: candidates[0],
    candidates
  };
}
