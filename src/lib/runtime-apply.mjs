import { createConfig } from './config.mjs';
import { reloadConfig } from './mihomo.mjs';
import {
  readPid,
  isPidAlive,
  startDetached,
  stopManagedRuntime
} from './process.mjs';
import { getManagedRuntimeStatus } from './managed-runtime.mjs';
import { setConfiguredPorts, saveInstallState } from './install.mjs';
import { writeManagedConfig } from './subscriptions.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function restartManagedProcess(currentConfig = createConfig()) {
  await stopManagedRuntime(currentConfig);
  const nextPid = await startDetached(currentConfig);
  await waitForManagedRuntime(currentConfig);
  return nextPid;
}

async function waitForManagedRuntime(currentConfig, attempts = 15) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if ((await getManagedRuntimeStatus(currentConfig)).managedApiAlive) return;
    await sleep(300);
  }
  throw new Error('mihomo 启动后未在新 API 端口就绪');
}

export async function configureRuntimePorts(options = {}) {
  const previousConfig = createConfig(options.mode);
  const previousStatus = await getManagedRuntimeStatus(previousConfig);
  const oldState = previousConfig.installState;
  let stopped = false;
  let changed = false;

  try {
    if (previousStatus.pidAlive) {
      await stopManagedRuntime(previousConfig);
      stopped = true;
    }

    const result = await setConfiguredPorts(options);
    changed = true;
    await writeManagedConfig(result.config);

    if (!stopped) return { ...result, applied: false };

    await startDetached(result.config);
    await waitForManagedRuntime(result.config);
    return { ...result, applied: true };
  } catch (error) {
    try {
      if (changed) {
        const nextConfig = createConfig(previousConfig.mode);
        const nextStatus = await getManagedRuntimeStatus(nextConfig);
        if (nextStatus.pidAlive) await stopManagedRuntime(nextConfig);
      }

      if (changed && oldState) {
        await saveInstallState(previousConfig, oldState);
        await writeManagedConfig(createConfig(previousConfig.mode));
      }

      if (stopped) {
        await startDetached(previousConfig);
        await waitForManagedRuntime(previousConfig);
      }
    } catch (restoreError) {
      throw new Error(`${error.message}；恢复旧端口失败：${restoreError.message}`, { cause: error });
    }
    throw error;
  }
}

export async function applyManagedConfigToRuntime(currentConfig = createConfig()) {
  const runtimeStatus = await getManagedRuntimeStatus(currentConfig);
  if (!runtimeStatus.managedApiAlive) {
    return {
      applied: false,
      mode: 'none',
      fallbackUsed: false,
      message: runtimeStatus.foreignApiAlive
        ? '检测到其他账户的 mihomo 占用了当前 API 端口，未应用到本账户运行态'
        : 'mihomo 未运行，配置已写入磁盘'
    };
  }

  try {
    await reloadConfig('', currentConfig);
    return {
      applied: true,
      mode: 'reload',
      fallbackUsed: false,
      message: '已热重载 mihomo'
    };
  } catch (reloadError) {
    const pid = await readPid(currentConfig);
    if (await isPidAlive(pid)) {
      await restartManagedProcess(currentConfig);
      return {
        applied: true,
        mode: 'restart',
        fallbackUsed: true,
        message: `热重载失败，已自动重启 mihomo: ${reloadError.message || String(reloadError)}`
      };
    }

    throw new Error(`热重载失败且托管进程已退出：${reloadError.message || String(reloadError)}`, { cause: reloadError });
  }
}
