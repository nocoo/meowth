# 01 · 项目根本目的概要

> **状态**：v0.1（设计基线已锁定，实现未开始）
> **更新规则**：本文档是 Meowth 的「为什么 + 是什么 + 怎么造」的根。
> 后续任何脱离本文档定义的设计必须先回到这里更新，再向下推进。

---

## 1. 项目定位

Meowth 是**运行在 macOS 本机的 coding-agent 桥接层**。

- 通过一层 **Agent SDK**（继承自 [multica](https://github.com/multica) 的 `Backend` 抽象，Go 实现）控制本机已安装的多家 coding CLI agent；
- 通过一个 **HTTP daemon**（bearer-token 认证）把本机能力暴露给网络，让外部服务能远程调度本机的 agent；
- 通过一个 **Web dashboard**（Vite + basalt 设计语言）在本机管理 daemon、token、agent 运行情况。

一句话：**「我」对本机一切 coding agent 的统一控制台与远程入口。**

## 2. 核心目标

| # | 目标 | 可验证标志 |
|---|------|-----------|
| G1 | 屏蔽 5 家 coding CLI 的协议差异，对外暴露统一 SDK | `Backend.Execute(ctx, prompt, opts)` 单一入口可调度 claude/copilot/codex/hermes/pi |
| G2 | 本机 daemon 可被远程 HTTP 控制 | `POST /v1/agents/{type}/exec` 接 bearer token，返回 stream-json 事件 |
| G3 | dashboard 一屏看清所有运行中 agent 的状态 | 实时列出 session、token usage、stdout tail |
| G4 | dashboard 可自助管理 bearer token | 创建/列出/撤销 token，token 仅在创建时出现一次 |
| G5 | 全栈 6DQ 质量体系达 Tier S | L1 ≥ 95% UT、L2 100% API 真 HTTP、L3 关键流 Playwright、G1+G2 全绿、D1 SQLite test 隔离 |

## 3. 非目标

明确不做，避免范围蔓延：

- ❌ **不做云端 SaaS**——只跑本机；不提供 cloud relay / multi-tenant / 计费
- ❌ **不做 issue / squad / autopilot / workspace 等产品层**（multica 的业务侧不继承）
- ❌ **不做插件市场**——agent 后端硬编码 5 个白名单，新增需改代码 + 发版
- ❌ **不做 Linux / Windows 一等公民**——darwin 优先，其他平台先标 unsupported
- ❌ **不内嵌 LLM**——只调度本机已安装的 CLI，不直接调 model API
- ❌ **不做 PTY / 终端模拟**——只走 stdin/stdout pipe（与 multica 一致）

## 4. 目标用户

唯一用户：**项目作者本人**。

典型场景：
1. 本地 IDE / 远程脚本 / 移动端面板，通过 HTTP 调用本机已安装的 claude code 跑一个长任务
2. 多个 agent 并行做不同事，dashboard 一屏汇总
3. 给信任的外部服务发一个 bearer token，让它代我调度本机 agent

## 5. 成功标准

V1 视为完成的客观条件（与 G1–G5 对应）：

- ✅ Daemon 二进制 `meowthd` 启动后可被 5 个 agent 的 happy-path 调用，每个有真 e2e 测试
- ✅ `POST /v1/agents/claude/exec` 在另一台机器上通过 bearer token 成功调度并 stream 回事件
- ✅ Dashboard 在 `meowthd` 起停时正确反应；至少能看到 sessions / tokens / agents 三个核心视图
- ✅ Dashboard 创建一个 token 后能立刻用于 HTTP 调用；撤销后即时失效
- ✅ CI 上 6DQ 全绿，Tier 判定为 S；pre-commit < 30s，pre-push < 3min

## 6. 关键约束

- **License**：multica 是 Modified Apache 2.0（含 anti-SaaS + 保留 logo 条款）。Meowth 的 SDK 继承部分**必须**保留上游 LICENSE 与 NOTICE，dashboard 重写以避开 logo 条款
- **macOS only**：darwin-arm64 / darwin-amd64 二进制
- **零云依赖**：所有持久化在 `~/.meowth/`；不要求外部 Postgres / Redis
- **Agent 优先**：所有改动必须能在 pre-commit / pre-push 自动证明正确性，不依赖人工 QA
- **原子化提交**：任何改动都拆成可独立解释、独立回滚的 commit（详见 [CLAUDE.md](../CLAUDE.md)）

---

## 7. 架构总览

### 7.1 Monorepo 布局（目标态）

```
meowth/
├── apps/
│   └── dashboard/                # Vite + React 19 + basalt（TS）
├── daemon/                       # Go module，独立于 pnpm workspace
│   ├── cmd/
│   │   └── meowthd/              # 主二进制入口
│   ├── pkg/
│   │   ├── agent/                # SDK：继承 multica 的 Backend 抽象
│   │   │   ├── agent.go          # Backend / ExecOptions / Session / Message / Result
│   │   │   ├── claude.go         # 5 个 backend 实现（pump 自 multica）
│   │   │   ├── copilot.go
│   │   │   ├── codex.go
│   │   │   ├── hermes.go
│   │   │   └── pi.go
│   │   └── protocol/             # daemon ↔ client wire format
│   ├── internal/
│   │   ├── server/               # Chi router + handlers
│   │   ├── auth/                 # bearer token 验证 + 存储
│   │   ├── store/                # SQLite (sqlc 生成)
│   │   └── home/                 # ~/.meowth 路径解析
│   ├── go.mod
│   └── go.sum
├── packages/
│   └── shared/                   # dashboard ↔ daemon 共享 TS 类型（手写或从 OpenAPI 生成）
├── docs/                         # 编号文档
├── pnpm-workspace.yaml           # 只管 apps/dashboard + packages/*
├── turbo.json
└── biome.json
```

**当前与目标态的差异**（待后续 commit 调整）：
- `apps/api`（占位 TS）→ **删除**，daemon 改用 Go 顶层 `daemon/`
- `apps/web` → **重命名**为 `apps/dashboard`
- 根 `package.json` / `pnpm-workspace.yaml` / `turbo.json` 加 `daemon` shell task（`go build` / `go test`）

### 7.2 Agent SDK（继承 multica）

**继承原则**：尽量少改 `pkg/agent/` 下的代码，方便后续 `pump` 上游 multica 的更新。继承采取**「整目录源码 vendor + 改 package path + LICENSE 致谢」**方式（Q2 选项 C），不 fork 整个 multica。

**继承范围**：multica `server/pkg/agent/` **整个目录原样拷贝**到 `meowth/daemon/pkg/agent/`，包含但不限于：
- 入口：`agent.go`、`models.go`、`thinking.go`、`version.go`
- 13 个 backend 实现：`claude.go` / `copilot.go` / `codex.go` / `hermes.go` / `pi.go` + 8 个待裁剪（codebuddy/opencode/openclaw/gemini/cursor/kimi/kiro/antigravity）
- 跨平台 helper：`stderr_tail.go`、`proc_other.go`、`proc_windows.go`、`proc_windows_test.go`
- backend 私有 helper：`copilot_invocation*.go`、`pi_invocation*.go`、`cursor_invocation*.go`（裁剪步骤里会一起处理）
- 所有 `*_test.go` 与 `testdata/`

**为什么整目录拷贝**：multica backend 互相不依赖业务代码，但严重共享 `pkg/agent` 包内的 helper（`hideAgentWindow`、`newStderrTail`、`runContext`、平台分桶 `_unix`/`_windows`/`_other` build tag）。任何只挑 6 个文件的子集都会因为 `undefined: hideAgentWindow` 等编译错误第一时间挂掉，违反「每步独立可编译可测试」。

**裁剪范围（必须同步动 7 处，缺一不可）**：
1. `SupportedTypes` 白名单 → 保留 `claude / copilot / codex / hermes / pi` 5 个
2. `New()` 工厂 switch → 同步收窄
3. `launchHeaders` map（`agent.go:218` 起）→ 删 8 个不支持 provider 的条目
4. `ListModels()`（`models.go:94`）的 switch / 各 provider 分支 → 删 8 个
5. `version.go` 里被裁 provider 的最低版本表 / 探测分支
6. `thinking.go` 的 enum / 校验若覆盖了被裁 provider，删对应条目
7. 删 8 个被裁 provider 的源文件 + 测试 + `*_invocation_*` 平台分桶文件；裁完跑 `go vet ./...` + `go test ./pkg/agent/...` 必须全绿

**核心接口（来自 multica `server/pkg/agent/agent.go:16-21`，永不动）**：
```go
type Backend interface {
    Execute(ctx context.Context, prompt string, opts ExecOptions) (*Session, error)
}
```

**pump 流程**：在 `docs/architecture/` 后续单独写 `01-agent-sdk-pump-from-multica.md`，规定 cherry-pick 命令、子树同步策略、与「白名单裁剪 commit」的 rebase 关系——上游每次新增 provider 必须明确「纳入或忽略」。

### 7.3 Daemon HTTP 层

- **路由**：Chi router（与 multica 同栈，降低后续抽换成本）
- **认证**：单一中间件 `BearerAuth`，校验 `Authorization: Bearer <token>`；token 全权限、无 scope；本地/远程同一套；存储只存 hash（见 §7.4 schema）
- **核心端点**（v1）：
  - `POST /v1/agents/{type}/exec` — 启动一次 agent run，stream NDJSON 事件
  - `GET  /v1/sessions` — 列出活跃 sessions
  - `GET  /v1/sessions/{id}/messages` — 拉取/订阅消息流
  - `POST /v1/sessions/{id}/cancel` — 取消
  - `GET  /v1/agents` — 列出本机已安装的 5 个 agent 与版本探测
  - `POST /v1/tokens` / `GET /v1/tokens` / `DELETE /v1/tokens/{id}` — token 管理（dashboard 用，**返回体永不含 secret**）
  - `GET  /healthz` — **唯一免认证端点**
- **绑定**：默认 `127.0.0.1:7777`；监听其他地址需走 §7.7 远程访问规则

### 7.4 数据与本机目录

**根目录**：`~/.meowth/`

```
~/.meowth/
├── config.toml          # daemon 端口、bind 地址、remote_access、日志等级等
├── meowth.db            # SQLite：tokens(hash)、sessions、messages、agent install cache
├── logs/
│   └── meowthd.log      # 滚动日志
└── runtime/
    ├── meowthd.sock     # 本地 UNIX socket（bootstrap + 备用控制平面，见 §7.8）
    └── meowthd.pid      # daemon pid，用于 stop/restart
```

**权限**：`~/.meowth` = 0700；`meowth.db` / socket / `*.pid` = 0600（参考 raven [`app-dirs.ts`](/Users/nocoo/workspace/personal/raven/packages/proxy/src/lib/app-dirs.ts) 的 `DIR_MODE`/`FILE_MODE` 常量）。

**SQLite 选型**：标准库 `database/sql` + `modernc.org/sqlite`（纯 Go，无 CGO，交叉编译友好）；schema 用 `sqlc` 生成 typed query（与 multica 一致）。

**Token 表 schema（不可妥协）**：

```sql
CREATE TABLE tokens (
  id          TEXT PRIMARY KEY,          -- uuid v7
  name        TEXT NOT NULL,             -- 用户自定的可读标签
  prefix      TEXT NOT NULL,             -- 形如 "mwt_abc12"，前 8 字符，仅用于识别
  token_hash  BLOB NOT NULL,             -- argon2id(secret + salt)，BLOB 32B+
  salt        BLOB NOT NULL,             -- 每 token 独立随机 16B
  created_at  INTEGER NOT NULL,          -- unix epoch
  last_used_at INTEGER,                  -- 最近一次成功认证
  revoked_at  INTEGER,                   -- NULL = active
  created_via TEXT NOT NULL              -- "init" | "bootstrap_socket" | "dashboard" | "cli"
);
CREATE INDEX idx_tokens_prefix ON tokens(prefix);
CREATE INDEX idx_tokens_active ON tokens(revoked_at) WHERE revoked_at IS NULL;
```

**铁律**：
- 数据库**只存 hash**，明文 secret 仅在创建瞬间存在于内存与一次响应
- 比对走「prefix 查行 → argon2id 验证」常数时间（hash 比对自带 constant-time，前缀只是减少行扫）
- API 序列化模型里**不存在** `secret` 字段；编译期保证响应永不泄露
- 撤销 = 设 `revoked_at`，**不物理删**，便于审计

### 7.5 Dashboard（Vite + basalt）

- **栈**：Vite + React 19 + React Router 7 + Tailwind v4 + basalt 设计系统
- **参考实现**：surety（[`/Users/nocoo/workspace/personal/surety`](/Users/nocoo/workspace/personal/surety)）、bat（[`/Users/nocoo/workspace/personal/bat`](/Users/nocoo/workspace/personal/bat)）——两者都是 Vite + basalt + sqlite 风格
- **basalt 接入**：抄源码模板（不发包），见 [basalt v1.1.1](/Users/nocoo/workspace/personal/basalt)
  - 抄 `src/index.css`（token 全文）、`src/lib/{utils,palette}.ts`、`src/components/{AppSidebar,DashboardLayout,ThemeToggle}.tsx`、按需 `src/components/ui/*`
  - Tailwind v4 `@tailwindcss/vite` 插件路线（非 PostCSS）
  - 严格 L0→L1→L2 三层亮度 + 6 typography utility + `tabular-nums`
- **MVVM 三段式**（basalt 风格）：`models/`（业务函数 + 类型）→ `viewmodels/`（`useXxxViewModel` hook）→ `pages/`（仅消费 hook）
- **核心页面**（V1）：
  - `Overview` — daemon 状态、token 数量、近期 sessions
  - `Agents` — 5 个 backend 的安装/可用性探测
  - `Sessions` — 活跃与历史 session 列表 + 详情（消息流 + token usage）
  - `Tokens` — bearer token CRUD
  - `Settings` — daemon 端口/绑定/日志等级
- **本地连通**：dashboard 与 daemon 同机，dev 默认 `http://127.0.0.1:7777`，仍发 bearer header（dev token 启动 daemon 时打印一次）

### 7.6 Agent 后端白名单（V1 硬编码）

| Type | CLI 二进制 | 协议形态 | 备注 |
|------|-----------|----------|------|
| `claude` | `claude` | stream-json (`--output-format stream-json`) | 直接 pump multica `claude.go` |
| `copilot` | `gh copilot` 或 `github-copilot-cli` | TBD（pump 时确认） | pump multica `copilot.go` |
| `codex` | `codex` | stream-json | pump multica `codex.go` |
| `hermes` | `hermes` | ACP / 自定义 | pump multica `hermes.go` |
| `pi` | `pi` | TBD | pump multica `pi.go` |

新增 backend 必须改 `SupportedTypes` 白名单 + `New()` switch + `launchHeaders` + `ListModels` + 版本/thinking enum + e2e 测试，**禁止运行时注册**。

### 7.7 远程访问与传输安全（硬约束）

Meowth 是「本机 agent 桥」，但目标包含「外部服务远程调度」（G2）。bearer token 全权限，泄露后无回旋余地，所以**必须把 TLS / 网络边界外包给成熟组件**，daemon 本身只跑明文 HTTP，不内置证书管理。

**允许的远程暴露方式**（三选一，dashboard Settings 必须显式承认）：

| 方式 | 形态 | 适用 |
|------|------|------|
| **A. Tailscale** | daemon bind `100.x.x.x:7777`（Tailnet IP），ACL 限 device tag | 推荐默认；零运维 |
| **B. SSH tunnel** | daemon bind `127.0.0.1:7777`，远端 `ssh -L 7777:127.0.0.1:7777 mac` | 单连接、低频调用 |
| **C. HTTPS 反代** | 前面挂 Caddy / Cloudflare Tunnel，反代到 `127.0.0.1:7777` | 多端常驻 |

**显式禁止**：
- ❌ 裸 `0.0.0.0:7777` 直接面对公网
- ❌ daemon 自签或 ACME TLS（认证职责不进 daemon）
- ❌ 把 token 作为 query string 传（`?token=xxx`）；只允许 `Authorization` header

**daemon 启动校验**：当 `bind_addr` 不在 `127.0.0.1/loopback` 也不在 `100.64.0.0/10`（Tailscale CGNAT 段）时，**强制要求** `config.toml` 显式设置 `remote_access.mode = "tailscale" | "ssh_tunnel" | "https_proxy"` 与 `remote_access.acknowledged_by = "<dashboard user>"`；否则启动失败并打印修复建议。

### 7.8 Bootstrap（首个 token 的诞生）

所有 v1 端点除 `/healthz` 外均强制 bearer。零 token 时 dashboard 无法创建 token，必须有带外通路。

**采用方案：`meowthd init` + 本地 UNIX socket bootstrap，双轨保险。**

1. **`meowthd init`**（一次性 CLI）
   - 创建 `~/.meowth/` 目录结构（0700）与默认 `config.toml`
   - 初始化 `meowth.db` schema
   - **生成首个 root token，明文打印到 stdout 一次**（带 `mwt_` 前缀，全权限），仅 hash 入库
   - 提示：「请立刻保存；丢失只能用 `meowthd bootstrap-token` 重新生成」
   - 幂等：已存在的 `~/.meowth/` 拒绝执行，避免覆盖
2. **本地 UNIX socket bootstrap**（备用通路）
   - daemon 始终监听 `~/.meowth/runtime/meowthd.sock`（socket 文件权限 0600，仅当前 user 可读写）
   - socket 上的 `POST /v1/bootstrap/token` 端点**免 bearer**，但**仅在 token 表为空时**响应；有任何已存在 token 后立即返回 404
   - dashboard 首次启动若检测到 token 表空，自动通过 socket 拉取一个 root token，缓存到 `~/Library/Application Support/meowth-dashboard/`
3. **应急通路：`meowthd bootstrap-token`** —— 在 daemon 停机时，直接读写 SQLite 注入一个新 root token 并打印一次（用户丢失全部 token 时的最后手段）

**Token 显示策略（硬性）**：
- 任何创建端点 / CLI 命令的响应里，secret 只出现**一次**
- 之后 `GET /v1/tokens` 只返回 `id`、`name`、`prefix`（如 `mwt_abc...`）、`created_at`、`last_used_at`、`revoked_at`，**永不返回完整 secret**
- dashboard 创建 token 后弹出 modal 让用户复制，关闭即失

---

## 8. 6DQ 质量计划

| 维度 | 工具 | 阈值 | 运行时机 |
|------|------|------|---------|
| **L1** Unit/Component | TS: vitest（dashboard）；Go: `go test` + `go test -cover` | TS 行覆盖 ≥ 95%；Go pkg 覆盖 ≥ 95%（cmd/ 入口豁免） | pre-commit, <30s |
| **L2** Integration/API | 自写 `scripts/run-l2.ts` 拉起真实 `meowthd`，对所有 `/v1/*` 端点真 HTTP 调用 | 100% v1 端点覆盖 | pre-push, <3min |
| **L3** System/E2E | Playwright 起 dashboard + daemon，跑「登录 → 创建 token → 调 agent → 看消息」流 | 关键流绿 | CI |
| **G1** Static | TS: Biome strict + tsc --noEmit；Go: `gofmt -d` + `go vet` + `golangci-lint run` | 0 error 0 warning | pre-commit, 并行 L1 |
| **G2** Sec/Perf | `osv-scanner --lockfile pnpm-lock.yaml`、`gitleaks protect --staged`、Go: `govulncheck ./...` | 0 漏洞 | pre-push, 并行 L2 |
| **D1** 隔离 | SQLite 测试库走 `~/.meowth-test/meowth-test.db`；命名后缀 `-test`；带 `_test_marker` 表；构建期+运行时双校验 | 三重校验全通过 | 测试 setup |

**Husky hooks**：`pre-commit` = L1+G1；`pre-push` = L2+G2；CI 跑全套 + L3。

**Tier 目标**：S（六维全绿）。

---

## 9. 原子化提交计划（落地顺序）

01 文档定稿后，按以下顺序推进，每步一个 commit、每步可独立 review/回滚：

| # | Commit | 内容 |
|---|--------|------|
| 1 | `docs: write 01 project overview` | 本文档（本次提交） |
| 2 | `chore: rewire monorepo for daemon/dashboard split` | 删 `apps/api`，重命名 `apps/web` → `apps/dashboard`，更新 workspace/turbo |
| 3 | `chore(daemon): scaffold go module with meowthd entrypoint` | `daemon/go.mod`、`daemon/cmd/meowthd/main.go` hello-world，`go build ./...` 绿 |
| 4 | `chore(daemon): vendor multica pkg/agent verbatim` | **整目录拷贝**（所有 `*.go` + `testdata/` + 平台分桶文件）+ LICENSE + NOTICE，改 package path；`go vet ./...` + `go test ./pkg/agent/...` 全绿 |
| 5 | `chore(daemon): trim agent SDK to 5 whitelisted backends` | 同步动 7 处（`SupportedTypes` / `New` / `launchHeaders` / `ListModels` / `version` / `thinking` / 删 8 个 backend 文件与测试），裁完跑测试仍全绿 |
| 6 | `feat(daemon): wire ~/.meowth path resolver` | `internal/home`，darwin 路径 + 权限校验（0700/0600）+ 单测 |
| 7 | `feat(daemon): sqlite store with tokens schema (hash only)` | `internal/store` + `sqlc.yaml`；token 表只存 hash + prefix + salt |
| 8 | `feat(daemon): meowthd init command (bootstrap root token)` | 一次性 CLI，幂等，明文 token 仅打印一次 |
| 9 | `feat(daemon): bearer auth middleware (constant-time hash compare)` | 共享给 HTTP 与 socket |
| 10 | `feat(daemon): chi router + healthz + token CRUD endpoints` | secret 仅创建时返回；schema 测试覆盖 |
| 11 | `feat(daemon): unix socket bootstrap endpoint (zero-token only)` | `runtime/meowthd.sock` + `/v1/bootstrap/token`，token 表非空时返 404 |
| 12 | `feat(daemon): remote_access config + bind validation` | 非 loopback / 非 Tailscale CGNAT 绑定强制要求 `remote_access.mode` |
| 13 | `feat(daemon): agent exec endpoint streaming NDJSON` | 接通 5 个 backend，session/messages/cancel 三件套 |
| 14 | `feat(dashboard): bootstrap vite + basalt token system` | 抄 basalt `index.css` + lib + theme init + Tailwind v4 vite 插件 |
| 15 | `feat(dashboard): app shell + 5 page skeletons` | Overview/Agents/Sessions/Tokens/Settings |
| 16 | `feat(dashboard): daemon http client + token storage` | bearer 注入、`FetchResult` 判别联合、错误边界 |
| 17 | `feat(dashboard): first-run bootstrap via unix socket` | 检测 token 表空时自动 socket 取 root token，缓存本地 |
| 18 | `chore: husky + pre-commit (L1+G1) + pre-push (L2+G2)` | hooks 落地 |
| 19 | `test(daemon): L1 unit tests ≥ 95% coverage` | 重点：auth、store、home、bootstrap |
| 20 | `test(daemon): L2 http integration via run-l2 script` | 真启 daemon、覆盖全部 v1 端点 + bootstrap socket |
| 21 | `test(e2e): playwright happy path` | init → dashboard 拉 token → 调 claude → 看消息 |
| 22 | `ci: github actions matrix darwin + 6DQ all-green gate` | |

每个 commit 都满足：**自带必要测试 + hooks 通过 + 不留 TODO**。

---

## 10. 相关文档

- [`/README.md`](../README.md) — 仓库入口
- [`/CLAUDE.md`](../CLAUDE.md) — 工作约束
- 待建：
  - `docs/architecture/01-agent-sdk-pump-from-multica.md`
  - `docs/architecture/02-daemon-http-protocol.md`
  - `docs/architecture/03-sqlite-schema-and-tokens.md`
  - `docs/architecture/04-bootstrap-and-unix-socket.md`
  - `docs/architecture/05-remote-access-modes.md`
  - `docs/architecture/06-dashboard-mvvm-and-basalt.md`
  - `docs/architecture/07-6dq-hooks-wiring.md`
