# Meowth

> 本项目根本目的与定位详见 [`docs/01-project-overview.md`](docs/01-project-overview.md)

macOS 本机 coding-agent 桥接层：Go daemon 暴露 HTTP，Vite/React dashboard 管理本机已安装的 5 家 coding CLI（claude / copilot / codex / hermes / pi）。

## 仓库结构（Monorepo）

pnpm + Turborepo + TypeScript + Biome。`daemon/` 为独立 Go module（不在 pnpm workspace）。

```
meowth/
├── apps/
│   └── dashboard/           @meowth/dashboard  Vite + React 19 + basalt（daemon 管理面板）
├── daemon/                  Go module（独立），主二进制 cmd/meowthd
├── packages/
│   └── shared/              @meowth/shared  dashboard ↔ daemon 共享类型
├── docs/                    编号文档（见 docs/README.md）
├── pnpm-workspace.yaml      只覆盖 apps/dashboard + packages/*
├── turbo.json
├── biome.json
└── tsconfig.base.json
```

详细架构、6DQ 质量计划、原子化提交规划见 [`docs/01-project-overview.md`](docs/01-project-overview.md)。

## 常用命令

```bash
pnpm install            # 安装 workspace 依赖
pnpm dev                # 所有包 dev
pnpm build              # 所有包 build
pnpm typecheck          # 全量类型检查
pnpm lint               # biome 检查
pnpm format             # biome 格式化
```

## 环境要求

- macOS（darwin-arm64 / darwin-amd64）
- Node >= 20
- pnpm >= 11
- Go >= 1.26.1（构建 daemon；与上游 multica `server/go.mod` 对齐，详 [`docs/architecture/01-agent-sdk-pump-from-multica.md`](docs/architecture/01-agent-sdk-pump-from-multica.md) §7）

## 实施状态（Phase 3.1 — agent SDK 底座已落地）

当前仓库已实现：

- `daemon/` 独立 Go module，`cmd/meowthd` 最小入口
- `daemon/pkg/agent/` 从 multica 整目录 vendor，裁剪到 V1 白名单 5 backend（`claude` / `codex` / `copilot` / `hermes` / `pi`）；详 [`docs/architecture/01-agent-sdk-pump-from-multica.md`](docs/architecture/01-agent-sdk-pump-from-multica.md)
- 真实 CLI smoke harness `daemon/test/cli-smoke/`，opt-in 环境变量 `MEOWTH_CLI_SMOKE=1` 触发；本机已验证 4 backend（claude / codex / hermes / pi）通过裁剪 SDK 端到端跑通
- 一条上游本地补丁：`daemon/pkg/agent/pi.go` 把 Pi 的 `message_end` / `turn_end` 错误映射为 `Result.Status="failed"`，详 `daemon/pkg/agent/UPSTREAM.md`

尚未实施的范围（见 [`docs/01-project-overview.md`](docs/01-project-overview.md) §9.2 Phase 计划）：HTTP daemon、SQLite + token、bootstrap mint、dashboard、CI matrix、6DQ husky hooks。
