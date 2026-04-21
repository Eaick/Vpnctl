import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { buildRuntimePaths, detectRuntimeMode } from './runtime.mjs';
import { resolveThemeName } from './theme.mjs';

const DEFAULT_PORTS = {
  dev: {
    mix: {
      mixed: 17890,
      api: 19090
    },
    separate: {
      http: 17890,
      socks: 17891,
      api: 19090
    }
  },
  user: {
    mix: {
      mixed: 7890,
      api: 9090
    },
    separate: {
      http: 7890,
      socks: 7891,
      api: 9090
    }
  }
};

function readJson(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeHost(value, fallback = '127.0.0.1') {
  return value || fallback;
}

function buildEndpoint(protocol, host, port) {
  return `${protocol}://${host}:${port}`;
}

export function normalizeProxyMode(value, fallback = 'mix') {
  return value === 'separate' ? 'separate' : fallback;
}

function inferStoredProxyMode(installState, fallback = 'mix') {
  if (installState?.proxyMode === 'mix' || installState?.proxyMode === 'separate') {
    return installState.proxyMode;
  }

  if (installState?.ports?.mixed) return 'mix';
  if (installState?.ports?.http || installState?.ports?.socks) return 'separate';
  return fallback;
}

export function getDefaultPortSet(mode = 'user', proxyMode = 'mix') {
  const defaultModePorts = DEFAULT_PORTS[mode] || DEFAULT_PORTS.user;
  return structuredClone(defaultModePorts[proxyMode] || defaultModePorts.mix);
}

function normalizePortSet(value, fallback, proxyMode) {
  if (proxyMode === 'mix') {
    return {
      mixed: Number(value?.mixed || value?.http || fallback.mixed),
      api: Number(value?.api || fallback.api)
    };
  }

  return {
    http: Number(value?.http || value?.mixed || fallback.http),
    socks: Number(value?.socks || fallback.socks),
    api: Number(value?.api || fallback.api)
  };
}

export function createConfig(mode = detectRuntimeMode(), overrides = {}) {
  const home = process.env.HOME || os.homedir();
  const paths = buildRuntimePaths(mode);
  const installState = readJson(paths.installFile);
  const proxyMode = normalizeProxyMode(
    overrides.proxyMode || inferStoredProxyMode(installState, 'mix'),
    'mix'
  );
  const defaultPorts = getDefaultPortSet(mode, proxyMode);
  const ports = normalizePortSet(overrides.ports || installState?.ports, defaultPorts, proxyMode);
  const controllerHost = normalizeHost(overrides.controllerHost || installState?.controllerHost);
  const proxyHost = normalizeHost(
    overrides.proxyHost
      || installState?.proxyHost
      || installState?.httpHost
      || installState?.socksHost
      || installState?.mixedHost
  );
  const theme = resolveThemeName(process.env.VPNCTL_THEME, overrides.theme, installState?.theme, 'gemini');
  const defaultGroup = overrides.defaultGroup || process.env.MIHOMO_GROUP || installState?.defaultGroup || 'VPNCTL';
  const portSource = overrides.portSource || installState?.portSource || 'default';
  const shellIntegration = installState?.shellIntegration || { bashrc: false, bashrcPath: '', codexWrapper: false };
  const migration = installState?.migration || { status: 'none', sourcePath: '' };
  const proxyPort = proxyMode === 'mix' ? ports.mixed : ports.http;
  const socksPort = proxyMode === 'mix' ? ports.mixed : ports.socks;

  return {
    home,
    mode,
    paths,
    installState,
    proxyMode,
    ports,
    controllerHost,
    proxyHost,
    httpHost: proxyHost,
    socksHost: proxyHost,
    mixedHost: proxyHost,
    mihomoBin: process.env.MIHOMO_BIN || paths.mihomoBin,
    mihomoDir: process.env.MIHOMO_DIR || paths.mihomoDir,
    configDir: paths.configDir,
    dataDir: paths.dataDir,
    cacheDir: paths.cacheDir,
    providersDir: paths.providersDir,
    subscriptionsFile: paths.subscriptionsFile,
    downloadsDir: paths.downloadsDir,
    generatedConfigFile: paths.generatedConfigFile,
    installFile: paths.installFile,
    portSource,
    mihomoApi: process.env.MIHOMO_API || buildEndpoint('http', controllerHost, ports.api),
    mihomoSecret: process.env.MIHOMO_SECRET || installState?.secret || '',
    mixedProxy: buildEndpoint('http', proxyHost, proxyMode === 'mix' ? ports.mixed : proxyPort),
    httpProxy: process.env.MIHOMO_HTTP_PROXY || buildEndpoint('http', proxyHost, proxyPort),
    socksProxy: process.env.MIHOMO_SOCKS_PROXY || buildEndpoint('socks5', proxyHost, socksPort),
    defaultGroup,
    theme,
    shellIntegration,
    migration,
    logFile: paths.logFile,
    pidFile: paths.pidFile,
    lockFile: paths.lockFile,
    isInitialized: fs.existsSync(paths.installFile)
  };
}

export const config = createConfig();

export function authHeaders({ json = true, config: currentConfig = config } = {}) {
  const headers = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (currentConfig.mihomoSecret) {
    headers.Authorization = `Bearer ${currentConfig.mihomoSecret}`;
  }
  return headers;
}
