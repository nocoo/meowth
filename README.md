# Meowth

> 本项目根本目的与定位详见 [`docs/01-project-overview.md`](docs/01-project-overview.md)

macOS 本机 coding-agent 桥接层：Go daemon 暴露 HTTP，Vite/React dashboard 管理本机已安装的 5 家 coding CLI（claude / copilot / codex / hermes / pi）。一句话：**「我」对本机一切 coding agent 的统一控制台与远程入口**。

## 当前能力

| 能力 | 状态 |
|------|------|
| `meowthd` daemon（Go 二进制,默认 bind `127.0.0.1:7040`） | ✅ |
| 5 家 backend 统一调度 SDK（claude / codex / copilot / hermes / pi） | ✅ 5/5 真实端到端跑通 |
| HTTP API：agents / exec / sessions / messages / tokens / mint / healthz | ✅ |
| Bearer token 全生命周期（init / bootstrap / mint path B / 创建 / 撤销） | ✅ |
| 4 种远程访问模式（local / tailscale / ssh\_tunnel / https\_proxy） | ✅ 启动期校验 |
| SQLite 持久化（tokens hash / sessions / messages） | ✅ |
| Web Dashboard（Setup / Overview / Agents / Sessions / Tokens / Settings） | ✅ `go:embed` 同源 |
| 6DQ 质量门（G1 静态 + G2 安全 + L1 单测 + L2 真 HTTP + L3 Playwright + D1 隔离） | ✅ husky pre-commit 跑 lint-staged 子集,pre-push 跑 vet + tsc + L1 + 覆盖率 + L2 + G2;CI（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）在 macOS runner 上跑 lint / build matrix / l1 / l2 / l2-embed / l3(embed+embed-mint) / g2 / secret-scan;**D1 + dashboard-dev L3 仅手动跑** |

详见 [`docs/01-project-overview.md`](docs/01-project-overview.md) §10.1 与 [`docs/architecture/README.md`](docs/architecture/README.md) 的实施状态表。

## 仓库结构（Monorepo）

pnpm + Turborepo + TypeScript + Biome。`daemon/` 为独立 Go module（不在 pnpm workspace）。

```
meowth/
├── apps/
│   └── dashboard/           @meowth/dashboard  Vite + React 19 + basalt（daemon 管理面板）
├── daemon/                  Go module（独立）,主二进制 cmd/meowthd
│   ├── cmd/meowthd/         主入口（init / bootstrap-token / serve）
│   ├── pkg/agent/           5 家 backend SDK（从 multica vendored）
│   └── internal/server/     HTTP 控制面（chi + 中间件链 + handlers）
├── packages/
│   └── shared/              @meowth/shared  dashboard ↔ daemon 共享类型
├── docs/                    编号文档（见 docs/README.md）
├── scripts/                 L2 harness + e2e fixture + 扫描脚本
├── pnpm-workspace.yaml      只覆盖 apps/dashboard + packages/*
├── turbo.json
├── biome.json
└── tsconfig.base.json
```

## 文档地图

| 入口 | 内容 |
|------|------|
| [`docs/README.md`](docs/README.md) | 整体文档索引（顶层 + 子目录） |
| [`docs/01-project-overview.md`](docs/01-project-overview.md) | **「为什么 + 是什么 + 怎么造」的根**：目标、非目标、架构、Phase 计划、6DQ |
| [`docs/architecture/`](docs/architecture/README.md) | 8 篇系统架构文档（SDK / HTTP / SQLite / Mint / 远程 / Dashboard / 安全 / 6DQ） |
| [`docs/features/`](docs/features/README.md) | 功能迭代记录（如端口迁移到 Hexly Caddy） |

### 想做某事时应该先读哪篇

| 你想…… | 先读 |
|---|---|
| 用 daemon 跑一个 agent | 本 README → [`HTTP API 用法`](#http-api-用法) |
| 二开 / 加 backend / 改协议 | [`docs/architecture/01`](docs/architecture/01-agent-sdk-pump-from-multica.md) + [`02`](docs/architecture/02-daemon-http-protocol.md) |
| 部署到 Tailscale / SSH / Caddy | [`docs/architecture/05`](docs/architecture/05-remote-access-modes.md) |
| 改 dashboard | [`docs/architecture/06`](docs/architecture/06-dashboard-mvvm-and-basalt.md) + [`07`](docs/architecture/07-dashboard-security-csp-and-xss.md) |
| 加测试 / 改 CI | [`docs/architecture/08`](docs/architecture/08-6dq-hooks-wiring.md) |
| 排查端口 / 域名 | [`docs/features/01-port-migration-to-hexly-caddy.md`](docs/features/01-port-migration-to-hexly-caddy.md) |

## 环境要求

- macOS（darwin-arm64 / darwin-amd64）
- Node ≥ 20（详 `.nvmrc`）
- pnpm ≥ 11
- Go ≥ 1.26.2（与上游 multica `server/go.mod` 对齐,详 [`docs/architecture/01`](docs/architecture/01-agent-sdk-pump-from-multica.md) §7）
- 至少安装一家 coding CLI 才能真实跑 agent（`which claude / codex / copilot / hermes / pi`）

## 快速上手

### 1. 安装依赖并构建 daemon

```bash
pnpm install                # 安装 workspace 依赖
pnpm daemon:build           # 构建 dashboard dist → 嵌入 → go build 出 daemon/meowthd
```

`daemon/meowthd` 是一个 ~19 MB 自包含 Go 二进制,内嵌完整 dashboard SPA。

### 2. 首次启动（二选一）

**路径 A（推荐本机用）**:`init` 直接打印 root token,只显示一次

```bash
./daemon/meowthd init
# mwt_XXXX... (39 字符 RFC4648 base32) ← 立即保存
# Dashboard: http://127.0.0.1:7040
```

**路径 B（推荐远程引导）**:`init --skip-token` 留一个一次性 setup-code,后续在 dashboard `/setup` 页 mint

```bash
./daemon/meowthd init --skip-token
# 出 mws_XXXX... setup-code（也只显示一次）
```

详见 [`docs/architecture/04-bootstrap-and-first-run-mint.md`](docs/architecture/04-bootstrap-and-first-run-mint.md)。

### 3. 启动 daemon

```bash
./daemon/meowthd serve
# listening: 127.0.0.1:7040
```

监听地址来自 `~/.meowth/config.toml` 的 `[remote_access]` 段（默认 `local + 127.0.0.1:7040`,详 [`docs/architecture/05`](docs/architecture/05-remote-access-modes.md)）。

### 4. 浏览器打开 dashboard

```
http://127.0.0.1:7040/
```

dashboard 与 API 同源（go:embed）。粘 root token → 进 `/overview` → 列出 agent / 查 session / 管 token。

> **首次启动 mint（path B）必须用 `http://127.0.0.1:7040/setup`**(loopback),不能经 Caddy HTTPS 反代；详 [`docs/features/01`](docs/features/01-port-migration-to-hexly-caddy.md) §2.3。

## HTTP API 用法

完整 schema 见 [`daemon/internal/server/openapi.yaml`](daemon/internal/server/openapi.yaml)（即 `@meowth/shared` 类型源）。常用调用：

```bash
TOKEN=mwt_XXXX...                        # 步骤 2 拿到的 root token

# 列 5 家 backend 安装/版本探测
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7040/v1/agents

# 跑 claude 写 fib.py(stream NDJSON)
curl -sN -X POST http://127.0.0.1:7040/v1/agents/claude/exec \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Write fib.py with iterative fibonacci(n)","cwd":"/tmp/work","timeout_ms":180000}'
# 每行一条 envelope: session_started / message / [heartbeat] / [usage] / session_ended

# 列历史 session
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7040/v1/sessions?limit=10

# 拉 session 消息（断点续读用 after_seq）
curl -H "Authorization: Bearer $TOKEN" 'http://127.0.0.1:7040/v1/sessions/{id}/messages?after_seq=0'

# 取消运行中的 session
curl -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7040/v1/sessions/{id}/cancel

# 管 token
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7040/v1/tokens
curl -X POST -H "Authorization: Bearer $TOKEN" -d '{"name":"laptop"}' http://127.0.0.1:7040/v1/tokens
curl -X DELETE -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7040/v1/tokens/{id}
```

**事件 envelope** 统一形态（详 [`docs/architecture/02`](docs/architecture/02-daemon-http-protocol.md)）:
```json
{"v":1,"seq":N,"ts":"...","session_id":"...","type":"<6 种之一>","payload":{...}}
```
6 种 `type`:`session_started` / `message` / `usage` / `error` / `heartbeat` / `session_ended`。5 家 backend 协议各异,daemon 统一封装。

## 远程访问

daemon **明文 HTTP only**,TLS / 证书职责外包给成熟组件。三种安全暴露方式:

| 方式 | bind | 备注 |
|---|---|---|
| Tailscale | `100.x.x.x:7040` | 推荐;零运维 |
| SSH tunnel | `127.0.0.1:7040` + `ssh -L 7040:127.0.0.1:7040 mac` | 单连接 |
| HTTPS reverse proxy | `127.0.0.1:7040` + Caddy / Cloudflare Tunnel | 多端常驻 |

裸 `0.0.0.0:7040` 直接面对公网会被启动期拒绝。详 [`docs/architecture/05-remote-access-modes.md`](docs/architecture/05-remote-access-modes.md)。

本机已有 Hexly Caddy 体系映射:`https://meowth.dev.hexly.ai` → `127.0.0.1:7040`,`https://meowth-vite.dev.hexly.ai` → Vite dev `:37040`。详 [`docs/features/01`](docs/features/01-port-migration-to-hexly-caddy.md)。

## 开发常用命令

```bash
pnpm install                 # workspace 依赖
pnpm dev                     # turbo dev（启 Vite dev server :37040,需另启 daemon）
pnpm build                   # 构建所有 JS 包
pnpm daemon:build            # 构建 dashboard → 嵌入 → go build

# 全套质量门(手动)。Husky 只跑其中一个子集——见下方注释。
pnpm daemon:g1               # gofmt + go vet + golangci-lint
pnpm dashboard:g1            # biome + tsc + depcruise + source scan
pnpm daemon:test:cover && pnpm daemon:cover:check         # L1 + 覆盖率(target 95%)         [pre-push]
pnpm dashboard:test:cover && pnpm dashboard:cover:check   # L1 + 覆盖率(target 90%)         [pre-push]
pnpm test:l2                 # L2 真 HTTP harness（tokens / mint / exec / remote-access）   [pre-push]
pnpm --filter @meowth/dashboard e2e  # L3 Playwright（embed + embed-mint fixtures）         手动
pnpm scan:d1                 # 检查 prod/test 路径无混合                                     手动
pnpm scan:g2                 # osv-scanner + gitleaks + govulncheck                          [pre-push]
```

**Husky 实际范围**(`.husky/pre-commit` + `.husky/pre-push`):

| 钩子 | 跑什么 | 不跑什么 |
|---|---|---|
| pre-commit | `lint-staged`(staged 文件 → biome / gofmt 自动修) | 其他 G1 / L1 / L2 / 任何 cover gate |
| pre-push   | `daemon:vet` + `dashboard:typecheck` + L1 + 覆盖率 + L2 + G2 | L3 Playwright / D1 / CI matrix |
| CI([`.github/workflows/ci.yml`](.github/workflows/ci.yml),GitHub macos-14 runner) | lint / build-darwin(amd64+arm64) / l1-daemon / l1-dashboard / l2 / l2-embed / l3(embed+embed-mint) / g2 / secret-scan | dashboard-dev L3 project（meowthd init 在 runner 上 flake） / D1 |

D1 隔离与 dashboard-dev e2e release 前手动跑。

详见 [`docs/architecture/08-6dq-hooks-wiring.md`](docs/architecture/08-6dq-hooks-wiring.md)。

## 本机数据目录

```
~/.meowth/
├── config.toml              # [remote_access] 配置
├── meowth.db                # SQLite（tokens hash / sessions / messages）
├── logs/meowthd.log
└── runtime/
    ├── meowthd.pid
    └── setup_nonce.hash     # 仅 init --skip-token 后存在,one-shot
```

测试模式（`MEOWTH_TEST=1`）走 `~/.meowth-test/`,与 prod 严格隔离。

## License

修改版 Apache 2.0（继承自 multica `pkg/agent` 的上游 license）;详 [`daemon/pkg/agent/LICENSE`](daemon/pkg/agent/LICENSE) + [`daemon/pkg/agent/UPSTREAM.md`](daemon/pkg/agent/UPSTREAM.md)。dashboard 完全自写,**不**引入 multica 的 `apps/web/`。
