import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import YAML from 'yaml';
import { createConfig } from './config.mjs';
import { ensureRuntimeDirectories } from './install.mjs';

const PROTOCOL_ALIASES = {
  ss: 'shadowsocks',
  ssr: 'shadowsocksr'
};

function normalizeActiveSubscriptions(items = [], preferredId = null) {
  if (!items.length) return [];

  const preferred = preferredId && items.find((item) => item.id === preferredId)
    ? preferredId
    : null;
  const firstEnabled = items.find((item) => item.enabled)?.id || null;
  const activeId = preferred || firstEnabled || items[0].id;

  return items.map((item) => ({
    ...item,
    enabled: item.id === activeId
  }));
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'sub';
}

function toForwardSlash(filepath) {
  return filepath.replace(/\\/g, '/');
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function normalizeProtocolName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'unknown';
  return PROTOCOL_ALIASES[normalized] || normalized;
}

export function formatProtocolTag(protocol) {
  const normalized = normalizeProtocolName(protocol);
  if (normalized === 'shadowsocks') return 'SS';
  if (normalized === 'shadowsocksr') return 'SSR';
  return normalized.toUpperCase();
}

function buildSubscriptionId() {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

function buildProviderKey(label, id) {
  return `${slugify(label)}-${id.slice(0, 6)}`;
}

function nextDisplayName(baseName, existingItems) {
  const names = new Set(existingItems.map((item) => item.displayName));
  if (!names.has(baseName)) return baseName;

  let index = 2;
  while (names.has(`${baseName} (${index})`)) {
    index += 1;
  }
  return `${baseName} (${index})`;
}

export function normalizeSubscriptionUrl(value) {
  const url = new URL(value);
  url.hash = '';
  return url.toString();
}

export function parseNodeNamesFromUriList(content) {
  return parseNodesFromUriList(content).map((item) => item.name);
}

export function parseNodesFromUriList(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const scheme = line.includes('://') ? line.slice(0, line.indexOf('://')) : '';
      const rawName = line.includes('#') ? line.slice(line.indexOf('#') + 1) : line;
      try {
        return {
          name: decodeURIComponent(rawName),
          protocol: normalizeProtocolName(scheme)
        };
      } catch {
        return {
          name: rawName,
          protocol: normalizeProtocolName(scheme)
        };
      }
    })
    .filter((item) => item.name);
}

function maybeDecodeBase64(content) {
  const compact = content.trim();
  if (!compact || /[\r\n]/.test(compact)) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(compact)) return null;

  try {
    const decoded = Buffer.from(compact, 'base64').toString('utf8');
    return decoded.includes('://') ? decoded : null;
  } catch {
    return null;
  }
}

export function parseNodes(content) {
  try {
    const parsed = YAML.parse(content);
    if (Array.isArray(parsed?.proxies)) {
      return parsed.proxies
        .map((item) => ({
          name: typeof item?.name === 'string' ? item.name.trim() : '',
          protocol: normalizeProtocolName(item?.type)
        }))
        .filter((item) => item.name);
    }
  } catch {
    // ignore parse failure and continue with URI mode
  }

  const base64Decoded = maybeDecodeBase64(content);
  if (base64Decoded) {
    return parseNodesFromUriList(base64Decoded);
  }

  if (content.includes('://')) {
    return parseNodesFromUriList(content);
  }

  return [];
}

export function parseNodeNames(content) {
  return parseNodes(content).map((item) => item.name);
}

async function readJson(filepath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filepath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function fileExists(filepath) {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(filepath, value) {
  await fs.writeFile(filepath, JSON.stringify(value, null, 2), 'utf8');
}

export async function ensureSubscriptionStore(currentConfig = createConfig()) {
  await ensureRuntimeDirectories(currentConfig);
  try {
    await fs.access(currentConfig.subscriptionsFile);
  } catch {
    await writeJson(currentConfig.subscriptionsFile, []);
  }
}

export async function loadSubscriptions(currentConfig = createConfig()) {
  const items = await readJson(currentConfig.subscriptionsFile, []);
  return normalizeActiveSubscriptions(items).map((item) => ({
    ...item,
    nodes: Array.isArray(item.nodes) && item.nodes.length
      ? item.nodes.map((node) => ({
        name: String(node?.name || '').trim(),
        protocol: normalizeProtocolName(node?.protocol)
      })).filter((node) => node.name)
      : (Array.isArray(item.nodeNames)
        ? item.nodeNames
          .map((name) => String(name || '').trim())
          .filter(Boolean)
          .map((name) => ({ name, protocol: 'unknown' }))
        : []),
    nodeNames: Array.isArray(item.nodes) && item.nodes.length
      ? item.nodes
        .map((node) => String(node?.name || '').trim())
        .filter(Boolean)
      : (Array.isArray(item.nodeNames)
        ? item.nodeNames.map((name) => String(name || '').trim()).filter(Boolean)
        : []),
    cachePath: buildCacheFile(currentConfig, item.id),
    providerPath: buildProviderFile(currentConfig, item.providerKey)
  })).map((item) => ({
    ...item,
    nodeCount: item.nodes.length || Number(item.nodeCount || 0)
  }));
}

export async function saveSubscriptions(currentConfig, items) {
  await ensureSubscriptionStore(currentConfig);
  await writeJson(currentConfig.subscriptionsFile, normalizeActiveSubscriptions(items).map((item) => ({
    ...item,
    nodes: Array.isArray(item.nodes)
      ? item.nodes.map((node) => ({
        name: String(node?.name || '').trim(),
        protocol: normalizeProtocolName(node?.protocol)
      })).filter((node) => node.name)
      : [],
    nodeNames: Array.isArray(item.nodes) && item.nodes.length
      ? item.nodes.map((node) => String(node?.name || '').trim()).filter(Boolean)
      : (Array.isArray(item.nodeNames)
        ? item.nodeNames.map((name) => String(name || '').trim()).filter(Boolean)
        : []),
    nodeCount: Array.isArray(item.nodes) && item.nodes.length
      ? item.nodes.length
      : Number(item.nodeCount || 0)
  })));
}

function buildDisplayName(source, alias) {
  if (alias) return alias.trim();

  if (source.type === 'remote') {
    return source.url.hostname || 'Subscription';
  }

  return path.basename(source.filePath, path.extname(source.filePath)) || 'Local Subscription';
}

function buildCacheFile(currentConfig, subscriptionId) {
  return path.join(currentConfig.cacheDir, `${subscriptionId}.yaml`);
}

function buildProviderFile(currentConfig, providerKey) {
  return path.join(currentConfig.providersDir, `${providerKey}.yaml`);
}

export async function addSubscriptionFromUrl(url, alias, currentConfig = createConfig()) {
  const normalized = normalizeSubscriptionUrl(url);
  const subscriptions = await loadSubscriptions(currentConfig);
  const exists = subscriptions.find((item) => item.type === 'remote' && item.source === normalized);
  if (exists) {
    throw new Error(`订阅已存在：${exists.displayName} (${exists.id})`);
  }

  const baseName = buildDisplayName({ type: 'remote', url: new URL(normalized) }, alias);
  const displayName = nextDisplayName(baseName, subscriptions);
  const id = buildSubscriptionId();
  const providerKey = buildProviderKey(displayName, id);
  const subscription = {
    id,
    type: 'remote',
    source: normalized,
    displayName,
    providerKey,
    contentHash: '',
    lastSyncedAt: '',
    enabled: subscriptions.length === 0,
    nodes: [],
    nodeNames: [],
    nodeCount: 0,
    syncStatus: 'pending',
    syncError: '',
    cachePath: buildCacheFile(currentConfig, id),
    providerPath: buildProviderFile(currentConfig, providerKey)
  };

  subscriptions.push(subscription);
  await saveSubscriptions(currentConfig, subscriptions);
  return subscription;
}

export async function addSubscriptionFromFile(filePath, alias, currentConfig = createConfig()) {
  const resolved = path.resolve(filePath);
  const content = await fs.readFile(resolved, 'utf8');
  const contentHash = sha256(content);
  const subscriptions = await loadSubscriptions(currentConfig);
  const exists = subscriptions.find((item) => item.type === 'local' && item.contentHash === contentHash);
  if (exists) {
    throw new Error(`本地订阅内容已存在：${exists.displayName} (${exists.id})`);
  }

  const baseName = buildDisplayName({ type: 'local', filePath: resolved }, alias);
  const displayName = nextDisplayName(baseName, subscriptions);
  const id = buildSubscriptionId();
  const providerKey = buildProviderKey(displayName, id);
  const subscription = {
    id,
    type: 'local',
    source: resolved,
    displayName,
    providerKey,
    contentHash,
    lastSyncedAt: '',
    enabled: subscriptions.length === 0,
    nodes: [],
    nodeNames: [],
    nodeCount: 0,
    syncStatus: 'pending',
    syncError: '',
    cachePath: buildCacheFile(currentConfig, id),
    providerPath: buildProviderFile(currentConfig, providerKey)
  };

  subscriptions.push(subscription);
  await saveSubscriptions(currentConfig, subscriptions);
  return subscription;
}

export async function removeSubscription(id, currentConfig = createConfig()) {
  const subscriptions = await loadSubscriptions(currentConfig);
  const nextItems = subscriptions.filter((item) => item.id !== id);
  if (nextItems.length === subscriptions.length) {
    throw new Error(`订阅不存在：${id}`);
  }

  const removed = subscriptions.find((item) => item.id === id);
  await saveSubscriptions(currentConfig, nextItems);

  if (removed?.cachePath) await fs.rm(removed.cachePath, { force: true }).catch(() => {});
  if (removed?.providerPath) await fs.rm(removed.providerPath, { force: true }).catch(() => {});
  return removed;
}

export async function activateSubscription(id, currentConfig = createConfig()) {
  const subscriptions = await loadSubscriptions(currentConfig);
  const exists = subscriptions.find((item) => item.id === id);
  if (!exists) {
    throw new Error(`订阅不存在：${id}`);
  }

  const nextItems = normalizeActiveSubscriptions(subscriptions, id);
  await saveSubscriptions(currentConfig, nextItems);
  return nextItems.find((item) => item.id === id);
}

function buildRemoteProviderEntry(subscription) {
  return {
    type: 'http',
    url: subscription.source,
    path: toForwardSlash(subscription.providerPath),
    interval: 86400,
    'health-check': {
      enable: true,
      lazy: true,
      url: 'https://www.gstatic.com/generate_204',
      interval: 600
    }
  };
}

function buildLocalProviderEntry(subscription) {
  return {
    type: 'file',
    path: toForwardSlash(subscription.providerPath)
  };
}

async function buildProviderEntry(subscription) {
  if (subscription.type === 'local') {
    return buildLocalProviderEntry(subscription);
  }

  if (subscription.syncStatus === 'synced' && await fileExists(subscription.providerPath)) {
    return buildLocalProviderEntry(subscription);
  }

  return buildRemoteProviderEntry(subscription);
}

export async function writeManagedConfig(currentConfig = createConfig()) {
  const subscriptions = await loadSubscriptions(currentConfig);
  const active = subscriptions.filter((item) => item.enabled);
  const providerEntries = {};
  const providerGroups = [];

  for (const subscription of active) {
    providerEntries[subscription.providerKey] = await buildProviderEntry(subscription);

    providerGroups.push({
      name: subscription.displayName,
      type: 'select',
      use: [subscription.providerKey]
    });
  }

  const rootGroupName = active.length ? currentConfig.defaultGroup : 'DIRECT';
  const proxyGroups = [
    ...providerGroups,
    active.length
      ? {
        name: currentConfig.defaultGroup,
        type: 'select',
        proxies: [...active.map((item) => item.displayName), 'DIRECT']
      }
      : {
        name: 'DIRECT',
        type: 'select',
        proxies: ['DIRECT']
      }
  ];

  const document = {
    mode: 'rule',
    'allow-lan': false,
    'log-level': 'info',
    'external-controller': `${currentConfig.controllerHost}:${Number(new URL(currentConfig.mihomoApi).port)}`,
    secret: currentConfig.mihomoSecret,
    profile: {
      'store-selected': true
    },
    'proxy-providers': providerEntries,
    'proxy-groups': proxyGroups,
    rules: [`MATCH,${rootGroupName}`]
  };

  if (currentConfig.proxyMode === 'mix') {
    document['mixed-port'] = Number(new URL(currentConfig.httpProxy).port);
  } else {
    document.port = Number(new URL(currentConfig.httpProxy).port);
    document['socks-port'] = Number(new URL(currentConfig.socksProxy).port);
  }

  await fs.mkdir(path.dirname(currentConfig.generatedConfigFile), { recursive: true });
  await fs.writeFile(currentConfig.generatedConfigFile, YAML.stringify(document), 'utf8');
}

async function loadRemoteSubscriptionContent(subscription) {
  const res = await fetch(subscription.source, {
    headers: {
      'User-Agent': 'vpnctl-mihomo'
    }
  });

  if (!res.ok) {
    throw new Error(`拉取订阅失败：${res.status} ${res.statusText}`);
  }

  return res.text();
}

async function loadLocalSubscriptionContent(subscription) {
  return fs.readFile(subscription.source, 'utf8');
}

export async function syncSubscriptions({ id } = {}, currentConfig = createConfig()) {
  const subscriptions = await loadSubscriptions(currentConfig);
  const targetItems = id
    ? subscriptions.filter((item) => item.id === id)
    : subscriptions.filter((item) => item.enabled);

  if (id && targetItems.length === 0) {
    throw new Error(`订阅不存在：${id}`);
  }

  const results = [];

  for (const subscription of targetItems) {
    try {
      const content = subscription.type === 'remote'
        ? await loadRemoteSubscriptionContent(subscription)
        : await loadLocalSubscriptionContent(subscription);

      await fs.mkdir(path.dirname(subscription.cachePath), { recursive: true });
      await fs.mkdir(path.dirname(subscription.providerPath), { recursive: true });
      await fs.writeFile(subscription.cachePath, content, 'utf8');
      await fs.writeFile(subscription.providerPath, content, 'utf8');

      const nodes = parseNodes(content);
      const nodeNames = nodes.map((item) => item.name);
      subscription.contentHash = sha256(content);
      subscription.lastSyncedAt = new Date().toISOString();
      subscription.nodes = nodes;
      subscription.nodeNames = nodeNames;
      subscription.nodeCount = nodes.length;
      subscription.syncStatus = 'synced';
      subscription.syncError = '';
      results.push({
        id: subscription.id,
        displayName: subscription.displayName,
        ok: true,
        nodeCount: nodes.length
      });
    } catch (error) {
      subscription.syncStatus = 'failed';
      subscription.syncError = error.message || String(error);
      results.push({
        id: subscription.id,
        displayName: subscription.displayName,
        ok: false,
        error: subscription.syncError
      });
    }
  }

  await saveSubscriptions(currentConfig, subscriptions);
  await writeManagedConfig(currentConfig);
  return results;
}

export function mapSubscriptionToProviderView(subscription) {
  const nodes = (subscription.nodes || []).map((node) => ({
    id: node.name,
    label: node.name,
    isCurrent: false,
    delayMs: null,
    delayStatus: 'idle',
    protocol: normalizeProtocolName(node.protocol),
    tags: [formatProtocolTag(node.protocol)]
  }));

  return {
    id: subscription.displayName,
    label: subscription.displayName,
    nodeCount: nodes.length,
    currentNodeLabel: '',
    status: subscription.syncStatus === 'failed' ? 'warn' : 'idle',
    nodes
  };
}

export async function loadSubscriptionProviderViews(currentConfig = createConfig()) {
  const subscriptions = await loadSubscriptions(currentConfig);
  return subscriptions
    .filter((item) => item.enabled)
    .map(mapSubscriptionToProviderView);
}

export async function importSubscriptions(records = [], currentConfig = createConfig()) {
  const existing = await loadSubscriptions(currentConfig);
  const nextItems = [...existing];
  const imported = [];
  const skipped = [];

  for (const record of records) {
    const type = record.type === 'local' ? 'local' : 'remote';
    const source = String(record.source || '').trim();
    if (!source) {
      skipped.push({ reason: 'missing-source', source });
      continue;
    }

    const duplicate = nextItems.find((item) => {
      if (type === 'remote') {
        return item.type === 'remote' && item.source === source;
      }
      return item.type === 'local' && item.contentHash && item.contentHash === record.contentHash;
    });

    if (duplicate) {
      skipped.push({ reason: 'duplicate', source, id: duplicate.id });
      continue;
    }

    const baseName = (record.displayName || '').trim() || buildDisplayName(
      type === 'remote'
        ? { type: 'remote', url: new URL(source) }
        : { type: 'local', filePath: source }
    );
    const displayName = nextDisplayName(baseName, nextItems);
    const id = buildSubscriptionId();
    const providerKey = buildProviderKey(displayName, id);
    const subscription = {
      id,
      type,
      source,
      displayName,
      providerKey,
      contentHash: record.contentHash || '',
      lastSyncedAt: record.lastSyncedAt || '',
      enabled: record.enabled !== false,
      nodes: Array.isArray(record.nodes)
        ? record.nodes.map((node) => ({
          name: String(node?.name || '').trim(),
          protocol: normalizeProtocolName(node?.protocol)
        })).filter((node) => node.name)
        : (Array.isArray(record.nodeNames)
          ? record.nodeNames.map((name) => String(name || '').trim()).filter(Boolean).map((name) => ({ name, protocol: 'unknown' }))
          : []),
      nodeNames: Array.isArray(record.nodeNames) ? [...record.nodeNames] : [],
      nodeCount: Number(record.nodeCount || 0),
      syncStatus: record.syncStatus || 'pending',
      syncError: record.syncError || '',
      cachePath: buildCacheFile(currentConfig, id),
      providerPath: buildProviderFile(currentConfig, providerKey)
    };

    nextItems.push(subscription);
    imported.push(subscription);
  }

  await saveSubscriptions(currentConfig, nextItems);
  return { imported, skipped, items: nextItems };
}
