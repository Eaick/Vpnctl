import { filterItems, filterNodesByProtocol, resolveSelectedIndex } from './tui-layout.mjs';

export function createInitialTuiState(snapshot) {
  return {
    snapshot,
    selectedProviderId: snapshot.selectedProviderId,
    selectedNodeIds: {},
    activePane: 'providers',
    singleModePane: 'providers',
    helpOpen: false,
    searchMode: false,
    filters: {
      providers: '',
      nodes: ''
    },
    protocolFilter: 'all',
    notice: {
      tone: 'accent',
      text: 'Ready'
    },
    busy: false
  };
}

export function getProviders(state) {
  return filterItems(state.snapshot.providers, state.filters.providers);
}

export function getSelectedProvider(state) {
  const providers = getProviders(state);
  const providerIndex = resolveSelectedIndex(providers, state.selectedProviderId);
  return providers[providerIndex] || null;
}

export function getNodes(state, provider = getSelectedProvider(state)) {
  if (!provider) return [];
  return filterItems(
    filterNodesByProtocol(provider.nodes, state.protocolFilter),
    state.filters.nodes
  );
}

export function getAvailableProtocols(provider) {
  const protocols = new Set();
  for (const node of provider?.nodes || []) {
    if (node?.protocol) protocols.add(node.protocol);
  }
  return ['all', ...Array.from(protocols).sort()];
}

export function ensureSelections(state) {
  const providers = getProviders(state);
  if (!providers.length) {
    state.selectedProviderId = null;
    return;
  }

  const providerIndex = resolveSelectedIndex(providers, state.selectedProviderId);
  state.selectedProviderId = providers[providerIndex].id;

  for (const provider of state.snapshot.providers) {
    const current = provider.nodes.find((node) => node.isCurrent) || provider.nodes[0] || null;
    if (!current) continue;

    if (!state.selectedNodeIds[provider.id]) {
      state.selectedNodeIds[provider.id] = current.id;
    }
  }

  const selectedProvider = providers[providerIndex];
  const nodes = getNodes(state, selectedProvider);
  if (!nodes.length) return;

  const selectedNodeId = state.selectedNodeIds[selectedProvider.id];
  const nodeIndex = resolveSelectedIndex(nodes, selectedNodeId);
  state.selectedNodeIds[selectedProvider.id] = nodes[nodeIndex].id;
}

export function getSelectedNode(state, provider = getSelectedProvider(state)) {
  const nodes = getNodes(state, provider);
  if (!provider || !nodes.length) return null;
  const nodeIndex = resolveSelectedIndex(nodes, state.selectedNodeIds[provider.id]);
  return nodes[nodeIndex] || null;
}

export function setNotice(state, tone, text) {
  state.notice = { tone, text };
}
