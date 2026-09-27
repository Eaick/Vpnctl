import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);

function normalize(value) {
  const resolved = path.resolve(value).replace(/\\/g, '/');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export async function getProcessIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;

  try {
    if (process.platform === 'linux') {
      const [executable, commandLine, stat] = await Promise.all([
        fs.readlink(`/proc/${pid}/exe`),
        fs.readFile(`/proc/${pid}/cmdline`, 'utf8'),
        fs.readFile(`/proc/${pid}/stat`, 'utf8')
      ]);
      const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
      return {
        executable,
        commandLine: commandLine.split('\0').filter(Boolean),
        startedAt: fields[19]
      };
    }

    if (process.platform === 'win32') {
      const script = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($p) { $p | Select-Object ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress }`;
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command', script
      ], { timeout: 5000, windowsHide: true });
      if (!stdout.trim()) return null;
      const info = JSON.parse(stdout);
      return {
        executable: info.ExecutablePath,
        commandLine: info.CommandLine || '',
        startedAt: info.CreationDate
      };
    }
  } catch {
    return null;
  }

  return null;
}

export async function matchesManagedProcess(pid, currentConfig, lock) {
  if (!lock || lock.pid !== pid || normalize(lock.root || '') !== normalize(currentConfig.paths.root)) {
    return false;
  }

  const identity = await getProcessIdentity(pid);
  if (!identity?.executable || !identity.startedAt) return false;

  const [actualBinary, expectedBinary] = await Promise.all([
    fs.realpath(identity.executable).catch(() => identity.executable),
    fs.realpath(currentConfig.mihomoBin).catch(() => currentConfig.mihomoBin)
  ]);
  if (normalize(actualBinary) !== normalize(expectedBinary)) return false;
  if (lock.startedAt && lock.startedAt !== identity.startedAt) return false;

  const expectedDir = normalize(currentConfig.mihomoDir);
  if (Array.isArray(identity.commandLine)) {
    const index = identity.commandLine.indexOf('-d');
    return index >= 0 && identity.commandLine[index + 1]
      && normalize(identity.commandLine[index + 1]) === expectedDir;
  }
  const match = identity.commandLine.match(/(?:^|\s)-d\s+(?:"([^"]+)"|(\S+))/);
  return Boolean(match && normalize(match[1] || match[2]) === expectedDir);
}
