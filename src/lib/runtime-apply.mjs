import { createConfig } from './config.mjs';
import { isApiAlive, reloadConfig, restartKernel } from './mihomo.mjs';
import {
  readPid,
  isPidAlive,
  startDetached,
  stopByPid,
  removePidFile
} from './process.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function restartManagedProcess() {
  const pid = await readPid();
  if (await isPidAlive(pid)) {
    await stopByPid(pid, { force: false });
    await sleep(800);
    if (await isPidAlive(pid)) {
      await stopByPid(pid, { force: true });
      await sleep(300);
    }
  }

  await removePidFile();
  const nextPid = await startDetached();
  await sleep(1200);
  return nextPid;
}

export async function applyManagedConfigToRuntime(currentConfig = createConfig()) {
  const apiAlive = await isApiAlive();
  if (!apiAlive) {
    return {
      applied: false,
      mode: 'none',
      fallbackUsed: false,
      message: 'mihomo 未运行，配置已写入磁盘'
    };
  }

  try {
    await reloadConfig('');
    return {
      applied: true,
      mode: 'reload',
      fallbackUsed: false,
      message: '已热重载 mihomo'
    };
  } catch (reloadError) {
    const pid = await readPid();

    if (await isPidAlive(pid)) {
      await restartManagedProcess();
      return {
        applied: true,
        mode: 'restart',
        fallbackUsed: true,
        message: `热重载失败，已自动重启 mihomo: ${reloadError.message || String(reloadError)}`
      };
    }

    await restartKernel().catch(() => {});
    return {
      applied: true,
      mode: 'restart',
      fallbackUsed: true,
      message: `热重载失败，已请求 mihomo 自重启: ${reloadError.message || String(reloadError)}`
    };
  }
}
