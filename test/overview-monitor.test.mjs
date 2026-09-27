import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMemory, getLocalIPv4, loadOverviewMetrics } from '../src/lib/overview-monitor.mjs';

test('local IPv4 ignores loopback and memory formats safely', () => {
  assert.equal(getLocalIPv4({
    lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.8' }]
  }), '192.168.1.8');
  assert.equal(getLocalIPv4({
    tun: [{ family: 'IPv4', internal: false, address: '198.18.0.1' }],
    eth0: [{ family: 'IPv4', internal: false, address: '10.0.0.8' }]
  }), '10.0.0.8');
  assert.equal(formatMemory(1048576), '1.0 MB');
  assert.equal(formatMemory(null), '未知');
});

test('offline overview does not probe any external endpoint', async () => {
  const metrics = await loadOverviewMetrics({}, { apiAlive: false });
  assert.equal(metrics.network, '未检测');
  assert.equal(metrics.proxyIp, '');
  assert.equal(metrics.connections, null);
  assert.equal(metrics.mihomoMemory, null);
});
