function getPortValue(snapshot, key, fallback = '') {
  return snapshot?.status?.ports?.[key]?.port ? String(snapshot.status.ports[key].port) : fallback;
}

function resolveProxyMode(snapshotOrMode) {
  if (snapshotOrMode === 'separate') return 'separate';
  if (snapshotOrMode?.status?.proxyMode === 'separate') return 'separate';
  return 'mix';
}

function getPortDefaults(proxyMode) {
  if (proxyMode === 'separate') {
    return {
      http: '7890',
      socks: '7891',
      api: '9090'
    };
  }

  return {
    mixed: '7890',
    api: '9090'
  };
}

function buildPortFields(snapshot, proxyMode, currentValues = {}) {
  const defaults = getPortDefaults(proxyMode);
  const fields = [
    {
      key: 'proxyMode',
      label: '\u6a21\u5f0f',
      value: proxyMode,
      options: ['mix', 'separate']
    }
  ];

  if (proxyMode === 'separate') {
    fields.push(
      {
        key: 'http',
        label: 'HTTP',
        value: currentValues.http ?? getPortValue(snapshot, 'http', defaults.http),
        placeholder: defaults.http
      },
      {
        key: 'socks',
        label: 'SOCKS',
        value: currentValues.socks ?? getPortValue(snapshot, 'socks', defaults.socks),
        placeholder: defaults.socks
      }
    );
  } else {
    fields.push({
      key: 'mixed',
      label: '\u6df7\u5408\u7aef\u53e3',
      value: currentValues.mixed ?? getPortValue(snapshot, 'mixed', defaults.mixed),
      placeholder: defaults.mixed
    });
  }

  fields.push({
    key: 'api',
    label: 'API',
    value: currentValues.api ?? getPortValue(snapshot, 'api', defaults.api),
    placeholder: defaults.api
  });

  return fields;
}

function buildPortNotes(snapshot, proxyMode) {
  const source = snapshot?.status?.portSource || 'default';
  if (proxyMode === 'separate') {
    return [
      'separate\uff1a\u4f7f\u7528 http + socks + api \u4e09\u4e2a\u7aef\u53e3\u3002',
      '\u4fdd\u5b58\u540e\u4f1a\u81ea\u52a8\u91cd\u63a2\u6d4b\u53ef\u7528\u7aef\u53e3\uff0c\u907f\u514d\u6cbf\u7528\u51b2\u7a81\u7aef\u53e3\u3002',
      `\u5f53\u524d\u7aef\u53e3\u6765\u6e90\uff1a${source}`
    ];
  }

  return [
    'mix\uff1a\u4f7f\u7528 mixed + api\uff0cHTTP \u548c SOCKS5 \u5171\u7528\u4e00\u4e2a\u4ee3\u7406\u7aef\u53e3\u3002',
    '\u4fdd\u5b58\u540e\u4f1a\u81ea\u52a8\u91cd\u63a2\u6d4b\u53ef\u7528\u7aef\u53e3\uff0c\u51cf\u5c11\u5360\u7528\u5e76\u89c4\u907f\u51b2\u7a81\u3002',
    `\u5f53\u524d\u7aef\u53e3\u6765\u6e90\uff1a${source}`
  ];
}

function getCurrentFieldValues(modal) {
  const values = {};
  for (const field of modal?.fields || []) {
    values[field.key] = field.value;
  }
  return values;
}

function buildPortModalBase(type, title, prompt, snapshot, proxyMode, currentValues = {}) {
  return {
    type,
    title,
    prompt,
    fields: buildPortFields(snapshot, proxyMode, currentValues),
    notes: buildPortNotes(snapshot, proxyMode),
    activeField: 0,
    submitText: 'Enter \u4fdd\u5b58 | Tab/\u4e0a\u4e0b\u5207\u6362\u5b57\u6bb5 | \u5de6\u53f3\u5207\u6362\u6a21\u5f0f | Esc \u53d6\u6d88'
  };
}

export function createAddSubscriptionModal() {
  return {
    type: 'add-sub',
    title: '\u6dfb\u52a0\u8ba2\u9605',
    prompt: '\u9009\u62e9\u5bfc\u5165\u65b9\u5f0f\uff0c\u7136\u540e\u586b\u5199\u670d\u52a1\u5668\u4e0a\u7684\u8ba2\u9605\u6765\u6e90\u3002',
    fields: [
      { key: 'sourceType', label: '\u6765\u6e90\u7c7b\u578b', value: 'url', options: ['url', 'file'] },
      { key: 'source', label: '\u6765\u6e90', value: '', placeholder: 'https://example.com/sub \u6216 /srv/vpn/subscription.yaml' },
      { key: 'alias', label: '\u522b\u540d', value: '', placeholder: '\u53ef\u9009\uff0c\u7559\u7a7a\u5219\u4f7f\u7528\u8ba2\u9605\u540d' }
    ],
    notes: [
      'url\uff1a\u8fdc\u7a0b\u8ba2\u9605\u5730\u5740\u3002',
      'file\uff1a\u672c\u5730 YAML \u6216 URI \u5217\u8868\u6587\u4ef6\u3002'
    ],
    activeField: 0,
    submitText: 'Enter \u5bfc\u5165 | Tab/\u4e0a\u4e0b\u5207\u6362\u5b57\u6bb5 | Esc \u53d6\u6d88'
  };
}

export function createPortModal(snapshot, proxyMode = resolveProxyMode(snapshot)) {
  return buildPortModalBase(
    'set-ports',
    '\u7aef\u53e3\u4e0e\u6a21\u5f0f',
    '\u8bbe\u7f6e\u5f53\u524d\u4ee3\u7406\u7aef\u53e3\u6a21\u5f0f\u4e0e\u76d1\u542c\u7aef\u53e3\u3002',
    snapshot,
    proxyMode
  );
}

export function createInitModal(snapshot, proxyMode = resolveProxyMode(snapshot)) {
  return buildPortModalBase(
    'init-runtime',
    '\u521d\u59cb\u5316\u8fd0\u884c\u73af\u5883',
    `\u5f53\u524d\u8fd0\u884c\u6a21\u5f0f\uff1a${snapshot.status.mode}\u3002\u521d\u59cb\u5316\u4f1a\u51c6\u5907\u8fd0\u884c\u76ee\u5f55\u3001mihomo\u3001\u8ba2\u9605\u5b58\u50a8\u4e0e\u53d7\u7ba1\u914d\u7f6e\u3002`,
    snapshot,
    proxyMode
  );
}

export function rebuildPortModal(modal, snapshot, proxyMode) {
  const nextMode = resolveProxyMode(proxyMode);
  const currentValues = getCurrentFieldValues(modal);
  const next = modal.type === 'init-runtime'
    ? createInitModal(snapshot, nextMode)
    : createPortModal(snapshot, nextMode);
  next.fields = buildPortFields(snapshot, nextMode, currentValues);
  next.activeField = Math.min(modal.activeField || 0, Math.max(0, next.fields.length - 1));
  return next;
}

export function createDeleteSubscriptionModal(subscription) {
  return {
    type: 'confirm-remove-sub',
    title: '\u786e\u8ba4\u5220\u9664\u8ba2\u9605',
    prompt: `\u5373\u5c06\u5220\u9664\u8ba2\u9605\u201c${subscription.displayName}\u201d\u3002`,
    fields: [],
    notes: [
      `\u6765\u6e90\uff1a${subscription.source}`,
      `\u7f13\u5b58\u6587\u4ef6\uff1a${subscription.cachePath}`,
      `Provider \u6587\u4ef6\uff1a${subscription.providerPath}`,
      subscription.enabled
        ? '\u8fd9\u662f\u5f53\u524d\u6fc0\u6d3b\u8ba2\u9605\uff1b\u5220\u9664\u540e\u4f1a\u81ea\u52a8\u5207\u6362\u5230\u4e0b\u4e00\u6761\u53ef\u7528\u8ba2\u9605\u3002'
        : '\u5220\u9664\u540e\u4f1a\u79fb\u9664\u8ba2\u9605\u8bb0\u5f55\u548c\u5bf9\u5e94\u7f13\u5b58\u6587\u4ef6\u3002'
    ],
    activeField: 0,
    subscriptionId: subscription.id,
    submitText: 'Enter \u786e\u8ba4\u5220\u9664 | Esc \u53d6\u6d88'
  };
}

export function createInitProgressModal(snapshot) {
  return {
    type: 'init-progress',
    title: '\u521d\u59cb\u5316\u8fdb\u5ea6',
    prompt: `\u5f53\u524d\u8fd0\u884c\u6a21\u5f0f\uff1a${snapshot.status.mode}\u3002\u6b63\u5728\u51c6\u5907\u8fd0\u884c\u73af\u5883\u4e0e\u53d7\u7ba1\u914d\u7f6e\u3002`,
    fields: [],
    notes: [],
    activeField: 0,
    steps: [],
    submitText: '\u521d\u59cb\u5316\u5b8c\u6210\u540e\u6309 Esc \u5173\u95ed'
  };
}

export function createShellInstallModal(snapshot) {
  return {
    type: 'shell-install',
    title: '\u5b89\u88c5 Shell \u96c6\u6210',
    prompt: '\u628a\u53d7\u7ba1 bashrc \u7247\u6bb5\u5199\u5165\u670d\u52a1\u5668\u73af\u5883\uff0c\u4fbf\u4e8e\u540c\u8d26\u53f7\u4f1a\u8bdd\u590d\u7528\u5f53\u524d VPN\u3002',
    fields: [
      { key: 'bashrcPath', label: '.bashrc \u8def\u5f84', value: snapshot.status.shellIntegration?.bashrcPath || '', placeholder: '~/.bashrc' }
    ],
    notes: [
      '\u53ea\u8986\u76d6 vpnctl \u81ea\u5df1\u7684\u53d7\u7ba1\u5757\uff0c\u4e0d\u6539\u5176\u5b83 bash \u914d\u7f6e\u3002',
      '\u5b89\u88c5\u540e\u4f1a\u63d0\u4f9b vpnctl-proxy-on/off/status \u4e0e codex \u4ee3\u7406\u5c01\u88c5\u3002'
    ],
    activeField: 0,
    submitText: 'Enter \u5b89\u88c5 | Tab \u5207\u6362\u5b57\u6bb5 | Esc \u53d6\u6d88'
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
      '\u8fd8\u6ca1\u6709\u51c6\u5907\u597d\u8fd0\u884c\u73af\u5883\u3002',
      '1. \u6309 Enter \u6216 i \u6253\u5f00\u521d\u59cb\u5316\u5411\u5bfc\u3002',
      '2. \u9ed8\u8ba4\u4f7f\u7528 mix \u6a21\u5f0f\uff0c\u53ea\u5360\u7528 mixed + api \u4e24\u4e2a\u7aef\u53e3\u3002',
      '3. \u5982\u9700\u517c\u5bb9\u65e7\u4e60\u60ef\uff0c\u518d\u5207\u5230 separate \u6a21\u5f0f\u3002',
      '4. \u521d\u59cb\u5316\u5b8c\u6210\u540e\u7ee7\u7eed\u5bfc\u5165\u8ba2\u9605\u3002'
    ];
  }

  if (action === 'add-sub') {
    return [
      '\u73b0\u5728\u5148\u5bfc\u5165\u4e00\u4e2a\u8ba2\u9605\u3002',
      '1. \u6309 Enter \u6216 a \u6dfb\u52a0 URL \u6216 YAML \u8ba2\u9605\u3002',
      '2. \u5bfc\u5165\u540e\u4f1a\u751f\u6210 provider\u3002',
      '3. \u7136\u540e\u540c\u6b65\u5e76\u542f\u52a8 mihomo\u3002'
    ];
  }

  if (action === 'sync') {
    return [
      '\u8ba2\u9605\u5df2\u7ecf\u5b58\u5728\uff0c\u4f46\u8fd8\u6ca1\u751f\u6210 provider\u3002',
      '1. \u6309 Enter \u6216 y \u540c\u6b65\u5f53\u524d\u6fc0\u6d3b\u8ba2\u9605\u3002',
      '2. \u751f\u6210 provider \u540e\u518d\u53bb\u8282\u70b9\u9875\u5207\u6362\u8282\u70b9\u3002',
      '3. \u82e5 mihomo \u6b63\u5728\u8fd0\u884c\uff0c\u4f1a\u81ea\u52a8\u70ed\u91cd\u8f7d\u6216\u91cd\u542f\u3002'
    ];
  }

  if (action === 'start') {
    return [
      '\u914d\u7f6e\u5df2\u7ecf\u51c6\u5907\u597d\uff0c\u4f46 mihomo \u8fd8\u6ca1\u542f\u52a8\u3002',
      '1. \u6309 Enter \u6216 s \u542f\u52a8 mihomo\u3002',
      '2. \u542f\u52a8\u540e\u518d\u5207\u8282\u70b9\u6216\u6d4b\u901f\u3002',
      '3. \u5982\u9700\u8de8\u4f1a\u8bdd\u590d\u7528 VPN\uff0c\u53ef\u7ee7\u7eed\u5b89\u88c5 shell \u96c6\u6210\u3002'
    ];
  }

  if (action === 'shell-install') {
    return [
      '\u5f53\u524d VPN \u5df2\u53ef\u7528\uff0c\u4f46\u8fd8\u6ca1\u6709\u5b89\u88c5 shell \u590d\u7528\u80fd\u529b\u3002',
      '1. \u6309 Enter \u6216 b \u5b89\u88c5 bashrc \u7247\u6bb5\u3002',
      '2. \u6267\u884c source ~/.bashrc\u3002',
      '3. \u4e4b\u540e\u65b0\u4f1a\u8bdd\u53ef\u4ee5\u76f4\u63a5\u590d\u7528\u5f53\u524d VPN \u8fd0\u884c codex\u3002'
    ];
  }

  if (sessionState === 'waiting') {
    return [
      'Shell \u96c6\u6210\u5df2\u7ecf\u51c6\u5907\u597d\u3002',
      '\u4efb\u610f\u4e00\u4e2a\u540c\u8d26\u53f7\u4f1a\u8bdd\u5148\u542f\u52a8 mihomo\uff0c',
      '\u4e4b\u540e\u5176\u4ed6\u540c\u8d26\u53f7\u4f1a\u8bdd\u5c31\u53ef\u4ee5\u76f4\u63a5\u8fd0\u884c codex \u5e76\u590d\u7528 VPN\u3002'
    ];
  }

  return [
    '\u73af\u5883\u5df2\u7ecf\u5c31\u7eea\u3002',
    '\u53ef\u4ee5\u76f4\u63a5\u8fdb\u5165\u8282\u70b9\u9875\u5207\u6362\u8282\u70b9\u3001\u6267\u884c\u6d4b\u901f\uff0c\u6216\u5728\u65b0\u4f1a\u8bdd\u8fd0\u884c codex\u3002',
    '\u65b0\u7684\u540c\u8d26\u53f7\u4f1a\u8bdd\u53ef\u4ee5\u76f4\u63a5\u590d\u7528\u5f53\u524d VPN\u3002'
  ];
}

export function buildShellGuide(snapshot) {
  const shell = snapshot.status.shellIntegration || { installed: false, codexWrapper: false };
  const sessionReuse = snapshot.status.sessionReuse || { state: 'unknown' };

  if (!shell.installed) {
    return [
      '\u8fd8\u6ca1\u6709\u5b89\u88c5 bashrc \u7247\u6bb5\u3002',
      '\u5b89\u88c5\u540e\u4f1a\u63d0\u4f9b vpnctl-proxy-on/off/status\uff0c',
      '\u540c\u65f6\u63d0\u4f9b codex() \u4e0e codexvpn \u6765\u590d\u7528\u5f53\u524d VPN\u3002'
    ];
  }

  if (!shell.codexWrapper) {
    return [
      'bashrc \u5df2\u5b89\u88c5\uff0c\u4f46 Codex \u4ee3\u7406\u5c01\u88c5\u4e0d\u5b8c\u6574\u3002',
      '\u53ef\u91cd\u65b0\u6267\u884c shell \u5b89\u88c5\u4ee5\u8865\u5168\u7247\u6bb5\uff0c',
      '\u5b8c\u6210\u540e\u518d source ~/.bashrc\u3002'
    ];
  }

  if (sessionReuse.state === 'waiting') {
    return [
      'Shell \u96c6\u6210\u5df2\u7ecf\u5c31\u7eea\uff0c\u6b63\u5728\u7b49\u5f85\u67d0\u4e2a\u4f1a\u8bdd\u5148\u542f\u52a8 mihomo\u3002',
      'A \u4f1a\u8bdd\u542f\u52a8 mihomo\u3002',
      'B \u4f1a\u8bdd\u76f4\u63a5\u8fd0\u884c codex\u3002'
    ];
  }

  return [
    'Shell \u96c6\u6210\u5df2\u7ecf\u5b8c\u6574\u53ef\u7528\u3002',
    'A \u4f1a\u8bdd\u4fdd\u6301 mihomo \u8fd0\u884c\u3002',
    'B \u4f1a\u8bdd\u76f4\u63a5\u8fd0\u884c codex\u3002'
  ];
}