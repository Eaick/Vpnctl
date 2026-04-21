const TARGETS = [
  {
    id: 'google',
    label: 'Google',
    url: 'https://www.google.com/generate_204',
    description: '测试 Google 出海可达性'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    url: 'https://api.openai.com/v1/models',
    description: '测试 OpenAI API 链路'
  },
  {
    id: 'youtube',
    label: 'YouTube',
    url: 'https://www.youtube.com/generate_204',
    description: '测试 YouTube 视频站点链路'
  },
  {
    id: 'gstatic',
    label: 'GStatic',
    url: 'https://www.gstatic.com/generate_204',
    description: '轻量测速基准目标'
  },
  {
    id: 'github',
    label: 'GitHub',
    url: 'https://github.com/',
    description: '测试 GitHub 访问质量'
  }
];

export function getLatencyTargets() {
  return TARGETS.map((item) => ({ ...item }));
}

export function getLatencyTarget(targetId = 'gstatic') {
  return TARGETS.find((item) => item.id === targetId) || TARGETS.find((item) => item.id === 'gstatic');
}
