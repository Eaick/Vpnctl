import net from 'node:net';
import { URL } from 'node:url';

export function getPortKeys(proxyMode = 'mix') {
  return proxyMode === 'separate' ? ['http', 'socks', 'api'] : ['mixed', 'api'];
}

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
  const base = {
    mode: config.proxyMode
  };

  if (config.proxyMode === 'separate') {
    return {
      ...base,
      api: parseEndpoint(config.mihomoApi, 'http:', 9090),
      http: parseEndpoint(config.httpProxy, 'http:', 7890),
      socks: parseEndpoint(config.socksProxy, 'socks5:', 7891)
    };
  }

  return {
    ...base,
    api: parseEndpoint(config.mihomoApi, 'http:', 9090),
    mixed: parseEndpoint(config.httpProxy, 'http:', 7890)
  };
}

export function buildPortPlan(config, overrides = {}, proxyMode = config.proxyMode) {
  const current = getConfiguredPortPlan(config);
  const normalized = normalizePortOverrides(overrides);
  const mode = proxyMode || current.mode || 'mix';

  if (mode === 'separate') {
    return {
      mode,
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

  return {
    mode,
    mixed: {
      ...(current.mixed || current.http),
      port: normalized.mixed || normalized.http || current.mixed?.port || current.http.port
    },
    api: {
      ...current.api,
      port: normalized.api || current.api.port
    }
  };
}

export async function probePortPlan(plan) {
  const results = { mode: plan.mode };
  for (const key of getPortKeys(plan.mode)) {
    const endpoint = plan[key];
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

export async function findAvailablePortPlan(config, { maxOffset = 5, preferredPorts = null, proxyMode = config.proxyMode } = {}) {
  const mode = proxyMode || config.proxyMode || 'mix';
  const current = preferredPorts ? buildPortPlan(config, preferredPorts, mode) : getConfiguredPortPlan(config);

  if (mode === 'separate') {
    const socksDelta = current.socks.port - current.http.port;
    const apiDelta = current.api.port - current.http.port;

    for (let offset = 0; offset <= maxOffset; offset += 1) {
      const shift = offset * 10000;
      const candidate = {
        mode,
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

      if (!Object.values(candidate).filter((item) => item && item.port).every((endpoint) => isValidPort(endpoint.port))) {
        continue;
      }

      const probed = await probePortPlan(candidate);
      if (getPortKeys(mode).every((key) => probed[key].available)) {
        return probed;
      }
    }

    return null;
  }

  const apiDelta = current.api.port - current.mixed.port;
  for (let offset = 0; offset <= maxOffset; offset += 1) {
    const shift = offset * 10000;
    const candidate = {
      mode,
      mixed: {
        ...current.mixed,
        port: current.mixed.port + shift
      },
      api: {
        ...current.api,
        port: current.mixed.port + shift + apiDelta
      }
    };

    if (!getPortKeys(mode).every((key) => isValidPort(candidate[key].port))) {
      continue;
    }

    const probed = await probePortPlan(candidate);
    if (getPortKeys(mode).every((key) => probed[key].available)) {
      return probed;
    }
  }

  return null;
}

export function listBusyEndpoints(plan) {
  return getPortKeys(plan.mode)
    .filter((key) => !plan[key].available)
    .map((name) => ({ name, ...plan[name] }));
}

export function buildPortEnvSnippet(plan) {
  const lines = [`export MIHOMO_API="http://${plan.api.host}:${plan.api.port}"`];

  if (plan.mode === 'separate') {
    lines.push(`export MIHOMO_HTTP_PROXY="http://${plan.http.host}:${plan.http.port}"`);
    lines.push(`export MIHOMO_SOCKS_PROXY="socks5://${plan.socks.host}:${plan.socks.port}"`);
  } else {
    lines.push(`export MIHOMO_HTTP_PROXY="http://${plan.mixed.host}:${plan.mixed.port}"`);
    lines.push(`export MIHOMO_SOCKS_PROXY="socks5://${plan.mixed.host}:${plan.mixed.port}"`);
  }

  return lines.join('\n');
}

export function getPortSourceLabel(source = 'default') {
  if (source === 'custom') return 'custom';
  if (source === 'auto') return 'auto';
  if (source === 'migrated') return 'migrated';
  return 'default';
}
