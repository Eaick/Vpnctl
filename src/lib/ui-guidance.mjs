function getFieldValue(snapshot, key, fallback = '') {
  return snapshot?.status?.ports?.[key]?.port ? String(snapshot.status.ports[key].port) : fallback;
}

export function createAddSubscriptionModal() {
  return {
    type: 'add-sub',
    title: '添加订阅',
    prompt: '选择导入方式，然后填写服务器上的订阅来源。',
    fields: [
      { key: 'sourceType', label: '导入方式', value: 'url', options: ['url', 'file'] },
      { key: 'source', label: '来源', value: '', placeholder: 'https://example.com/sub 或 /srv/vpn/subscription.yaml' },
      { key: 'alias', label: '别名', value: '', placeholder: '可选，例如 生产机场' }
    ],
    notes: [
      'url: 远程订阅地址',
      'file: 服务器上的本地 YAML 文件路径'
    ],
    activeField: 0,
    submitText: 'Enter 提交  ←/→ 切换选项  Tab/上下切换字段  Esc 取消'
  };
}

export function createPortModal(snapshot) {
  return {
    type: 'set-ports',
    title: '设置端口',
    prompt: '修改 HTTP / SOCKS / API 端口。保存后会重写受管配置。',
    fields: [
      { key: 'http', label: 'HTTP', value: getFieldValue(snapshot, 'http', '17890'), placeholder: '17890' },
      { key: 'socks', label: 'SOCKS', value: getFieldValue(snapshot, 'socks', '17891'), placeholder: '17891' },
      { key: 'api', label: 'API', value: getFieldValue(snapshot, 'api', '19090'), placeholder: '19090' }
    ],
    notes: [
      '如发生冲突，doctor 会显示新的推荐端口',
      '正式服务器建议保持一组固定端口，方便运维'
    ],
    activeField: 0,
    submitText: 'Enter 保存  Tab/上下切换字段  Esc 取消'
  };
}

export function createInitModal(snapshot) {
  return {
    type: 'init-runtime',
    title: '初始化运行目录',
    prompt: `当前模式: ${snapshot.status.mode}。先确认端口，再初始化受管 mihomo 环境。`,
    fields: [
      { key: 'http', label: 'HTTP', value: getFieldValue(snapshot, 'http', '17890'), placeholder: '17890' },
      { key: 'socks', label: 'SOCKS', value: getFieldValue(snapshot, 'socks', '17891'), placeholder: '17891' },
      { key: 'api', label: 'API', value: getFieldValue(snapshot, 'api', '19090'), placeholder: '19090' }
    ],
    notes: [
      'init 会准备运行目录、mihomo、配置文件和订阅存储',
      'Linux 服务器建议先 init，再装 bashrc 集成'
    ],
    activeField: 0,
    submitText: 'Enter 初始化  Tab/上下切换字段  Esc 取消'
  };
}

export function createDeleteSubscriptionModal(subscription) {
  return {
    type: 'confirm-remove-sub',
    title: '确认删除订阅',
    prompt: `即将删除订阅「${subscription.displayName}」。`,
    fields: [],
    notes: [
      `来源: ${subscription.source}`,
      `缓存文件: ${subscription.cachePath}`,
      `Provider 文件: ${subscription.providerPath}`,
      '确认后会移除订阅记录和对应缓存文件'
    ],
    activeField: 0,
    subscriptionId: subscription.id,
    submitText: 'Enter 确认删除  Esc 取消'
  };
}

export function createInitProgressModal(snapshot) {
  return {
    type: 'init-progress',
    title: '初始化进行中',
    prompt: `当前模式: ${snapshot.status.mode}。正在准备受管 mihomo 环境。`,
    fields: [],
    notes: [],
    activeField: 0,
    steps: [],
    submitText: '初始化完成后按 Esc 关闭'
  };
}

export function createShellInstallModal(snapshot) {
  return {
    type: 'shell-install',
    title: '安装 Shell 集成',
    prompt: '为当前 Linux bash 账户写入受管 .bashrc 片段，让新会话直接运行 codex 也能复用已启动的 VPN。',
    fields: [
      { key: 'bashrcPath', label: '.bashrc 路径', value: snapshot.status.shellIntegration?.bashrcPath || '', placeholder: '~/.bashrc（留空使用默认）' }
    ],
    notes: [
      'A 会话启动 mihomo 后，B 会话可直接运行 codex',
      '只覆盖 vpnctl 自己的受管块，不改其它 bash 配置'
    ],
    activeField: 0,
    submitText: 'Enter 安装  Tab 切换字段  Esc 取消'
  };
}

export function cycleModalFieldOption(field, direction = 1) {
  if (!field?.options?.length) return field?.value || '';
  const currentIndex = Math.max(0, field.options.findIndex((item) => item === field.value));
  const nextIndex = (currentIndex + direction + field.options.length) % field.options.length;
  return field.options[nextIndex];
}

export function getPrimaryGuidedAction(snapshot) {
  if (!snapshot?.status?.initialized) return 'init-runtime';
  if (!snapshot?.status?.subscriptionCount) return 'add-sub';
  if (!snapshot.providers?.length) return 'sync';
  if (!snapshot.status.apiAlive) return 'start';
  if (!snapshot.status.shellIntegration?.installed || !snapshot.status.shellIntegration?.codexWrapper) return 'shell-install';
  return 'ready';
}

export function buildOverviewGuide(snapshot) {
  const action = getPrimaryGuidedAction(snapshot);
  const sessionState = snapshot.status.sessionReuse?.state || 'unknown';

  if (action === 'init-runtime') {
    return [
      '下一步向导',
      '1. 按 Enter 或 i 初始化运行目录',
      '2. 确认 HTTP / SOCKS / API 端口',
      '3. 界面会显示初始化步骤进度',
      '4. 初始化完成后继续导入订阅'
    ];
  }

  if (action === 'add-sub') {
    return [
      '下一步向导',
      '1. 按 Enter 或 a 添加 URL 或 YAML 订阅',
      '2. 完成后执行同步生成 provider',
      '3. 同步成功后再启动 mihomo'
    ];
  }

  if (action === 'sync') {
    return [
      '下一步向导',
      '1. 按 Enter 或 y 同步订阅',
      '2. provider 生成后进入节点页检查节点',
      '3. 再启动 mihomo 进行实际连接'
    ];
  }

  if (action === 'start') {
    return [
      '下一步向导',
      '1. 按 Enter 或 s 启动 mihomo',
      '2. 启动后节点延迟会逐步显示',
      '3. 然后安装 shell 集成给新会话复用'
    ];
  }

  if (action === 'shell-install') {
    return [
      '下一步向导',
      '1. 按 Enter 或 b 安装 bashrc 集成',
      '2. 在服务器执行 source ~/.bashrc',
      '3. 之后同账户新会话可直接运行 codex'
    ];
  }

  if (sessionState === 'waiting') {
    return [
      '服务器复用状态',
      'Shell 集成已经准备好',
      '任意一个会话启动 mihomo 后',
      '其他同账户会话即可直接运行 codex'
    ];
  }

  return [
    '服务器复用状态',
    '当前闭环已经就绪',
    'A 会话启动 mihomo 后',
    'B 会话可直接运行 codex，无需再次动 VPN'
  ];
}

export function buildShellGuide(snapshot) {
  const shell = snapshot.status.shellIntegration || {};
  const sessionReuse = snapshot.status.sessionReuse || {};

  if (!shell.installed) {
    return [
      '当前还没有安装 bashrc 集成',
      '安装后会写入 vpnctl-proxy-on/off/status',
      '并提供 codex() 与 codexvpn 复用当前 VPN'
    ];
  }

  if (!shell.codexWrapper) {
    return [
      'bashrc 受管块已存在，但 Codex 包装器未就绪',
      '建议重新执行 shell install',
      '然后 source ~/.bashrc'
    ];
  }

  if (sessionReuse.state === 'waiting') {
    return [
      'Shell 已准备好，正在等待 mihomo 启动',
      'A 会话先启动 mihomo',
      'B 会话随后可直接运行 codex'
    ];
  }

  return [
    '同账户多会话复用已就绪',
    'A 会话保持 mihomo 运行',
    'B 会话直接运行 codex 即可'
  ];
}
