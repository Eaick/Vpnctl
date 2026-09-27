import fs from 'node:fs/promises';
import os from 'node:os';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { api } from './mihomo.mjs';

const execFileAsync = promisify(execFile);

export function getLocalIPv4(interfaces = os.networkInterfaces()) {
  const candidates = [];
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if ((address.family === 'IPv4' || address.family === 4) && !address.internal) {
        candidates.push(address.address);
      }
    }
  }
  return candidates.find((address) => /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(address))
    || candidates.find((address) => !/^198\.(18|19)\./.test(address))
    || candidates[0]
    || '';
}

export function formatMemory(bytes) {
  return Number.isFinite(bytes) && bytes >= 0 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '未知';
}

async function getProcessMemory(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === 'linux') {
      const status = await fs.readFile(`/proc/${pid}/status`, 'utf8');
      const kilobytes = Number(status.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1]);
      return Number.isFinite(kilobytes) ? kilobytes * 1024 : null;
    }
    if (process.platform === 'win32') {
      const script = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($p) { $p.WorkingSetSize }`;
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        timeout: 5000, windowsHide: true
      });
      const bytes = Number(stdout.trim());
      return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
    }
  } catch {
    return null;
  }
  return null;
}

async function runProxyCurl(proxy, args) {
  const { stdout } = await execFileAsync('curl', [
    '--silent', '--show-error', '--max-time', '5', '--noproxy', '', '--proxy', proxy, ...args
  ], { timeout: 7000, windowsHide: true, maxBuffer: 4096 });
  return stdout.trim();
}

export async function loadOverviewMetrics(config, status) {
  const metrics = {
    localIp: getLocalIPv4(),
    proxyIp: '',
    network: '未检测',
    networkDelayMs: null,
    connections: null,
    vpnctlMemory: process.memoryUsage().rss,
    mihomoMemory: null
  };
  if (!status.apiAlive) return metrics;

  const results = await Promise.allSettled([
    getProcessMemory(status.pid),
    api('/connections', { signal: AbortSignal.timeout(3000) }, config),
    runProxyCurl(config.httpProxy, ['https://api.ipify.org']),
    runProxyCurl(config.httpProxy, ['--output', os.devNull, '--write-out', '%{http_code} %{time_total}', 'https://cp.cloudflare.com/generate_204'])
  ]);

  if (results[0].status === 'fulfilled') metrics.mihomoMemory = results[0].value;
  if (results[1].status === 'fulfilled') {
    metrics.connections = results[1].value?.connections?.length ?? null;
    metrics.mihomoMemory ??= results[1].value?.memory ?? null;
  }
  if (results[2].status === 'fulfilled' && net.isIP(results[2].value)) metrics.proxyIp = results[2].value;
  if (results[3].status === 'fulfilled') {
    const [code, seconds] = results[3].value.split(/\s+/);
    metrics.network = code === '204' ? '正常' : `HTTP ${code || '未知'}`;
    const delay = Number(seconds);
    if (Number.isFinite(delay)) metrics.networkDelayMs = Math.round(delay * 1000);
  } else {
    metrics.network = results[3].reason?.code === 'ENOENT' ? '缺少 curl' : '不可达';
  }
  return metrics;
}
