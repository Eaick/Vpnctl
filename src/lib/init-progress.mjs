export const INIT_STEP_DEFINITIONS = [
  { id: 'validate', label: '校验平台与参数' },
  { id: 'directories', label: '准备运行目录' },
  { id: 'ports', label: '解析并探测端口' },
  { id: 'binary', label: '下载或生成 mihomo 占位二进制' },
  { id: 'install-state', label: '写入安装状态' },
  { id: 'subscriptions', label: '初始化订阅存储' },
  { id: 'managed-config', label: '生成受管配置' },
  { id: 'complete', label: '完成' }
];

export function buildInitProgressStep(id, status = 'pending', extra = {}) {
  const index = INIT_STEP_DEFINITIONS.findIndex((item) => item.id === id);
  const definition = INIT_STEP_DEFINITIONS[index];
  if (!definition) {
    throw new Error(`Unknown init progress step: ${id}`);
  }

  return {
    id: definition.id,
    label: definition.label,
    index: index + 1,
    total: INIT_STEP_DEFINITIONS.length,
    status,
    ...extra
  };
}

export function formatInitProgressLine(step) {
  const prefix = `[${step.index}/${step.total}]`;
  if (step.status === 'running') return `${prefix} ${step.label}...`;
  if (step.status === 'done') return `${prefix} ${step.label} 完成`;
  if (step.status === 'failed') return `${prefix} ${step.label} 失败: ${step.error || 'unknown error'}`;
  return `${prefix} ${step.label}`;
}
