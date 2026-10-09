# VPNCTL

[![Version](https://img.shields.io/badge/VPNCTL-0.1.1-0f766e)](https://github.com/Eaick/Vpnctl)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![mihomo](https://img.shields.io/badge/runtime-mihomo-0f766e)](https://github.com/MetaCubeX/mihomo)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![GitHub Repo](https://img.shields.io/badge/GitHub-Eaick%2FVpnctl-181717?logo=github)](https://github.com/Eaick/Vpnctl)

```text
██╗   ██╗██████╗ ███╗   ██╗ ██████╗████████╗██╗
██║   ██║██╔══██╗████╗  ██║██╔════╝╚══██╔══╝██║
██║   ██║██████╔╝██╔██╗ ██║██║        ██║   ██║
╚██╗ ██╔╝██╔═══╝ ██║╚██╗██║██║        ██║   ██║
 ╚████╔╝ ██║     ██║ ╚████║╚██████╗   ██║   ███████╗
  ╚═══╝  ╚═╝     ╚═╝  ╚═══╝ ╚═════╝   ╚═╝   ╚══════╝
```

## 最新动态

**2026-10-09 · VPNCTL 0.1.1**

- 节点页按终端宽度显示 1～4 列卡片，低高度时自动使用紧凑列表。
- 将可识别的流量、到期、重置和公告提示放入只读提示区，按 `v` 展开或收起，不参与节点选择和测速。
- 保留独立光标和当前使用标记，修正三角标记的终端宽度问题，支持方向键按卡片移动。
- 新增 `vpnctl --version`，TUI 顶部同步显示 VPNCTL 程序版本。
- 保留原有订阅下载、节点名称、Mihomo 配置和 provider 测速回退逻辑，并补充终端渲染及切换、测速回归测试。

> 流量提示来自最近同步的订阅节点文字，不是实时余额。本版尚未解析 `subscription-userinfo` 响应头；若机场只通过响应头提供流量信息，则不会显示额度。

**2026-10-07 · VPNCTL 0.1 维护更新**

- 修复部分机场根据客户端类型返回不同节点配置，导致 VPNCTL 测速显示 `ERR` 的兼容问题。
- 订阅同步使用 `clash.meta` 请求头，优先获取机场提供的 Mihomo 原生配置。
- 整组测速完成后显示首个失败节点的具体原因，便于排查超时和配置问题。

> **已安装用户：** 根据安装方式选择 [Git 克隆更新](#git-克隆安装更新) 或 [ZIP 下载更新](#zip-下载安装更新)。更新后，在订阅页按 `y` 重新同步，再按 `d` 测速。

## 项目简介

**VPNCTL 是面向 Linux 服务器和 SSH 会话的 Mihomo 终端管理器。** 不依赖桌面环境，在中文 TUI 中管理订阅、选择节点、测速、配置端口，并让当前账户的终端应用使用代理。

VPNCTL 当前版本：**0.1.1**，可执行 `vpnctl --version` 查看；这不是 npm 工具或 Mihomo 内核的版本。它不是全系统透明代理，不自动接管其他用户或其他进程的网络。

## 导航

- [界面预览](#界面预览) · [功能](#功能) · [运行要求](#运行要求)
- [安装](#安装) · [更新已安装版本](#更新已安装版本) · [离线安装 Mihomo](#离线安装-mihomo)
- [开始使用](#开始使用) · [订阅管理](#订阅管理) · [端口与联网](#端口与联网)
- [终端与 Codex 代理](#终端与-codex-代理) · [测试](#测试) · [卸载](#卸载) · [运行数据](#运行数据)

## 界面预览

以下 SVG 为界面示意图，数据均为虚构，不是个人运行截图。

### 总览卡片

![VPNCTL Overview View](./docs/assets/tui-overview.svg)

### 订阅管理

![VPNCTL Subscription View](./docs/assets/tui-subscriptions.svg)

### 节点卡片

![VPNCTL Provider View](./docs/assets/tui-providers.svg)

## 功能

- 中文 TUI，支持初始化进度可视化、订阅删除确认和运行状态摘要
- 导入远程订阅 URL、本地 YAML 或分享链接列表，可修改来源及名称
- 支持识别多种协议标签，例如 `VLESS`、`VMESS`、`TROJAN`、`SS`、`SSR`
- 保存多个订阅，但任意时刻只激活一个，其余订阅休息
- 支持节点协议筛选、节点测速、主题切换、Shell 集成和端口管理
- 默认 `mix` 模式：HTTP 与 SOCKS5 共用混合端口，另设 API 端口
- 可切换 `separate` 模式：HTTP、SOCKS5 与 API 分别使用端口
- 对运行时做了账户隔离校验，避免不同系统用户误复用同一个 API 端口

## 运行要求

- Node.js `>= 18`
- Linux x64、Bash 和可正常显示中文的终端
- npm；使用 Git 拉取源码时需安装 Git
- Mihomo：由初始化流程下载，安装脚本本身不下载内核
- `curl`：用于总览网络检测；`pgrep`、`readlink`：用于卸载安全检查

安装和运行请使用自己的普通账户，不要通过 `sudo` 启动 VPNCTL。初始化下载内核、远程订阅同步和安装依赖需要服务器能访问对应下载源。

## 安装

先选择一种方式获取源码，再执行安装。

### 方式一：Git 克隆

```bash
git clone https://github.com/Eaick/Vpnctl.git
cd "Vpnctl"
bash scripts/vpnctl.sh install
```

### 方式二：下载 ZIP

从 GitHub 的 **Code → Download ZIP** 或 [源码 ZIP 下载链接](https://github.com/Eaick/Vpnctl/archive/refs/heads/main.zip) 下载，解压后进入项目目录。服务器不能访问 GitHub 时，可先在能联网的电脑上下载，再上传至服务器。

```bash
cd "/path/to/Vpnctl-main"
bash scripts/vpnctl.sh install
```

将示例路径替换为实际解压目录。ZIP 安装不需要 Git。

### 管理菜单与手动安装

上述安装命令都会依次执行 `npm install`、`npm run build`、`npm link`，完成后输入 `vpnctl` 即可使用。也可在源码目录运行管理菜单：

```bash
bash scripts/vpnctl.sh
```

```text
1. 安装
2. 卸载
3. 测试
0. 退出
```

选择 `1` 安装、`2` 卸载、`3` 测试。手动安装命令如下：

```bash
npm install
npm run build
npm link
vpnctl
```

## 更新已安装版本

先退出旧 TUI。更新程序会保留当前账户的订阅、端口、受管 Mihomo 和个人运行数据；无需卸载，也不要重新执行 `vpnctl init`。

| 原安装方式 | 识别方式 | 更新方法 |
| --- | --- | --- |
| Git 克隆 | 使用过 `git clone`，源码目录带 `.git` | 拉取新版，再运行安装脚本 |
| ZIP 下载 | 解压源码压缩包，通常没有 `.git` | 下载新版 ZIP，解压到新目录，再运行安装脚本 |

### Git 克隆安装更新

进入**原安装源码目录**，执行这一条命令：

```bash
git pull --ff-only && bash scripts/vpnctl.sh install
```

如果 Git 提示本地修改或无法快进，请先处理自己的修改，不要强制覆盖。服务器不能访问 GitHub 时，也可以使用下面的 ZIP 更新方式。

### ZIP 下载安装更新

1. 重新下载 [最新源码 ZIP](https://github.com/Eaick/Vpnctl/archive/refs/heads/main.zip)。服务器不能访问 GitHub 时，在能联网的电脑下载后上传。
2. 将压缩包解压到一个**新的目录**，保留旧源码目录作为备份。
3. 进入新源码目录，执行安装命令：

```bash
cd "/path/to/new/Vpnctl-main"
bash scripts/vpnctl.sh install
```

`npm link` 会让全局 `vpnctl` 指向新源码目录。个人运行数据默认位于 `~/.local/share/vpnctl/`，仍可继续使用。请保留新源码目录，因为全局命令依赖其中的构建文件；ZIP 安装无需执行 `git pull`。

如果已有别人提供的完整新版 `dist/`，也可替换原源码目录的 `dist/`；新增或变更依赖时仍需安装依赖。GitHub 源码 ZIP 本身不包含 `dist/`，需要执行上述安装命令来构建。

### 更新后操作

运行 `vpnctl --version` 确认显示 `VPNCTL 0.1.1`，再启动 `vpnctl`。节点页布局更新无需重新初始化；从订阅兼容性修复前的旧版本升级时，在订阅页激活要使用的订阅，按 `y` 重新同步，再进入节点页按 `d` 测速，以替换旧订阅缓存。

若 npm 报错连接已关闭的本地代理端口，在当前终端执行 `vpnoff`。npm 自己保存的代理还需检查 `npm config get proxy` 和 `npm config get https-proxy`；Mihomo 正在运行且下载需要代理时，可执行 `vpnon` 获取当前有效端口。

## 离线安装 Mihomo

服务器无法访问 GitHub 时，可以在能联网的电脑上下载 Mihomo，再上传到服务器。以下用于 Linux x64 的首次安装，假设已完成上面的 VPNCTL 安装，并使用默认运行目录。

1. 在服务器执行 `uname -m`，确认输出为 `x86_64`。应下载服务器对应的 Linux 内核，而不是下载电脑对应的版本。
2. 在能联网的电脑上打开 [Mihomo 官方发布页](https://github.com/MetaCubeX/mihomo/releases)。以下以 `v1.19.31` 为例：[下载 Linux amd64 v1 内核](https://github.com/MetaCubeX/mihomo/releases/download/v1.19.31/mihomo-linux-amd64-v1-v1.19.31.gz)。
3. 将下载的 `.gz` 文件上传至服务器的 `~/upload/` 目录。若服务器也无法拉取 VPNCTL 源码，可一并上传源码，再执行安装命令。
4. 先跳过在线下载完成初始化：

```bash
vpnctl init --skip-download
```

5. 检查压缩文件，解压到受管内核路径，并赋予执行权限：

```bash
gzip -t "$HOME/upload/mihomo-linux-amd64-v1-v1.19.31.gz" &&
gzip -dc "$HOME/upload/mihomo-linux-amd64-v1-v1.19.31.gz" \
  > "$HOME/.local/share/vpnctl/mihomo/mihomo" &&
chmod 755 "$HOME/.local/share/vpnctl/mihomo/mihomo" &&
"$HOME/.local/share/vpnctl/mihomo/mihomo" -v
```

6. 确认显示真实 Mihomo 版本后，输入 `vpnctl`，添加订阅并启动内核。

**顺序必须是先初始化、再替换内核。** `--skip-download` 生成的只是占位文件，不能代理；替换后不要再次执行初始化，否则会覆盖手动放入的内核。已有安装只需先停止受管 Mihomo，再替换内核，不要重复初始化。自定义运行目录时，请相应调整上述目标路径。

本节只解决 Mihomo 无法从 GitHub 下载的问题；`npm install` 仍需访问 npm 下载源。远程订阅也无法访问时，可以上传本地 YAML，在 TUI 中添加文件订阅，或执行 `vpnctl add-sub --file "/srv/vpn/nodes.yaml" --name "本地订阅"`。

## 开始使用

### 1. 初始化

若已按“离线安装 Mihomo”章节完成初始化和内核替换，请跳过此步，直接启动 TUI。

```bash
vpnctl init
```

默认会使用 `mix` 模式。初始化过程会显示分步进度，包括目录准备、端口探测、二进制准备、订阅存储初始化和受管配置生成。

### 2. 启动 TUI

```bash
vpnctl
```

推荐在 TUI 中按以下顺序操作：

1. 添加订阅
2. 激活需要使用的订阅
3. 同步当前订阅
4. 启动 `mihomo`
5. 在节点页切换节点并测速

节点页以卡片显示节点名、协议和测速结果；总览卡片显示当前链路、端口、内网/代理出口 IP、连接数及 VPNCTL/Mihomo 内存。进入总览或按 `r` 刷新时才进行一次网络采样，不持续轮询。出口 IP 查询会通过当前 VPNCTL 代理请求 [ipify](https://www.ipify.org/)；需要 `curl`，缺失或请求失败时只影响网络卡片。

### 节点页操作

| 按键 / 标记 | 作用 |
| --- | --- |
| `↑` / `↓` | 在节点卡片之间按行移动，紧凑列表中逐项移动 |
| `←` / `→` | 切换相邻卡片；首张卡片按 `←` 返回提供方 |
| `Enter` | 将光标所在节点设为实际使用节点 |
| `/` / `f` | 文本搜索 / 协议筛选，两者共同生效 |
| `d` | 对当前筛选后的节点执行测速，不包含只读提示 |
| `v` | 展开或收起订阅提示；终端过低时优先显示节点 |
| `►` / `● 使用中` | 光标位置 / 当前实际节点，移动光标不会自动切换代理 |

提示区读取已有订阅中的明确提示文字，不修改原始节点名或内核配置。没有这些文字时不推算余额，也不会将 Mihomo 本次运行流量当作机场剩余额度。

## 订阅管理

- 可以保存多个订阅
- 任意时刻只会有一个激活订阅
- 其他订阅处于休息状态，不参与当前运行
- `sync` 默认只同步当前激活订阅
- 同步结果为空或失败时保留上次成功的 Provider 缓存；TUI 不会激活同步失败的订阅
- 提供方面板包含当前运行的策略组和订阅；`GLOBAL`、`VPNCTL` 是内部策略组，不是机场名称
- 在 TUI 订阅页选中订阅按 `e`，可修改名称、URL 或本地 YAML 路径；新来源验证成功后才替换缓存

```bash
vpnctl add-sub --url "https://example.com/sub" --name "示例订阅"
vpnctl add-sub --file "/srv/vpn/nodes.yaml" --name "本地订阅"
vpnctl list-subs
vpnctl edit-sub --id "subscription-id" --url "https://example.com/new-sub" --name "新名称"
vpnctl edit-sub --id "subscription-id" --file "/srv/vpn/nodes.yaml"
vpnctl sync
vpnctl remove-sub --id "subscription-id"
```

修改订阅时保留原 ID、Provider 标识及激活状态，也可在 URL 与本地文件之间切换。仅修改名称不会重新拉取订阅；来源变更会先读取并检查节点，读取失败或无可识别节点时保留原订阅及缓存。编辑弹窗中可按 `Ctrl+U` 清空当前字段，`Enter` 保存，`Esc` 取消。

## 端口与联网

默认使用混合端口模式。端口可能因占用而自动调整，请以 `vpnctl status` 或 TUI 中显示的实际端口为准，不要假定固定为 7890 或 9090。

```bash
vpnctl status
vpnctl doctor
vpnctl config set-ports --proxy-mode mix
vpnctl config set-ports --proxy-mode separate
```

运行中切换端口模式会停止并重启本账户受管的 Mihomo；若新端口未就绪，会尝试恢复原配置和端口。未运行时只保存设置，下次启动生效。

测试实际代理连接时，把下例的端口替换为当前有效的混合端口或 HTTP 端口：

```bash
curl --noproxy '' -x http://127.0.0.1:7890 --max-time 15 -I https://www.google.com/
```

## 终端与 Codex 代理

安装 VPNCTL 的受管 Bash 配置块：

```bash
vpnctl shell install
source ~/.bashrc
```

启用后，`codex` 与 `codexvpn` 会在启动时检查本账户受管的 Mihomo，并使用当前有效代理端口；内核未运行时清除相关代理变量。`vpnon`、`vpnoff` 可启用或关闭当前终端的代理变量，`vpnstat` 查看诊断。

这些功能只影响使用该配置的 Bash 会话，不是 TUN 或操作系统全局代理。不同系统账户拥有各自的运行目录、订阅和内核状态。

## 测试

在管理菜单选择 `3`，或执行：

```bash
bash scripts/vpnctl.sh test
bash scripts/vpnctl.sh test subscriptions
bash scripts/vpnctl.sh test all
bash scripts/vpnctl.sh test entry
bash scripts/vpnctl.sh tui
```

测试菜单按订阅管理、初始化与端口、运行安全、TUI 卡片与布局、Shell 集成和构建入口分类，输出测试明细及通过/失败结果。`test/` 是源码中的自动测试，由脚本统一调用。运行前需安装依赖，并按提示确认可能清理的测试数据；失败不会退出交互菜单。

自动测试不代表真实机场节点一定能联网，也不启动实际 Mihomo；`tui` 用于查看界面。无交互输入时，`test` 默认运行全部自动测试并通过退出码报告结果。

## 卸载

从源码目录选择管理菜单的 `2`，或执行：

```bash
bash scripts/vpnctl.sh uninstall
```

卸载脚本按以下顺序处理：

1. 确认并停止本账户受管的 Mihomo；无法确认停止时中止卸载，不继续删除文件。
2. 从安装时记录的 Bash 配置文件（默认 `~/.bashrc`）删除 VPNCTL 受管块，并检查是否仍有残留标记。
3. 解除指向本源码目录的全局 npm link，删除受管内核及生成的配置。
4. 询问是否保留订阅、Provider 缓存及个人配置；删除个人数据需要再次确认。

删除的 Bash 受管块位于以下标记之间，包含 VPNCTL 代理函数、Codex 包装函数及相关别名：

```text
# >>> vpnctl >>>
...
# <<< vpnctl <<<
```

**删除 `.bashrc` 中的配置，不会自动清除已打开终端中加载的函数或代理变量。** Mihomo 停止后，旧代理变量仍可能指向已关闭的端口，导致 npm、curl 或 Codex 连接失败。

卸载后请打开新的 SSH 会话。若要继续使用当前 Bash 会话，可执行：

```bash
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
unset -f vpnctl-proxy-on vpnctl-proxy-off vpnctl-proxy-status vpnctl-codex-env vpnctl-codex codex
unalias vpnon vpnoff vpnstat codexvpn 2>/dev/null || true
```

以上命令清除当前会话的代理变量和受管包装，不会卸载 Codex 本身。仅重新执行 `source ~/.bashrc` 不会删除已加载的旧函数。如果曾手动粘贴不带受管标记的旧配置，需另行检查并清理该片段。

脚本不会删除 `~/.codex`、其他软件的代理配置或源码目录。若卸载中止，尚未执行的清理步骤不会继续。

## 运行数据

个人运行目录默认为 `~/.local/share/vpnctl/`，包含内核、安装状态、订阅、缓存、生成配置和日志。卸载时默认保留个人订阅数据。

仓库仅提供 [公开配置示例](./config.example.yaml)。

## 许可证

MIT
