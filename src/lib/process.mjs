import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createConfig } from './config.mjs';
import { writeRuntimeLock, removeRuntimeLock } from './runtime-lock.mjs';

export async function ensureLogDir() {
  const config = createConfig();
  await fs.mkdir(config.mihomoDir, { recursive: true });
}

export async function fileExists(filepath) {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

export async function readPid(currentConfig = createConfig()) {
  try {
    const raw = await fs.readFile(currentConfig.pidFile, 'utf8');
    const pid = Number(raw.trim());
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

export async function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function writePid(pid, currentConfig = createConfig()) {
  await ensureLogDir();
  await fs.writeFile(currentConfig.pidFile, String(pid), 'utf8');
}

export async function removePidFile(currentConfig = createConfig()) {
  await fs.rm(currentConfig.pidFile, { force: true });
  await removeRuntimeLock(currentConfig);
}

export async function startDetached(currentConfig = createConfig()) {
  await ensureLogDir();

  const out = await fs.open(currentConfig.logFile, 'a');
  const err = await fs.open(currentConfig.logFile, 'a');

  const child = spawn(currentConfig.mihomoBin, ['-d', currentConfig.mihomoDir], {
    detached: true,
    stdio: ['ignore', out.fd, err.fd]
  });

  child.unref();
  await writePid(child.pid, currentConfig);
  await writeRuntimeLock(currentConfig, child.pid);
  await out.close();
  await err.close();
  return child.pid;
}

export async function stopByPid(pid, { force = false } = {}) {
  if (!pid) return false;
  const signal = force ? 'SIGKILL' : 'SIGTERM';
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

export async function tailLogHint() {
  const config = createConfig();
  return `tail -n 80 ${config.logFile}`;
}
