# 自动根据 mihomo 是否运行，给当前 shell 挂上/移除代理环境变量
if command -v vpnctl >/dev/null 2>&1; then
  eval "$(vpnctl env --shell bash --quiet 2>/dev/null || true)"
fi

# 可选：给 codex 包一层
codexp() {
  eval "$(vpnctl env --shell bash --quiet 2>/dev/null || true)"
  codex "$@"
}
