const CLI_HELP_ENTRIES = [
  {
    command: 'vpnctl',
    meaning: '直接进入总览式 UI，普通用户优先从这里开始。',
    example: 'vpnctl'
  },
  {
    command: 'vpnctl dev init',
    meaning: '在项目 .sandbox 里初始化独立运行环境，适合本机安全测试，不碰现有 Clash 或 mihomo。',
    example: 'node ./dist/index.js dev init --skip-download --http-port 17890'
  },
  {
    command: 'vpnctl init',
    meaning: '在用户目录初始化正式运行环境，可自定义 HTTP、SOCKS 和 API 端口。',
    example: 'vpnctl init --http-port 7890 --socks-port 7891 --api-port 9090'
  },
  {
    command: 'vpnctl upgrade',
    meaning: '检测并迁移旧版 vpnctl Old 的配置、订阅、主题和端口到新结构。',
    example: 'vpnctl upgrade --skip-download'
  },
  {
    command: 'vpnctl add-sub',
    meaning: '导入远程订阅 URL 或本地 YAML 文件。',
    example: 'vpnctl add-sub --url "https://example.com/sub"'
  },
  {
    command: 'vpnctl sync',
    meaning: '同步订阅并生成 provider 配置，供 TUI 和 mihomo 使用。',
    example: 'vpnctl sync'
  },
  {
    command: 'vpnctl config set-ports',
    meaning: '手动修改 HTTP、SOCKS、API 端口；如果冲突会自动改配到空闲端口。',
    example: 'vpnctl config set-ports --http 17890 --socks 17891 --api 19090'
  },
  {
    command: 'vpnctl shell install',
    meaning: '在 Linux bash 的 .bashrc 中写入受管代理函数，并让同账户下的新会话直接运行 codex 时自动继承当前 VPN 代理。',
    example: 'vpnctl shell install --bashrc'
  },
  {
    command: '服务器验收流',
    meaning: '推荐顺序：init -> shell install -> add-sub -> sync -> start -> 新会话直接运行 codex。',
    example: 'vpnctl init && vpnctl shell install --bashrc'
  },
  {
    command: 'vpnctl doctor',
    meaning: '诊断当前运行状态、端口占用、旧版迁移状态、Shell 集成状态和下一步建议。',
    example: 'vpnctl doctor'
  },
  {
    command: 'vpnctl start / stop',
    meaning: '启动或停止由 vpnctl 管理的 mihomo 后台进程。',
    example: 'vpnctl start'
  }
];

const TUI_HELP_SECTIONS = [
  {
    title: '导航',
    lines: [
      '上下方向键: 在左侧导航、订阅、Provider、节点或主题列表中移动',
      'Tab: 在左侧导航和右侧内容之间切换焦点',
      'Enter: 执行当前动作，或在 Provider / 节点之间进入下一层；在总览页会执行推荐的下一步',
      'Esc: 返回导航区、退出搜索，或关闭帮助',
      '/: 进入搜索模式，过滤当前列表',
      '?: 打开或关闭帮助面板',
      'q: 退出 TUI'
    ]
  },
  {
    title: '动作',
    lines: [
      'i: 初始化当前模式的运行目录',
      'u: 执行旧版迁移或升级',
      'a: 添加订阅，支持 URL 或 YAML 路径，可用 source|别名 输入',
      'Enter: 在订阅页激活当前订阅，其余订阅进入休息状态',
      'x: 删除当前选中的订阅，会先弹出确认框',
      'y: 只同步当前激活订阅并刷新 provider',
      's: 启动 mihomo',
      'k: 停止 mihomo',
      'f: 在节点页循环切换协议筛选（ALL / VLESS / VMESS / TROJAN / SS 等）',
      '站点测速页可切换 Google / OpenAI / YouTube 等目标，节点页 ms 会跟随切换',
      'p: 修改端口，格式为 http,socks,api',
      'b: 安装 bashrc 代理集成',
      'n: 卸载 bashrc 代理集成',
      'Shell 页按 Enter 会打开服务器 Shell 集成向导',
      '安装 bashrc 后，同账户下的新会话直接运行 codex 即可复用已启动的 VPN',
      'd: 用当前站点测速目标对当前 provider 整组节点执行一次测速',
      'r: 刷新总览快照',
      'l: 显示日志路径'
    ]
  },
  {
    title: '图例',
    lines: [
      '>: 当前光标位置，表示你正在操作的项',
      '*: 当前已连接节点或活动 provider',
      '--: 还没有拿到延迟，通常是 API 离线或尚未测速',
      '123ms: 当前节点延迟结果',
      'port source: 端口来源，可能是 default / custom / auto / migrated'
    ]
  }
];

export function getCliHelpEntries() {
  return CLI_HELP_ENTRIES.map((item) => ({ ...item }));
}

export function formatCliHelpText() {
  const lines = [
    '用法:',
    '',
    '普通用户:',
    '- 直接输入 vpnctl 进入总览式 UI',
    '- 常见动作都应在 UI 里完成: 初始化、导入订阅、同步、启动、切换节点、改主题、改端口',
    '',
    '高级模式:'
  ];

  for (const entry of CLI_HELP_ENTRIES) {
    lines.push(`- ${entry.command}`);
    lines.push(`  含义: ${entry.meaning}`);
    lines.push(`  示例: ${entry.example}`);
  }

  lines.push('');
  lines.push('说明:');
  lines.push('- 本机测试优先使用 dev init，它会把运行时隔离在项目 .sandbox 中。');
  lines.push('- 正式安装使用 init，运行时数据写入用户目录，不依赖源码目录。');
  lines.push('- init 会显示分步进度：目录、端口、mihomo、安装状态、订阅存储、受管配置。');
  lines.push('- 如果你有完整终端环境，默认入口就是 UI；CLI 更适合脚本、SSH 和故障排查。');
  lines.push('- Linux 服务器推荐按验收流执行：init -> shell install -> add-sub -> sync -> start -> 新会话运行 codex。');

  return lines.join('\n');
}

export function getTuiHelpSections() {
  return TUI_HELP_SECTIONS.map((section) => ({
    ...section,
    lines: [...section.lines]
  }));
}
