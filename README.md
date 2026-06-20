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
- Go >= 1.22（构建 daemon）
