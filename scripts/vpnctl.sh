#!/usr/bin/env bash
set -euo pipefail

project_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
runtime_root="${HOME:?HOME is required}/.local/share/vpnctl"

require_linux() {
  if [[ "$(uname -s)" != Linux ]]; then
    printf '此脚本只支持 Linux；Windows 请使用现有 npm 命令。\n' >&2
    exit 1
  fi
}

confirm() {
  local answer
  if [[ ! -t 0 ]]; then
    printf '需要交互确认，已取消操作。\n' >&2
    exit 1
  fi
  printf '%s 输入 yes 继续：' "$1"
  read -r answer
  [[ "$answer" == yes ]] || { printf '已取消。\n'; exit 1; }
}

run_vpnctl() {
  if [[ -f "$project_root/dist/index.js" ]]; then
    env -u MIHOMO_API -u MIHOMO_BIN -u MIHOMO_DIR -u MIHOMO_HTTP_PROXY -u MIHOMO_SOCKS_PROXY \
      VPNCTL_MODE=user node "$project_root/dist/index.js" "$@"
  elif [[ -f "$project_root/src/index.mjs" ]]; then
    env -u MIHOMO_API -u MIHOMO_BIN -u MIHOMO_DIR -u MIHOMO_HTTP_PROXY -u MIHOMO_SOCKS_PROXY \
      VPNCTL_MODE=user node "$project_root/src/index.mjs" "$@"
  else
    return 127
  fi
}

managed_process_present() {
  local pid executable
  while read -r pid; do
    [[ -n "$pid" ]] || continue
    executable="$(readlink -f -- "/proc/$pid/exe" 2>/dev/null || true)"
    if [[ "$executable" == "$runtime_root/mihomo/mihomo" ]]; then
      return 0
    fi
  done < <(pgrep -u "$(id -u)" -x mihomo || true)
  return 1
}

install_vpnctl() {
  require_linux
  cd "$project_root"
  npm install
  npm run build
  npm link
  printf '\n安装完成。输入 vpnctl 启动 TUI。\n'
}

test_entry() {
  cd "$project_root"
  if [[ -f "$project_root/dist/index.js" ]]; then
    if ! node "$project_root/dist/index.js" help; then
      printf '构建入口检查失败。\n' >&2
      return 1
    fi
    printf 'CLI 模块加载与帮助输出正常；此项不验证 TUI 交互或真实节点联网。\n'
  else
    printf 'dist 不存在；请先执行 scripts/vpnctl.sh install，再检查 TUI 入口。\n' >&2
    return 1
  fi
}

test_vpnctl() {
  local suite="${1:-all}" label status
  local -a files=()
  case "$suite" in
    all) label='全部自动测试' ;;
    subscriptions)
      label='订阅管理与同步保护'
      files=(subscriptions cli-subscription sync-safety)
      ;;
    ports)
      label='初始化、迁移与端口配置'
      files=(install migration ports port-change runtime prereq)
      ;;
    runtime)
      label='运行安全与节点测速接口'
      files=(safe-runtime managed-runtime runtime-apply mihomo-delay)
      ;;
    ui)
      label='TUI 卡片、布局与总览'
      files=(dashboard tui-cards tui-layout tui-latency tui-node-view ui-guidance overview-monitor latency-targets theme help)
      ;;
    shell) label='Shell 集成与管理脚本'; files=(shell script-menu) ;;
    entry) label='构建入口检查' ;;
    *) printf '未知测试分类：%s\n' "$suite" >&2; return 2 ;;
  esac

  cd "$project_root"
  printf '\n========== %s ==========\n' "$label"
  printf '自动测试不检测机场节点可用性，不启动实际 Mihomo。\n'
  if [[ "$suite" != entry && -e "$project_root/.sandbox" ]]; then
    confirm "自动测试会重置 $project_root/.sandbox；其中的开发配置会被清除。"
  fi
  status=0
  if [[ "$suite" == entry ]]; then
    test_entry || status=$?
  elif [[ "$suite" == all ]]; then
    npm test || status=$?
  else
    local index
    for index in "${!files[@]}"; do
      files[$index]="$project_root/test/${files[$index]}.test.mjs"
    done
    node --test --experimental-test-isolation=none "${files[@]}" || status=$?
  fi
  if [[ "$status" == 0 ]]; then
    printf '\n[通过] %s\n' "$label"
  else
    printf '\n[失败] %s（退出码 %s），请查看上方错误。\n' "$label" "$status" >&2
  fi
  return "$status"
}

test_menu() {
  local choice suite
  while true; do
    printf '\n========== VPNCTL 测试菜单 ==========\n'
    printf '1. 全部自动测试\n2. 订阅管理与同步保护\n3. 初始化、迁移与端口配置\n'
    printf '4. 运行安全与节点测速接口\n5. TUI 卡片、布局与总览\n6. Shell 集成\n7. 构建入口检查\n0. 返回主菜单\n'
    printf '请选择测试项：'
    read -r choice || return 0
    case "$choice" in
      1) suite=all ;;
      2) suite=subscriptions ;;
      3) suite=ports ;;
      4) suite=runtime ;;
      5) suite=ui ;;
      6) suite=shell ;;
      7) suite=entry ;;
      0) return 0 ;;
      *) printf '无效选项，请输入 0-7。\n'; continue ;;
    esac
    # 独立运行，取消或失败时不退出上层菜单。
    bash "$project_root/scripts/vpnctl.sh" test "$suite" || true
  done
}

main_menu() {
  local choice action status
  while true; do
    printf '\n========== VPNCTL 管理菜单 ==========\n'
    printf '1. 安装\n2. 卸载\n3. 测试\n0. 退出\n'
    printf '请选择操作：'
    read -r choice || return 0
    case "$choice" in
      1) action=install ;;
      2) action=uninstall ;;
      3) test_menu; continue ;;
      0) return 0 ;;
      *) printf '无效选项，请输入 0-3。\n'; continue ;;
    esac
    status=0
    bash "$project_root/scripts/vpnctl.sh" "$action" || status=$?
    if [[ "$status" != 0 ]]; then
      printf '操作未完成（退出码 %s），请查看上方提示。\n' "$status" >&2
    fi
  done
}

remove_shell_block() {
  local bashrc_path="$HOME/.bashrc"
  if [[ -f "$runtime_root/install.json" ]]; then
    local saved_path
    saved_path="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.shellIntegration?.bashrcPath || "")' "$runtime_root/install.json")"
    if [[ -n "$saved_path" ]]; then
      bashrc_path="$saved_path"
    fi
  fi
  if [[ -f "$bashrc_path" ]] && grep -Fq '# >>> vpnctl >>>' "$bashrc_path"; then
    run_vpnctl shell uninstall --bashrc-path "$bashrc_path"
    if grep -Fq '# >>> vpnctl >>>' "$bashrc_path"; then
      printf '受管 bashrc 配置块仍存在，停止卸载：%s\n' "$bashrc_path" >&2
      exit 1
    fi
  fi
}

uninstall_vpnctl() {
  require_linux
  if [[ "$HOME" == / ]]; then
    printf 'HOME 指向根目录，拒绝卸载。\n' >&2
    exit 1
  fi
  confirm "将停止本账户受管 Mihomo、解除全局 npm link、清除 VPNCTL 管理的 bashrc/Codex 包装。"

  if [[ -f "$runtime_root/data/mihomo.pid" ]]; then
    if ! run_vpnctl stop; then
      printf '无法安全停止受管 Mihomo；未删除任何运行文件。\n' >&2
      exit 1
    fi
    if [[ -f "$runtime_root/data/mihomo.pid" ]]; then
      printf 'PID 文件仍存在；请检查内核是否停止，卸载已中止。\n' >&2
      exit 1
    fi
  fi
  if managed_process_present; then
    printf '检测到仍在运行的本账户 VPNCTL Mihomo；为避免端口残留，卸载已中止。\n' >&2
    exit 1
  fi

  remove_shell_block
  cd "$project_root"
  if command -v vpnctl >/dev/null 2>&1; then
    local linked_target
    linked_target="$(readlink -f -- "$(command -v vpnctl)")"
    if [[ "$linked_target" != "$project_root/dist/index.js" ]]; then
      printf '全局 vpnctl 不指向当前源码，拒绝解除其他安装：%s\n' "$linked_target" >&2
      exit 1
    fi
    npm unlink -g vpnctl-mihomo
  fi

  if [[ -e "$runtime_root" ]]; then
    if [[ -L "$HOME/.local" || -L "$HOME/.local/share" || -L "$runtime_root" ]]; then
      printf '运行目录路径异常，拒绝清理：%s\n' "$runtime_root" >&2
      exit 1
    fi
    rm -f -- "$runtime_root/mihomo/mihomo" "$runtime_root/config/config.yaml" "$runtime_root/data/runtime-lock.json"
    printf '保留订阅、Provider 缓存和个人配置？[Y/n] '
    read -r answer
    if [[ "$answer" == n || "$answer" == N ]]; then
      confirm "将永久删除 $runtime_root 内的订阅、Provider、日志和个人设置。"
      rm -rf -- "$runtime_root"
    else
      printf '已保留个人配置：%s\n' "$runtime_root"
    fi
  fi

  printf 'VPNCTL 已卸载。源码目录未删除：%s\n' "$project_root"
  printf '当前 Shell 若仍有代理变量，请执行：unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy\n'
}

case "${1:-}" in
  '') main_menu ;;
  install) install_vpnctl ;;
  test)
    if [[ $# -ge 2 ]]; then
      test_vpnctl "$2"
    elif [[ -t 0 ]]; then
      test_menu
    else
      test_vpnctl all
    fi
    ;;
  tui) cd "$project_root"; run_vpnctl tui ;;
  uninstall) uninstall_vpnctl ;;
  *) printf '用法：bash scripts/vpnctl.sh [install|uninstall|tui|test [all|subscriptions|ports|runtime|ui|shell|entry]]\n不带参数时显示交互菜单。\n' >&2; exit 2 ;;
esac
