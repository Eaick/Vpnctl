import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { createConfig } from '../lib/config.mjs';
import { loadDashboardSnapshot, refreshDashboardSnapshot, switchProviderNode, measureNode } from '../lib/dashboard.mjs';
import { getTuiHelpSections } from '../lib/help.mjs';
import { getTheme, getThemeNames, getThemeOption, getThemeTone } from '../lib/theme.mjs';
import { getLayoutMode, getViewportHeights, padText, truncateText, getVisibleWindow, moveSelection, filterItems, resolveSelectedIndex } from '../lib/tui-layout.mjs';
import { createInitialTuiState, getProviders, getSelectedProvider, getNodes, ensureSelections, getSelectedNode, setNotice, getAvailableProtocols } from '../lib/tui-state.mjs';
import { initializeRuntimeWithOptions, setConfiguredTheme } from '../lib/install.mjs';
import { migrateOldInstall } from '../lib/migration.mjs';
import { ensureSubscriptionStore, addSubscriptionFromUrl, addSubscriptionFromFile, editSubscription, activateSubscription, removeSubscription, syncSubscriptions, writeManagedConfig, formatProtocolTag } from '../lib/subscriptions.mjs';
import { installShellIntegration, uninstallShellIntegration } from '../lib/shell.mjs';
import { ensureMihomoInstalled } from '../lib/prereq.mjs';
import { startDetached, stopManagedRuntime } from '../lib/process.mjs';
import { getLatencyTargets, getLatencyTarget } from '../lib/latency-targets.mjs';
import { createAddSubscriptionModal, createEditSubscriptionModal, createPortModal, createInitModal, createInitProgressModal, createDeleteSubscriptionModal, createShellInstallModal, rebuildPortModal, cycleModalFieldOption, getPrimaryGuidedAction, buildOverviewGuide, buildShellGuide } from '../lib/ui-guidance.mjs';
import { formatInitProgressLine } from '../lib/init-progress.mjs';
import { applyManagedConfigToRuntime, configureRuntimePorts } from '../lib/runtime-apply.mjs';
import { getManagedRuntimeStatus } from '../lib/managed-runtime.mjs';
import { buildNodeCardLines, buildOverviewCardLines, moveNodeCardSelection } from '../lib/tui-cards.mjs';
import { getNodeNotices, getSelectableNodes } from '../lib/tui-node-view.mjs';
import { VPNCTL_VERSION } from '../lib/version.mjs';
import { formatMemory, loadOverviewMetrics } from '../lib/overview-monitor.mjs';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const COLOR_ENABLED = process.env.NO_COLOR !== '1';
const LATENCY_CONCURRENCY = 4;
const SECTIONS = [{
  id: 'overview',
  label: '总览'
}, {
  id: 'runtime',
  label: '运行状态'
}, {
  id: 'subscriptions',
  label: '订阅管理'
}, {
  id: 'nodes',
  label: '节点与策略组'
}, {
  id: 'latency',
  label: '测速目标'
}, {
  id: 'ports',
  label: '端口与环境'
}, {
  id: 'appearance',
  label: '主题与外观'
}, {
  id: 'install',
  label: '安装与升级'
}, {
  id: 'shell',
  label: 'Shell 集成'
}, {
  id: 'logs',
  label: '日志与诊断'
}];
const THEMES = getThemeNames().map(name => getThemeOption(name));
const LATENCY_TARGETS = getLatencyTargets();
const cloneState = state => structuredClone(state);
const toneProps = (themeName, tone) => getThemeTone(themeName, tone, {
  colorEnabled: COLOR_ENABLED
});
const formatDelay = (delayMs, status = 'idle') => {
  if (typeof delayMs === 'number') return `${delayMs}ms`;
  if (status === 'pending') return '...';
  if (status === 'error') return 'ERR';
  return '--';
};
const formatPort = port => port ? `${port.port}:${port.available ? '可用' : '占用'}` : '--';
const formatSessionReuseState = state => {
  if (state === 'ready') return '已就绪';
  if (state === 'waiting') return '等待中';
  if (state === 'unavailable') return '未启用';
  return '未知';
};
const formatSubscriptionState = enabled => enabled ? '激活' : '休息';
const formatSyncState = status => {
  if (status === 'synced') return '已同步';
  if (status === 'error') return '失败';
  if (status === 'syncing') return '同步中';
  return '待同步';
};
function sectionsOf(state) {
  return filterItems(SECTIONS, state.filters.nav);
}
function selectedSection(state) {
  const items = sectionsOf(state);
  return items[resolveSelectedIndex(items, state.sectionId)] || SECTIONS[0];
}
function subscriptionsOf(state) {
  return filterItems(state.snapshot.subscriptions || [], state.filters.subscriptions, item => item.displayName || '');
}
function ensureAppSelections(state) {
  ensureSelections(state);
  state.sectionId = sectionsOf(state)[resolveSelectedIndex(sectionsOf(state), state.sectionId)]?.id || 'overview';
  state.selectedSubscriptionId = subscriptionsOf(state)[resolveSelectedIndex(subscriptionsOf(state), state.selectedSubscriptionId)]?.id || null;
  state.selectedThemeId = THEMES[resolveSelectedIndex(THEMES, state.selectedThemeId)]?.id || 'gemini';
  state.selectedLatencyTargetId = LATENCY_TARGETS[resolveSelectedIndex(LATENCY_TARGETS, state.selectedLatencyTargetId)]?.id || 'gstatic';
}
function listLines({
  title,
  items,
  selectedId,
  width,
  height,
  renderRow,
  emptyText
}) {
  const lines = [{
    text: padText(title, width),
    tone: 'accent'
  }];
  const viewHeight = Math.max(0, height - 1);
  if (!items.length) {
    lines.push({
      text: padText(emptyText, width),
      tone: 'dim'
    });
    while (lines.length < height) lines.push({
      text: ' '.repeat(width),
      tone: 'normal'
    });
    return lines.slice(0, height);
  }
  const selectedIndex = Math.max(0, items.findIndex(item => item.id === selectedId));
  const windowed = getVisibleWindow(items, selectedIndex, viewHeight);
  for (const item of windowed.items) {
    lines.push(renderRow(item, item.id === items[selectedIndex]?.id));
  }
  while (lines.length < height) lines.push({
    text: ' '.repeat(width),
    tone: 'normal'
  });
  return lines.slice(0, height);
}
function Panel({
  themeName,
  width,
  height,
  lines,
  active
}) {
  const theme = getTheme(themeName);
  return /*#__PURE__*/_jsx(Box, {
    width: width,
    height: height,
    flexDirection: "column",
    borderStyle: "round",
    borderColor: COLOR_ENABLED ? active ? theme.borderActive : theme.borderInactive : undefined,
    paddingX: 1,
    children: lines.map((line, index) => /*#__PURE__*/_jsx(Text, {
      ...toneProps(themeName, line.tone),
      children: line.segments
        ? line.segments.map((segment, segmentIndex) => /*#__PURE__*/_jsx(Text, {
          ...toneProps(themeName, segment.tone),
          children: segment.text
        }, segmentIndex))
        : line.text
    }, `${index}-${line.text}`))
  });
}
function HelpOverlay({
  themeName,
  width,
  height
}) {
  const theme = getTheme(themeName);
  const lines = getTuiHelpSections().flatMap(section => [{
    text: section.title,
    tone: 'accent'
  }, ...section.lines.map(text => ({
    text,
    tone: 'normal'
  })), {
    text: '',
    tone: 'normal'
  }]);
  return /*#__PURE__*/_jsx(Box, {
    width: width,
    height: height,
    flexDirection: "column",
    borderStyle: "round",
    borderColor: COLOR_ENABLED ? theme.borderActive : undefined,
    paddingX: 1,
    children: lines.slice(0, Math.max(1, height - 2)).map((line, index) => /*#__PURE__*/_jsx(Text, {
      ...toneProps(themeName, line.tone),
      children: padText(line.text, Math.max(4, width - 4))
    }, `${index}-${line.text}`))
  });
}
function readModalValue(modal, key) {
  return modal.fields.find(field => field.key === key)?.value || '';
}
function ModalOverlay({
  themeName,
  modal,
  width = 82
}) {
  const theme = getTheme(themeName);
  const innerWidth = Math.max(10, width - 4);
  const lines = [{
    text: modal.title,
    tone: 'accent'
  }, {
    text: '',
    tone: 'normal'
  }, {
    text: modal.prompt,
    tone: 'dim'
  }, {
    text: '',
    tone: 'normal'
  }, ...modal.fields.flatMap((field, index) => {
    const selected = index === modal.activeField;
    const prefix = selected ? '>' : ' ';
    const displayValue = field.options?.length ? `< ${field.value || field.options[0]} >` : field.value || field.placeholder || '';
    return [{
      text: `${prefix} ${field.label}`,
      tone: selected ? 'selected' : 'normal'
    }, {
      text: `  ${displayValue}`,
      tone: field.value ? 'normal' : 'dim'
    }];
  }), ...(modal.notes || []).flatMap(note => [{
    text: '',
    tone: 'normal'
  }, {
    text: `- ${note}`,
    tone: 'dim'
  }]), {
    text: '',
    tone: 'normal'
  }, {
    text: modal.submitText,
    tone: 'dim'
  }];
  return /*#__PURE__*/_jsx(Box, {
    width: width,
    height: Math.min(lines.length + 2, 22),
    flexDirection: "column",
    borderStyle: "round",
    borderColor: COLOR_ENABLED ? theme.borderActive : undefined,
    paddingX: 1,
    children: lines.slice(0, 20).map((line, index) => /*#__PURE__*/_jsx(Text, {
      ...toneProps(themeName, line.tone),
      children: padText(line.text, innerWidth)
    }, `${index}-${line.text}`))
  });
}
function InitProgressOverlay({
  themeName,
  modal,
  width = 82
}) {
  const theme = getTheme(themeName);
  const innerWidth = Math.max(10, width - 4);
  const lines = [{
    text: modal.title,
    tone: 'accent'
  }, {
    text: '',
    tone: 'normal'
  }, {
    text: modal.prompt,
    tone: 'dim'
  }, {
    text: '',
    tone: 'normal'
  }, ...(modal.steps?.length ? modal.steps.map(step => ({
    text: formatInitProgressLine(step),
    tone: step.status === 'failed' ? 'error' : step.status === 'running' ? 'selected' : step.status === 'done' ? 'active' : 'normal'
  })) : [{
    text: '正在准备初始化步骤...',
    tone: 'dim'
  }]), ...(modal.error ? [{
    text: '',
    tone: 'normal'
  }, {
    text: modal.error,
    tone: 'error'
  }] : []), ...(modal.done ? [{
    text: '',
    tone: 'normal'
  }, {
    text: '初始化已完成，按 Esc 关闭',
    tone: 'dim'
  }] : [])];
  return /*#__PURE__*/_jsx(Box, {
    width: width,
    height: Math.min(lines.length + 2, 22),
    flexDirection: "column",
    borderStyle: "round",
    borderColor: COLOR_ENABLED ? theme.borderActive : undefined,
    paddingX: 1,
    children: lines.slice(0, 20).map((line, index) => /*#__PURE__*/_jsx(Text, {
      ...toneProps(themeName, line.tone),
      children: padText(line.text, innerWidth)
    }, `${index}-${line.text}`))
  });
}
function bootState(snapshot) {
  const state = createInitialTuiState(snapshot);
  return {
    ...state,
    activePane: 'nav',
    sectionId: 'overview',
    sectionPane: 'providers',
    selectedSubscriptionId: snapshot.subscriptions[0]?.id || null,
    selectedThemeId: snapshot.status.theme || 'gemini',
    selectedLatencyTargetId: 'gstatic',
    overviewScroll: 0,
    filters: {
      nav: '',
      providers: '',
      nodes: '',
      subscriptions: ''
    },
    modal: null
  };
}
function parseInteger(value, fieldName) {
  const parsed = Number(String(value || '').trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} 端口必须是正整数`);
  }
  return parsed;
}
function parsePortModal(modal) {
  const proxyMode = readModalValue(modal, 'proxyMode') === 'separate' ? 'separate' : 'mix';
  const ports = {
    api: parseInteger(readModalValue(modal, 'api'), 'API')
  };
  if (proxyMode === 'mix') {
    ports.mixed = parseInteger(readModalValue(modal, 'mixed'), 'MIXED');
  } else {
    ports.http = parseInteger(readModalValue(modal, 'http'), 'HTTP');
    ports.socks = parseInteger(readModalValue(modal, 'socks'), 'SOCKS');
  }
  return {
    proxyMode,
    ports
  };
}
function getPortSummary(status) {
  if (status.proxyMode === 'separate') {
    return `separate | http:${formatPort(status.ports.http)} | socks:${formatPort(status.ports.socks)} | api:${formatPort(status.ports.api)}`;
  }
  return `mix | mixed:${formatPort(status.ports.mixed)} | api:${formatPort(status.ports.api)}`;
}
function getProxyEndpointSummary(status) {
  if (status.proxyMode === 'separate') {
    return [`HTTP 代理：${status.httpProxy}`, `SOCKS 代理：${status.socksProxy}`, `API 地址：${status.mihomoApi}`];
  }
  return [`混合代理(HTTP)：${status.httpProxy}`, `混合代理(SOCKS5)：${status.socksProxy}`, `API 地址：${status.mihomoApi}`];
}
function cycleProtocolFilter(current, provider) {
  const protocols = getAvailableProtocols(provider);
  const index = Math.max(0, protocols.findIndex(item => item === current));
  return protocols[(index + 1) % protocols.length] || 'all';
}
async function writeAndApplyRuntime(currentConfig) {
  await writeManagedConfig(currentConfig);
  return applyManagedConfigToRuntime(currentConfig);
}
async function syncAndApplyRuntime() {
  const currentConfig = createConfig();
  const results = await syncSubscriptions({}, currentConfig);
  const applied = await applyManagedConfigToRuntime(currentConfig);
  const failures = results.filter(item => !item.ok);
  return { applied, failures };
}
function openGuidedModal(action, snapshot) {
  if (action === 'init-runtime') return createInitModal(snapshot);
  if (action === 'add-sub') return createAddSubscriptionModal();
  if (action === 'set-ports') return createPortModal(snapshot);
  if (action === 'shell-install') return createShellInstallModal(snapshot);
  return null;
}
export default function App() {
  const {
    exit
  } = useApp();
  const {
    stdout
  } = useStdout();
  const initialConfig = useMemo(() => createConfig(), []);
  const [state, setState] = useState(null);
  const [bootError, setBootError] = useState('');
  const [overviewMetrics, setOverviewMetrics] = useState(null);
  const dimensions = useMemo(() => ({
    width: stdout.columns || 120,
    height: stdout.rows || 30
  }), [stdout.columns, stdout.rows]);
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const snapshot = await loadDashboardSnapshot();
        if (!mounted) return;
        const next = bootState(snapshot);
        ensureAppSelections(next);
        setState(next);
      } catch (error) {
        if (!mounted) return;
        setBootError(error.message || String(error));
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (!state || state.sectionId !== 'overview') return undefined;
    let mounted = true;
    setOverviewMetrics(null);
    void loadOverviewMetrics(createConfig(), state.snapshot.status).then(metrics => {
      if (mounted) setOverviewMetrics(metrics);
    }).catch(() => {
      if (mounted) setOverviewMetrics({ network: '不可达' });
    });
    return () => {
      mounted = false;
    };
  }, [state?.sectionId, state?.snapshot?.generatedAt]);
  const updateState = mutator => {
    setState(previous => {
      const next = cloneState(previous);
      mutator(next);
      ensureAppSelections(next);
      return next;
    });
  };
  const previewThemeName = state?.sectionId === 'appearance' && state?.activePane === 'content' ? state.selectedThemeId : state?.snapshot.status.theme || initialConfig.theme;
  const layoutMode = getLayoutMode(dimensions.width);
  const {
    middle
  } = getViewportHeights(dimensions.height);
  const navWidth = layoutMode === 'split' ? 24 : 22;
  const contentWidth = layoutMode === 'single' ? dimensions.width : Math.max(24, dimensions.width - navWidth - 1);
  const navPanelWidth = layoutMode === 'single' ? dimensions.width : navWidth;
  const providerWidth = Math.max(20, Math.min(28, Math.floor(contentWidth * 0.32)));
  const nodeWidth = layoutMode === 'single' ? dimensions.width : Math.max(20, contentWidth - providerWidth - 1);
  const selectedProvider = state ? getSelectedProvider(state) : null;
  const nodes = state ? getNodes(state, selectedProvider) : [];
  const nodeNotices = state ? getNodeNotices(selectedProvider, state.snapshot.subscriptions) : [];
  const nodeCardWidth = Math.max(1, nodeWidth - 4);
  const nodeCardHeight = Math.max(1, middle - 2);
  const compactNodeCards = nodeCardHeight < 6 || nodeCardWidth < 12;
  const selectedNodeId = selectedProvider ? state.selectedNodeIds[selectedProvider.id] : null;
  const subscriptions = state ? subscriptionsOf(state) : [];
  const selectedLatencyTarget = state ? getLatencyTarget(state.selectedLatencyTargetId) : getLatencyTarget('gstatic');
  const protocolFilterLabel = state?.protocolFilter === 'all' ? 'ALL' : formatProtocolTag(state?.protocolFilter);
  const refreshState = async () => {
    const snapshot = await refreshDashboardSnapshot();
    updateState(next => {
      next.snapshot = snapshot;
    });
  };
  const withBusy = async (action, successNotice) => {
    if (!state || state.busy) return;
    updateState(next => {
      next.busy = true;
    });
    try {
      await action();
      updateState(next => {
        next.busy = false;
        if (successNotice) setNotice(next, 'success', successNotice);
      });
    } catch (error) {
      updateState(next => {
        next.busy = false;
        setNotice(next, 'error', error.message || String(error));
      });
    }
  };
  const startRuntime = async () => {
    const currentConfig = createConfig();
    await ensureMihomoInstalled();
    await ensureSubscriptionStore(currentConfig);
    await writeManagedConfig(currentConfig);
    const runtimeStatus = await getManagedRuntimeStatus(currentConfig);
    if (runtimeStatus.managedApiAlive && runtimeStatus.pidAlive) return;
    if (runtimeStatus.foreignApiAlive) {
      throw new Error(`检测到其他账户占用了当前 API 端口：${currentConfig.mihomoApi}`);
    }
    await startDetached(currentConfig);
    await new Promise(resolve => setTimeout(resolve, 1200));
  };
  const stopRuntime = async () => {
    await stopManagedRuntime(createConfig());
  };
  const measureProviderNodes = async (provider, target, nodeItems) => {
    if (!provider || !target || !Array.isArray(nodeItems) || nodeItems.length === 0) return { okCount: 0, firstFailure: '' };
    updateState(next => {
      const liveProvider = next.snapshot.providers.find(item => item.id === provider.id);
      for (const liveNode of liveProvider?.nodes || []) {
        if (nodeItems.some(item => item.id === liveNode.id)) {
          liveNode.delayMs = null;
          liveNode.delayStatus = 'pending';
        }
      }
    });
    let okCount = 0;
    let firstFailure = '';
    for (let index = 0; index < nodeItems.length; index += LATENCY_CONCURRENCY) {
      const batch = nodeItems.slice(index, index + LATENCY_CONCURRENCY);
      const batchResults = await Promise.all(batch.map(async node => {
        try {
          const result = await measureNode(provider.id, node.id, {
            url: target.url
          });
          return {
            nodeId: node.id,
            delayMs: result.delayMs,
            ok: typeof result.delayMs === 'number',
            error: typeof result.delayMs === 'number' ? '' : '内核未返回延迟'
          };
        } catch (error) {
          return {
            nodeId: node.id,
            delayMs: null,
            ok: false,
            error: error.message || String(error)
          };
        }
      }));
      updateState(next => {
        const liveProvider = next.snapshot.providers.find(item => item.id === provider.id);
        for (const result of batchResults) {
          const liveNode = liveProvider?.nodes.find(item => item.id === result.nodeId);
          if (!liveNode) continue;
          liveNode.delayMs = result.delayMs;
          liveNode.delayStatus = result.ok ? 'ok' : 'error';
        }
      });
      okCount += batchResults.filter(item => item.ok).length;
      const failure = batchResults.find(item => !item.ok);
      if (!firstFailure && failure) firstFailure = `${failure.nodeId}：${failure.error}`;
    }
    return { okCount, firstFailure };
  };
  const runModal = async modal => {
    const currentConfig = createConfig();
    if (modal.type === 'add-sub') {
      const sourceType = readModalValue(modal, 'sourceType').trim() || 'url';
      const source = readModalValue(modal, 'source').trim();
      const alias = readModalValue(modal, 'alias').trim();
      if (!source) throw new Error('订阅来源不能为空');
      await ensureSubscriptionStore(currentConfig);
      if (sourceType === 'url') {
        await addSubscriptionFromUrl(source, alias || undefined, currentConfig);
      } else {
        await addSubscriptionFromFile(source, alias || undefined, currentConfig);
      }
      return writeAndApplyRuntime(currentConfig);
    } else if (modal.type === 'edit-sub') {
      const sourceType = readModalValue(modal, 'sourceType').trim();
      const source = readModalValue(modal, 'source').trim();
      const name = readModalValue(modal, 'alias').trim();
      if (!source) throw new Error('订阅来源不能为空');
      await editSubscription(modal.subscriptionId, {
        ...(sourceType === 'file' ? { file: source } : { url: source }),
        name
      }, currentConfig);
      const applied = await applyManagedConfigToRuntime(currentConfig);
      await refreshState();
      return { ...applied, message: `订阅已修改。${applied.message}` };
    } else if (modal.type === 'set-ports' || modal.type === 'init-runtime') {
      const {
        proxyMode,
        ports
      } = parsePortModal(modal);
      if (modal.type === 'set-ports') {
        const result = await configureRuntimePorts({
          proxyMode,
          ports,
          reason: 'custom'
        });
        return {
          applied: result.applied,
          fallbackUsed: false,
          message: result.applied ? 'mihomo 已在新端口重启' : '端口已保存，将在下次启动时生效'
        };
      } else {
        updateState(next => {
          next.modal = createInitProgressModal(next.snapshot);
        });
        await initializeRuntimeWithOptions({
          mode: currentConfig.mode,
          proxyMode,
          ports,
          skipDownload: process.env.VPNCTL_SKIP_DOWNLOAD === '1',
          onProgress(step) {
            updateState(next => {
              if (next.modal?.type !== 'init-progress') {
                next.modal = createInitProgressModal(next.snapshot);
              }
              const existingIndex = next.modal.steps.findIndex(item => item.id === step.id);
              if (existingIndex >= 0) {
                next.modal.steps[existingIndex] = step;
              } else {
                next.modal.steps.push(step);
              }
              if (step.status === 'failed') next.modal.error = step.error || '初始化失败';
              if (step.id === 'complete' && step.status === 'done') next.modal.done = true;
            });
          }
        });
      }
    } else if (modal.type === 'shell-install') {
      const bashrcPath = readModalValue(modal, 'bashrcPath').trim();
      await installShellIntegration({
        ...(bashrcPath ? {
          bashrcPath
        } : {})
      });
    } else if (modal.type === 'confirm-remove-sub') {
      await removeSubscription(modal.subscriptionId, currentConfig);
      return writeAndApplyRuntime(currentConfig);
    }
    await refreshState();
    return null;
  };
  useInput(async (input, key) => {
    if (!state) {
      if (input === 'q' || key.ctrl && input === 'c') exit();
      return;
    }
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }
    if (state.modal) {
      if (state.modal.type === 'init-progress') {
        if (key.escape && (state.modal.done || state.modal.error)) {
          updateState(next => {
            next.modal = null;
          });
        }
        return;
      }
      if (key.escape) {
        updateState(next => {
          next.modal = null;
        });
        return;
      }
      if ((key.leftArrow || key.rightArrow) && state.modal.fields[state.modal.activeField]?.options?.length) {
        const direction = key.leftArrow ? -1 : 1;
        updateState(next => {
          const field = next.modal.fields[next.modal.activeField];
          field.value = cycleModalFieldOption(field, direction);
          if (field.key === 'proxyMode' && (next.modal.type === 'set-ports' || next.modal.type === 'init-runtime')) {
            next.modal = rebuildPortModal(next.modal, next.snapshot, field.value);
          }
        });
        return;
      }
      if (key.tab || key.upArrow || key.downArrow) {
        const direction = key.upArrow ? -1 : 1;
        updateState(next => {
          const count = next.modal.fields.length;
          if (!count) return;
          next.modal.activeField = key.tab ? (next.modal.activeField + 1) % count : moveSelection(next.modal.activeField, direction, count);
        });
        return;
      }
      if (key.return) {
        const modal = state.modal;
        await withBusy(async () => {
          const applied = await runModal(modal);
          if (applied?.message) {
            updateState(next => {
              setNotice(next, applied.fallbackUsed ? 'warn' : 'success', applied.message);
            });
          }
          updateState(next => {
            if (next.modal?.type !== 'init-progress') {
              next.modal = null;
            } else {
              next.modal.done = true;
            }
          });
        }, null);
        return;
      }
      if (key.backspace || key.delete) {
        updateState(next => {
          const field = next.modal.fields[next.modal.activeField];
          if (!field) return;
          if (field.options?.length) return;
          field.value = field.value.slice(0, -1);
        });
        return;
      }
      if (key.ctrl && input === 'u') {
        updateState(next => {
          const field = next.modal.fields[next.modal.activeField];
          if (field && !field.options?.length) field.value = '';
        });
        return;
      }
      if (typeof input === 'string' && input >= ' ' && input !== '\x7f') {
        updateState(next => {
          const field = next.modal.fields[next.modal.activeField];
          if (!field) return;
          if (field.options?.length) return;
          field.value += input;
        });
      }
      return;
    }
    if (state.helpOpen) {
      if (input === '?' || key.escape) {
        updateState(next => {
          next.helpOpen = false;
        });
      }
      return;
    }
    if (state.searchMode) {
      if (key.escape || key.return) {
        updateState(next => {
          next.searchMode = false;
        });
        return;
      }
      if (key.backspace || key.delete) {
        updateState(next => {
          if (next.activePane === 'nav') next.filters.nav = next.filters.nav.slice(0, -1);else if (next.sectionId === 'subscriptions') next.filters.subscriptions = next.filters.subscriptions.slice(0, -1);else if (next.sectionId === 'nodes') next.filters[next.sectionPane] = next.filters[next.sectionPane].slice(0, -1);
        });
        return;
      }
      if (typeof input === 'string' && input >= ' ' && input !== '\x7f') {
        updateState(next => {
          if (next.activePane === 'nav') next.filters.nav += input;else if (next.sectionId === 'subscriptions') next.filters.subscriptions += input;else if (next.sectionId === 'nodes') next.filters[next.sectionPane] += input;
        });
      }
      return;
    }
    if (input === 'q') {
      exit();
      return;
    }
    if (input === '?') {
      updateState(next => {
        next.helpOpen = !next.helpOpen;
      });
      return;
    }
    if (key.tab) {
      updateState(next => {
        next.activePane = next.activePane === 'nav' ? 'content' : 'nav';
      });
      return;
    }
    if (key.leftArrow) {
      updateState(next => {
        if (next.activePane === 'content' && next.sectionId === 'nodes' && next.sectionPane === 'nodes') {
          const provider = getSelectedProvider(next);
          const items = getNodes(next, provider);
          if (provider && items.findIndex(item => item.id === next.selectedNodeIds[provider.id]) > 0) {
            next.selectedNodeIds[provider.id] = moveNodeCardSelection(items, next.selectedNodeIds[provider.id], 'left', nodeCardWidth, { compact: compactNodeCards });
          } else {
            next.sectionPane = 'providers';
          }
        } else {
          next.activePane = 'nav';
        }
      });
      return;
    }
    if (key.rightArrow) {
      updateState(next => {
        if (next.activePane === 'content' && next.sectionId === 'nodes' && next.sectionPane === 'nodes') {
          const provider = getSelectedProvider(next);
          if (provider) next.selectedNodeIds[provider.id] = moveNodeCardSelection(getNodes(next, provider), next.selectedNodeIds[provider.id], 'right', nodeCardWidth, { compact: compactNodeCards });
          return;
        }
        next.activePane = 'content';
        if (next.sectionId === 'nodes') next.sectionPane = 'nodes';
      });
      return;
    }
    if (key.escape) {
      updateState(next => {
        next.activePane = 'nav';
      });
      return;
    }
    if (input === '/') {
      updateState(next => {
        next.searchMode = true;
      });
      return;
    }
    if (key.upArrow || key.downArrow) {
      const direction = key.upArrow ? -1 : 1;
      updateState(next => {
        if (next.activePane === 'nav') {
          const items = sectionsOf(next);
          const index = items.findIndex(item => item.id === next.sectionId);
          next.sectionId = items[moveSelection(index >= 0 ? index : 0, direction, items.length)]?.id || next.sectionId;
        } else if (next.sectionId === 'subscriptions') {
          const items = subscriptionsOf(next);
          const index = items.findIndex(item => item.id === next.selectedSubscriptionId);
          next.selectedSubscriptionId = items[moveSelection(index >= 0 ? index : 0, direction, items.length)]?.id || next.selectedSubscriptionId;
        } else if (next.sectionId === 'appearance') {
          const index = THEMES.findIndex(item => item.id === next.selectedThemeId);
          next.selectedThemeId = THEMES[moveSelection(index >= 0 ? index : 0, direction, THEMES.length)]?.id || next.selectedThemeId;
        } else if (next.sectionId === 'latency') {
          const index = LATENCY_TARGETS.findIndex(item => item.id === next.selectedLatencyTargetId);
          next.selectedLatencyTargetId = LATENCY_TARGETS[moveSelection(index >= 0 ? index : 0, direction, LATENCY_TARGETS.length)]?.id || next.selectedLatencyTargetId;
        } else if (next.sectionId === 'overview') {
          next.overviewScroll = Math.max(0, Math.min(next.overviewScroll + direction, overviewMaxScroll));
        } else if (next.sectionId === 'nodes') {
          if (next.sectionPane === 'providers') {
            const items = getProviders(next);
            const index = items.findIndex(item => item.id === next.selectedProviderId);
            next.selectedProviderId = items[moveSelection(index >= 0 ? index : 0, direction, items.length)]?.id || next.selectedProviderId;
          } else {
            const provider = getSelectedProvider(next);
            if (!provider) return;
            const items = getNodes(next, provider);
            next.selectedNodeIds[provider.id] = moveNodeCardSelection(items, next.selectedNodeIds[provider.id], direction < 0 ? 'up' : 'down', nodeCardWidth, { compact: compactNodeCards });
          }
        }
      });
      return;
    }
    if (key.return) {
      if (state.activePane === 'nav') {
        updateState(next => {
          next.activePane = 'content';
        });
        return;
      }
      if (state.sectionId === 'appearance') {
        await withBusy(async () => {
          await setConfiguredTheme({
            theme: state.selectedThemeId
          });
          await refreshState();
        }, `主题已切换为 ${state.selectedThemeId}`);
        return;
      }
      if (state.sectionId === 'latency') {
        updateState(next => {
          setNotice(next, 'accent', `当前测速目标: ${getLatencyTarget(next.selectedLatencyTargetId).label}；去节点页按 d 执行整组测速`);
        });
        return;
      }
      if (state.sectionId === 'nodes') {
        const provider = getSelectedProvider(state);
        const node = getSelectedNode(state, provider);
        if (!provider) return;
        if (state.sectionPane === 'providers') {
          updateState(next => {
            next.sectionPane = 'nodes';
          });
          return;
        }
        if (!node) return;
        await withBusy(async () => {
          const snapshot = await switchProviderNode(provider.id, node.id);
          updateState(next => {
            next.snapshot = snapshot;
            next.selectedProviderId = provider.id;
            next.selectedNodeIds[provider.id] = node.id;
          });
        }, `已切换到 ${node.label}`);
        return;
      }
      if (state.sectionId === 'overview') {
        const action = getPrimaryGuidedAction(state.snapshot);
        if (action === 'sync') {
          await withBusy(async () => {
            const { applied, failures } = await syncAndApplyRuntime();
            await refreshState();
            updateState(next => {
              setNotice(next, failures.length || applied.fallbackUsed ? 'warn' : 'success', failures.length
                ? `${failures.length} 个订阅同步失败：${failures[0].displayName}，已保留旧缓存`
                : applied.message);
            });
          }, '订阅已同步');
          return;
        }
        if (action === 'start') {
          await withBusy(async () => {
            await startRuntime();
            await refreshState();
          }, 'mihomo 已启动');
          return;
        }
        if (action === 'ready') {
          updateState(next => {
            setNotice(next, 'success', '服务器已就绪：新会话可直接运行 codex');
          });
          return;
        }
        updateState(next => {
          next.modal = openGuidedModal(action, next.snapshot);
        });
        return;
      }
      if (state.sectionId === 'shell') {
        if (!state.snapshot.status.shellIntegration?.installed || !state.snapshot.status.shellIntegration?.codexWrapper) {
          updateState(next => {
            next.modal = createShellInstallModal(next.snapshot);
          });
        } else {
          updateState(next => {
            setNotice(next, 'success', 'bashrc 集成已就绪：新会话可直接运行 codex');
          });
        }
        return;
      }
      if (state.sectionId === 'ports') {
        updateState(next => {
          next.modal = createPortModal(next.snapshot);
        });
        return;
      }
      if (state.sectionId === 'install') {
        if (!state.snapshot.status.initialized) {
          updateState(next => {
            next.modal = createInitModal(next.snapshot);
          });
        } else if (state.snapshot.status.oldInstallDetected) {
          await withBusy(async () => {
            await migrateOldInstall({
              mode: createConfig().mode,
              skipDownload: process.env.VPNCTL_SKIP_DOWNLOAD === '1'
            });
            await refreshState();
          }, '旧版迁移已完成');
        }
        return;
      }
      if (state.sectionId === 'subscriptions') {
        const subscription = subscriptions.find(item => item.id === state.selectedSubscriptionId);
        if (!subscription) return;
        await withBusy(async () => {
          const currentConfig = createConfig();
          const previous = subscriptions.find(item => item.enabled);
          const [synced] = await syncSubscriptions({
            id: subscription.id
          }, currentConfig);
          if (!synced?.ok) {
            throw new Error(`${subscription.displayName} 同步失败：${synced?.error || '未知错误'}；当前订阅未切换`);
          }
          try {
            await activateSubscription(subscription.id, currentConfig);
            await writeManagedConfig(currentConfig);
            const applied = await applyManagedConfigToRuntime(currentConfig);
            await refreshState();
            updateState(next => {
              setNotice(next, applied.fallbackUsed ? 'warn' : 'success', `${subscription.displayName} 已激活。${applied.message}`);
            });
          } catch (error) {
            if (previous && previous.id !== subscription.id) {
              await activateSubscription(previous.id, currentConfig);
              await writeManagedConfig(currentConfig);
              await applyManagedConfigToRuntime(currentConfig);
            }
            throw error;
          }
        });
        return;
      }
      return;
    }
    if (input === 'r') {
      await withBusy(refreshState, '面板已刷新');
      return;
    }
    if (input === 's') {
      await withBusy(async () => {
        await startRuntime();
        await refreshState();
      }, 'mihomo 已启动');
      return;
    }
    if (input === 'k') {
      await withBusy(async () => {
        await stopRuntime();
        await refreshState();
      }, 'mihomo 已停止');
      return;
    }
    if (input === 'y') {
      await withBusy(async () => {
        const { applied, failures } = await syncAndApplyRuntime();
        await refreshState();
        updateState(next => {
          setNotice(next, failures.length || applied.fallbackUsed ? 'warn' : 'success', failures.length
            ? `${failures.length} 个订阅同步失败：${failures[0].displayName}，已保留旧缓存`
            : applied.message);
        });
      }, '订阅已同步');
      return;
    }
    if (input === 'i') {
      updateState(next => {
        next.modal = createInitModal(next.snapshot);
      });
      return;
    }
    if (input === 'u') {
      await withBusy(async () => {
        await migrateOldInstall({
          mode: createConfig().mode,
          skipDownload: process.env.VPNCTL_SKIP_DOWNLOAD === '1'
        });
        await refreshState();
      }, '旧版迁移已完成');
      return;
    }
    if (input === 'a') {
      updateState(next => {
        next.modal = createAddSubscriptionModal();
      });
      return;
    }
    if (input === 'e' && state.sectionId === 'subscriptions' && state.selectedSubscriptionId) {
      const subscription = subscriptions.find(item => item.id === state.selectedSubscriptionId);
      if (!subscription) return;
      updateState(next => {
        next.modal = createEditSubscriptionModal(subscription);
      });
      return;
    }
    if (input === 'x' && state.sectionId === 'subscriptions' && state.selectedSubscriptionId) {
      const subscription = subscriptions.find(item => item.id === state.selectedSubscriptionId);
      if (!subscription) return;
      updateState(next => {
        next.modal = createDeleteSubscriptionModal(subscription);
      });
      return;
    }
    if (input === 'v' && state.sectionId === 'nodes') {
      updateState(next => {
        next.nodeNoticesExpanded = !next.nodeNoticesExpanded;
      });
      return;
    }
    if (input === 'f' && state.sectionId === 'nodes') {
      const provider = getSelectedProvider(state);
      updateState(next => {
        next.protocolFilter = cycleProtocolFilter(next.protocolFilter, provider);
        setNotice(next, 'accent', `协议筛选: ${next.protocolFilter === 'all' ? 'ALL' : formatProtocolTag(next.protocolFilter)}`);
      });
      return;
    }
    if (input === 'p') {
      updateState(next => {
        next.modal = createPortModal(next.snapshot);
      });
      return;
    }
    if (input === 'b') {
      updateState(next => {
        next.modal = createShellInstallModal(next.snapshot);
      });
      return;
    }
    if (input === 'n') {
      await withBusy(async () => {
        await uninstallShellIntegration({});
        await refreshState();
      }, 'bashrc 集成已卸载');
      return;
    }
    if (input === 'd' && state.sectionId === 'nodes') {
      const provider = getSelectedProvider(state);
      const providerNodes = getNodes(state, provider);
      if (!provider || !providerNodes.length) return;
      await withBusy(async () => {
        const { okCount, firstFailure } = await measureProviderNodes(provider, selectedLatencyTarget, providerNodes);
        updateState(next => {
          setNotice(next, firstFailure ? 'warn' : 'success', `${selectedLatencyTarget.label} 测速完成：${okCount}/${providerNodes.length}${firstFailure ? `；失败原因 ${firstFailure}` : ''}`);
        });
      });
      return;
    }
    if (input === 'l') {
      updateState(next => {
        setNotice(next, 'accent', next.snapshot.status.logFile);
      });
    }
  }, {
    isActive: true
  });
  if (bootError) {
    return /*#__PURE__*/_jsxs(Box, {
      flexDirection: "column",
      children: [/*#__PURE__*/_jsx(Text, {
        ...toneProps(previewThemeName, 'error'),
        children: "VPNCTL UI \u542F\u52A8\u5931\u8D25"
      }), /*#__PURE__*/_jsx(Text, {
        children: bootError
      })]
    });
  }
  if (!state) {
    return /*#__PURE__*/_jsxs(Box, {
      flexDirection: "column",
      children: [/*#__PURE__*/_jsx(Text, {
        ...toneProps(initialConfig.theme, 'accent'),
        children: "VPNCTL"
      }), /*#__PURE__*/_jsx(Text, {
        children: "\u6B63\u5728\u52A0\u8F7D\u603B\u89C8..."
      })]
    });
  }
  const section = selectedSection(state);
  const infoWidth = Math.max(4, contentWidth - 4);
  const navLines = listLines({
    title: `页面 (${SECTIONS.length})`,
    items: sectionsOf(state),
    selectedId: state.sectionId,
    width: Math.max(4, navPanelWidth - 4),
    height: Math.max(1, middle - 2),
    renderRow: (item, isSelected) => ({
      text: padText(`${isSelected ? '>' : ' '} ${item.label}`, Math.max(4, navPanelWidth - 4)),
      tone: isSelected ? 'selected' : 'normal'
    }),
    emptyText: '没有页面'
  });
  const appearanceLines = listLines({
    title: '主题列表',
    items: THEMES,
    selectedId: state.selectedThemeId,
    width: infoWidth,
    height: Math.max(1, middle - 2),
    renderRow: (item, isSelected) => ({
      text: padText(`${isSelected ? '>' : ' '} ${truncateText(`${item.label} ${item.tagline ? `· ${item.tagline}` : ''}`, Math.max(12, infoWidth - 6))}${item.id === state.snapshot.status.theme ? ' *' : ''}`, infoWidth),
      tone: isSelected ? 'selected' : item.id === state.snapshot.status.theme ? 'active' : 'normal'
    }),
    emptyText: '没有主题'
  });
  const latencyLines = listLines({
    title: `站点测速 (${LATENCY_TARGETS.length})`,
    items: LATENCY_TARGETS,
    selectedId: state.selectedLatencyTargetId,
    width: infoWidth,
    height: Math.max(1, middle - 2),
    renderRow: (item, isSelected) => ({
      text: padText(`${isSelected ? '>' : ' '} ${truncateText(`${item.label} · ${item.description}`, Math.max(16, infoWidth - 4))}`, infoWidth),
      tone: isSelected ? 'selected' : item.id === state.selectedLatencyTargetId ? 'active' : 'normal'
    }),
    emptyText: '没有测速目标'
  });
  const subscriptionLines = listLines({
    title: `订阅 (${subscriptions.length})${state.filters.subscriptions ? ` / ${state.filters.subscriptions}` : ''}`,
    items: subscriptions,
    selectedId: state.selectedSubscriptionId,
    width: infoWidth,
    height: Math.max(1, middle - 2),
    renderRow: (item, isSelected) => ({
      text: padText(`${isSelected ? '>' : ' '} ${truncateText(item.displayName, Math.max(8, infoWidth - 24))} ${formatSubscriptionState(item.enabled)} ${formatSyncState(item.syncStatus)}`, infoWidth),
      tone: isSelected ? 'selected' : item.enabled ? 'active' : 'normal'
    }),
    emptyText: '还没有订阅，按 a 添加'
  });
  const providerLines = listLines({
    title: `提供方 (${getProviders(state).length})${state.filters.providers ? ` / ${state.filters.providers}` : ''}`,
    items: getProviders(state),
    selectedId: state.selectedProviderId,
    width: Math.max(4, providerWidth - 4),
    height: Math.max(1, middle - 2),
    renderRow: (item, isSelected) => ({
      text: `${padText(`${isSelected ? '>' : ' '}${item.status === 'active' ? '*' : ' '} ${truncateText(item.label, Math.max(6, providerWidth - 11))}`, Math.max(4, providerWidth - 7))}${`${getSelectableNodes(item).length}`.padStart(3, ' ')}`,
      tone: isSelected ? 'selected' : item.status === 'active' ? 'active' : 'normal'
    }),
    emptyText: '没有可用提供方'
  });
  const nodeLines = buildNodeCardLines({
    title: `节点 (${nodes.length})${state.filters.nodes ? ` / ${state.filters.nodes}` : ''} | ${selectedLatencyTarget.label} | ${protocolFilterLabel}`,
    items: nodes.map(item => ({
      ...item,
      protocolLabel: formatProtocolTag(item.protocol),
      delayLabel: formatDelay(item.delayMs, item.delayStatus)
    })),
    selectedId: selectedNodeId,
    width: nodeCardWidth,
    height: nodeCardHeight,
    notices: nodeNotices,
    noticesExpanded: state.nodeNoticesExpanded,
    currentNodeLabel: selectedProvider?.currentNodeLabel || '',
    emptyText: state.snapshot.status.apiAlive ? '没有匹配当前筛选的节点' : '请先启动 mihomo，延迟才会显示'
  });
  const overviewGuide = buildOverviewGuide(state.snapshot);
  const shellGuide = buildShellGuide(state.snapshot);
  const activeSubscription = state.snapshot.subscriptions.find(item => item.enabled) || null;
  const activeProvider = state.snapshot.providers.find(item => item.label === activeSubscription?.displayName);
  const currentNodeLabel = activeProvider?.currentNodeLabel || state.snapshot.currentNodeLabel || '未选择';
  const portLabel = key => {
    const port = state.snapshot.status.ports[key];
    if (!port) return '--';
    const stateLabel = port.available ? '空闲' : state.snapshot.status.apiAlive ? '监听' : '冲突';
    return `${port.port} ${stateLabel}`;
  };
  const proxyPorts = state.snapshot.status.proxyMode === 'mix'
    ? `混合 ${portLabel('mixed')}`
    : `HTTP ${portLabel('http')} / SOCKS ${portLabel('socks')}`;
  const overviewCards = [{
    title: `● Mihomo ${state.snapshot.status.apiAlive ? '在线' : '离线'}`,
    lines: [`PID ${state.snapshot.status.pid || '无'}`, `版本 ${state.snapshot.status.version?.version || '未知'}`]
  }, {
    title: '当前连接节点',
    lines: [`订阅 ${activeSubscription?.displayName || '无'}`, `节点 ${currentNodeLabel}`]
  }, {
    title: '端口配置',
    lines: [proxyPorts, `API ${portLabel('api')} · ${state.snapshot.status.proxyMode}`]
  }, {
    title: '网络检测',
    lines: [`内网 ${overviewMetrics?.localIp || '未知'} · 出口 ${overviewMetrics?.proxyIp || '未知'}`, `代理 ${overviewMetrics?.network || '检测中'}${overviewMetrics?.networkDelayMs != null ? ` · ${overviewMetrics.networkDelayMs}ms` : ''}`]
  }, {
    title: '内存与连接',
    lines: [`VPNCTL ${formatMemory(overviewMetrics?.vpnctlMemory)}`, `Mihomo ${formatMemory(overviewMetrics?.mihomoMemory)} · 连接 ${overviewMetrics?.connections ?? '--'}`]
  }, {
    title: '提示与下一步',
    lines: [`策略组 ${state.snapshot.status.defaultGroup}`, (state.snapshot.status.nextSteps || []).join(' · ') || '按 r 刷新检测']
  }];
  const overviewPanel = buildOverviewCardLines({
    cards: overviewCards,
    width: infoWidth,
    height: Math.max(1, middle - 2),
    offset: state.overviewScroll
  });
  const overviewMaxScroll = overviewPanel.maxScroll;
  const pageContent = {
    overview: ['总览', `初始化状态：${state.snapshot.status.initialized ? '已完成' : '未完成'}`, `mihomo：${state.snapshot.status.apiAlive ? '在线' : '离线'}`, `当前激活订阅：${activeSubscription?.displayName || '无'}`, `代理模式：${state.snapshot.status.proxyMode}`, `默认策略组：${state.snapshot.status.defaultGroup}`, `下一步：${(state.snapshot.status.nextSteps || []).join(' | ')}`, '', ...overviewGuide, '', '动作：Enter 执行下一步 | i 初始化 | a 添加订阅 | y 同步 | s 启动'],
    runtime: ['运行状态', `接口：${state.snapshot.status.apiAlive ? '在线' : '离线'}`, `进程 PID：${state.snapshot.status.pid || '无'}`, `当前节点：${state.snapshot.currentNodeLabel || '无'}`, `运行锁数量：${(state.snapshot.status.runtimeLocks || []).length}`, `日志文件：${state.snapshot.status.logFile}`, '', '动作：s 启动 | k 停止 | r 刷新 | l 显示日志路径'],
    ports: ['端口与环境', `代理模式：${state.snapshot.status.proxyMode}`, ...getProxyEndpointSummary(state.snapshot.status), getPortSummary(state.snapshot.status), `端口来源：${state.snapshot.status.portSource}`, '', '动作：p 修改代理模式与端口'],
    latency: ['测速目标', `当前目标：${selectedLatencyTarget.label}`, `测速 URL：${selectedLatencyTarget.url}`, `${selectedLatencyTarget.description}`, '', '说明：节点延迟结果取决于这里选择的测速目标。', '动作：上下选择目标 | Enter 应用 | 前往节点页按 d 测速'],
    install: ['安装与升级', `运行模式：${state.snapshot.status.mode}`, `默认代理模式：${state.snapshot.status.proxyMode}`, `检测到旧版安装：${state.snapshot.status.oldInstallDetected ? '是' : '否'}`, `迁移状态：${state.snapshot.status.migration.migrationStatus}`, `迁移来源：${state.snapshot.status.migration.sourcePath || '无'}`, '', '动作：i 初始化 | u 迁移旧版'],
    shell: ['Shell 集成', `已安装：${state.snapshot.status.shellIntegration?.installed ? '是' : '否'}`, `bashrc 路径：${state.snapshot.status.shellIntegration?.bashrcPath || '无'}`, `Codex 封装：${state.snapshot.status.shellIntegration?.codexWrapper ? '已启用' : '未启用'}`, `同账号复用：${formatSessionReuseState(state.snapshot.status.sessionReuse?.state)}`, `${state.snapshot.status.sessionReuse?.label || '建议在服务器安装 bash Shell 集成，以复用同账号会话的 VPN。'}`, '', ...shellGuide, '', '动作：Enter 或 b 安装 bashrc 配置块 | n 卸载 bashrc 配置块'],
    logs: ['日志与诊断', `日志文件：${state.snapshot.status.logFile}`, `主题：${state.snapshot.status.theme}`, `代理模式：${state.snapshot.status.proxyMode}`, `端口来源：${state.snapshot.status.portSource}`, `迁移状态：${state.snapshot.status.migration.migrationStatus}`, '', '动作：r 刷新 | l 显示日志路径']
  };
  const contentLines = section.id === 'overview' ? overviewPanel.lines : section.id === 'subscriptions' ? subscriptionLines : section.id === 'appearance' ? appearanceLines : section.id === 'latency' ? latencyLines : listLines({
    title: pageContent[section.id]?.[0] || '总览',
    items: (pageContent[section.id] || pageContent.overview).slice(1).map((text, index) => ({
      id: `${section.id}-${index}`,
      label: text
    })),
    selectedId: '',
    width: infoWidth,
    height: Math.max(1, middle - 2),
    renderRow: item => ({
      text: padText(item.label, infoWidth),
      tone: item.label.startsWith('动作：') ? 'dim' : 'normal'
    }),
    emptyText: ''
  });
  const currentNode = getSelectedNode(state, selectedProvider);
  const statusLine1 = padText(`VPNCTL ${VPNCTL_VERSION}  主题:${previewThemeName}  模式:${state.snapshot.status.proxyMode}`, dimensions.width);
  const statusLine2 = padText(`页面:${section.label} | 接口:${state.snapshot.status.apiAlive ? '在线' : '离线'} | 进程:${state.snapshot.status.pid || '无'} | 订阅:${activeSubscription?.displayName || '无'}`, dimensions.width);
  const statusLine3 = padText(`提供方:${selectedProvider?.label || '无'} | 光标:${currentNode?.label || '无'} | 已连接:${state.snapshot.status.apiAlive ? selectedProvider?.currentNodeLabel || state.snapshot.currentNodeLabel || '无' : '离线'}`, dimensions.width);
  const statusLine4 = padText(`测速目标:${selectedLatencyTarget.label} | 协议:${protocolFilterLabel} | ${getPortSummary(state.snapshot.status)} | 来源:${state.snapshot.status.portSource}`, dimensions.width);
  const statusLine5 = padText(state.notice.text || '就绪', dimensions.width);
  return /*#__PURE__*/_jsxs(Box, {
    flexDirection: "column",
    children: [/*#__PURE__*/_jsx(Text, {
      ...toneProps(previewThemeName, 'accent'),
      children: statusLine1
    }), /*#__PURE__*/_jsx(Text, {
      ...toneProps(previewThemeName, 'normal'),
      children: statusLine2
    }), /*#__PURE__*/_jsx(Text, {
      ...toneProps(previewThemeName, 'normal'),
      children: statusLine3
    }), /*#__PURE__*/_jsx(Text, {
      ...toneProps(previewThemeName, 'dim'),
      children: statusLine4
    }), /*#__PURE__*/_jsx(Text, {
      ...toneProps(previewThemeName, state.notice.tone || 'dim'),
      children: statusLine5
    }), state.helpOpen ? /*#__PURE__*/_jsx(HelpOverlay, {
      themeName: previewThemeName,
      width: dimensions.width,
      height: middle
    }) : state.modal ? /*#__PURE__*/_jsx(Box, {
      justifyContent: "center",
      children: state.modal.type === 'init-progress' ? /*#__PURE__*/_jsx(InitProgressOverlay, {
        themeName: previewThemeName,
        modal: state.modal
      }) : /*#__PURE__*/_jsx(ModalOverlay, {
        themeName: previewThemeName,
        modal: state.modal
      })
    }) : layoutMode === 'single' ? state.activePane === 'nav' ? /*#__PURE__*/_jsx(Panel, {
      themeName: previewThemeName,
      width: dimensions.width,
      height: middle,
      lines: navLines,
      active: true
    }) : section.id === 'nodes' ? /*#__PURE__*/_jsx(Panel, {
      themeName: previewThemeName,
      width: dimensions.width,
      height: middle,
      lines: state.sectionPane === 'providers' ? providerLines : nodeLines,
      active: true
    }) : /*#__PURE__*/_jsx(Panel, {
      themeName: previewThemeName,
      width: dimensions.width,
      height: middle,
      lines: contentLines,
      active: true
    }) : /*#__PURE__*/_jsxs(Box, {
      columnGap: 1,
      children: [/*#__PURE__*/_jsx(Panel, {
        themeName: previewThemeName,
        width: navPanelWidth,
        height: middle,
        lines: navLines,
        active: state.activePane === 'nav'
      }), section.id === 'nodes' ? /*#__PURE__*/_jsxs(Box, {
        columnGap: 1,
        children: [/*#__PURE__*/_jsx(Panel, {
          themeName: previewThemeName,
          width: providerWidth,
          height: middle,
          lines: providerLines,
          active: state.activePane === 'content' && state.sectionPane === 'providers'
        }), /*#__PURE__*/_jsx(Panel, {
          themeName: previewThemeName,
          width: nodeWidth,
          height: middle,
          lines: nodeLines,
          active: state.activePane === 'content' && state.sectionPane === 'nodes'
        })]
      }) : /*#__PURE__*/_jsx(Panel, {
        themeName: previewThemeName,
        width: contentWidth,
        height: middle,
        lines: contentLines,
        active: state.activePane === 'content'
      })]
    }), /*#__PURE__*/_jsx(Text, {
      ...toneProps(previewThemeName, 'dim'),
      children: padText('Tab 切换区域  Enter 执行动作或激活订阅  / 搜索  f 协议筛选  ? 帮助  q 退出', dimensions.width)
    }), /*#__PURE__*/_jsx(Text, {
      ...toneProps(previewThemeName, 'normal'),
      children: padText('i 初始化  a 添加订阅  e 修改订阅  y 同步  s 启动  d 测速  p 端口模式  b bashrc  x 删除订阅', dimensions.width)
    }), /*#__PURE__*/_jsx(Text, {
      ...toneProps(previewThemeName, 'normal'),
      children: padText(state.searchMode ? `搜索中 | 当前区域 ${state.activePane === 'nav' ? '导航' : section.label}` : section.id === 'nodes' ? '↑↓ 切换卡片行  ←→ 切换卡片  Enter 使用节点  v 展开提示  Esc 返回导航' : `当前焦点 ${state.activePane === 'nav' ? '导航' : '内容'} | 当前页面 ${section.label}`, dimensions.width)
    })]
  });
}
