const CLI_HELP_ENTRIES = [
  {
    command: 'vpnctl',
    meaning: '\u542f\u52a8\u4ea4\u4e92\u5f0f TUI\uff0c\u5b8c\u6210\u521d\u59cb\u5316\u3001\u8ba2\u9605\u7ba1\u7406\u3001\u8282\u70b9\u5207\u6362\u3001\u7aef\u53e3\u8bbe\u7f6e\u4e0e shell \u96c6\u6210\u3002',
    example: 'vpnctl'
  },
  {
    command: 'vpnctl dev init',
    meaning: '\u5728\u9879\u76ee .sandbox \u4e2d\u521d\u59cb\u5316\u5f00\u53d1\u73af\u5883\uff0c\u9ed8\u8ba4\u4f7f\u7528 mix \u6a21\u5f0f\uff1b\u53ef\u901a\u8fc7 --proxy-mode \u5207\u5230 separate\u3002',
    example: 'node ./dist/index.js dev init --skip-download --proxy-mode mix --mixed-port 17890 --api-port 19090'
  },
  {
    command: 'vpnctl init',
    meaning: '\u5728\u7528\u6237\u76ee\u5f55\u521d\u59cb\u5316\u6b63\u5f0f\u8fd0\u884c\u73af\u5883\uff0c\u9ed8\u8ba4\u4f7f\u7528 mix \u6a21\u5f0f\uff1b\u4e5f\u652f\u6301 separate \u6a21\u5f0f\u3002',
    example: 'vpnctl init --proxy-mode mix --mixed-port 7890 --api-port 9090'
  },
  {
    command: 'vpnctl upgrade',
    meaning: '\u4ece vpnctl Old \u8fc1\u79fb\u8ba2\u9605\u4e0e\u8fd0\u884c\u65f6\u72b6\u6001\u5230\u5f53\u524d\u7248\u672c\u3002',
    example: 'vpnctl upgrade --skip-download'
  },
  {
    command: 'vpnctl add-sub',
    meaning: '\u5bfc\u5165\u8fdc\u7a0b\u8ba2\u9605 URL \u6216\u672c\u5730 YAML / URI \u5217\u8868\u6587\u4ef6\u3002',
    example: 'vpnctl add-sub --url "https://example.com/sub"'
  },
  {
    command: 'vpnctl sync',
    meaning: '\u540c\u6b65\u5f53\u524d\u6fc0\u6d3b\u8ba2\u9605\uff0c\u751f\u6210\u672c\u5730 provider\uff0c\u5e76\u628a\u53d7\u7ba1\u914d\u7f6e\u5e94\u7528\u5230\u8fd0\u884c\u4e2d\u7684 mihomo\u3002',
    example: 'vpnctl sync'
  },
  {
    command: 'vpnctl config set-ports',
    meaning: '\u5207\u6362 mix / separate \u6a21\u5f0f\u5e76\u81ea\u52a8\u91cd\u63a2\u6d4b\u7aef\u53e3\uff0c\u907f\u514d\u5360\u7528\u5df2\u6709\u670d\u52a1\u7aef\u53e3\u3002',
    example: 'vpnctl config set-ports --proxy-mode separate --http 17890 --socks 17891 --api 19090'
  },
  {
    command: 'vpnctl shell install',
    meaning: '\u5728 Linux bash \u7684 .bashrc \u5199\u5165\u53d7\u7ba1\u7247\u6bb5\uff0c\u8ba9\u540c\u8d26\u53f7\u4f1a\u8bdd\u53ef\u76f4\u63a5\u590d\u7528\u5f53\u524d VPN \u8fd0\u884c codex\u3002',
    example: 'vpnctl shell install --bashrc'
  },
  {
    command: '\u63a8\u8350\u987a\u5e8f',
    meaning: '\u5efa\u8bae\u6309 init -> shell install -> add-sub -> sync -> start -> \u76f4\u63a5\u8fd0\u884c codex \u7684\u987a\u5e8f\u4f7f\u7528\u3002',
    example: 'vpnctl init && vpnctl shell install --bashrc'
  },
  {
    command: 'vpnctl doctor',
    meaning: '\u68c0\u67e5\u521d\u59cb\u5316\u72b6\u6001\u3001\u7aef\u53e3\u6a21\u5f0f\u3001\u7aef\u53e3\u5360\u7528\u3001\u65e5\u5fd7\u3001\u8ba2\u9605\u548c shell \u96c6\u6210\u3002',
    example: 'vpnctl doctor'
  },
  {
    command: 'vpnctl start / stop',
    meaning: '\u542f\u52a8\u6216\u505c\u6b62\u5f53\u524d\u53d7\u7ba1\u7684 mihomo \u8fdb\u7a0b\u3002',
    example: 'vpnctl start'
  }
];

const TUI_HELP_SECTIONS = [
  {
    title: '\u5bfc\u822a',
    lines: [
      'Tab: \u5207\u6362\u5bfc\u822a\u533a\u4e0e\u5185\u5bb9\u533a',
      'Enter: \u6267\u884c\u52a8\u4f5c\uff0c\u6216\u5728\u8ba2\u9605\u9875\u6fc0\u6d3b\u5f53\u524d\u8ba2\u9605',
      'Esc: \u9000\u51fa\u641c\u7d22\u3001\u5173\u95ed\u5f39\u7a97\u6216\u56de\u5230\u5bfc\u822a\u533a',
      '/: \u8fdb\u5165\u641c\u7d22\u6a21\u5f0f',
      '?: \u6253\u5f00\u5e2e\u52a9',
      'q: \u9000\u51fa TUI'
    ]
  },
  {
    title: '\u52a8\u4f5c',
    lines: [
      'i: \u521d\u59cb\u5316\u8fd0\u884c\u73af\u5883',
      'u: \u8fc1\u79fb\u65e7\u7248\u5b89\u88c5',
      'a: \u6dfb\u52a0\u8ba2\u9605 URL \u6216 YAML',
      'x: \u5220\u9664\u5f53\u524d\u8ba2\u9605\uff08\u5e26\u786e\u8ba4\u6846\uff09',
      'y: \u540c\u6b65\u5f53\u524d\u6fc0\u6d3b\u8ba2\u9605\u5e76\u5e94\u7528\u5230\u8fd0\u884c\u6001',
      's: \u542f\u52a8 mihomo',
      'k: \u505c\u6b62 mihomo',
      'f: \u5728\u8282\u70b9\u9875\u5faa\u73af\u5207\u6362\u534f\u8bae\u7b5b\u9009',
      'd: \u5bf9\u5f53\u524d provider \u7684\u53ef\u89c1\u8282\u70b9\u6267\u884c\u6574\u7ec4\u6d4b\u901f',
      'p: \u4fee\u6539\u7aef\u53e3\u6a21\u5f0f\u4e0e\u7aef\u53e3\uff0c\u652f\u6301 mix / separate',
      'b: \u5b89\u88c5 bashrc \u7247\u6bb5',
      'n: \u5378\u8f7d bashrc \u7247\u6bb5',
      'r: \u5237\u65b0\u9762\u677f',
      'l: \u663e\u793a\u65e5\u5fd7\u6587\u4ef6\u8def\u5f84',
      'Google / OpenAI / YouTube: \u53ef\u5728\u6d4b\u901f\u9875\u5207\u6362\u6d4b\u901f\u76ee\u6807'
    ]
  },
  {
    title: '\u56fe\u4f8b',
    lines: [
      '>: \u5f53\u524d\u5149\u6807',
      '*: \u5f53\u524d provider \u6216\u5f53\u524d\u8282\u70b9',
      '--: \u5c1a\u672a\u6d4b\u901f\u6216 API \u79bb\u7ebf',
      '123ms: \u6700\u8fd1\u4e00\u6b21\u6d4b\u901f\u7ed3\u679c',
      'port source: default / custom / auto / migrated'
    ]
  }
];

export function getCliHelpEntries() {
  return CLI_HELP_ENTRIES.map((item) => ({ ...item }));
}

export function formatCliHelpText() {
  const lines = [
    '\u8bf4\u660e\uff1a',
    '',
    'vpnctl \u662f\u9762\u5411 mihomo \u7684\u4ea4\u4e92\u5f0f CLI / TUI \u7ba1\u7406\u5668\u3002',
    '- \u9ed8\u8ba4\u63a8\u8350\u4f7f\u7528 mix \u6a21\u5f0f\uff0c\u53ea\u5360\u7528 mixed + api \u4e24\u4e2a\u7aef\u53e3\u3002',
    '- \u5982\u9700\u517c\u5bb9\u4f20\u7edf HTTP/SOCKS \u5206\u79bb\u65b9\u6848\uff0c\u53ef\u5207\u5230 separate \u6a21\u5f0f\u3002',
    '',
    '\u5e38\u7528\u547d\u4ee4\uff1a'
  ];

  for (const entry of CLI_HELP_ENTRIES) {
    lines.push(`- ${entry.command}`);
    lines.push(`  \u542b\u4e49: ${entry.meaning}`);
    lines.push(`  \u793a\u4f8b: ${entry.example}`);
  }

  lines.push('');
  lines.push('\u63d0\u793a\uff1a');
  lines.push('- \u5f00\u53d1\u9a8c\u8bc1\u4f18\u5148\u4f7f\u7528 vpnctl dev init\u3002');
  lines.push('- \u6b63\u5f0f\u73af\u5883\u4f18\u5148\u4f7f\u7528 vpnctl init\u3002');
  lines.push('- shell install \u5b8c\u6210\u540e\uff0c\u540c\u8d26\u53f7\u65b0\u4f1a\u8bdd\u53ef\u4ee5\u76f4\u63a5\u8fd0\u884c codex\u3002');

  return lines.join('\n');
}

export function getTuiHelpSections() {
  return TUI_HELP_SECTIONS.map((section) => ({
    ...section,
    lines: [...section.lines]
  }));
}
