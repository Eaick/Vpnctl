import { createConfig } from './config.mjs';
import { cleanCandidates, getGroups, getVersion, chooseNode, testProxyDelay, isApiAlive } from './mihomo.mjs';
import { probeConfiguredPortPlan } from './ports.mjs';
import { readPid, isPidAlive } from './process.mjs';
import {
  loadSubscriptionProviderViews,
  loadSubscriptions
} from './subscriptions.mjs';
import { detectOldInstall, summarizeMigrationState } from './migration.mjs';
import { detectShellIntegration } from './shell.mjs';
import { listKnownRuntimeLocks } from './runtime-lock.mjs';
import { formatProtocolTag, normalizeProtocolName } from './subscriptions.mjs';

const REGION_TAGS = [
  'Hong Kong',
  'Japan',
  'Singapore',
  'United States',
  'Taiwan',
  'Korea',
  'HK',
  'JP',
  'US',
  'SG',
  'TW',
  'KR',
  '香港',
  '日本',
  '新加坡',
  '美国',
  '台湾',
  '韩国'
];

export function buildNodeTags(label, { isCurrent = false } = {}) {
  const tags = [];

  if (isCurrent) tags.push('CURRENT');

  for (const tag of REGION_TAGS) {
    if (label.includes(tag)) {
      tags.push(tag);
      break;
    }
  }

  return tags;
}

export function mapGroupToProviderView(group, { defaultGroup = createConfig().defaultGroup } = {}) {
  const visibleNodes = cleanCandidates(group.all || []);
  const isActive = group.name === defaultGroup || Boolean(group.now);

  return {
    id: group.name,
    label: group.name,
    nodeCount: visibleNodes.length,
    currentNodeLabel: group.now || '',
    status: isActive ? 'active' : 'idle',
    nodes: visibleNodes.map((name) => ({
      id: name,
      label: name,
      isCurrent: name === group.now,
      delayMs: null,
      delayStatus: 'idle',
      protocol: 'unknown',
      tags: buildNodeTags(name, { isCurrent: name === group.now })
    }))
  };
}

function buildProtocolLookup(subscriptions = []) {
  const lookup = new Map();
  for (const subscription of subscriptions) {
    for (const node of subscription.nodes || []) {
      lookup.set(`${subscription.displayName}::${node.name}`, normalizeProtocolName(node.protocol));
      if (!lookup.has(node.name)) {
        lookup.set(node.name, normalizeProtocolName(node.protocol));
      }
    }
  }
  return lookup;
}

function attachProtocol(node, providerLabel, lookup) {
  const protocol = lookup.get(`${providerLabel}::${node.label}`) || lookup.get(node.label) || 'unknown';
  const tags = [...(node.tags || []).filter((tag) => tag !== formatProtocolTag(protocol))];
  tags.push(formatProtocolTag(protocol));
  return {
    ...node,
    protocol,
    tags
  };
}

export function getSessionReuseStatus({ apiAlive, shellIntegration }) {
  if (!shellIntegration?.installed || !shellIntegration?.codexWrapper) {
    return {
      state: 'unavailable',
      label: 'Install bash shell integration to enable direct codex reuse'
    };
  }

  if (!apiAlive) {
    return {
      state: 'waiting',
      label: 'Shell is ready; once any session starts mihomo, other same-account sessions can run codex directly'
    };
  }

  return {
    state: 'ready',
    label: 'Same-account sessions can run codex directly and reuse the running VPN'
  };
}

function buildNextSteps({ config, providers, subscriptions, apiAlive, shellIntegration }) {
  if (!config.isInitialized) {
    return ['Run dev init / init'];
  }

  if (!subscriptions.length) {
    return ['Add a subscription URL or YAML'];
  }

  if (!providers.length) {
    return ['Run sync to generate providers'];
  }

  if (!apiAlive) {
    return ['Start mihomo', 'Refresh dashboard'];
  }

  if (!shellIntegration?.installed || !shellIntegration?.codexWrapper) {
    return ['Install bash shell integration', 'Review shell proxy'];
  }

  return ['Select a node', 'Measure latency', 'Review shell proxy'];
}

export async function loadDashboardSnapshot() {
  const config = createConfig();
  const apiAlive = await isApiAlive();
  const pid = await readPid();
  const pidAlive = await isPidAlive(pid);
  const ports = await probeConfiguredPortPlan(config);
  const subscriptions = await loadSubscriptions(config);
  const shellIntegration = await detectShellIntegration().catch(() => ({
    shell: 'bash',
    bashrcPath: '',
    installed: false,
    codexWrapper: false
  }));
  const sessionReuse = getSessionReuseStatus({ apiAlive, shellIntegration });
  const runtimeLocks = await listKnownRuntimeLocks();
  const migration = await summarizeMigrationState(config);
  const oldInstall = await detectOldInstall();

  let version = null;
  let providers = [];
  const protocolLookup = buildProtocolLookup(subscriptions);

  if (apiAlive) {
    const groups = await getGroups();
    version = await getVersion().catch(() => null);
    providers = groups.map((group) => {
      const provider = mapGroupToProviderView(group, { defaultGroup: config.defaultGroup });
      return {
        ...provider,
        nodes: provider.nodes.map((node) => attachProtocol(node, provider.label, protocolLookup))
      };
    });
  } else {
    providers = await loadSubscriptionProviderViews(config);
  }

  const selectedProviderId = providers.find((provider) => provider.id === config.defaultGroup)?.id || providers[0]?.id || null;
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) || null;

  return {
    generatedAt: new Date().toISOString(),
    status: {
      apiAlive,
      pid,
      pidAlive,
      version,
      mode: config.mode,
      initialized: config.isInitialized,
      configDir: config.configDir,
      dataDir: config.dataDir,
      defaultGroup: config.defaultGroup,
      httpProxy: config.httpProxy,
      socksProxy: config.socksProxy,
      mihomoApi: config.mihomoApi,
      logFile: config.logFile,
      ports,
      portSource: config.portSource,
      theme: config.theme,
      shellIntegration,
      sessionReuse,
      runtimeLocks,
      migration,
      oldInstallDetected: Boolean(oldInstall),
      subscriptionCount: subscriptions.length,
      nextSteps: buildNextSteps({ config, providers, subscriptions, apiAlive, shellIntegration })
    },
    subscriptions,
    selectedProviderId,
    providers,
    currentNodeLabel: selectedProvider?.currentNodeLabel || ''
  };
}

export async function refreshDashboardSnapshot() {
  return loadDashboardSnapshot();
}

export async function switchProviderNode(providerId, nodeId) {
  await chooseNode(providerId, nodeId);
  return refreshDashboardSnapshot();
}

export async function measureNode(providerId, nodeId, { url, timeout } = {}) {
  const result = await testProxyDelay(nodeId, { url, timeout });
  return {
    providerId,
    nodeId,
    delayMs: typeof result?.delay === 'number' ? result.delay : null,
    raw: result
  };
}
