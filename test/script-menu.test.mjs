import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const scriptPath = path.join(projectRoot, 'scripts', 'vpnctl.sh');
const bashAvailable = spawnSync('bash', ['--version'], { encoding: 'utf8', timeout: 5000 }).status === 0;

test('management script exposes main and classified test menus', async () => {
  const source = await fs.readFile(scriptPath, 'utf8');
  assert.match(source, /1\. 安装\\n2\. 卸载\\n3\. 测试/);
  assert.match(source, /''\) main_menu/);
  assert.match(source, /3\) test_menu; continue/);
  assert.match(source, /npm test \|\| status=\$\?/);
  assert.match(source, /\[通过\]/);
  assert.match(source, /\[失败\]/);
  assert.match(source, /\.sandbox.*\n\s*confirm/);
});

test('classified script suites reference existing tests and cover all test files', async () => {
  const source = await fs.readFile(scriptPath, 'utf8');
  const suites = [...source.matchAll(/files=\(([^)]*)\)/g)];
  const names = new Set(suites.flatMap((match) => match[1].trim().split(/\s+/).filter(Boolean)));
  for (const name of names) {
    await fs.access(path.join(projectRoot, 'test', `${name}.test.mjs`));
  }
  const actual = (await fs.readdir(path.join(projectRoot, 'test')))
    .filter((name) => name.endsWith('.test.mjs'));
  assert.deepEqual([...names].map((name) => `${name}.test.mjs`).sort(), actual.sort());
});

test('management script passes Bash syntax validation', { skip: !bashAvailable }, () => {
  const result = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
});

test('management script enters test menu, handles invalid input and returns', { skip: !bashAvailable }, () => {
  const result = spawnSync('bash', [scriptPath], {
    encoding: 'utf8', input: '3\n9\n0\n0\n', timeout: 5000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /VPNCTL 测试菜单/);
  assert.match(result.stdout, /无效选项/);
  assert.equal(result.stdout.match(/VPNCTL 管理菜单/g)?.length, 2);
});
