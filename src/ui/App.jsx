import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { createConfig } from '../lib/config.mjs';
import { loadDashboardSnapshot, refreshDashboardSnapshot, switchProviderNode, measureNode } from '../lib/dashboard.mjs';
import { getTuiHelpSections } from '../lib/help.mjs';
import { getTheme, getThemeNames, getThemeOption, getThemeTone } from '../lib/theme.mjs';
import { getLayoutMode, getViewportHeights, padText, truncateText, getVisibleWindow, moveSelection, filterItems, resolveSelectedIndex } from '../lib/tui-layout.mjs';
import { createInitialTuiState, getProviders, getSelectedProvider, getNodes, ensureSelections, getSelectedNode, setNotice, getAvailableProtocols } from '../lib/tui-state.mjs';
import { initializeRuntimeWithOptions, setConfiguredPorts, setConfiguredTheme } from '../lib/install.mjs';
import { migrateOldInstall } from '../lib/migration.mjs';
import { ensureSubscriptionStore, addSubscriptionFromUrl, addSubscriptionFromFile, activateSubscription, removeSubscription, syncSubscriptions, writeManagedConfig, formatProtocolTag } from '../lib/subscriptions.mjs';
import { installShellIntegration, uninstallShellIntegration } from '../lib/shell.mjs';
import { ensureMihomoInstalled } from '../lib/prereq.mjs';
import { readPid, isPidAlive, startDetached, stopByPid, removePidFile } from '../lib/process.mjs';
import { isApiAlive } from '../lib/mihomo.mjs';
import { getLatencyTargets, getLatencyTarget } from '../lib/latency-targets.mjs';
import {
  createAddSubscriptionModal,
  createPortModal,
  createInitModal,
  createInitProgressModal,
  createDeleteSubscriptionModal,
  createShellInstallModal,
  cycleModalFieldOption,
  getPrimaryGuidedAction,
  buildOverviewGuide,
  buildShellGuide
} from '../lib/ui-guidance.mjs';
import { formatInitProgressLine } from '../lib/init-progress.mjs';
import { applyManagedConfigToRuntime } from '../lib/runtime-apply.mjs';

const COLOR_ENABLED = process.env.NO_COLOR !== '1';
const LATENCY_CONCURRENCY = 4;

const SECTIONS = [
  { id: 'overview', label: '总览' },
  { id: 'runtime', label: '运行状态' },
  { id: 'subscriptions', label: '订阅管理' },
  { id: 'nodes', label: '节点与策略组' },
  { id: 'latency', label: '站点测速' },
  { id: 'ports', label: '端口与环境' },
  { id: 'appearance', label: '主题与外观' },
  { id: 'install', label: '安装与升级' },
  { id: 'shell', label: 'Shell 集成' },
  { id: 'logs', label: '日志与诊断' }
];

const THEMES = getThemeNames().map((name) => getThemeOption(name));
const LATENCY_TARGETS = getLatencyTargets();

const cloneState = (state) => structuredClone(state);
const toneProps = (themeName, tone) => getThemeTone(themeName, tone, { colorEnabled: COLOR_ENABLED });
const formatDelay = (delayMs, status = 'idle') => {
  if (typeof delayMs === 'number') return `${delayMs}ms`;
  if (status === 'pending') return '...';
  if (status === 'error') return 'ERR';
  return '--';
};
const formatPort = (port) => `${port.port}:${port.available ? 'free' : 'busy'}`;

function sectionsOf(state) {
  return filterItems(SECTIONS, state.filters.nav);
}

function selectedSection(state) {
  const items = sectionsOf(state);
  return items[resolveSelectedIndex(items, state.sectionId)] || SECTIONS[0];
}

function subscriptionsOf(state) {
  return filterItems(state.snapshot.subscriptions || [], state.filters.subscriptions, (item) => item.displayName || '');
}

function ensureAppSelections(state) {
  ensureSelections(state);
  state.sectionId = sectionsOf(state)[resolveSelectedIndex(sectionsOf(state), state.sectionId)]?.id || 'overview';
  state.selectedSubscriptionId = subscriptionsOf(state)[resolveSelectedIndex(subscriptionsOf(state), state.selectedSubscriptionId)]?.id || null;
  state.selectedThemeId = THEMES[resolveSelectedIndex(THEMES, state.selectedThemeId)]?.id || 'gemini';
  state.selectedLatencyTargetId = LATENCY_TARGETS[resolveSelectedIndex(LATENCY_TARGETS, state.selectedLatencyTargetId)]?.id || 'gstatic';
}

function listLines({ title, items, selectedId, width, height, renderRow, emptyText }) {
  const lines = [{ text: padText(title, width), tone: 'accent' }];
  const viewHeight = Math.max(0, height - 1);

  if (!items.length) {
    lines.push({ text: padText(emptyText, width), tone: 'dim' });
    while (lines.length < height) lines.push({ text: ' '.repeat(width), tone: 'normal' });
    return lines.slice(0, height);
  }

  const selectedIndex = Math.max(0, items.findIndex((item) => item.id === selectedId));
  const windowed = getVisibleWindow(items, selectedIndex, viewHeight);
  for (const item of windowed.items) {
    lines.push(renderRow(item, item.id === items[selectedIndex]?.id));
  }

  while (lines.length < height) lines.push({ text: ' '.repeat(width), tone: 'normal' });
  return lines.slice(0, height);
}

function Panel({ themeName, width, height, lines, active }) {
  const theme = getTheme(themeName);
  return (
    <Box
      width={width}
      height={height}
      flexDirection="column"
      borderStyle="round"
      borderColor={COLOR_ENABLED ? (active ? theme.borderActive : theme.borderInactive) : undefined}
      paddingX={1}
    >
      {lines.map((line, index) => (
        <Text key={`${index}-${line.text}`} {...toneProps(themeName, line.tone)}>
          {line.text}
        </Text>
      ))}
    </Box>
  );
}

function HelpOverlay({ themeName, width, height }) {
  const theme = getTheme(themeName);
  const lines = getTuiHelpSections().flatMap((section) => [
    { text: section.title, tone: 'accent' },
    ...section.lines.map((text) => ({ text, tone: 'normal' })),
    { text: '', tone: 'normal' }
  ]);

  return (
    <Box
      width={width}
      height={height}
      flexDirection="column"
      borderStyle="round"
      borderColor={COLOR_ENABLED ? theme.borderActive : undefined}
      paddingX={1}
    >
      {lines.slice(0, Math.max(1, height - 2)).map((line, index) => (
        <Text key={`${index}-${line.text}`} {...toneProps(themeName, line.tone)}>
          {padText(line.text, Math.max(4, width - 4))}
        </Text>
      ))}
    </Box>
  );
}

function readModalValue(modal, key) {
  return modal.fields.find((field) => field.key === key)?.value || '';
}

function ModalOverlay({ themeName, modal, width = 82 }) {
  const theme = getTheme(themeName);
  const innerWidth = Math.max(10, width - 4);
  const lines = [
    { text: modal.title, tone: 'accent' },
    { text: '', tone: 'normal' },
    { text: modal.prompt, tone: 'dim' },
    { text: '', tone: 'normal' },
    ...modal.fields.flatMap((field, index) => {
      const selected = index === modal.activeField;
      const prefix = selected ? '>' : ' ';
      const displayValue = field.options?.length
        ? `< ${field.value || field.options[0]} >`
        : (field.value || field.placeholder || '');
      return [
        { text: `${prefix} ${field.label}`, tone: selected ? 'selected' : 'normal' },
        { text: `  ${displayValue}`, tone: field.value ? 'normal' : 'dim' }
      ];
    }),
    ...(modal.notes || []).flatMap((note) => ([
      { text: '', tone: 'normal' },
      { text: `- ${note}`, tone: 'dim' }
    ])),
    { text: '', tone: 'normal' },
    { text: modal.submitText, tone: 'dim' }
  ];

  return (
    <Box
      width={width}
      height={Math.min(lines.length + 2, 22)}
      flexDirection="column"
      borderStyle="round"
      borderColor={COLOR_ENABLED ? theme.borderActive : undefined}
      paddingX={1}
    >
      {lines.slice(0, 20).map((line, index) => (
        <Text key={`${index}-${line.text}`} {...toneProps(themeName, line.tone)}>
          {padText(line.text, innerWidth)}
        </Text>
      ))}
    </Box>
  );
}

function InitProgressOverlay({ themeName, modal, width = 82 }) {
  const theme = getTheme(themeName);
  const innerWidth = Math.max(10, width - 4);
  const lines = [
    { text: modal.title, tone: 'accent' },
    { text: '', tone: 'normal' },
    { text: modal.prompt, tone: 'dim' },
    { text: '', tone: 'normal' },
    ...(modal.steps?.length
      ? modal.steps.map((step) => ({
        text: formatInitProgressLine(step),
        tone: step.status === 'failed'
          ? 'error'
          : (step.status === 'running' ? 'selected' : (step.status === 'done' ? 'active' : 'normal'))
      }))
      : [{ text: '正在准备初始化步骤...', tone: 'dim' }]),
    ...(modal.error ? [{ text: '', tone: 'normal' }, { text: modal.error, tone: 'error' }] : []),
    ...(modal.done ? [{ text: '', tone: 'normal' }, { text: '初始化已完成，按 Esc 关闭', tone: 'dim' }] : [])
  ];

  return (
    <Box
      width={width}
      height={Math.min(lines.length + 2, 22)}
      flexDirection="column"
      borderStyle="round"
      borderColor={COLOR_ENABLED ? theme.borderActive : undefined}
      paddingX={1}
    >
      {lines.slice(0, 20).map((line, index) => (
        <Text key={`${index}-${line.text}`} {...toneProps(themeName, line.tone)}>
          {padText(line.text, innerWidth)}
        </Text>
      ))}
    </Box>
  );
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
    filters: { nav: '', providers: '', nodes: '', subscriptions: '' },
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

function cycleProtocolFilter(current, provider) {
  const protocols = getAvailableProtocols(provider);
  const index = Math.max(0, protocols.findIndex((item) => item === current));
  return protocols[(index + 1) % protocols.length] || 'all';
}

async function writeAndApplyRuntime(currentConfig) {
  await writeManagedConfig(currentConfig);
  return applyManagedConfigToRuntime(currentConfig);
}

function openGuidedModal(action, snapshot) {
  if (action === 'init-runtime') return createInitModal(snapshot);
  if (action === 'add-sub') return createAddSubscriptionModal();
  if (action === 'set-ports') return createPortModal(snapshot);
  if (action === 'shell-install') return createShellInstallModal(snapshot);
  return null;
}

export default function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const initialConfig = useMemo(() => createConfig(), []);
  const [state, setState] = useState(null);
  const [bootError, setBootError] = useState('');
  const dimensions = useMemo(
    () => ({ width: stdout.columns || 120, height: stdout.rows || 30 }),
    [stdout.columns, stdout.rows]
  );

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

  const updateState = (mutator) => {
    setState((previous) => {
      const next = cloneState(previous);
      mutator(next);
      ensureAppSelections(next);
      return next;
    });
  };

  const previewThemeName =
    state?.sectionId === 'appearance' && state?.activePane === 'content'
      ? state.selectedThemeId
      : state?.snapshot.status.theme || initialConfig.theme;

  const layoutMode = getLayoutMode(dimensions.width);
  const { middle } = getViewportHeights(dimensions.height);
  const navWidth = layoutMode === 'split' ? 24 : 22;
  const contentWidth = layoutMode === 'single' ? dimensions.width : Math.max(24, dimensions.width - navWidth - 1);
  const navPanelWidth = layoutMode === 'single' ? dimensions.width : navWidth;
  const providerWidth = Math.max(20, Math.min(28, Math.floor(contentWidth * 0.32)));
  const nodeWidth = Math.max(20, contentWidth - providerWidth - 1);
  const selectedProvider = state ? getSelectedProvider(state) : null;
  const nodes = state ? getNodes(state, selectedProvider) : [];
  const selectedNodeId = selectedProvider ? state.selectedNodeIds[selectedProvider.id] : null;
  const subscriptions = state ? subscriptionsOf(state) : [];
  const selectedLatencyTarget = state ? getLatencyTarget(state.selectedLatencyTargetId) : getLatencyTarget('gstatic');
  const protocolFilterLabel = state?.protocolFilter === 'all' ? 'ALL' : formatProtocolTag(state?.protocolFilter);

  const refreshState = async () => {
    const snapshot = await refreshDashboardSnapshot();
    updateState((next) => {
      next.snapshot = snapshot;
    });
  };

  const withBusy = async (action, successNotice) => {
    if (!state || state.busy) return;

    updateState((next) => {
      next.busy = true;
    });

    try {
      await action();
      updateState((next) => {
        next.busy = false;
        if (successNotice) setNotice(next, 'success', successNotice);
      });
    } catch (error) {
      updateState((next) => {
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

    const pid = await readPid();
    if (await isApiAlive() && await isPidAlive(pid)) return;

    await startDetached();
    await new Promise((resolve) => setTimeout(resolve, 1200));
  };

  const stopRuntime = async () => {
    const pid = await readPid();
    if (!pid) return;

    if (!await isPidAlive(pid)) {
      await removePidFile();
      return;
    }

    await stopByPid(pid, { force: false });
    await new Promise((resolve) => setTimeout(resolve, 800));

    if (await isPidAlive(pid)) {
      await stopByPid(pid, { force: true });
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    await removePidFile();
  };

  const measureProviderNodes = async (provider, target, nodeItems) => {
    if (!provider || !target || !Array.isArray(nodeItems) || nodeItems.length === 0) return 0;

    updateState((next) => {
      const liveProvider = next.snapshot.providers.find((item) => item.id === provider.id);
      for (const liveNode of liveProvider?.nodes || []) {
        if (nodeItems.some((item) => item.id === liveNode.id)) {
          liveNode.delayMs = null;
          liveNode.delayStatus = 'pending';
        }
      }
    });

    let okCount = 0;
    for (let index = 0; index < nodeItems.length; index += LATENCY_CONCURRENCY) {
      const batch = nodeItems.slice(index, index + LATENCY_CONCURRENCY);
      const batchResults = await Promise.all(batch.map(async (node) => {
        try {
          const result = await measureNode(provider.id, node.id, {
            url: target.url
          });
          return { nodeId: node.id, delayMs: result.delayMs, ok: typeof result.delayMs === 'number' };
        } catch {
          return { nodeId: node.id, delayMs: null, ok: false };
        }
      }));

      updateState((next) => {
        const liveProvider = next.snapshot.providers.find((item) => item.id === provider.id);
        for (const result of batchResults) {
          const liveNode = liveProvider?.nodes.find((item) => item.id === result.nodeId);
          if (!liveNode) continue;
          liveNode.delayMs = result.delayMs;
          liveNode.delayStatus = result.ok ? 'ok' : 'error';
        }
      });

      okCount += batchResults.filter((item) => item.ok).length;
    }

    return okCount;
  };

  const runModal = async (modal) => {
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
    } else if (modal.type === 'set-ports' || modal.type === 'init-runtime') {
      const ports = {
        http: parseInteger(readModalValue(modal, 'http'), 'HTTP'),
        socks: parseInteger(readModalValue(modal, 'socks'), 'SOCKS'),
        api: parseInteger(readModalValue(modal, 'api'), 'API')
      };

      if (modal.type === 'set-ports') {
        const result = await setConfiguredPorts({ ports, reason: 'custom' });
        return writeAndApplyRuntime(result.config);
      } else {
        updateState((next) => {
          next.modal = createInitProgressModal(next.snapshot);
        });
        await initializeRuntimeWithOptions({
          mode: currentConfig.mode,
          ports,
          skipDownload: process.env.VPNCTL_SKIP_DOWNLOAD === '1',
          onProgress(step) {
            updateState((next) => {
              if (next.modal?.type !== 'init-progress') {
                next.modal = createInitProgressModal(next.snapshot);
              }
              const existingIndex = next.modal.steps.findIndex((item) => item.id === step.id);
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
        ...(bashrcPath ? { bashrcPath } : {})
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
      if (input === 'q' || (key.ctrl && input === 'c')) exit();
      return;
    }

    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    if (state.modal) {
      if (state.modal.type === 'init-progress') {
        if (key.escape && (state.modal.done || state.modal.error)) {
          updateState((next) => {
            next.modal = null;
          });
        }
        return;
      }

      if (key.escape) {
        updateState((next) => {
          next.modal = null;
        });
        return;
      }

      if ((key.leftArrow || key.rightArrow) && state.modal.fields[state.modal.activeField]?.options?.length) {
        const direction = key.leftArrow ? -1 : 1;
        updateState((next) => {
          const field = next.modal.fields[next.modal.activeField];
          field.value = cycleModalFieldOption(field, direction);
        });
        return;
      }

      if (key.tab || key.upArrow || key.downArrow) {
        const direction = key.upArrow ? -1 : 1;
        updateState((next) => {
          const count = next.modal.fields.length;
          if (!count) return;
          next.modal.activeField = key.tab
            ? (next.modal.activeField + 1) % count
            : moveSelection(next.modal.activeField, direction, count);
        });
        return;
      }

      if (key.return) {
        const modal = state.modal;
        await withBusy(async () => {
          const applied = await runModal(modal);
          if (applied?.message) {
            updateState((next) => {
              setNotice(next, applied.fallbackUsed ? 'warn' : 'success', applied.message);
            });
          }
          updateState((next) => {
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
        updateState((next) => {
          const field = next.modal.fields[next.modal.activeField];
          if (!field) return;
          if (field.options?.length) return;
          field.value = field.value.slice(0, -1);
        });
        return;
      }

      if (typeof input === 'string' && input >= ' ' && input !== '\x7f') {
        updateState((next) => {
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
        updateState((next) => {
          next.helpOpen = false;
        });
      }
      return;
    }

    if (state.searchMode) {
      if (key.escape || key.return) {
        updateState((next) => {
          next.searchMode = false;
        });
        return;
      }

      if (key.backspace || key.delete) {
        updateState((next) => {
          if (next.activePane === 'nav') next.filters.nav = next.filters.nav.slice(0, -1);
          else if (next.sectionId === 'subscriptions') next.filters.subscriptions = next.filters.subscriptions.slice(0, -1);
          else if (next.sectionId === 'nodes') next.filters[next.sectionPane] = next.filters[next.sectionPane].slice(0, -1);
        });
        return;
      }

      if (typeof input === 'string' && input >= ' ' && input !== '\x7f') {
        updateState((next) => {
          if (next.activePane === 'nav') next.filters.nav += input;
          else if (next.sectionId === 'subscriptions') next.filters.subscriptions += input;
          else if (next.sectionId === 'nodes') next.filters[next.sectionPane] += input;
        });
      }
      return;
    }

    if (input === 'q') {
      exit();
      return;
    }

    if (input === '?') {
      updateState((next) => {
        next.helpOpen = !next.helpOpen;
      });
      return;
    }

    if (key.tab) {
      updateState((next) => {
        next.activePane = next.activePane === 'nav' ? 'content' : 'nav';
      });
      return;
    }

    if (key.leftArrow) {
      updateState((next) => {
        if (next.activePane === 'content' && next.sectionId === 'nodes' && next.sectionPane === 'nodes') {
          next.sectionPane = 'providers';
        } else {
          next.activePane = 'nav';
        }
      });
      return;
    }

    if (key.rightArrow) {
      updateState((next) => {
        next.activePane = 'content';
        if (next.sectionId === 'nodes') next.sectionPane = 'nodes';
      });
      return;
    }

    if (key.escape) {
      updateState((next) => {
        next.activePane = 'nav';
      });
      return;
    }

    if (input === '/') {
      updateState((next) => {
        next.searchMode = true;
      });
      return;
    }

    if (key.upArrow || key.downArrow) {
      const direction = key.upArrow ? -1 : 1;
      updateState((next) => {
        if (next.activePane === 'nav') {
          const items = sectionsOf(next);
          const index = items.findIndex((item) => item.id === next.sectionId);
          next.sectionId = items[moveSelection(index >= 0 ? index : 0, direction, items.length)]?.id || next.sectionId;
        } else if (next.sectionId === 'subscriptions') {
          const items = subscriptionsOf(next);
          const index = items.findIndex((item) => item.id === next.selectedSubscriptionId);
          next.selectedSubscriptionId = items[moveSelection(index >= 0 ? index : 0, direction, items.length)]?.id || next.selectedSubscriptionId;
        } else if (next.sectionId === 'appearance') {
          const index = THEMES.findIndex((item) => item.id === next.selectedThemeId);
          next.selectedThemeId = THEMES[moveSelection(index >= 0 ? index : 0, direction, THEMES.length)]?.id || next.selectedThemeId;
        } else if (next.sectionId === 'latency') {
          const index = LATENCY_TARGETS.findIndex((item) => item.id === next.selectedLatencyTargetId);
          next.selectedLatencyTargetId = LATENCY_TARGETS[moveSelection(index >= 0 ? index : 0, direction, LATENCY_TARGETS.length)]?.id || next.selectedLatencyTargetId;
        } else if (next.sectionId === 'nodes') {
          if (next.sectionPane === 'providers') {
            const items = getProviders(next);
            const index = items.findIndex((item) => item.id === next.selectedProviderId);
            next.selectedProviderId = items[moveSelection(index >= 0 ? index : 0, direction, items.length)]?.id || next.selectedProviderId;
          } else {
            const provider = getSelectedProvider(next);
            if (!provider) return;
            const items = getNodes(next, provider);
            const index = items.findIndex((item) => item.id === next.selectedNodeIds[provider.id]);
            const node = items[moveSelection(index >= 0 ? index : 0, direction, items.length)];
            if (node) next.selectedNodeIds[provider.id] = node.id;
          }
        }
      });
      return;
    }

    if (key.return) {
      if (state.activePane === 'nav') {
        updateState((next) => {
          next.activePane = 'content';
        });
        return;
      }

      if (state.sectionId === 'appearance') {
        await withBusy(async () => {
          await setConfiguredTheme({ theme: state.selectedThemeId });
          await refreshState();
        }, `主题已切换为 ${state.selectedThemeId}`);
        return;
      }

      if (state.sectionId === 'latency') {
        updateState((next) => {
          setNotice(next, 'accent', `当前测速目标: ${getLatencyTarget(next.selectedLatencyTargetId).label}；去节点页按 d 执行整组测速`);
        });
        return;
      }

      if (state.sectionId === 'nodes') {
        const provider = getSelectedProvider(state);
        const node = getSelectedNode(state, provider);
        if (!provider) return;

        if (state.sectionPane === 'providers') {
          updateState((next) => {
            next.sectionPane = 'nodes';
          });
          return;
        }

        if (!node) return;

        await withBusy(async () => {
          const snapshot = await switchProviderNode(provider.id, node.id);
          updateState((next) => {
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
            await syncSubscriptions({}, createConfig());
            const applied = await applyManagedConfigToRuntime(createConfig());
            await refreshState();
            updateState((next) => {
              setNotice(next, applied.fallbackUsed ? 'warn' : 'success', applied.message);
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
          updateState((next) => {
            setNotice(next, 'success', '服务器已就绪：新会话可直接运行 codex');
          });
          return;
        }

        updateState((next) => {
          next.modal = openGuidedModal(action, next.snapshot);
        });
        return;
      }

      if (state.sectionId === 'shell') {
        if (!state.snapshot.status.shellIntegration?.installed || !state.snapshot.status.shellIntegration?.codexWrapper) {
          updateState((next) => {
            next.modal = createShellInstallModal(next.snapshot);
          });
        } else {
          updateState((next) => {
            setNotice(next, 'success', 'bashrc 集成已就绪：新会话可直接运行 codex');
          });
        }
        return;
      }

      if (state.sectionId === 'ports') {
        updateState((next) => {
          next.modal = createPortModal(next.snapshot);
        });
        return;
      }

      if (state.sectionId === 'install') {
        if (!state.snapshot.status.initialized) {
          updateState((next) => {
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
        const subscription = subscriptions.find((item) => item.id === state.selectedSubscriptionId);
        if (!subscription) return;
        await withBusy(async () => {
          await activateSubscription(subscription.id, createConfig());
          await syncSubscriptions({ id: subscription.id }, createConfig());
          const applied = await applyManagedConfigToRuntime(createConfig());
          await refreshState();
          updateState((next) => {
            setNotice(next, applied.fallbackUsed ? 'warn' : 'success', `${subscription.displayName} 已激活。${applied.message}`);
          });
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
        await syncSubscriptions({}, createConfig());
        const applied = await applyManagedConfigToRuntime(createConfig());
        await refreshState();
        updateState((next) => {
          setNotice(next, applied.fallbackUsed ? 'warn' : 'success', applied.message);
        });
      }, '订阅已同步');
      return;
    }
    if (input === 'i') {
      updateState((next) => {
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
      updateState((next) => {
        next.modal = createAddSubscriptionModal();
      });
      return;
    }
    if (input === 'x' && state.sectionId === 'subscriptions' && state.selectedSubscriptionId) {
      const subscription = subscriptions.find((item) => item.id === state.selectedSubscriptionId);
      if (!subscription) return;
      updateState((next) => {
        next.modal = createDeleteSubscriptionModal(subscription);
      });
      return;
    }
    if (input === 'f' && state.sectionId === 'nodes') {
      const provider = getSelectedProvider(state);
      updateState((next) => {
        next.protocolFilter = cycleProtocolFilter(next.protocolFilter, provider);
        setNotice(next, 'accent', `协议筛选: ${next.protocolFilter === 'all' ? 'ALL' : formatProtocolTag(next.protocolFilter)}`);
      });
      return;
    }
    if (input === 'p') {
      updateState((next) => {
        next.modal = createPortModal(next.snapshot);
      });
      return;
    }
    if (input === 'b') {
      updateState((next) => {
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
        const okCount = await measureProviderNodes(provider, selectedLatencyTarget, providerNodes);
        updateState((next) => {
          setNotice(next, okCount > 0 ? 'success' : 'warn', `${selectedLatencyTarget.label} 测速完成：${okCount}/${providerNodes.length}`);
        });
      }, `${provider.label} ${selectedLatencyTarget.label} 整组测速完成`);
      return;
    }
    if (input === 'l') {
      updateState((next) => {
        setNotice(next, 'accent', next.snapshot.status.logFile);
      });
    }
  }, { isActive: true });

  if (bootError) {
    return (
      <Box flexDirection="column">
        <Text {...toneProps(previewThemeName, 'error')}>VPNCTL UI 启动失败</Text>
        <Text>{bootError}</Text>
      </Box>
    );
  }

  if (!state) {
    return (
      <Box flexDirection="column">
        <Text {...toneProps(initialConfig.theme, 'accent')}>VPNCTL</Text>
        <Text>正在加载总览...</Text>
      </Box>
    );
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
      text: padText(
        `${isSelected ? '>' : ' '} ${truncateText(`${item.label} ${item.tagline ? `· ${item.tagline}` : ''}`, Math.max(12, infoWidth - 6))}${item.id === state.snapshot.status.theme ? ' *' : ''}`,
        infoWidth
      ),
      tone: isSelected ? 'selected' : (item.id === state.snapshot.status.theme ? 'active' : 'normal')
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
      text: padText(
        `${isSelected ? '>' : ' '} ${truncateText(`${item.label} · ${item.description}`, Math.max(16, infoWidth - 4))}`,
        infoWidth
      ),
      tone: isSelected ? 'selected' : (item.id === state.selectedLatencyTargetId ? 'active' : 'normal')
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
      text: padText(
        `${isSelected ? '>' : ' '} ${truncateText(item.displayName, Math.max(8, infoWidth - 24))} ${item.enabled ? 'active' : 'resting'} ${item.syncStatus || 'pending'}`,
        infoWidth
      ),
      tone: isSelected ? 'selected' : (item.enabled ? 'active' : 'normal')
    }),
    emptyText: '还没有订阅，按 a 添加'
  });

  const providerLines = listLines({
    title: `Providers (${getProviders(state).length})${state.filters.providers ? ` / ${state.filters.providers}` : ''}`,
    items: getProviders(state),
    selectedId: state.selectedProviderId,
    width: Math.max(4, providerWidth - 4),
    height: Math.max(1, middle - 2),
    renderRow: (item, isSelected) => ({
      text: `${padText(
        `${isSelected ? '>' : ' '}${item.status === 'active' ? '*' : ' '} ${truncateText(item.label, Math.max(6, providerWidth - 11))}`,
        Math.max(4, providerWidth - 7)
      )}${`${item.nodeCount}`.padStart(3, ' ')}`,
      tone: isSelected ? 'selected' : (item.status === 'active' ? 'active' : 'normal')
    }),
    emptyText: '没有 provider'
  });

  const nodeLines = listLines({
    title: `Nodes (${nodes.length})${state.filters.nodes ? ` / ${state.filters.nodes}` : ''} | ${selectedLatencyTarget.label} | ${protocolFilterLabel}`,
    items: nodes,
    selectedId: selectedNodeId,
    width: Math.max(4, nodeWidth - 4),
    height: Math.max(1, middle - 2),
    renderRow: (item, isSelected) => ({
      text: `${padText(
        `${isSelected ? '>' : ' '}${item.isCurrent ? '*' : ' '} ${truncateText(item.label, Math.max(8, nodeWidth - 24))}`,
        Math.max(8, nodeWidth - 14)
      )} ${formatProtocolTag(item.protocol).padStart(8, ' ')} ${formatDelay(item.delayMs, item.delayStatus).padStart(6, ' ')}`,
      tone: isSelected ? 'selected' : (item.isCurrent ? 'active' : 'normal')
    }),
    emptyText: state.snapshot.status.apiAlive ? '没有匹配当前筛选的节点' : '请先启动 mihomo，延迟才会显示'
  });
  const overviewGuide = buildOverviewGuide(state.snapshot);
  const shellGuide = buildShellGuide(state.snapshot);

  const pageContent = {
    overview: [
      '总览',
      `初始化状态: ${state.snapshot.status.initialized ? '已完成' : '未初始化'}`,
      `mihomo 状态: ${state.snapshot.status.apiAlive ? '运行中' : '离线'}`,
      `订阅数量: ${state.snapshot.status.subscriptionCount}`,
      `当前主题: ${state.snapshot.status.theme}`,
      `默认策略组: ${state.snapshot.status.defaultGroup}`,
      `下一步: ${(state.snapshot.status.nextSteps || []).join(' | ')}`,
      '',
      ...overviewGuide,
      '',
      '动作: Enter 执行下一步 | i 初始化 | a 添加订阅 | y 同步激活订阅 | s 启动'
    ],
    runtime: [
      '运行状态',
      `API 在线: ${state.snapshot.status.apiAlive ? '是' : '否'}`,
      `PID: ${state.snapshot.status.pid || 'none'}`,
      `当前节点: ${state.snapshot.currentNodeLabel || 'none'}`,
      `锁文件数量: ${(state.snapshot.status.runtimeLocks || []).length}`,
      `日志文件: ${state.snapshot.status.logFile}`,
      '',
      '动作: s 启动 | k 停止 | r 刷新 | l 日志路径'
    ],
    ports: [
      '端口与环境',
      `HTTP 代理: ${state.snapshot.status.httpProxy}`,
      `SOCKS 代理: ${state.snapshot.status.socksProxy}`,
      `API 地址: ${state.snapshot.status.mihomoApi}`,
      `HTTP 检测: ${formatPort(state.snapshot.status.ports.http)}`,
      `SOCKS 检测: ${formatPort(state.snapshot.status.ports.socks)}`,
      `API 检测: ${formatPort(state.snapshot.status.ports.api)}`,
      `端口来源: ${state.snapshot.status.portSource}`,
      '',
      '动作: p 修改端口'
    ],
    latency: [
      '站点测速',
      `当前测速目标: ${selectedLatencyTarget.label}`,
      `测速 URL: ${selectedLatencyTarget.url}`,
      `${selectedLatencyTarget.description}`,
      '',
      '说明: 节点页显示的 ms 会跟随这里的目标站点切换',
      '动作: 上下选择站点 | Enter 应用目标 | 去节点页按 d 执行整组测速'
    ],
    install: [
      '安装与升级',
      `模式: ${state.snapshot.status.mode}`,
      `旧版安装检测: ${state.snapshot.status.oldInstallDetected ? '检测到' : '未检测到'}`,
      `迁移状态: ${state.snapshot.status.migration.migrationStatus}`,
      `迁移来源: ${state.snapshot.status.migration.sourcePath || 'none'}`,
      '',
      '动作: i 初始化 | u 迁移旧版'
    ],
    shell: [
      'Shell 集成',
      `已安装: ${state.snapshot.status.shellIntegration?.installed ? '是' : '否'}`,
      `bashrc 路径: ${state.snapshot.status.shellIntegration?.bashrcPath || 'none'}`,
      `Codex 自动代理: ${state.snapshot.status.shellIntegration?.codexWrapper ? '已启用' : '未启用'}`,
      `同账户会话复用: ${state.snapshot.status.sessionReuse?.state || 'unknown'}`,
      `${state.snapshot.status.sessionReuse?.label || 'Install bash shell integration on the server to reuse VPN across same-account sessions'}`,
      '',
      ...shellGuide,
      '',
      '动作: Enter / b 安装 bashrc 片段 | n 卸载 bashrc 片段'
    ],
    logs: [
      '日志与诊断',
      `日志文件: ${state.snapshot.status.logFile}`,
      `主题: ${state.snapshot.status.theme}`,
      `端口来源: ${state.snapshot.status.portSource}`,
      `迁移状态: ${state.snapshot.status.migration.migrationStatus}`,
      '',
      '动作: r 刷新 | l 显示日志路径'
    ]
  };

  const contentLines =
    section.id === 'subscriptions'
      ? subscriptionLines
      : section.id === 'appearance'
        ? appearanceLines
        : section.id === 'latency'
          ? latencyLines
        : listLines({
            title: pageContent[section.id]?.[0] || '总览',
            items: (pageContent[section.id] || pageContent.overview)
              .slice(1)
              .map((text, index) => ({ id: `${section.id}-${index}`, label: text })),
            selectedId: '',
            width: infoWidth,
            height: Math.max(1, middle - 2),
            renderRow: (item) => ({
              text: padText(item.label, infoWidth),
              tone: item.label.startsWith('动作:') ? 'dim' : 'normal'
            }),
            emptyText: ''
          });

  const currentNode = getSelectedNode(state, selectedProvider);
  const statusLine1 = padText(`VPNCTL  Fast lanes. Calm terminal.  theme:${previewThemeName}`, dimensions.width);
  const statusLine2 = padText(
    `section:${section.label} | api:${state.snapshot.status.apiAlive ? 'online' : 'offline'} | pid:${state.snapshot.status.pid || 'none'} | provider:${selectedProvider?.label || 'none'} | cursor:${currentNode?.label || 'none'} | connected:${state.snapshot.status.apiAlive ? (selectedProvider?.currentNodeLabel || state.snapshot.currentNodeLabel || 'none') : 'offline'} | latency:${selectedLatencyTarget.label} | protocol:${protocolFilterLabel}`,
    dimensions.width
  );
  const statusLine3 = padText(
    `http:${formatPort(state.snapshot.status.ports.http)} | socks:${formatPort(state.snapshot.status.ports.socks)} | api:${formatPort(state.snapshot.status.ports.api)} | source:${state.snapshot.status.portSource} | ${state.notice.text}`,
    dimensions.width
  );

  return (
    <Box flexDirection="column">
      <Text {...toneProps(previewThemeName, 'accent')}>{statusLine1}</Text>
      <Text {...toneProps(previewThemeName, 'normal')}>{statusLine2}</Text>
      <Text {...toneProps(previewThemeName, state.notice.tone || 'dim')}>{statusLine3}</Text>
      {state.helpOpen ? (
        <HelpOverlay themeName={previewThemeName} width={dimensions.width} height={middle} />
      ) : state.modal ? (
        <Box justifyContent="center">
          {state.modal.type === 'init-progress'
            ? <InitProgressOverlay themeName={previewThemeName} modal={state.modal} />
            : <ModalOverlay themeName={previewThemeName} modal={state.modal} />}
        </Box>
      ) : layoutMode === 'single' ? (
        state.activePane === 'nav' ? (
          <Panel themeName={previewThemeName} width={dimensions.width} height={middle} lines={navLines} active />
        ) : section.id === 'nodes' ? (
          <Panel
            themeName={previewThemeName}
            width={dimensions.width}
            height={middle}
            lines={state.sectionPane === 'providers' ? providerLines : nodeLines}
            active
          />
        ) : (
          <Panel themeName={previewThemeName} width={dimensions.width} height={middle} lines={contentLines} active />
        )
      ) : (
        <Box columnGap={1}>
          <Panel themeName={previewThemeName} width={navPanelWidth} height={middle} lines={navLines} active={state.activePane === 'nav'} />
          {section.id === 'nodes' ? (
            <Box columnGap={1}>
              <Panel themeName={previewThemeName} width={providerWidth} height={middle} lines={providerLines} active={state.activePane === 'content' && state.sectionPane === 'providers'} />
              <Panel themeName={previewThemeName} width={nodeWidth} height={middle} lines={nodeLines} active={state.activePane === 'content' && state.sectionPane === 'nodes'} />
            </Box>
          ) : (
            <Panel themeName={previewThemeName} width={contentWidth} height={middle} lines={contentLines} active={state.activePane === 'content'} />
          )}
        </Box>
      )}
      <Text {...toneProps(previewThemeName, 'dim')}>
        {padText('Tab 切换区域  Enter 执行动作/激活订阅  / 搜索  f 协议筛选  i 初始化  a 加订阅  y 同步激活订阅  s 启动  d 测速  p 端口  b bashrc  ? 帮助  q 退出', dimensions.width)}
      </Text>
      <Text {...toneProps(previewThemeName, 'normal')}>
        {padText(
          state.searchMode ? `SEARCH ${state.activePane === 'nav' ? 'nav' : section.id}` : `ACTIVE ${state.activePane.toUpperCase()} | SECTION ${section.label}`,
          dimensions.width
        )}
      </Text>
    </Box>
  );
}
