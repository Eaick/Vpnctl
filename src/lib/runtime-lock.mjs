import fs from 'node:fs/promises';
import path from 'node:path';
import { createConfig } from './config.mjs';
import { getKnownRuntimeRoots, buildRuntimePaths } from './runtime.mjs';
import { getConfiguredPortPlan } from './ports.mjs';

function normalize(filepath) {
  return path.resolve(filepath).replace(/\\/g, '/');
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filepath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filepath, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function readRuntimeLock(currentConfig = createConfig()) {
  return readJson(currentConfig.lockFile, null);
}

export async function writeRuntimeLock(currentConfig = createConfig(), pid = null) {
  const ports = getConfiguredPortPlan(currentConfig);
  const payload = {
    pid,
    mode: currentConfig.mode,
    proxyMode: currentConfig.proxyMode,
    root: normalize(currentConfig.paths.root),
    lockFile: normalize(currentConfig.lockFile),
    writtenAt: new Date().toISOString(),
    portSource: currentConfig.portSource,
    ports: Object.fromEntries(
      Object.entries(ports)
        .filter(([key, value]) => key !== 'mode' && value?.port)
        .map(([key, value]) => [key, value.port])
    )
  };

  await fs.mkdir(path.dirname(currentConfig.lockFile), { recursive: true });
  await fs.writeFile(currentConfig.lockFile, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

export async function removeRuntimeLock(currentConfig = createConfig()) {
  await fs.rm(currentConfig.lockFile, { force: true });
}

export async function listKnownRuntimeLocks() {
  const locks = [];

  for (const root of getKnownRuntimeRoots()) {
    const lockFile = buildRuntimePaths(normalize(root) === normalize(buildRuntimePaths('dev').root) ? 'dev' : 'user').lockFile;
    const payload = await readJson(lockFile, null);
    if (!payload) continue;

    if (!isProcessAlive(payload.pid)) {
      await fs.rm(lockFile, { force: true }).catch(() => {});
      continue;
    }

    locks.push(payload);
  }

  return locks;
}
