import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('offline port changes use one shared workflow and write only the selected mode', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vpnctl-port-change-'));
  const uniquePorts = new Set();
  while (uniquePorts.size < 4) uniquePorts.add(await freePort());
  const [mixed, http, socks, api] = uniquePorts;
  const ports = { mixed, http, socks, api };
  const script = `
    import fs from 'node:fs/promises';
    import YAML from 'yaml';
    import { configureRuntimePorts } from './src/lib/runtime-apply.mjs';
    const ports = ${JSON.stringify(ports)};
    const mixed = await configureRuntimePorts({ mode: 'user', proxyMode: 'mix', ports: { mixed: ports.mixed, api: ports.api } });
    const separate = await configureRuntimePorts({ mode: 'user', proxyMode: 'separate', ports: { http: ports.http, socks: ports.socks, api: ports.api } });
    const doc = YAML.parse(await fs.readFile(separate.config.generatedConfigFile, 'utf8'));
    console.log(JSON.stringify({ mixed: mixed.config.ports, separate: separate.config.ports, applied: separate.applied, doc }));
  `;
  try {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        VPNCTL_MODE: 'user',
        MIHOMO_API: '',
        MIHOMO_HTTP_PROXY: '',
        MIHOMO_SOCKS_PROXY: ''
      }
    });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout.trim());
    assert.equal(result.mixed.mixed, ports.mixed);
    assert.equal(result.separate.http, ports.http);
    assert.equal(result.separate.socks, ports.socks);
    assert.equal(result.applied, false);
    assert.equal(result.doc.port, ports.http);
    assert.equal(result.doc['socks-port'], ports.socks);
    assert.equal(result.doc['mixed-port'], undefined);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
