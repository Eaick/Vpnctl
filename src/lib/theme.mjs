const THEME_NAMES = ['gemini', 'claude', 'deepseek', 'codex', 'kimi', 'dark', 'light'];

const THEMES = {
  gemini: {
    name: 'Gemini Prism',
    tagline: '智慧 + 多彩',
    accent: { color: '#5fd7ff', bold: true },
    dim: { color: '#a7b2c5' },
    success: { color: '#c084fc', bold: true },
    warn: { color: '#facc15', bold: true },
    error: { color: '#fb7185', bold: true },
    active: { color: '#f9c74f', bold: true },
    selected: { backgroundColor: '#38bdf8', color: '#082f49', bold: true },
    borderActive: '#5fd7ff',
    borderInactive: '#64748b',
    key: { color: '#5fd7ff', bold: true },
    value: { color: 'white' },
    marker: { color: '#f9c74f', bold: true },
    bannerGradient: ['#38bdf8', '#8b5cf6', '#f9c74f'],
    bannerTransitionGradient: true
  },
  claude: {
    name: 'Claude Sage',
    tagline: '人性 + 睿智',
    accent: { color: '#d97706', bold: true },
    dim: { color: '#b7ada1' },
    success: { color: '#f4a261', bold: true },
    warn: { color: '#fbbf24', bold: true },
    error: { color: '#dc2626', bold: true },
    active: { color: '#f4a261', bold: true },
    selected: { backgroundColor: '#d97706', color: '#3b1f0a', bold: true },
    borderActive: '#d97706',
    borderInactive: '#78716c',
    key: { color: '#d97706', bold: true },
    value: { color: 'white' },
    marker: { color: '#f4a261', bold: true },
    bannerGradient: ['#9a3412', '#d97706', '#f4a261'],
    bannerTransitionGradient: true
  },
  deepseek: {
    name: 'DeepSeek Ocean',
    tagline: '深蓝 + 海洋',
    accent: { color: '#38bdf8', bold: true },
    dim: { color: '#94a3b8' },
    success: { color: '#22d3ee', bold: true },
    warn: { color: '#7dd3fc', bold: true },
    error: { color: '#ef4444', bold: true },
    active: { color: '#67e8f9', bold: true },
    selected: { backgroundColor: '#0f172a', color: '#7dd3fc', bold: true },
    borderActive: '#0ea5e9',
    borderInactive: '#334155',
    key: { color: '#38bdf8', bold: true },
    value: { color: '#e0f2fe' },
    marker: { color: '#22d3ee', bold: true },
    bannerGradient: ['#1e3a8a', '#1d4ed8', '#22d3ee'],
    bannerTransitionGradient: true
  },
  codex: {
    name: 'Codex Logic',
    tagline: '代码 + 理性',
    accent: { color: '#22c55e', bold: true },
    dim: { color: '#94a3b8' },
    success: { color: '#10b981', bold: true },
    warn: { color: '#eab308', bold: true },
    error: { color: '#ef4444', bold: true },
    active: { color: '#86efac', bold: true },
    selected: { backgroundColor: '#1f2937', color: '#bbf7d0', bold: true },
    borderActive: '#22c55e',
    borderInactive: '#475569',
    key: { color: '#22c55e', bold: true },
    value: { color: '#e5e7eb' },
    marker: { color: '#10b981', bold: true },
    bannerGradient: ['#166534', '#10b981', '#93c5fd'],
    bannerTransitionGradient: true
  },
  kimi: {
    name: 'Kimi Spring',
    tagline: '青春 + 草绿',
    accent: { color: '#84cc16', bold: true },
    dim: { color: '#a3a3a3' },
    success: { color: '#4ade80', bold: true },
    warn: { color: '#facc15', bold: true },
    error: { color: '#f87171', bold: true },
    active: { color: '#bef264', bold: true },
    selected: { backgroundColor: '#365314', color: '#ecfccb', bold: true },
    borderActive: '#84cc16',
    borderInactive: '#4d7c0f',
    key: { color: '#84cc16', bold: true },
    value: { color: '#f7fee7' },
    marker: { color: '#4ade80', bold: true },
    bannerGradient: ['#4d7c0f', '#84cc16', '#4ade80'],
    bannerTransitionGradient: true
  },
  dark: {
    name: 'Dark',
    tagline: '中性深色',
    accent: { color: '#60a5fa', bold: true },
    dim: { color: '#94a3b8' },
    success: { color: '#a78bfa', bold: true },
    warn: { color: '#f59e0b', bold: true },
    error: { color: '#ef4444', bold: true },
    active: { color: '#a78bfa', bold: true },
    selected: { backgroundColor: '#1e293b', color: '#bfdbfe', bold: true },
    borderActive: '#60a5fa',
    borderInactive: '#475569',
    key: { color: '#60a5fa', bold: true },
    value: { color: '#e2e8f0' },
    marker: { color: '#a78bfa', bold: true },
    bannerGradient: ['#334155', '#475569', '#a78bfa'],
    bannerTransitionGradient: true
  },
  light: {
    name: 'Light',
    tagline: '浅底清晰',
    accent: { color: '#2563eb', bold: true },
    dim: { color: '#64748b' },
    success: { color: '#0f766e', bold: true },
    warn: { color: '#b45309', bold: true },
    error: { color: '#dc2626', bold: true },
    active: { color: '#0f766e', bold: true },
    selected: { backgroundColor: '#dbeafe', color: '#1e3a8a', bold: true },
    borderActive: '#2563eb',
    borderInactive: '#94a3b8',
    key: { color: '#2563eb', bold: true },
    value: { color: '#111827' },
    marker: { color: '#0f766e', bold: true },
    bannerGradient: ['#2563eb', '#38bdf8', '#0f766e'],
    bannerTransitionGradient: true
  }
};

export function getThemeNames() {
  return [...THEME_NAMES];
}

export function resolveThemeName(...candidates) {
  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim().toLowerCase();
    if (THEME_NAMES.includes(normalized)) {
      return normalized;
    }
  }

  return 'gemini';
}

export function getTheme(themeName = 'gemini') {
  return THEMES[resolveThemeName(themeName)];
}

export function getThemeOption(themeName = 'gemini') {
  const normalized = resolveThemeName(themeName);
  const theme = THEMES[normalized];
  return {
    id: normalized,
    label: theme.name,
    tagline: theme.tagline || ''
  };
}

export function getThemeTone(themeName, tone, { colorEnabled = true } = {}) {
  if (!colorEnabled) return {};
  const theme = getTheme(themeName);
  return theme[tone] || {};
}
