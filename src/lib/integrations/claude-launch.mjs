import { readClaudeProviderStore, claudeProviderEnvironment } from './claude-providers.mjs';
import { startClaudeGateway } from './claude-gateway.mjs';
import { recordClaudeRequest } from './claude-monitor.mjs';

export async function prepareClaudeLaunch({ env = process.env, proxy = null } = {}) {
  const { value } = await readClaudeProviderStore({ env });
  const profile = value.applied?.profile;
  const result = await claudeProviderEnvironment({ env });
  if (!profile) return { env: result, close: async () => {} };
  const mappings = { model: 'ANTHROPIC_MODEL', sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL', opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', subagent: 'CLAUDE_CODE_SUBAGENT_MODEL' };
  for (const [field, key] of Object.entries(mappings)) {
    if (profile[field]) result[key] = profile[field]; else delete result[key];
  }
  const gateway = await startClaudeGateway({ profile, proxy, onRecord: record => recordClaudeRequest(record, { env }) });
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) delete result[key];
  result.ANTHROPIC_BASE_URL = gateway.baseUrl;
  result.ANTHROPIC_AUTH_TOKEN = gateway.token;
  const bypass = ['127.0.0.1', 'localhost', '::1'];
  for (const key of ['NO_PROXY', 'no_proxy']) result[key] = [...new Set([...(result[key] || '').split(',').filter(Boolean), ...bypass])].join(',');
  return { env: result, close: gateway.close };
}
