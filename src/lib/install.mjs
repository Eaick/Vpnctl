import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { gunzipSync } from 'node:zlib';
import { createConfig } from './config.mjs';
import {
  buildPortEnvSnippet,
  findAvailablePortPlan,
  getConfiguredPortPlan,
  normalizePortOverrides,
  probePortPlan
} from './ports.mjs';
import { ensureSubscriptionStore, writeManagedConfig } from './subscriptions.mjs';
import { buildInitProgressStep } from './init-progress.mjs';

const LATEST_RELEASE_API = process.env.VPNCTL_MIHOMO_RELEASE_API || 'https://api.github.com/repos/MetaCubeX/mihomo/releases/latest';

function normalizePath(filepath) {
  return filepath.replace(/\\/g, '/');
}

function getPlatformAssetMatchers(platform, arch) {
  if (arch !== 'x64') return [];

  if (platform === 'win32') {
    return ['windows-amd64-v1', 'windows-amd64-compatible', 'windows-amd64'];
  }

  if (platform === 'linux') {
    return ['linux-amd64-v1', 'linux-amd64-compatible', 'linux-amd64'];
  }

  return [];
}

function buildManagedState(currentConfig, portPlan, asset = null) {
  return {
    mode: currentConfig.mode,
    initializedAt: currentConfig.installState?.initializedAt || new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    controllerHost: portPlan.api.host,
    httpHost: portPlan.http.host,
    socksHost: portPlan.socks.host,
    ports: {
      api: portPlan.api.port,
      http: portPlan.http.port,
      socks: portPlan.socks.port
    },
    portSource: currentConfig.portSource || currentConfig.installState?.portSource || 'default',
    defaultGroup: currentConfig.defaultGroup,
    theme: currentConfig.theme,
    secret: currentConfig.installState?.secret || '',
    assetName: asset?.name || currentConfig.installState?.assetName || '',
    assetUrl: asset?.browser_download_url || currentConfig.installState?.assetUrl || '',
    shellIntegration: currentConfig.installState?.shellIntegration || { bashrc: false, bashrcPath: '', codexWrapper: false },
    migration: currentConfig.installState?.migration || { status: 'none', sourcePath: '' }
  };
}

async function writeInstallState(currentConfig, installState) {
  await fs.writeFile(currentConfig.installFile, JSON.stringify(installState, null, 2), 'utf8');
}

function selectAsset(assets, platform = process.platform, arch = process.arch) {
  const matchers = getPlatformAssetMatchers(platform, arch);
  for (const matcher of matchers) {
    const asset = assets.find((item) => item.name.includes(matcher) && item.name.endsWith('.gz'));
    if (asset) return asset;
  }

  return null;
}

async function downloadBinary(asset, targetFile) {
  const res = await fetch(asset.browser_download_url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'vpnctl-mihomo'
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to download mihomo: ${res.status} ${res.statusText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const binary = gunzipSync(buffer);
  await fs.writeFile(targetFile, binary);

  if (process.platform !== 'win32') {
    await fs.chmod(targetFile, 0o755);
  }
}

function buildFallbackScript() {
  if (process.platform === 'win32') {
    return '@echo off\r\necho VPNCTL test placeholder for mihomo\r\n';
  }

  return '#!/bin/sh\necho "VPNCTL test placeholder for mihomo"\n';
}

async function ensureManagedBinary(currentConfig, { skipDownload = false } = {}) {
  if (skipDownload || process.env.VPNCTL_SKIP_DOWNLOAD === '1') {
    await fs.writeFile(currentConfig.mihomoBin, buildFallbackScript(), 'utf8');
    if (process.platform !== 'win32') {
      await fs.chmod(currentConfig.mihomoBin, 0o755);
    }
    return null;
  }

  const asset = await resolveLatestMihomoAsset();
  await downloadBinary(asset, currentConfig.mihomoBin);
  return asset;
}

function emitProgress(onProgress, id, status, extra = {}) {
  if (typeof onProgress !== 'function') return;
  onProgress(buildInitProgressStep(id, status, extra));
}

export function getPlatformSupport(platform = process.platform, arch = process.arch) {
  if ((platform === 'win32' || platform === 'linux') && arch === 'x64') {
    return { supported: true, platform, arch };
  }

  return { supported: false, platform, arch };
}

export async function ensureRuntimeDirectories(currentConfig = createConfig()) {
  const dirs = [
    currentConfig.paths.root,
    path.dirname(currentConfig.mihomoBin),
    currentConfig.configDir,
    currentConfig.dataDir,
    currentConfig.cacheDir,
    currentConfig.providersDir,
    currentConfig.downloadsDir,
    currentConfig.paths.logDir,
    currentConfig.paths.migrationDir
  ];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}

export async function saveInstallState(currentConfig = createConfig(), installState = currentConfig.installState || {}) {
  await ensureRuntimeDirectories(currentConfig);
  await writeInstallState(currentConfig, installState);
  return installState;
}

export async function updateInstallState(currentConfig = createConfig(), updater = (state) => state) {
  const previous = currentConfig.installState || {};
  const next = await updater(structuredClone(previous));
  await saveInstallState(currentConfig, next);
  return next;
}

export async function resolveLatestMihomoAsset({ platform = process.platform, arch = process.arch } = {}) {
  const support = getPlatformSupport(platform, arch);
  if (!support.supported) {
    throw new Error(`Unsupported platform: ${platform}-${arch}. Only Windows x64 and Linux x64 are supported.`);
  }

  const res = await fetch(LATEST_RELEASE_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'vpnctl-mihomo'
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to query mihomo release: ${res.status} ${res.statusText}`);
  }

  const payload = await res.json();
  const asset = selectAsset(payload.assets || [], platform, arch);
  if (!asset) {
    throw new Error(`No mihomo release asset found for ${platform}-${arch}`);
  }

  return asset;
}

function inferPortSource(currentConfig, normalizedPorts, usedFallbackPlan) {
  if (currentConfig.installState?.migration?.status === 'migrated' && !Object.keys(normalizedPorts).length) {
    return usedFallbackPlan ? 'auto' : 'migrated';
  }

  if (Object.keys(normalizedPorts).length) {
    return usedFallbackPlan ? 'auto' : 'custom';
  }

  return usedFallbackPlan ? 'auto' : (currentConfig.installState?.portSource || 'default');
}

async function resolvePortPlan(currentConfig, normalizedPorts = {}) {
  const preferredPlan = getConfiguredPortPlan(currentConfig);
  const preferredProbe = await probePortPlan(preferredPlan);

  if (Object.values(preferredProbe).every((endpoint) => endpoint.available)) {
    return {
      plan: preferredProbe,
      portSource: inferPortSource(currentConfig, normalizedPorts, false)
    };
  }

  const plan = await findAvailablePortPlan(currentConfig, {
    maxOffset: currentConfig.mode === 'dev' ? 8 : 5,
    preferredPorts: normalizedPorts
  });

  return {
    plan,
    portSource: inferPortSource(currentConfig, normalizedPorts, true)
  };
}

export async function initializeRuntime({ mode = 'user', skipDownload = false } = {}) {
  return initializeRuntimeWithOptions({ mode, skipDownload });
}

export async function initializeRuntimeWithOptions({
  mode = 'user',
  skipDownload = false,
  ports = {},
  theme,
  defaultGroup,
  onProgress
} = {}) {
  const normalizedPorts = normalizePortOverrides(ports);
  let activeStep = 'validate';
  try {
    emitProgress(onProgress, 'validate', 'running');
    const currentConfig = createConfig(mode, {
      ports: normalizedPorts,
      theme,
      defaultGroup
    });
    const support = getPlatformSupport();
    if (!support.supported) {
      throw new Error(`Unsupported platform: ${support.platform}-${support.arch}. Only Windows x64 and Linux x64 are supported.`);
    }
    emitProgress(onProgress, 'validate', 'done');

    activeStep = 'directories';
    emitProgress(onProgress, 'directories', 'running');
    await ensureRuntimeDirectories(currentConfig);
    emitProgress(onProgress, 'directories', 'done');

    activeStep = 'ports';
    emitProgress(onProgress, 'ports', 'running');
    const resolved = await resolvePortPlan(currentConfig, normalizedPorts);
    if (!resolved.plan) {
      throw new Error('No available port set could be assigned. Set MIHOMO_API / MIHOMO_HTTP_PROXY / MIHOMO_SOCKS_PROXY manually.');
    }
    emitProgress(onProgress, 'ports', 'done', {
      portSource: resolved.portSource
    });

    activeStep = 'binary';
    emitProgress(onProgress, 'binary', 'running');
    const asset = await ensureManagedBinary(currentConfig, { skipDownload });
    emitProgress(onProgress, 'binary', 'done', {
      downloaded: Boolean(asset),
      assetName: asset?.name || ''
    });

    activeStep = 'install-state';
    emitProgress(onProgress, 'install-state', 'running');
    const installState = buildManagedState(
      createConfig(mode, {
        ports: {
          http: resolved.plan.http.port,
          socks: resolved.plan.socks.port,
          api: resolved.plan.api.port
        },
        theme,
        defaultGroup,
        portSource: resolved.portSource
      }),
      resolved.plan,
      asset
    );
    installState.portSource = resolved.portSource;
    await writeInstallState(currentConfig, installState);
    emitProgress(onProgress, 'install-state', 'done');

    const runtimeConfig = createConfig(mode);

    activeStep = 'subscriptions';
    emitProgress(onProgress, 'subscriptions', 'running');
    await ensureSubscriptionStore(runtimeConfig);
    emitProgress(onProgress, 'subscriptions', 'done');

    activeStep = 'managed-config';
    emitProgress(onProgress, 'managed-config', 'running');
    await writeManagedConfig(runtimeConfig);
    emitProgress(onProgress, 'managed-config', 'done');

    activeStep = 'complete';
    emitProgress(onProgress, 'complete', 'running');
    emitProgress(onProgress, 'complete', 'done');

    return {
      config: runtimeConfig,
      installState,
      portPlan: resolved.plan,
      portSnippet: buildPortEnvSnippet(resolved.plan),
      downloaded: Boolean(asset),
      assetName: asset?.name || ''
    };
  } catch (error) {
    emitProgress(onProgress, activeStep, 'failed', {
      error: error.message || String(error)
    });
    throw error;
  }
}

export async function setConfiguredPorts({
  mode,
  ports = {},
  reason = 'custom'
} = {}) {
  const currentConfig = createConfig(mode);
  const normalizedPorts = normalizePortOverrides(ports);
  const preferredConfig = createConfig(currentConfig.mode, {
    ports: normalizedPorts,
    portSource: reason
  });

  const resolved = await resolvePortPlan(preferredConfig, normalizedPorts);
  if (!resolved.plan) {
    throw new Error('No available port set could be assigned');
  }

  const nextState = buildManagedState(
    createConfig(currentConfig.mode, {
      ports: {
        http: resolved.plan.http.port,
        socks: resolved.plan.socks.port,
        api: resolved.plan.api.port
      },
      portSource: resolved.portSource || reason
    }),
    resolved.plan
  );

  nextState.initializedAt = currentConfig.installState?.initializedAt || new Date().toISOString();
  nextState.assetName = currentConfig.installState?.assetName || '';
  nextState.assetUrl = currentConfig.installState?.assetUrl || '';
  await saveInstallState(currentConfig, nextState);

  return {
    config: createConfig(currentConfig.mode),
    portPlan: resolved.plan,
    portSource: nextState.portSource,
    portSnippet: buildPortEnvSnippet(resolved.plan)
  };
}

export async function setConfiguredTheme({
  mode,
  theme
} = {}) {
  const currentConfig = createConfig(mode);
  const nextState = {
    ...(currentConfig.installState || {}),
    theme
  };

  await saveInstallState(currentConfig, nextState);

  return {
    config: createConfig(currentConfig.mode)
  };
}

export async function cleanSandboxRuntime() {
  const currentConfig = createConfig('dev');
  await fs.rm(currentConfig.paths.root, { recursive: true, force: true });
  return currentConfig.paths.root;
}

export function summarizeRuntime(currentConfig = createConfig()) {
  return {
    mode: currentConfig.mode,
    root: normalizePath(currentConfig.paths.root),
    mihomoBin: normalizePath(currentConfig.mihomoBin),
    configDir: normalizePath(currentConfig.configDir),
    dataDir: normalizePath(currentConfig.dataDir),
    logFile: normalizePath(currentConfig.logFile),
    initialized: currentConfig.isInitialized,
    portSource: currentConfig.portSource,
    lockFile: normalizePath(currentConfig.lockFile)
  };
}
