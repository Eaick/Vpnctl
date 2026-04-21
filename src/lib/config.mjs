import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { buildRuntimePaths, detectRuntimeMode } from './runtime.mjs';
import { resolveThemeName } from './theme.mjs';

const DEFAULT_PORTS = {
  dev: {
    http: 17890,
    socks: 17891,
    api: 19090
  },
  user: {
    http: 7890,
    socks: 7891,
    api: 9090
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

function normalizePortSet(value, fallback) {
  return {
    http: Number(value?.http || fallback.http),
    socks: Number(value?.socks || fallback.socks),
    api: Number(value?.api || fallback.api)
  };
}

export function createConfig(mode = detectRuntimeMode(), overrides = {}) {
  const home = process.env.HOME || os.homedir();
  const paths = buildRuntimePaths(mode);
  const installState = readJson(paths.installFile);
  const defaultPorts = DEFAULT_PORTS[mode] || DEFAULT_PORTS.user;
  const ports = normalizePortSet(overrides.ports || installState?.ports, defaultPorts);
  const controllerHost = normalizeHost(overrides.controllerHost || installState?.controllerHost);
  const httpHost = normalizeHost(overrides.httpHost || installState?.httpHost);
  const socksHost = normalizeHost(overrides.socksHost || installState?.socksHost);
  const theme = resolveThemeName(process.env.VPNCTL_THEME, overrides.theme, installState?.theme, 'gemini');
  const defaultGroup = overrides.defaultGroup || process.env.MIHOMO_GROUP || installState?.defaultGroup || 'VPNCTL';
  const portSource = overrides.portSource || installState?.portSource || 'default';
  const shellIntegration = installState?.shellIntegration || { bashrc: false, bashrcPath: '', codexWrapper: false };
  const migration = installState?.migration || { status: 'none', sourcePath: '' };

  return {
    home,
    mode,
    paths,
    installState,
    controllerHost,
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
    httpProxy: process.env.MIHOMO_HTTP_PROXY || buildEndpoint('http', httpHost, ports.http),
    socksProxy: process.env.MIHOMO_SOCKS_PROXY || buildEndpoint('socks5', socksHost, ports.socks),
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
