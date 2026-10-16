import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createConfig } from './config.mjs';
import { isManagedRuntimeActive } from './managed-runtime.mjs';
import { saveInstallState } from './install.mjs';
import { uninstallClaudeSettings } from './integrations/claude.mjs';
import { restoreClaudeProviders } from './integrations/claude-providers.mjs';

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

export async function buildShellExports({ shell = 'bash', quiet = false, app } = {}) {
  const config = createConfig();
  if (shell !== 'bash' && shell !== 'sh') {
    throw new Error(`Unsupported shell=${shell}. Only bash/sh are supported.`);
  }

  const alive = await isManagedRuntimeActive(config);
  if (app && app !== 'codex' && app !== 'claude') throw new Error('应用只支持 codex 或 claude');
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
    if (app) {
      delete vars.ALL_PROXY;
      delete vars.all_proxy;
      lines.push('unset ALL_PROXY all_proxy');
    }

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
    `vpnctl-codex-env() { eval "$(${commandName} env --shell bash --app codex --quiet)"; }`,
    codexCommand === 'codex'
      ? `vpnctl-codex() { command ${commandName} integrate codex run -- "$@"; }`
      : `vpnctl-codex() { vpnctl-codex-env; command ${codexCommand} "$@"; }`,
    'codex() { vpnctl-codex "$@"; }',
    `vpnctl-claude-env() { eval "$(${commandName} env --shell bash --app claude --quiet)"; }`,
    `vpnctl-claude() { command ${commandName} integrate claude run -- "$@"; }`,
    'claude() { vpnctl-claude "$@"; }',
    "alias vpnon='vpnctl-proxy-on'",
    "alias vpnoff='vpnctl-proxy-off'",
    "alias vpnstat='vpnctl-proxy-status'",
    "alias codexvpn='vpnctl-codex'",
    "alias claudevpn='vpnctl-claude'",
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
      codexWrapper: content.includes('vpnctl-codex()') && content.includes('codex()'),
      claudeWrapper: content.includes('vpnctl-claude()') && content.includes('claude()')
    };
  } catch {
    return {
      shell: 'bash',
      bashrcPath,
      installed: false,
      codexWrapper: false,
      claudeWrapper: false
    };
  }
}

async function writeShellFile(filepath, before, after) {
  if (before === after) return;
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  const stat = await fs.lstat(filepath).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
  if (stat && (!stat.isFile() || stat.nlink > 1 || (process.getuid && stat.uid !== process.getuid()))) throw new Error('bashrc 文件不是本账户的普通独立文件，拒绝修改');
  const lockPath = `${filepath}.vpnctl.lock`;
  const lock = await fs.open(lockPath, 'wx', 0o600).catch(() => { throw new Error('bashrc 正在被其他集成操作修改，请稍后重试'); });
  const temporary = `${filepath}.vpnctl-${randomUUID()}.tmp`;
  try {
    const current = await fs.readFile(filepath, 'utf8').catch((error) => { if (error.code !== 'ENOENT') throw error; return ''; });
    if (current !== before) throw new Error('bashrc 已被修改，请重新预览安装或卸载');
    if (stat) await fs.writeFile(`${filepath}.vpnctl-backup-${randomUUID()}`, before, { flag: 'wx', mode: 0o600 });
    await fs.writeFile(temporary, after, { flag: 'wx', mode: stat ? stat.mode & 0o777 : 0o600 });
    await fs.rename(temporary, filepath);
  } finally {
    await fs.rm(temporary, { force: true });
    await lock.close();
    await fs.rm(lockPath, { force: true });
  }
}

export async function installShellIntegration({
  shell = 'bash',
  bashrcPath = getDefaultBashrcPath(),
  commandName = 'vpnctl',
  codexCommand = 'codex',
  currentConfig = createConfig(),
  platform = process.platform
} = {}) {
  if (platform === 'win32') {
    throw new Error('Shell integration is only supported on Linux/macOS bash environments.');
  }

  if (shell !== 'bash') {
    throw new Error(`Unsupported shell=${shell}. Only bash is supported.`);
  }

  const current = await fs.readFile(bashrcPath, 'utf8').catch(() => '');
  const next = replaceManagedBlock(current, buildManagedBashrcBlock(commandName, codexCommand));
  await writeShellFile(bashrcPath, current, next);

  const nextState = {
    ...(currentConfig.installState || {}),
    shellIntegration: {
      bashrc: true,
      bashrcPath,
      codexWrapper: true,
      claudeWrapper: true
    }
  };
  await saveInstallState(currentConfig, nextState);

  return {
    shell,
    bashrcPath,
    installed: true,
    codexWrapper: true,
    claudeWrapper: true
  };
}

export async function uninstallShellIntegration({
  shell = 'bash',
  bashrcPath = getDefaultBashrcPath(),
  currentConfig = createConfig(),
  platform = process.platform
} = {}) {
  if (platform === 'win32') {
    throw new Error('Shell integration is only supported on Linux/macOS bash environments.');
  }

  if (shell !== 'bash') {
    throw new Error(`Unsupported shell=${shell}. Only bash is supported.`);
  }

  const current = await fs.readFile(bashrcPath, 'utf8').catch(() => '');
  const next = replaceManagedBlock(current, '');
  await restoreClaudeProviders({ confirmed: true });
  const claudeCleanup = await uninstallClaudeSettings({ confirmed: true });
  if (!claudeCleanup.ok) throw new Error(claudeCleanup.detail || '无法安全恢复 Claude 受管代理字段，未卸载 Shell 集成');
  await writeShellFile(bashrcPath, current, next);

  const nextState = {
    ...(currentConfig.installState || {}),
    shellIntegration: {
      bashrc: false,
      bashrcPath,
      codexWrapper: false,
      claudeWrapper: false
    }
  };
  await saveInstallState(currentConfig, nextState);

  return {
    shell,
    bashrcPath,
    installed: false,
    codexWrapper: false,
    claudeWrapper: false,
    claudeCleanup
  };
}

export async function printShellIntegration({ shell = 'bash', commandName = 'vpnctl', codexCommand = 'codex' } = {}) {
  if (shell !== 'bash') {
    throw new Error(`Unsupported shell=${shell}. Only bash is supported.`);
  }

  return buildManagedBashrcBlock(commandName, codexCommand);
}
