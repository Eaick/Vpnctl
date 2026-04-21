import net from 'node:net';
import { URL } from 'node:url';

function normalizeLocalHost(hostname, fallbackHost = '127.0.0.1') {
  return hostname || fallbackHost;
}

function parseEndpoint(value, fallbackProtocol, fallbackPort) {
  const url = new URL(value);
  return {
    protocol: url.protocol || fallbackProtocol,
    host: normalizeLocalHost(url.hostname),
    port: Number(url.port || fallbackPort)
  };
}

function isValidPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function normalizePortOverrides(ports = {}) {
  const normalized = {};

  for (const [key, value] of Object.entries(ports)) {
    if (value === undefined || value === null || value === '') continue;
    const numeric = Number(value);
    if (!isValidPort(numeric)) {
      throw new Error(`Invalid ${key} port: ${value}`);
    }
    normalized[key] = numeric;
  }

  return normalized;
}

async function canListen(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    server.listen({ host, port, exclusive: true });
  });
}

export function getConfiguredPortPlan(config) {
  return {
    api: parseEndpoint(config.mihomoApi, 'http:', 9090),
    http: parseEndpoint(config.httpProxy, 'http:', 7890),
    socks: parseEndpoint(config.socksProxy, 'socks5:', 7891)
  };
}

export function buildPortPlan(config, overrides = {}) {
  const current = getConfiguredPortPlan(config);
  const normalized = normalizePortOverrides(overrides);

  return {
    http: {
      ...current.http,
      port: normalized.http || current.http.port
    },
    socks: {
      ...current.socks,
      port: normalized.socks || current.socks.port
    },
    api: {
      ...current.api,
      port: normalized.api || current.api.port
    }
  };
}

export async function probePortPlan(plan) {
  const results = {};
  for (const [key, endpoint] of Object.entries(plan)) {
    results[key] = {
      ...endpoint,
      available: await canListen(endpoint.host, endpoint.port)
    };
  }
  return results;
}

export async function probeConfiguredPortPlan(config) {
  return probePortPlan(getConfiguredPortPlan(config));
}

export async function findAvailablePortPlan(config, { maxOffset = 5, preferredPorts = null } = {}) {
  const current = preferredPorts ? buildPortPlan(config, preferredPorts) : getConfiguredPortPlan(config);
  const socksDelta = current.socks.port - current.http.port;
  const apiDelta = current.api.port - current.http.port;

  for (let offset = 0; offset <= maxOffset; offset += 1) {
    const shift = offset * 10000;
    const candidate = {
      http: {
        ...current.http,
        port: current.http.port + shift
      },
      socks: {
        ...current.socks,
        port: current.http.port + shift + socksDelta
      },
      api: {
        ...current.api,
        port: current.http.port + shift + apiDelta
      }
    };

    if (!Object.values(candidate).every((endpoint) => isValidPort(endpoint.port))) {
      continue;
    }

    const probed = await probePortPlan(candidate);
    if (Object.values(probed).every((endpoint) => endpoint.available)) {
      return probed;
    }
  }

  return null;
}

export function listBusyEndpoints(plan) {
  return Object.entries(plan)
    .filter(([, endpoint]) => !endpoint.available)
    .map(([name, endpoint]) => ({ name, ...endpoint }));
}

export function buildPortEnvSnippet(plan) {
  return [
    `export MIHOMO_API="http://${plan.api.host}:${plan.api.port}"`,
    `export MIHOMO_HTTP_PROXY="http://${plan.http.host}:${plan.http.port}"`,
    `export MIHOMO_SOCKS_PROXY="socks5://${plan.socks.host}:${plan.socks.port}"`
  ].join('\n');
}

export function getPortSourceLabel(source = 'default') {
  if (source === 'custom') return 'custom';
  if (source === 'auto') return 'auto';
  if (source === 'migrated') return 'migrated';
  return 'default';
}
