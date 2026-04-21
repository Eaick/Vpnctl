import { createConfig } from './config.mjs';
import { cleanCandidates, getGroups, getVersion, chooseNode, testProxyDelay } from './mihomo.mjs';
import { probeConfiguredPortPlan } from './ports.mjs';
import {
  loadSubscriptionProviderViews,
  loadSubscriptions
} from './subscriptions.mjs';
import { detectOldInstall, summarizeMigrationState } from './migration.mjs';
import { detectShellIntegration } from './shell.mjs';
import { listKnownRuntimeLocks } from './runtime-lock.mjs';
import { formatProtocolTag, normalizeProtocolName } from './subscriptions.mjs';
import { getManagedRuntimeStatus } from './managed-runtime.mjs';

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

  if (isCurrent) tags.push('当前');

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
      label: '安装 bash shell 集成后，可直接复用当前 VPN 运行 codex'
    };
  }

  if (!apiAlive) {
    return {
      state: 'waiting',
      label: 'Shell 已准备好；任意同账号会话先启动 mihomo 后，其他会话即可直接运行 codex'
    };
  }

  return {
    state: 'ready',
    label: '同账号会话可以直接运行 codex，并复用当前 VPN'
  };
}

function buildNextSteps({ config, providers, subscriptions, apiAlive, shellIntegration }) {
  if (!config.isInitialized) {
    return ['先执行 dev init / init'];
  }

  if (!subscriptions.length) {
    return ['添加订阅 URL 或 YAML'];
  }

  if (!providers.length) {
    return ['执行同步生成 providers'];
  }

  if (!apiAlive) {
    return ['启动 mihomo', '刷新面板'];
  }

  if (!shellIntegration?.installed || !shellIntegration?.codexWrapper) {
    return ['安装 bash shell 集成', '检查 shell 代理'];
  }

  return ['选择节点', '执行测速', '检查 shell 代理'];
}

export async function loadDashboardSnapshot() {
  const config = createConfig();
  const runtimeStatus = await getManagedRuntimeStatus(config);
  const apiAlive = runtimeStatus.managedApiAlive;
  const pid = runtimeStatus.pid;
  const pidAlive = runtimeStatus.pidAlive;
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
  const activeSubscription = subscriptions.find((item) => item.enabled) || null;

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
      apiReachable: runtimeStatus.apiReachable,
      foreignApiAlive: runtimeStatus.foreignApiAlive,
      version,
      mode: config.mode,
      initialized: config.isInitialized,
      configDir: config.configDir,
      dataDir: config.dataDir,
      defaultGroup: config.defaultGroup,
      proxyMode: config.proxyMode,
      activeSubscriptionLabel: activeSubscription?.displayName || '',
      httpProxy: config.httpProxy,
      socksProxy: config.socksProxy,
      mixedProxy: config.mixedProxy,
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
