# VPNCTL

[![Version](https://img.shields.io/badge/version-0.1.0-0f766e)](https://github.com/Eaick/Vpnctl)
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

`VPNCTL` 是一个面向 `mihomo` 的 Node.js CLI / TUI 管理器，目标是在终端内完成订阅管理、节点切换、测速、端口配置和运行时维护，而不是再做一个重型 Clash GUI。

当前版本：**0.1**（npm 版本号 `0.1.0`）。本版加入节点与总览卡片、订阅来源/名称编辑、分类测试菜单，并修复 Provider 节点测速和运行实例安全校验。

## 界面预览

以下 SVG 为界面示意图，数据均为虚构，不是个人运行截图。

### 总览卡片

![VPNCTL Overview View](./docs/assets/tui-overview.svg)

### 订阅管理

![VPNCTL Subscription View](./docs/assets/tui-subscriptions.svg)

### Provider / 节点视图

![VPNCTL Provider View](./docs/assets/tui-providers.svg)

## 特性

- 中文 TUI，支持初始化进度可视化、订阅删除确认和运行状态摘要
- 支持远程 URL、本地 YAML 和分享链接订阅导入
- 支持识别多种协议标签，例如 `VLESS`、`VMESS`、`TROJAN`、`SS`、`SSR`
- 支持保存多个订阅，但任意时刻只激活一个订阅，避免多个 provider 同时压垮 `mihomo`
- 支持节点协议筛选、节点测速、主题切换、Shell 集成和端口管理
- 支持两种代理端口模式：
  - `mix`：默认模式，使用 `mixed + api`
  - `separate`：兼容模式，使用 `http + socks + api`
- 对运行时做了账户隔离校验，避免不同系统用户误复用同一个 API 端口

## 运行要求

- Node.js `>= 18`
- Windows x64 或 Linux x64
- `mihomo`

## 安装

Linux 可使用统一脚本（安装仅执行 `npm install`、`npm run build`、`npm link`）：

```bash
bash scripts/vpnctl.sh
# 菜单：1 安装 / 2 卸载 / 3 测试 / 0 退出
# 也可直接执行安装：
bash scripts/vpnctl.sh install
vpnctl
```

### 测试菜单

在主菜单选择 `3` 后，可以选择全部测试，或单独测试订阅管理、初始化与端口、运行安全、TUI 布局、Shell 集成及构建入口。测试明细直接显示在终端，结束后输出通过或失败并返回菜单。安装/卸载仍保留平台检查和原有安全确认。

```bash
bash scripts/vpnctl.sh test               # 交互终端中打开测试菜单
bash scripts/vpnctl.sh test subscriptions # 直接运行订阅类测试
bash scripts/vpnctl.sh test all           # 全部自动测试
bash scripts/vpnctl.sh test entry         # 检查 dist 模块加载和 CLI 帮助输出
```

自动测试需要已安装项目依赖；运行前请按脚本提示确认可能清理的测试数据。测试失败不会退出交互菜单。此流程不验证真实节点联网，不启动实际 Mihomo；TUI 交互效果请用 `bash scripts/vpnctl.sh tui` 查看。无交互输入时，`test` 默认运行全部自动测试并用退出码报告结果。

Windows 或希望手动安装时使用下列命令：

```bash
npm install
npm run build
npm link
vpnctl
```

## 快速开始

### 1. 初始化

```bash
vpnctl init
```

默认会使用 `mix` 模式。初始化过程会显示分步进度，包括目录准备、端口探测、二进制准备、订阅存储初始化和受管配置生成。

### 2. 启动 TUI

```bash
vpnctl
```

推荐流程：

1. 添加订阅
2. 激活需要使用的订阅
3. 同步当前订阅
4. 启动 `mihomo`
5. 在节点页切换节点并测速

节点页以卡片显示节点名、协议和测速结果；总览卡片显示当前链路、端口、内网/代理出口 IP、连接数及 VPNCTL/Mihomo 内存。进入总览或按 `r` 刷新时才进行一次网络采样，不持续轮询。出口 IP 查询会通过当前 VPNCTL 代理请求 [ipify](https://www.ipify.org/)；需要 `curl`，缺失或请求失败时只影响网络卡片。

## 订阅模型

- 可以保存多个订阅
- 任意时刻只会有一个激活订阅
- 其他订阅处于休息状态，不参与当前运行
- `sync` 默认只同步当前激活订阅
- 同步结果为空或失败时保留上次成功的 Provider 缓存；TUI 不会激活同步失败的订阅
- `Providers` 面板显示的是当前真正生效的运行时 provider
- 在 TUI 订阅页选中订阅按 `e`，可修改名称、URL 或本地 YAML 路径；新来源验证成功后才替换缓存

## 常用命令

```bash
vpnctl init
vpnctl add-sub --url "https://example.com/sub"
vpnctl list-subs
vpnctl edit-sub --id "subscription-id" --url "https://example.com/new-sub" --name "新名称"
vpnctl edit-sub --id "subscription-id" --file "/srv/vpn/nodes.yaml"
vpnctl sync
vpnctl status
vpnctl doctor
vpnctl config set-ports --proxy-mode mix
vpnctl config set-ports --proxy-mode separate
vpnctl remove-sub --id "subscription-id"
```

运行中执行 `config set-ports` 会安全停止并重启本账户的 Mihomo；若新端口未就绪，会尝试恢复原配置和原端口。未运行时只保存设置，下次启动生效。

修改订阅时保留原 ID、Provider 标识及激活状态，也可在 URL 与本地文件之间切换。仅修改名称不会重新拉取订阅；来源变更会先读取并检查节点，读取失败或无可识别节点时保留原订阅及缓存。编辑弹窗中可按 `Ctrl+U` 清空当前字段，`Enter` 保存，`Esc` 取消。

## 卸载

Linux 可从源码目录执行交互式卸载：

```bash
bash scripts/vpnctl.sh uninstall
```

脚本会先停止本账户受管的 Mihomo；如果无法确认已停止，会中止清理，避免残留端口或误杀其他进程。之后移除 VPNCTL 写入的 `.bashrc` 片段（包括其中的 Codex 代理包装）并解除全局 npm link。它不会删除 `~/.codex`、其他软件的代理配置或源码目录。订阅、Provider 缓存和个人运行数据默认保留；选择删除时会再次确认。

Windows 或手动卸载可按以下顺序操作：

### 1. 停止 mihomo

```bash
vpnctl stop
```

### 2. 移除 Shell 集成

如果安装过 bashrc 集成，先移除受管片段：

```bash
vpnctl shell uninstall --bashrc
```

如果使用了自定义 bashrc 路径：

```bash
vpnctl shell uninstall --bashrc-path "/path/to/.bashrc"
```

### 3. 取消全局命令

如果通过 `npm link` 安装过全局命令：

```bash
npm unlink -g vpnctl-mihomo
```

如果只是克隆源码运行，删除项目目录即可。

### 4. 删除用户运行目录

正式模式的运行数据默认保存在当前系统用户目录下：

- Windows: `%USERPROFILE%\.vpnctl\`
- Linux: `~/.local/share/vpnctl/`

确认不再需要订阅缓存、生成配置和运行日志后，可以手动删除对应目录。

## 配置示例

仓库只提供可公开的示例文件：

- [config.example.yaml](./config.example.yaml)

真实订阅配置和用户运行态文件不应该提交到仓库。

## 开发

Linux 一键运行现有测试：

```bash
bash scripts/vpnctl.sh test
bash scripts/vpnctl.sh tui
```

`test` 会调用 `npm test` 并检查已构建的 TUI 入口；`tui` 用于交互验收界面，不自动下载或启动 Mihomo。

```bash
npm test
npm run build
```

`test/` 目录属于源码仓库的一部分，用于保证订阅解析、初始化流程、端口规划和 TUI 状态行为不回退。

## 许可证

MIT
