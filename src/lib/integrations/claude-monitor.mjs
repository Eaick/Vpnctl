import fs from 'node:fs/promises';
import path from 'node:path';
import { claudePaths, readPrivateSnapshot, replacePrivateFile, withClaudeLock, encode } from './claude.mjs';

function location(env) {
  const { dir } = claudePaths(env);
  return { dir, file: path.join(dir, '.vpnctl-requests.json'), lockPath: path.join(dir, '.vpnctl-requests.lock') };
}
export async function readClaudeRequests({ env = process.env } = {}) {
  const snapshot = await readPrivateSnapshot(location(env).file, fs);
  const entries = snapshot.exists ? JSON.parse(snapshot.text) : [];
  if (!Array.isArray(entries) || entries.length > 100) throw new Error('请求统计文件无效');
  return entries;
}
export async function recordClaudeRequest(record, { env = process.env } = {}) {
  const where = location(env);
  return withClaudeLock(where, fs, async () => {
    const snapshot = await readPrivateSnapshot(where.file, fs);
    const entries = snapshot.exists ? JSON.parse(snapshot.text) : [];
    if (!Array.isArray(entries)) throw new Error('请求统计文件无效');
    const safe = { sampledAt: new Date().toISOString() };
    for (const key of ['providerName', 'model']) safe[key] = typeof record[key] === 'string'
      ? record[key].replace(/[\x00-\x1f\x7f]/g, '').slice(0, 256) : '';
    for (const key of ['status', 'durationMs', 'firstByteMs', 'inputTokens', 'outputTokens']) {
      safe[key] = Number.isSafeInteger(record[key]) && record[key] >= 0 ? record[key] : null;
    }
    safe.protocol = ['anthropic', 'openai-chat', 'openai-responses'].includes(record.protocol) ? record.protocol : 'unknown';
    await replacePrivateFile(where.file, encode([...entries.slice(-99), safe]), snapshot, fs);
  });
}
