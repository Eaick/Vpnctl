import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SANDBOX_ROOT = path.join(PROJECT_ROOT, '.sandbox');

function normalizePath(filepath) {
  return path.resolve(filepath).replace(/\\/g, '/').toLowerCase();
}

function isInsideProject(cwd = process.cwd()) {
  const current = normalizePath(cwd);
  const root = normalizePath(PROJECT_ROOT);
  return current === root || current.startsWith(`${root}/`);
}

function getUserRoot() {
  const home = process.env.HOME || os.homedir();
  if (process.platform === 'win32') return path.join(home, '.vpnctl');
  return path.join(home, '.local', 'share', 'vpnctl');
}

function getLegacyRoots() {
  const home = process.env.HOME || os.homedir();
  const envRoot = process.env.VPNCTL_OLD_ROOT;
  const candidates = [
    envRoot,
    path.join(home, '.vpnctl-old'),
    path.join(home, '.local', 'share', 'vpnctl-old'),
    path.join(PROJECT_ROOT, '.sandbox-old'),
    path.join(PROJECT_ROOT, 'vpnctl-old')
  ].filter(Boolean);

  return [...new Set(candidates.map((item) => path.resolve(item)))];
}

export function getProjectRoot() {
  return PROJECT_ROOT;
}

export function getSandboxRoot() {
  return SANDBOX_ROOT;
}

export function getUserInstallRoot() {
  return getUserRoot();
}

export function getKnownRuntimeRoots() {
  return [SANDBOX_ROOT, getUserRoot()];
}

export function getLegacyCandidateRoots() {
  return getLegacyRoots();
}

export function buildRuntimePaths(mode = 'user') {
  const root = mode === 'dev' ? SANDBOX_ROOT : getUserRoot();
  const binaryName = process.platform === 'win32' ? 'mihomo.exe' : 'mihomo';

  return {
    mode,
    projectRoot: PROJECT_ROOT,
    root,
    installFile: path.join(root, 'install.json'),
    mihomoBin: path.join(root, 'mihomo', binaryName),
    mihomoDir: path.join(root, 'config'),
    configDir: path.join(root, 'config'),
    generatedConfigFile: path.join(root, 'config', 'config.yaml'),
    dataDir: path.join(root, 'data'),
    cacheDir: path.join(root, 'data', 'cache'),
    providersDir: path.join(root, 'config', 'providers'),
    subscriptionsFile: path.join(root, 'data', 'subscriptions.json'),
    downloadsDir: path.join(root, 'data', 'downloads'),
    logDir: path.join(root, 'logs'),
    logFile: path.join(root, 'logs', 'mihomo.log'),
    pidFile: path.join(root, 'data', 'mihomo.pid'),
    lockFile: path.join(root, 'data', 'runtime-lock.json'),
    migrationDir: path.join(root, 'data', 'migrations')
  };
}

export function detectRuntimeMode({ cwd = process.cwd() } = {}) {
  const forced = process.env.VPNCTL_MODE;
  if (forced === 'dev' || forced === 'user') return forced;

  if (isInsideProject(cwd) && fs.existsSync(SANDBOX_ROOT)) {
    return 'dev';
  }

  return 'user';
}
