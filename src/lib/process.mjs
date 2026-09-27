import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createConfig } from './config.mjs';
import { writeRuntimeLock, readRuntimeLock, removeRuntimeLock } from './runtime-lock.mjs';
import { getProcessIdentity, matchesManagedProcess } from './process-identity.mjs';

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
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export async function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
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

  try {
    await new Promise((resolve, reject) => {
      const onSpawn = () => {
        child.off('error', onError);
        resolve();
      };
      const onError = (error) => {
        child.off('spawn', onSpawn);
        reject(error);
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });
  } catch (error) {
    await out.close();
    await err.close();
    throw error;
  }
  child.unref();
  await writePid(child.pid, currentConfig);
  await writeRuntimeLock(currentConfig, child.pid, await getProcessIdentity(child.pid));
  await out.close();
  await err.close();
  return child.pid;
}

export async function stopByPid(pid, { force = false } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const signal = force ? 'SIGKILL' : 'SIGTERM';
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

export async function stopManagedRuntime(currentConfig = createConfig()) {
  const pid = await readPid(currentConfig);
  if (!pid) return { stopped: false, stale: false, pid: null };
  if (!(await isPidAlive(pid))) {
    await removePidFile(currentConfig);
    return { stopped: false, stale: true, pid };
  }

  const lock = await readRuntimeLock(currentConfig);
  if (!(await matchesManagedProcess(pid, currentConfig, lock))) {
    throw new Error(`拒绝停止 PID ${pid}：无法确认它是本账户的 mihomo 进程`);
  }

  await stopByPid(pid);
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (await matchesManagedProcess(pid, currentConfig, lock)) {
    await stopByPid(pid, { force: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (await matchesManagedProcess(pid, currentConfig, lock)) {
    throw new Error(`mihomo 未停止：PID ${pid}`);
  }

  await removePidFile(currentConfig);
  return { stopped: true, stale: false, pid };
}

export async function tailLogHint() {
  const config = createConfig();
  return `tail -n 80 ${config.logFile}`;
}
