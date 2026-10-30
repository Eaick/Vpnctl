import net from 'node:net';

export const unbracketHost = host => String(host || '').replace(/^\[|\]$/g, '');
export function hostPort(host, port) {
  const value = unbracketHost(host);
  return `${net.isIP(value) === 6 ? `[${value}]` : value}:${port}`;
}
export const endpointUrl = (protocol, host, port) => `${protocol}://${hostPort(host, port)}`;
