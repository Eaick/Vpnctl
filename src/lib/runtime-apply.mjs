import { createConfig } from './config.mjs';
import { reloadConfig, restartKernel } from './mihomo.mjs';
import {
  readPid,
  isPidAlive,
  startDetached,
  stopByPid,
  removePidFile
} from './process.mjs';
import { getManagedRuntimeStatus } from './managed-runtime.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function restartManagedProcess(currentConfig = createConfig()) {
  const pid = await readPid(currentConfig);
  if (await isPidAlive(pid)) {
    await stopByPid(pid, { force: false });
    await sleep(800);
    if (await isPidAlive(pid)) {
      await stopByPid(pid, { force: true });
      await sleep(300);
    }
  }

  await removePidFile(currentConfig);
  const nextPid = await startDetached(currentConfig);
  await sleep(1200);
  return nextPid;
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

    await restartKernel(currentConfig).catch(() => {});
    return {
      applied: true,
      mode: 'restart',
      fallbackUsed: true,
      message: `热重载失败，已请求 mihomo 自行重启: ${reloadError.message || String(reloadError)}`
    };
  }
}
