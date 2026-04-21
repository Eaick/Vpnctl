import process from 'node:process';
import { createConfig } from './config.mjs';
import { fileExists } from './process.mjs';

function buildInstallSteps(platform) {
  if (platform === 'win32') {
    return [
      'Windows 本机建议先走开发沙箱，不要直接复用你现有 Clash 或 mihomo 的目录。',
      '本地测试优先运行 vpnctl dev init；确认稳定后再运行 vpnctl init。',
      '如果 7890/7891 已被 Clash 占用，请为 mihomo 单独准备端口，并同步设置 MIHOMO_API、MIHOMO_HTTP_PROXY、MIHOMO_SOCKS_PROXY。'
    ];
  }

  if (platform === 'darwin') {
    return [
      '当前内核自动安装主要面向 Windows x64 和 Linux x64；macOS 建议先手动准备内核。',
      '如果需要正式运行目录，请先执行 vpnctl init。',
      '也可以先用开发模式验证流程，再决定是否进入正式安装。'
    ];
  }

  return [
    'Linux/SSH 服务器建议先执行 vpnctl init，确保运行目录、端口和订阅存储已准备好。',
    '如果你只是做本地演练，可以优先执行 vpnctl dev init。',
    '如果内核路径不是默认位置，也可以通过 MIHOMO_BIN 指向现有二进制。'
  ];
}

export function getMihomoInstallHint() {
  const config = createConfig();
  const lines = [
    `未找到 mihomo 二进制: ${config.mihomoBin}`,
    config.mode === 'dev'
      ? '当前处于开发沙箱模式，建议先运行 vpnctl dev init。'
      : '当前处于正式安装模式，建议先运行 vpnctl init。',
    ...buildInstallSteps(process.platform)
  ];

  return lines.map((line, index) => `${index + 1}. ${line}`).join('\n');
}

export async function ensureMihomoInstalled() {
  const config = createConfig();
  const exists = await fileExists(config.mihomoBin);
  if (exists) return;

  throw new Error(getMihomoInstallHint());
}
