import process from 'node:process';
import { createConfig } from './config.mjs';
import { fileExists } from './process.mjs';

function buildInstallSteps(platform) {
  if (platform === 'win32') {
    return [
      'Windows 环境建议先在 .sandbox 里执行 vpnctl dev init，再确认正式配置。',
      '默认推荐 mix 模式，只占用 mixed + api 两个端口。',
      '如果 7890/7891 已被其它 Clash 客户端占用，请为 mihomo 单独准备端口。'
    ];
  }

  if (platform === 'darwin') {
    return [
      '当前版本正式支持 Windows x64 与 Linux x64。',
      'macOS 可以先在项目环境里验证流程，再自行准备 mihomo 二进制。',
      '如果端口冲突，请切到 mix 模式或手动指定新的端口。'
    ];
  }

  return [
    'Linux/SSH 服务器建议先执行 vpnctl init，确保运行目录、端口与订阅存储已准备好。',
    '默认推荐 mix 模式，减少端口占用与冲突概率。',
    '如需自定义 mihomo 路径，可提前设置 MIHOMO_BIN。'
  ];
}

export function getMihomoInstallHint() {
  const config = createConfig();
  const lines = [
    `当前 mihomo 路径: ${config.mihomoBin}`,
    config.mode === 'dev'
      ? '当前处于开发沙箱模式，建议先执行 vpnctl dev init。'
      : '当前处于正式安装模式，建议先执行 vpnctl init。',
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
