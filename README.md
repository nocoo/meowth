<p align="center">
  <img src="assets/brand/icon-rounded.png" width="128" alt="Meowth logo" />
</p>
<h1 align="center">Meowth</h1>
<p align="center">通过同一个网页和 HTTP 接口，调用本机 coding CLI 并查看运行记录。</p>
<p align="center">
  <a href="docs/README.en.md">English</a>
</p>

## 这是什么

Meowth 是面向个人开发环境的 coding-agent 控制台。它在本机运行一个 Go daemon，将 Claude Code、Codex、GitHub Copilot CLI、Hermes 和 Pi 的命令行协议接到统一的 HTTP 接口，并把 Dashboard 嵌入同一个二进制。

你可以在浏览器里发起对话、查看输出和历史会话，也可以让可信脚本通过 API 调用这些 CLI。实际模型调用、登录和费用由相应 CLI 及其服务负责；Meowth 使用 daemon 所在机器已有的安装和凭据。

主要使用平台是 macOS。Windows 提供实验性的原生构建与 `init` / `serve` 流程，尚未覆盖完整运行测试和等价的文件权限保障。

## 功能

| 操作 | 当前行为 |
| --- | --- |
| 发现代理 | 检查五种 CLI 是否位于 PATH 中，并读取版本；能发现程序不代表已完成登录。 |
| 发起对话 | Dashboard 提供代理选择、流式回复、工具活动展开、继续对话和取消。 |
| 通过 API 执行 | 接收 prompt、工作目录、模型、超时和续聊 ID 等参数，返回 NDJSON 事件；具体选项支持情况取决于后端。 |
| 回看运行 | SQLite 保存会话状态和事件，Dashboard 可查看会话列表与消息内容。 |
| 管理访问凭据 | 创建、列出和撤销 bearer token；新 token 的完整值只在创建时显示。 |
| 配置远程入口 | 支持 Tailscale、SSH tunnel 和 HTTPS 反向代理对应的配置模式，传输与访问控制由相应工具提供。 |

所有 token 都具有完整 API 权限。后端以允许自动执行工具的方式启动，可使用当前用户的文件和命令权限；Meowth 不提供按项目隔离的文件系统沙箱。它适合本人和可信调用方使用。

## 使用

### 从源码安装

准备 Node.js 24 LTS、`package.json` 指定的 pnpm，以及 `daemon/go.mod` 要求的 Go 1.26.6 或更新版本。要实际发起对话，还需安装并登录至少一种支持的 CLI。

首次安装时运行：

```bash
git clone https://github.com/nocoo/meowth.git
cd meowth
pnpm install --frozen-lockfile
pnpm daemon:build
./daemon/meowthd init
./daemon/meowthd serve
```

`init` 创建 `~/.meowth/`，输出一次 `mwt_...` token，请保存后打开 `http://127.0.0.1:7040` 并粘贴到登录框。已有非空 `~/.meowth/` 时，`init` 会拒绝运行；后续使用已有配置和 token 启动 `serve` 即可。

在 Dashboard 的 Agents 页面确认 CLI 安装情况，再进入 Chat 发送消息。CLI 的认证、模型可用性和运行错误仍会影响对话结果。

Windows 可用 PowerShell 构建，在仓库根目录运行：

```powershell
pnpm install --frozen-lockfile
.\scripts\build-daemon.ps1
.\daemon\meowthd.exe init
.\daemon\meowthd.exe serve
```

### HTTP 调用

将保存的 token 放入 `MEOWTH_TOKEN` 环境变量后，可列出后端。下面的执行示例需要可用的 `claude`，并把 `cwd` 改成实际存在的绝对目录。

```bash
curl -H "Authorization: Bearer $MEOWTH_TOKEN" \
  http://127.0.0.1:7040/v1/agents

curl -N -H "Authorization: Bearer $MEOWTH_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"prompt":"Summarize this project.","cwd":"/absolute/path/to/project","timeout_ms":600000}' \
  http://127.0.0.1:7040/v1/agents/claude/exec
```

执行请求持续返回 NDJSON，客户端断开会取消对应运行。会话查询、取消与 token 接口见 [OpenAPI 定义](daemon/internal/server/openapi.yaml)。

### 数据与远程访问

daemon 的配置位于 `~/.meowth/config.toml`，token 摘要、会话与事件位于 `~/.meowth/meowth.db`。服务端用 Argon2id 保存 token 摘要；Dashboard 在浏览器 localStorage 中保存当前使用的 token。各 coding CLI 仍按自身约定保存凭据和会话。

默认地址为 `127.0.0.1:7040`。远程使用前，在 `[remote_access]` 中选择 `tailscale`、`ssh_tunnel` 或 `https_proxy`，填写对应地址和 `acknowledged_by`，然后重启 daemon；Settings 页面目前只显示状态。远程模式关闭首次 token mint 入口，外部代理或隧道应与该模式配置一起启用。字段和部署示例见[远程访问文档](docs/architecture/05-remote-access-modes.md)，启动命令为 `meowthd serve`。

## 开发

前端位于 `apps/dashboard/`，共享类型位于 `packages/shared/`，Go daemon 位于 `daemon/`。开发时复用已运行的 daemon；需要启动服务时分别使用：

```bash
./daemon/meowthd serve
```

```bash
pnpm dashboard:dev
```

Vite 默认运行于 `http://127.0.0.1:37040`，将 API 请求代理到 daemon 的 7040 端口。配置过本机 Caddy 的环境也可使用 `https://meowth.dev.hexly.ai`；这是本地开发域名。`MEOWTH_DAEMON_URL` 可以改变 Vite 的 API 目标，首次 token mint 使用 daemon 的直接地址 `/setup`。

`pnpm daemon:build` 会重新构建 Dashboard 并嵌入 Go 二进制；使用新二进制启动后，7040 端口的页面才会更新。前端开发细节见 [Vite 与主题文档](docs/features/08-dashboard-theme-and-vite.md)。

## 测试

在仓库根目录安装依赖后运行：

| 范围 | 命令 |
| --- | --- |
| Go 单元与包级测试 | `pnpm daemon:test` |
| Dashboard 和共享类型单元测试 | `pnpm dashboard:test` |
| 本机 HTTP 集成测试 | `pnpm test:l2` |
| 嵌入页面的 HTTP 集成测试 | 先 `pnpm daemon:build`，再 `pnpm test:l2:embed` |
| 浏览器测试 | 先 `pnpm --filter @meowth/dashboard e2e:install`，再 `pnpm dashboard:e2e` |

常规集成与浏览器测试使用独立测试目录、本机测试端口和模拟后端。真实 CLI 测试需要可用的登录与模型服务，会发起实际模型请求，可按需运行：

```bash
MEOWTH_REAL_BACKENDS_L2=1 pnpm test:l2:real
MEOWTH_REAL_CHAT=1 pnpm dashboard:e2e:real
```

## 技术栈

| 技术 | 用途 |
| --- | --- |
| Go / Chi | daemon、HTTP 路由与 CLI 子进程管理 |
| SQLite / sqlc | 本地 token、会话和事件数据 |
| React / TypeScript / Vite | Dashboard 与开发服务器 |
| Basalt / Tailwind CSS | 界面组件、主题与样式 |
| React Markdown / remark-gfm | 对话和会话消息渲染 |
| pnpm / Turborepo | 前端工作区和构建编排 |
| Go testing / Vitest / Playwright | 包级、界面单元和浏览器测试 |

## 文档

- [文档索引](docs/README.md)
- [项目定位与设计背景](docs/01-project-overview.md)
- [HTTP 协议与接口](docs/architecture/02-daemon-http-protocol.md)
- [初始化与首次 token](docs/architecture/04-bootstrap-and-first-run-mint.md)
- [聊天与会话内容展示](docs/features/11-session-chat-transcript.md)
- [Windows 实验性支持](docs/features/06-experimental-windows.md)
- [版本记录](CHANGELOG.md)

## 许可证

原创代码采用 [MIT](LICENSE)。`daemon/pkg/agent/` 来自 [Multica](https://github.com/multica-ai/multica)，保留其 [Modified Apache 2.0 许可证](daemon/pkg/agent/LICENSE)；上游来源和本地修改记录见 [UPSTREAM.md](daemon/pkg/agent/UPSTREAM.md)。使用这部分代码时需同时阅读其附加条款。
