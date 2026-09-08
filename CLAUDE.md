# Meowth

> 本项目根本目的与定位详见 [`docs/01-project-overview.md`](docs/01-project-overview.md)

## 仓库结构（Monorepo）

pnpm + Turborepo + TypeScript + Biome。

```
meowth/
├── apps/
│   └── dashboard/           @meowth/dashboard  Vite + basalt 前端（daemon 管理面板）
├── daemon/                  Go module，独立于 pnpm workspace（顶层）
│   └── cmd/meowthd          主二进制入口（详见 docs/01-project-overview.md §7.1）
├── packages/
│   └── shared/              @meowth/shared  共享类型与工具
├── docs/                    编号文档（设计、架构、特性）
│   └── README.md            文档索引
├── package.json             根脚本入口
├── pnpm-workspace.yaml      workspace 配置
├── turbo.json               任务编排
├── biome.json               lint + format
└── tsconfig.base.json       TS 严格模式基线
```

## 文档体系

所有设计与决策走 `docs/` 编号文档，命名 `NN-kebab-name.md`。

入口：[`docs/README.md`](docs/README.md)

二级目录约定：
- `docs/architecture/` 系统架构
- `docs/features/` 功能迭代
- `docs/archive/` 已过时文档

每个二级目录内部独立编号，并维护各自的 `README.md` 索引。

## 开发约束（给 Claude / 给我自己）

### 行动前
- 关键假设先声明；影响正确性、安全或外部副作用的，等确认再执行
- 多种解读时列出选项，禁止默默选定
- 有更简单方案直接提出；需求不清晰立即停止并指出困惑
- 事实为先：先调查证实/证伪，不无脑赞同

### 编码与提交（硬性要求）
- **任何改动都必须坚持原子化提交**：一次 commit 只做一件可独立解释、可独立回滚的事
- 改完代码立即 commit，不积压、不混合无关变更
- commit 信息说明 *why*，不仅是 *what*；遵循项目 `rules/git-commit.md`
- 长任务在 `docs/` 编号文档里**预先**规划好原子提交序列，再开工
- 删除变更范围内确认无引用的死代码
- 不为不会发生的场景加错误处理 / fallback / 校验
- 默认不写注释；只在 *why* 非显然时写一行
- 不写 backwards-compat 垃圾、不留 `// removed` 之类的痕迹

### 文档驱动
- 架构变更或长任务前，先在 `docs/` 写编号文档
- 文档必含：设计细节 + 代码引用（文件路径） + 原子化提交计划 + 6DQ 质量计划
- 文档不含：工作量评估
- 根 `README.md` 和 `docs/README.md` 始终引用最新的编号文档

### 沟通
- 称呼用户为「哥」
- 中文：命令行输出与日常沟通；英文：代码、注释、文档正文标识符、Git 操作

## Local startup and service URLs

**Canonical development URL: https://meowth.dev.hexly.ai**

| Service | Fixed address | Purpose |
|---|---|---|
| Dashboard, API, and HMR | `https://meowth.dev.hexly.ai` | The single browser entry through local Caddy |
| Vite | `http://127.0.0.1:37040` | Frontend source with React Fast Refresh; API proxy to port 7040 |
| Daemon | `http://127.0.0.1:7040` | HTTP API and the last embedded dashboard build |
| Health | `https://meowth.dev.hexly.ai/healthz` | Confirms Caddy can reach the daemon; expected `{"ok":true}` |

Run commands from this repository's root. Check existing listeners first:

```bash
lsof -nP -iTCP:7040 -sTCP:LISTEN
lsof -nP -iTCP:37040 -sTCP:LISTEN
```

Reuse the running daemon and Vite. Start only the missing service in its own
terminal:

```bash
./daemon/meowthd serve   # Daemon: existing local config, 127.0.0.1:7040
pnpm dashboard:dev      # Vite: 127.0.0.1:37040, strictPort enabled
```

- Keep these ports fixed. Resolve an unexpected listener before launching a
  replacement. `--listen-addr` is a daemon test-only flag.
- Normal development uses the existing `$HOME/.meowth/config.toml`, tokens,
  and sessions. `init` is only for a brand-new installation. Keep `MEOWTH_TEST`,
  `MEOWTH_TEST_HOME`, and `MEOWTH_BACKEND_FACTORY=fake` out of normal services.
- Frontend edits through Vite update automatically. Use `pnpm daemon:build`
  when the daemon binary is missing or when preparing an embedded build; it
  builds the dashboard, embeds it, and writes `daemon/meowthd`. The embedded
  page on port 7040 changes when the rebuilt daemon is started.
- The live Caddy configuration is `/opt/homebrew/etc/Caddyfile`: `/v1`,
  `/v1/*`, `/healthz`, `/bootstrap`, and `/bootstrap/*` route to 7040; other
  paths, assets, and HMR WebSockets route to 37040. Use the existing wildcard
  TLS certificate and the single main hostname. `meowth-vite.dev.hexly.ai`
  was retired; the workflow repository's older Caddy template is not the
  source of truth for this machine.
- `MEOWTH_DAEMON_URL` overrides only Vite's proxy target. Its normal value is
  `http://127.0.0.1:7040`; check the shell and `apps/dashboard/.env.local` when
  diagnosing an unexpected backend. Caddy's direct API route stays on 7040.
- First-run token mint uses `http://127.0.0.1:7040/setup`. Existing tokens can
  be pasted into the canonical HTTPS dashboard.
- Browser test ports are separate: UI/dev Vite `47040`, fake dev daemon
  `47041`, embedded fixtures `17040`/`17041`. Real-agent browser tests select
  temporary loopback ports and isolated test homes. These are test fixtures,
  not development entry points.

See [feature 08](docs/features/08-dashboard-theme-and-vite.md) for routing and
[feature 09](docs/features/09-chat-workspace-and-ui-polish.md) for Chat and
real-agent verification.

## 常用命令

```bash
pnpm install            # 安装 workspace 依赖
pnpm dev                # 所有包 dev
pnpm build              # 所有包 build
pnpm typecheck          # 全量类型检查
pnpm lint               # biome 检查
pnpm format             # biome 格式化
```

## Retrospective

记录犯错与教训，避免重蹈。

（暂无条目。）
