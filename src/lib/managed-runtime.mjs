import path from 'node:path';
import { createConfig } from './config.mjs';
import { getConfiguredPortPlan } from './ports.mjs';
import { readPid, isPidAlive } from './process.mjs';
import { readRuntimeLock } from './runtime-lock.mjs';
import { isApiAlive } from './mihomo.mjs';
import { matchesManagedProcess } from './process-identity.mjs';

function normalize(filepath) {
  return path.resolve(filepath).replace(/\\/g, '/');
}

function buildExpectedPorts(currentConfig) {
  const plan = getConfiguredPortPlan(currentConfig);
  return Object.fromEntries(
    Object.entries(plan)
      .filter(([key, value]) => key !== 'mode' && value?.port)
      .map(([key, value]) => [key, value.port])
  );
}

function isLockOwnedByCurrentRuntime(lock, currentConfig, pid) {
  if (!lock) return false;

  const expectedPorts = buildExpectedPorts(currentConfig);
  const actualPorts = lock.ports || {};

  return lock.pid === pid
    && normalize(lock.root || '') === normalize(currentConfig.paths.root)
    && normalize(lock.lockFile || '') === normalize(currentConfig.lockFile)
    && lock.mode === currentConfig.mode
    && lock.proxyMode === currentConfig.proxyMode
    && JSON.stringify(actualPorts) === JSON.stringify(expectedPorts);
}

export async function getManagedRuntimeStatus(currentConfig = createConfig()) {
  const pid = await readPid(currentConfig);
  const pidAlive = await isPidAlive(pid);
  const runtimeLock = await readRuntimeLock(currentConfig);
  const lockOwned = isLockOwnedByCurrentRuntime(runtimeLock, currentConfig, pid);
  const processOwned = pidAlive && lockOwned
    ? await matchesManagedProcess(pid, currentConfig, runtimeLock)
    : false;
  const apiReachable = await isApiAlive(currentConfig);
  const managedApiAlive = Boolean(apiReachable && processOwned);

  return {
    pid,
    pidAlive,
    runtimeLock,
    lockOwned,
    processOwned,
    apiReachable,
    managedApiAlive,
    foreignApiAlive: Boolean(apiReachable && !managedApiAlive)
  };
}

export async function isManagedRuntimeActive(currentConfig = createConfig()) {
  return (await getManagedRuntimeStatus(currentConfig)).managedApiAlive;
}
