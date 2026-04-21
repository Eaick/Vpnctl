import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConfig } from './config.mjs';
import { isApiAlive } from './mihomo.mjs';
import { saveInstallState } from './install.mjs';

const BLOCK_START = '# >>> vpnctl >>>';
const BLOCK_END = '# <<< vpnctl <<<';

function shellEscapeSingle(value) {
  return String(value).replace(/'/g, `'"'"'`);
}

function getDefaultBashrcPath() {
  return path.join(process.env.HOME || os.homedir(), '.bashrc');
}

function replaceManagedBlock(content, block) {
  const pattern = new RegExp(`${BLOCK_START}[\\s\\S]*?${BLOCK_END}\\n?`, 'g');
  const cleaned = content.replace(pattern, '').replace(/\n{3,}/g, '\n\n').trimEnd();
  if (!block) {
    return cleaned ? `${cleaned}\n` : '';
  }

  return cleaned ? `${cleaned}\n\n${block}\n` : `${block}\n`;
}

export async function buildShellExports({ shell = 'bash', quiet = false } = {}) {
  const config = createConfig();
  if (shell !== 'bash' && shell !== 'sh') {
    throw new Error(`Unsupported shell=${shell}. Only bash/sh are supported.`);
  }

  const alive = await isApiAlive();
  const lines = [];

  if (alive) {
    const vars = {
      HTTP_PROXY: config.httpProxy,
      HTTPS_PROXY: config.httpProxy,
      ALL_PROXY: config.socksProxy,
      http_proxy: config.httpProxy,
      https_proxy: config.httpProxy,
      all_proxy: config.socksProxy
    };

    for (const [key, value] of Object.entries(vars)) {
      lines.push(`export ${key}='${shellEscapeSingle(value)}'`);
    }

    if (!quiet) lines.push(`echo '[proxy] mihomo detected -> proxy enabled' >&2`);
  } else {
    lines.push('unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy');
    if (!quiet) lines.push(`echo '[proxy] mihomo not running -> proxy disabled' >&2`);
  }

  return lines.join('\n');
}

export function buildManagedBashrcBlock(commandName = 'vpnctl', codexCommand = 'codex') {
  return [
    BLOCK_START,
    `vpnctl-proxy-on() { eval "$(${commandName} env --shell bash)"; }`,
    'vpnctl-proxy-off() { unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy; }',
    `vpnctl-proxy-status() { ${commandName} doctor; }`,
    `vpnctl-codex-env() { eval "$(${commandName} env --shell bash --quiet)"; }`,
    `vpnctl-codex() { vpnctl-codex-env; command ${codexCommand} "$@"; }`,
    `codex() { vpnctl-codex-env; command ${codexCommand} "$@"; }`,
    "alias vpnon='vpnctl-proxy-on'",
    "alias vpnoff='vpnctl-proxy-off'",
    "alias vpnstat='vpnctl-proxy-status'",
    "alias codexvpn='vpnctl-codex'",
    BLOCK_END
  ].join('\n');
}

export async function detectShellIntegration({ bashrcPath = getDefaultBashrcPath() } = {}) {
  try {
    const content = await fs.readFile(bashrcPath, 'utf8');
    return {
      shell: 'bash',
      bashrcPath,
      installed: content.includes(BLOCK_START) && content.includes(BLOCK_END),
      codexWrapper: content.includes('vpnctl-codex()') && content.includes('codex()')
    };
  } catch {
    return {
      shell: 'bash',
      bashrcPath,
      installed: false,
      codexWrapper: false
    };
  }
}

export async function installShellIntegration({
  shell = 'bash',
  bashrcPath = getDefaultBashrcPath(),
  commandName = 'vpnctl',
  codexCommand = 'codex',
  currentConfig = createConfig()
} = {}) {
  if (process.platform === 'win32') {
    throw new Error('Shell integration is only supported on Linux/macOS bash environments.');
  }

  if (shell !== 'bash') {
    throw new Error(`Unsupported shell=${shell}. Only bash is supported.`);
  }

  const current = await fs.readFile(bashrcPath, 'utf8').catch(() => '');
  const next = replaceManagedBlock(current, buildManagedBashrcBlock(commandName, codexCommand));
  await fs.mkdir(path.dirname(bashrcPath), { recursive: true });
  await fs.writeFile(bashrcPath, next, 'utf8');

  const nextState = {
    ...(currentConfig.installState || {}),
    shellIntegration: {
      bashrc: true,
      bashrcPath,
      codexWrapper: true
    }
  };
  await saveInstallState(currentConfig, nextState);

  return {
    shell,
    bashrcPath,
    installed: true,
    codexWrapper: true
  };
}

export async function uninstallShellIntegration({
  shell = 'bash',
  bashrcPath = getDefaultBashrcPath(),
  currentConfig = createConfig()
} = {}) {
  if (process.platform === 'win32') {
    throw new Error('Shell integration is only supported on Linux/macOS bash environments.');
  }

  if (shell !== 'bash') {
    throw new Error(`Unsupported shell=${shell}. Only bash is supported.`);
  }

  const current = await fs.readFile(bashrcPath, 'utf8').catch(() => '');
  const next = replaceManagedBlock(current, '');
  await fs.writeFile(bashrcPath, next, 'utf8');

  const nextState = {
    ...(currentConfig.installState || {}),
    shellIntegration: {
      bashrc: false,
      bashrcPath,
      codexWrapper: false
    }
  };
  await saveInstallState(currentConfig, nextState);

  return {
    shell,
    bashrcPath,
    installed: false,
    codexWrapper: false
  };
}

export async function printShellIntegration({ shell = 'bash', commandName = 'vpnctl', codexCommand = 'codex' } = {}) {
  if (shell !== 'bash') {
    throw new Error(`Unsupported shell=${shell}. Only bash is supported.`);
  }

  return buildManagedBashrcBlock(commandName, codexCommand);
}
