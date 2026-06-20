# 01 · 项目根本目的概要

> **更新规则**：本文档是 Meowth 的「为什么 + 是什么 + 怎么造」的根。
> 后续任何脱离本文档定义的设计必须先回到这里更新，再向下推进。
> 历史在 `git log -- docs/01-project-overview.md`。

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
| G2 | 本机 daemon 可被远程 HTTP 控制 | `POST /v1/agents/{type}/exec` 接 bearer token，stream NDJSON 事件（统一 envelope，封装各 backend 原生协议） |
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

- **License**：multica 是 Modified Apache 2.0（含 anti-SaaS + 保留 logo 条款）。Meowth 的 SDK 继承部分**必须**：
  - 保留上游 `LICENSE` 文件原文
  - 若上游存在 `NOTICE` 则同步拷贝（截至调查时 multica 仓库**只有 LICENSE，无 NOTICE**）
  - 在 `daemon/pkg/agent/UPSTREAM.md` 记录 source repo + 拉取时的 commit SHA + 拉取日期
  - dashboard 完全自写，**不引入** multica 的 `apps/web/`，避开保留 logo 条款
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

**当前与目标态的差异**：
- ✅ `apps/api` 已删（commit `b44b1f8`），daemon 改用 Go 顶层 `daemon/`
- ✅ `apps/web` 已重命名 `apps/dashboard`（commit `933de25`），包名 `@meowth/dashboard`
- ⏳ 根 `package.json` / `pnpm-workspace.yaml` / `turbo.json` 待加 `daemon` shell task（`go build` / `go test`）—— 由 §9 commit #3 完成

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
  - `GET  /healthz` — 免认证
  - `GET  /` 与静态资源 — 免认证（dashboard 静态文件，由 daemon embed）
  - `POST /bootstrap/mint` — 见 §7.8；仅在 token 表为空时响应、仅响应一次、仅 loopback
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
    └── meowthd.pid      # daemon pid，用于 stop/restart
```

**权限**：`~/.meowth` = 0700；`meowth.db` / `*.pid` = 0600（参考 raven [`app-dirs.ts`](/Users/nocoo/workspace/personal/raven/packages/proxy/src/lib/app-dirs.ts) 的 `DIR_MODE`/`FILE_MODE` 常量）。

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
  created_via TEXT NOT NULL              -- "init" | "first_run_mint" | "dashboard" | "cli"
);
CREATE INDEX idx_tokens_prefix ON tokens(prefix);
CREATE INDEX idx_tokens_active ON tokens(revoked_at) WHERE revoked_at IS NULL;
```

**铁律**：
- 数据库**只存 hash**，明文 secret 仅在创建瞬间存在于内存与一次响应
- 比对走「prefix 查行 → argon2id 验证」常数时间（hash 比对自带 constant-time，前缀只是减少行扫）
- API 序列化模型里**不存在** `secret` 字段；编译期保证响应永不泄露
- 撤销 = 设 `revoked_at`，**不物理删**，便于审计

### 7.5 Dashboard（Vite + basalt，**纯浏览器单页**）

- **栈**：Vite + React 19 + React Router 7 + Tailwind v4 + basalt 设计系统
- **形态明确（不是 Electron / 不是 Tauri / 不是 Node CLI）**：纯静态产物（`vite build` 出来一坨 HTML+JS+CSS），由 **daemon 自己挂在 `GET /` 下提供**（embed via `go:embed`）。dashboard 因此可以同源调用 daemon，**不需要 CORS**
  - 实现细节：daemon 启动时把 `apps/dashboard/dist` 作为 `embed.FS` 挂在 root；dev 模式下走 Vite dev server (`5173`) + Vite proxy（`/v1/*` 与 `/healthz` 转发到 `127.0.0.1:7777`）
- **能力边界（硬约束）**：
  - ❌ 浏览器不能读 UNIX socket
  - ❌ 浏览器不能写 `~/.meowth/` 或 `~/Library/Application Support/`
  - ✅ 只能走 HTTP；token 存 `localStorage`（**因此 dashboard 必须 same-origin 经 daemon 提供，否则 token 泄露面扩大**）
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
- **连通**：dashboard 与 daemon 同源（生产由 daemon 提供，dev 由 Vite proxy 转发），所有请求带 `Authorization: Bearer <token>`

### 7.6 Agent 后端白名单（V1 硬编码）

| Type | 默认 CLI 二进制 | argv 形态 | 协议 / 输出格式 | 备注 |
|------|---------------|----------|---------------|------|
| `claude` | `claude` | `claude --output-format stream-json --input-format stream-json --verbose` | NDJSON stream-json，stdin 持续接控制消息 | pump multica `claude.go` |
| `copilot` | `copilot` | `copilot -p "<prompt>" --output-format json --allow-all --no-ask-user` | JSONL events（Copilot CLI v1.0.28+） | pump multica `copilot.go`（**不是** `gh copilot`） |
| `codex` | `codex` | `codex app-server --listen stdio://` | JSON-RPC 2.0 over stdin/stdout（**不是 stream-json**） | pump multica `codex.go` |
| `hermes` | `hermes` | `hermes acp <custom args>` | ACP 协议 over stdio | pump multica `hermes.go` |
| `pi` | `pi` | `pi <prompt>`（prompt 走 argv 位置参数，配 session 文件） | 详见 `pi_invocation*.go` 平台分桶 | pump multica `pi.go` |

`ExecutablePath` 可在 daemon 配置里覆盖默认二进制名。`/v1/agents` 端点对每个 type 做 `exec.LookPath` 探测，返回是否安装与解析得到的版本。

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

**daemon 启动期 bind 校验**（mode 与 bind 必须匹配，否则启动失败并打印修复建议）：

| `remote_access.mode`（config.toml） | 允许的 `bind_addr` | 拒绝的 `bind_addr` |
|------------------------------------|------------------|-----------------|
| _未设置（默认本机）_ | `127.0.0.1` / `::1` / `localhost` | 其他全部（含 Tailscale IP） |
| `tailscale` | 必须在 `100.64.0.0/10`（Tailscale CGNAT 段，含 IPv4） 或 `fd7a:115c:a1e0::/48`（IPv6） | 其他全部 |
| `ssh_tunnel` | 仅 loopback（`127.0.0.1` / `::1`） | 其他全部（包括 Tailscale IP；SSH tunnel 的语义就是 daemon 只听本机，远端靠 `-L` 转发） |
| `https_proxy` | 仅 loopback | 其他全部（反代必须与 daemon 同机，daemon 不直接面向 Internet） |
| _任何 mode_ | — | **`0.0.0.0` / `::` 永远拒绝**，即使 mode 设了也不行（必须明确单一接口） |

`remote_access.mode` 设置后，必须同时填 `remote_access.acknowledged_by = "<dashboard user / human label>"`（防止悄悄改 config 暴露公网）。校验失败的错误信息必须打印实际的 `bind_addr`、当前 `mode`、推荐修复（如「mode=ssh_tunnel 必须 bind 127.0.0.1，请改 config.toml」）。

### 7.8 Bootstrap（首个 token 的诞生）

所有 v1 HTTP 端点（除 `/healthz`、静态资源、`/bootstrap/*` 见下）均强制 bearer。零 token 时 dashboard 拿不到 token 就无法操作，必须有带外通路。

由于 dashboard 是纯浏览器单页（§7.5），**它读不到 UNIX socket、写不了本机文件系统**，所有方案都必须可以在浏览器 + 用户手工配合下完成。

**采用方案：「CLI 必出 token」+「daemon 在零 token 状态下短暂自暴露 bootstrap 页面」双轨。**

1. **`meowthd init`**（首次安装，唯一推荐路径）
   - 创建 `~/.meowth/` 目录结构（0700）与默认 `config.toml`
   - 初始化 `meowth.db` schema
   - **生成首个 root token，明文打印到 stdout 一次**（带 `mwt_` 前缀，全权限），仅 argon2id hash 入库
   - 提示：「请立刻保存；丢失可用 `meowthd bootstrap-token` 重新生成」
   - 幂等：已存在的 `~/.meowth/` 拒绝执行，避免覆盖
2. **「First-Run Mint」HTTP 端点**（备用通路，给「忘记看 init 输出」的用户）
   - daemon 启动时检测 token 表是否为空
   - **若空**：开放 `POST /bootstrap/mint`（**免 bearer**），仅 loopback 接受，**仅响应一次**——成功返回明文 root token 后立即在内存把开关关闭，下次必须重启 daemon 才能再开
   - dashboard 在没有 token 时（首次加载 / token 被删光）渲染 `/setup` 页面，用户点「Mint root token」按钮即调用此端点
   - **若不空**：`POST /bootstrap/mint` 一律 `404 Not Found`（不是 401，避免泄露状态）
   - daemon 启动日志明确打印「first-run bootstrap window: OPEN / CLOSED」，便于审计
3. **应急通路：`meowthd bootstrap-token`** —— daemon **停机时**直接读写 SQLite 注入一个新 root token 并打印一次（用户既丢失全部 token 又错过 stdout 时的最后手段）

**Token 在 dashboard 端的存储**：
- 浏览器 `localStorage.meowth_token = "<secret>"`
- 因 dashboard 与 daemon 同源（§7.5），不存在跨域泄露面
- 用户「登出」 = `localStorage.removeItem('meowth_token')`
- 不写入 `~/Library/Application Support/`（浏览器没权限）

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

## 9. 工作规程与原子化提交计划

### 9.1 三段式工作规程（硬约束）

**任何写代码的冲动，先回到这里。** 顺序违反 = 工作作废。

**Stage 1 · 文档先行（Doc-First）**
- 任何架构/特性动手前，先在 `docs/architecture/` 或 `docs/features/` 写编号文档
- 文档必含：设计细节 + 代码引用（文件路径） + 原子化提交计划 + 6DQ 落点（哪一层测试覆盖哪一块）
- 文档不含：工作量评估
- **完全 review 无误才进 Stage 2**——这里的「review」由作者读 + 必要时 spawn subagent 唱反调
- 文档自己也走原子化提交：「新增文档」「修订文档」分开 commit

**Stage 2 · 测试 Harness 先行（Harness-First）**
- 先把该模块所属的 L1/L2/L3/G1/G2/D1 测试脚手架搭起来，**先让测试运行框架就位**，再写功能
- L1：vitest / `go test` 目录与 fixture 准备好；空 testfile + skipped placeholder 也算搭好
- L2：`scripts/run-l2.ts` 能拉起 daemon、调 healthz、退出 0
- L3：playwright config + 一个 `expect(true).toBe(true)` 空 spec 能跑
- G1：tsc/biome/golangci-lint/gofmt/go vet 在 pre-commit 通
- G2：osv-scanner/gitleaks/govulncheck 在 pre-push 通
- D1：测试用 `~/.meowth-test/` 路径与 `_test_marker` 表 schema 就位
- harness 提交独立成 commit，绿了才进 Stage 3

**Stage 3 · TDD 实现**
- 严格红绿重构：先写失败测试，再写最少代码让测试绿，再重构
- 每个原子 commit 自带它需要的新测试，整套测试在 commit 落地时必须**全绿**
- 覆盖率目标：daemon 95%、dashboard 90%（页面薄壳豁免）
- 任何 commit 不允许带 TODO / FIXME / skip-without-issue

**红线**：任何 commit 不能跨越 Stage 边界。例如「实现 X + 给 X 写文档」是非法 commit；必须先文档 commit，再 harness commit（若需要），最后实现 commit。

### 9.2 原子化提交计划（落地顺序）

按以下顺序推进，每步一个 commit、每步独立 review/回滚。已完成的标 ✅。

#### Phase 0 — 项目初始化（已完成）

| # | Commit | 内容 |
|---|--------|------|
| 0.1 | ✅ `chore: bootstrap pnpm + turbo monorepo skeleton` | `0fefb71` |
| 0.2 | ✅ `docs: add CLAUDE.md and numbered-docs scaffold` | `ba97460` |
| 0.3 | ✅ `docs(01): write project overview v0.1` | `3e110f3` |
| 0.4 | ✅ `docs(01): harden agent SDK / remote auth / token bootstrap (v0.2)` | `64646b6` |
| 0.5 | ✅ `chore: drop apps/api placeholder` | `b44b1f8` |
| 0.6 | ✅ `chore: rename apps/web → apps/dashboard` | `933de25` |

#### Phase 1 — 文档定稿（Doc-First，全部 review 通过才进 Phase 2）

| # | Commit | 内容 |
|---|--------|------|
| 1.1 | `docs(01): incorporate phase plan and workflow regimen (v0.3)` | 本次 commit |
| 1.2 | `docs(arch): 01-agent-sdk-pump-from-multica` | vendor 范围、裁剪 7 处、pump 命令、上游变更应对 |
| 1.3 | `docs(arch): 02-daemon-http-protocol` | NDJSON event schema、v1 端点契约、错误码、流式 cancel 协议 |
| 1.4 | `docs(arch): 03-sqlite-schema-and-tokens` | 完整 schema、argon2id 参数、migration 策略、D1 隔离表 |
| 1.5 | `docs(arch): 04-bootstrap-and-first-run-mint` | init / first-run mint endpoint / bootstrap-token CLI 三轨详细流程、文件权限、错误恢复 |
| 1.6 | `docs(arch): 05-remote-access-modes` | Tailscale/SSH/HTTPS-proxy 三模式配置范式、启动期校验逻辑 |
| 1.7 | `docs(arch): 06-dashboard-mvvm-and-basalt` | 5 个页面的 model/viewmodel/page 分层映射、basalt token 接入清单 |
| 1.8 | `docs(arch): 07-6dq-hooks-wiring` | 每层测试的具体工具、阈值、husky 脚本、CI matrix |

**Phase 1 出口条件**：作者逐篇 review 通过 + Phase 2 的 harness commit 计划在每篇文档里写死。

#### Phase 2 — Harness 先行（Harness-First，**全部绿了才进 Phase 3**）

| # | Commit | 内容 |
|---|--------|------|
| 2.1 | `chore(daemon): scaffold go module with meowthd entrypoint` | `daemon/go.mod` + `daemon/cmd/meowthd/main.go` 仅打印版本号，`go build` / `go vet` 绿 |
| 2.2 | `chore: add daemon shell tasks to turbo + root scripts` | 根 `package.json` 增加 `daemon:build` / `daemon:test`，turbo 接入 |
| 2.3 | `chore(daemon): G1 wiring (gofmt + go vet + golangci-lint)` | config + 一个故意 fail 的样本测试 vet 出来，证明 G1 真有效 |
| 2.4 | `chore(dashboard): G1 wiring (biome strict + tsc strict)` | 已就位，加一个故意 fail 样本证明强度 |
| 2.5 | `chore: husky + pre-commit (G1 placeholder)` | hook 安装，pre-commit 跑 G1，<5s |
| 2.6 | `test(daemon): L1 harness (go test + go-cover) with placeholder` | `daemon/pkg/.../foo_test.go` skipped；`go test ./...` 退 0 |
| 2.7 | `test(dashboard): L1 harness (vitest) with placeholder` | empty `*.test.ts`；`pnpm test` 退 0 |
| 2.8 | `test(daemon): L2 harness (scripts/run-l2.ts)` | 能拉起 hello-world daemon、ping `/healthz`、退 0；D1 测试路径 `~/.meowth-test/` 就位 |
| 2.9 | `test(e2e): L3 harness (playwright config + empty spec)` | playwright `pnpm test:e2e` 绿 |
| 2.10 | `chore: G2 wiring (osv-scanner + gitleaks + govulncheck)` | pre-push 跑 G2 placeholder，全绿 |
| 2.11 | `chore: husky pre-push (L2 + G2)` | hook 接通，<3min |
| 2.12 | `ci: github actions darwin matrix + 6DQ gates` | CI 跑全套 + L3，全绿 |

**Phase 2 出口条件**：六维 harness 全就位，pre-commit / pre-push / CI 全绿；任何后续功能 commit 失败时，确定是「功能不对」而不是「harness 没搭好」。

#### Phase 3 — TDD 实现（每步先写测试再写代码，commit 时全绿）

| # | Commit | 内容 |
|---|--------|------|
| 3.1 | `feat(daemon): vendor multica pkg/agent verbatim` | 整目录拷贝 + `LICENSE`（若上游有 `NOTICE` 也同步）+ `UPSTREAM.md`（source repo + commit SHA + date）+ package path 改名；上游测试套全绿 |
| 3.2 | `feat(daemon): trim agent SDK to 5 whitelisted backends` | 7 处同步裁；测试仍全绿 |
| 3.3 | `feat(daemon): ~/.meowth path resolver` | 红：写 home_test.go；绿：实现；重构 |
| 3.4 | `feat(daemon): sqlite store with tokens schema (hash only)` | 红：schema/CRUD 单测；绿：sqlc 代码 + argon2id |
| 3.5 | `feat(daemon): meowthd init command` | 红：CLI e2e 测试；绿：实现 |
| 3.6 | `feat(daemon): bearer auth middleware (constant-time compare)` | TDD |
| 3.7 | `feat(daemon): chi router + healthz + token CRUD` | TDD + L2 端点覆盖 |
| 3.8 | `feat(daemon): first-run mint endpoint (loopback + one-shot)` | TDD：token 表空时 `POST /bootstrap/mint` 返 token，调用后内存开关关；非空时 404 |
| 3.9 | `feat(daemon): remote_access config + bind validation` | TDD |
| 3.10 | `feat(daemon): agent exec endpoint streaming NDJSON` | TDD + 一个 backend e2e（claude） |
| 3.11 | `feat(daemon): wire all 5 backends with smoke tests` | 每个 backend 一个 L2 happy-path |
| 3.12 | `feat(dashboard): vite + basalt token system` | basalt CSS/lib 抄过来，对应 vitest snapshot |
| 3.13 | `feat(dashboard): app shell + theme init` | TDD（vitest + RTL） |
| 3.14 | `feat(dashboard): 5 page skeletons (MVVM 三段式)` | 每页 model/viewmodel 测试先行 |
| 3.15 | `feat(dashboard): daemon http client + bearer storage` | TDD |
| 3.16 | `feat(dashboard): /setup page wired to first-run mint endpoint` | TDD（mock fetch）；token 表空时跳 `/setup`，按钮触发 `POST /bootstrap/mint` |
| 3.17 | `feat(dashboard): wire 5 pages to live daemon` | L3 playwright happy path 跑通（dev 通过 Vite proxy） |
| 3.18 | `feat(daemon): embed dashboard dist via go:embed at GET /` | turbo `dashboard:build` 产出 `dist/` → daemon `embed.FS`；prod 同源访问、零 CORS |
| 3.19 | `test(e2e): full happy path against prod daemon (init → /setup → mint → claude exec → view messages)` | L3 完整，跑 daemon 单二进制（无 Vite dev server） |
| 3.20 | `chore: bump coverage thresholds to S-tier (daemon 95% / dashboard 90%)` | 强制 gate |

**每个 commit 都满足**：自带必要测试 + 六维 hooks 通过 + 不留 TODO。

**Phase 3 出口条件**：§5 成功标准全部勾选，Tier 判定 S。

---

## 10. 相关文档

- [`/README.md`](../README.md) — 仓库入口
- [`/CLAUDE.md`](../CLAUDE.md) — 工作约束
- 待建（**Phase 1 计划**，见 §9.2）：
  - `docs/architecture/01-agent-sdk-pump-from-multica.md`
  - `docs/architecture/02-daemon-http-protocol.md`
  - `docs/architecture/03-sqlite-schema-and-tokens.md`
  - `docs/architecture/04-bootstrap-and-first-run-mint.md`
  - `docs/architecture/05-remote-access-modes.md`
  - `docs/architecture/06-dashboard-mvvm-and-basalt.md`
  - `docs/architecture/07-6dq-hooks-wiring.md`
