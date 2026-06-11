# VPNCTL

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

## 界面预览

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

```bash
npm install
npm run build
```

如果需要把它作为全局命令使用：

```bash
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

### 3. 开发沙箱模式

```bash
node ./dist/index.js dev init --skip-download
node ./dist/index.js
node ./dist/index.js dev clean
```

开发模式默认写入 `.sandbox/`，不会污染正式用户目录。

## 订阅模型

- 可以保存多个订阅
- 任意时刻只会有一个激活订阅
- 其他订阅处于休息状态，不参与当前运行
- `sync` 默认只同步当前激活订阅
- `Providers` 面板显示的是当前真正生效的运行时 provider

## 常用命令

```bash
vpnctl init
vpnctl add-sub --url "https://example.com/sub"
vpnctl sync
vpnctl status
vpnctl doctor
vpnctl config set-ports --proxy-mode mix
vpnctl config set-ports --proxy-mode separate
vpnctl remove-sub --id "subscription-id"
```

## 卸载

`VPNCTL` 当前没有单独的 `vpnctl uninstall` 一键卸载命令，推荐按下面顺序清理，避免残留后台进程或 Shell 代理环境。

### 1. 停止 mihomo

```bash
vpnctl stop
```

如果只是在开发沙箱中测试，可以改用：

```bash
node ./dist/index.js dev clean
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

```bash
npm test
npm run build
```

`test/` 目录属于源码仓库的一部分，用于保证订阅解析、初始化流程、端口规划和 TUI 状态行为不回退。

## 许可证

MIT
