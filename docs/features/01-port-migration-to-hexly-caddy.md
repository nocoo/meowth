# 01 · 端口迁移到 Hexly Caddy 体系

> 状态：规划落地中（Caddy + 文档 + nmem 已完成，源码改动待开工）
> 历史在 `git log -- docs/features/01-port-migration-to-hexly-caddy.md`

---

## 1. 背景

本机开发环境用 Caddy + mkcert + `*.dev.hexly.ai` 通配域名做 HTTPS 反代（详 `nmem search "caddy 本机 debug 域名分配 端口"`）。端口分配规则：

- **主 dev**：从 7002 起按项目首次 commit 时间升序连续编号
- **L2 / E2E**：`dev + 10000`
- **BDD**：`dev + 20000`
- **Dev-only 辅助进程**（如 Cloudflare Worker dev、Vite dev server）：`dev + 30000`，避免和主端口段挤占

Meowth 当前用 `7777 / 5173 / 17777 / 17778` 是早期占位，未纳入 Hexly 体系。本次迁移到分配方案，并把 Caddy 反代域名写进代码与文档。

## 2. 设计原则与端口表

**原则**：主服务（daemon）= 主端口 = 主域名；Vite 是 dev-only 辅助，进 +30000 段。Meowth 在 Hexly 主端口表只占 **1 个位置**（7040），不浪费连号位。

| # | 端口 | 域名 | 进程 | 何时存在 |
|---|---|---|---|---|
| **主** | **7040** | `meowth.dev.hexly.ai` | daemon (`meowthd serve`) | prod + dev,永远 |
| **e2e-1** | **17040** | — | daemon (embed fixture 隔离副本) | `pnpm e2e` 期间 |
| **e2e-2** | **17041** | — | daemon (embed-mint fixture,独立实例) | `pnpm e2e` 期间 |
| **辅助** | **37040** | `meowth-vite.dev.hexly.ai` | Vite dev server | 仅 `pnpm dev` 期间 |

### 2.1 关于 e2e-2 的紧邻 +1

按 nmem 规则 `L2/E2E = dev + 10000`，daemon dev 7040 → e2e 应为 **17040**。但现存 `dashboard-embed-mint` fixture 必须独立 daemon 实例（mint 流不能与其它 e2e 共用,会污染 `setup_nonce.hash` 一次性状态,详 `docs/architecture/04` §5.3）。沿用现有「紧邻端口 +1」隔离方式 → **17041**。这是对 +10000 规则的**唯一例外**，原因：单 fixture 内部细分,非新增逻辑端口。

### 2.2 关于 Vite 进 +30000 段

`+30000` 段在 nmem 规则里原本为 Cloudflare Worker dev 设计，目的是避免多项目共用 wrangler 默认 8787 冲突。Vite 完全同构 —— 多项目共用默认 5173 也会冲突，dev-only、prod 不存在。把 Vite 归入这个段语义一致。

### 2.3 关于 prod 模式与 mint

prod 仍坚持 daemon 单进程 `go:embed` dashboard，**只占 7040 一个端口**。

**mint 不走 Caddy**（关键约束）：`docs/architecture/04` §6.6 的浏览器来源门硬编码 `expected := "http://" + r.Host`，依赖 same-origin loopback 前提；Caddy 反代终 TLS + 改 Host 会破坏该哲学。本次迁移**不改 origin gate**，方案约束如下：

- **日常使用**：浏览器走 `https://meowth.dev.hexly.ai`（Caddy → 7040 daemon）查 session、调 API、看仪表盘。bearer token 已存在,这条路径不触发 mint
- **首次启动 mint（path B）**：必须用 `http://127.0.0.1:7040/setup` 直接访问 daemon,绕开 Caddy。Origin = Host = `127.0.0.1:7040`,同源门通过。**建议用 127.0.0.1 而非 localhost** —— daemon `DefaultBindAddr = 127.0.0.1`,只 bind IPv4 loopback;浏览器解析 `localhost` 可能优先走 IPv6 `::1`,连不上 daemon。同源门本身（`expected := "http://" + r.Host`）对 `http://localhost:7040` 和 `http://127.0.0.1:7040` 都自洽,**真正的风险是 IPv6 解析失配**。同步 `daemon/internal/{bootstraptoken,initcmd}/.../DashboardURL` 保持 `http://127.0.0.1:7040`
- **dashboard `/setup` 页面**：复用现有 `useSetupViewModel` 的 origin 检测逻辑（当前用来禁用 dev 模式 mint 按钮）,**规则改为**：允许 HTTP loopback origin（`http://127.0.0.1:*`、`http://localhost:*`、`http://[::1]:*`）—— 因 e2e `dashboard-embed-mint` fixture 在 17041 上跑 mint,必须放行；禁用非 loopback 或 HTTPS Caddy origin,提示文案「mint 必须通过 http://127.0.0.1:7040/setup 完成（不能经 Caddy HTTPS 反代;若用 localhost 注意 IPv6 解析问题）」。判定不依赖固定端口,避免和 e2e 17041 冲突

`meowth-vite.dev.hexly.ai` 域名只在 dev 模式下有意义（Caddy → Vite 37040,Vite 内部 proxy `/v1` → daemon 7040）；prod 部署用户访问 `meowth.dev.hexly.ai` 看 UI / 调 API，访问 `http://127.0.0.1:7040/setup` 走 mint。

### 2.4 Caddy 路由总览

```
                  prod                            dev                        e2e
                  ─────                           ────                       ────
  浏览器                                                                       (无 Caddy,直连)
   ↓                                              ↓
  Caddy: meowth.dev.hexly.ai                     Caddy: meowth-vite.dev.hexly.ai
   ↓                                              ↓
  ┌──────────┐                            ┌──────────────┐          ┌────────────────┐
  │  7040    │ daemon (含 UI)             │  37040 Vite  │ HMR + JS │ 17040 daemon   │ embed e2e
  │          │                            │              │          │                │
  └──────────┘                            └──────┬───────┘ ─┐       └────────────────┘
        ↑                                        │          │       ┌────────────────┐
  (mint: http://                                  │          ▼       │ 17041 daemon   │ embed-mint e2e
   127.0.0.1:7040/setup                           │  ┌──────────┐    └────────────────┘
   直连,不经 Caddy)                                │  │ 7040     │
                                                   ▼  │ daemon   │
                                            (浏览器看见) │ (无UI)   │
                                                     └──────────┘
```

## 3. 影响面清单

### 3.1 已完成（外部世界）

- **`/opt/homebrew/etc/Caddyfile`** — 把 `# 7041 - meowth-api` 段改为 `# 37040 - meowth-vite`,`caddy validate` + `caddy reload` 完成。新路由：
  - `meowth.dev.hexly.ai` → `localhost:7040`（已存在,未变）
  - `meowth-vite.dev.hexly.ai` → `localhost:37040`（新增）
  - `meowth-api.dev.hexly.ai` → **已移除**
- **nmem** — 端口分配总表更新（Meowth 在 7040 + Vite 在 37040；7041 释放回空闲）

### 3.2 一次性本机迁移（仅当 `~/.meowth/` 存在时执行）

`remoteaccess.go:140` 的 `Load` 只在 `[remote_access]` 块缺失时走默认值，块存在按文件字面值。改 `DefaultBindPort` 对老 home **不生效**。

事实核对（2026-06-23）：本机当前**没有** `~/.meowth/`（只有 L2 harness 自动生成的 `~/.meowth-test/`，每次跑测试都重建，无需迁移）。所以本节属于「如果将来跑过 `meowthd init` 又想升级」的兜底说明。

幂等命令（空白不敏感，文件不存在不报错；本机只我一人用，不写迁移子命令 —— CLAUDE.md「不为不会发生的场景加 fallback」）：

```bash
if [ -f ~/.meowth/config.toml ]; then
  perl -0pi -e 's/(bind_port\s*=\s*)7777\b/${1}7040/' ~/.meowth/config.toml
  grep -E '^\s*bind_port\s*=\s*7040\s*$' ~/.meowth/config.toml \
    && echo "OK: bind_port 已升级到 7040" \
    || echo "WARN: 未找到 bind_port=7040 行,请人工核对"
fi
```

`~/.meowth-test/` 不需要管（每次测试重建）。

### 3.3 待改（仓库源码与文档）

#### Daemon 源码

- `daemon/internal/remoteaccess/remoteaccess.go:59` — `DefaultBindPort uint16 = 7777` → 7040
- `daemon/internal/remoteaccess/remoteaccess.go:286` — IPv6 注释举例
- `daemon/internal/remoteaccess/remoteaccess_test.go` — 17 处 `7777`
- `daemon/internal/remoteaccess/diag.go:111, 161` — 诊断文案模板
- `daemon/internal/remoteaccess/diag_test.go:13, 19, 104` — 诊断断言
- `daemon/internal/initcmd/initcmd.go:41, 55` — `DashboardURL` + 初始 config.toml 模板
- `daemon/internal/initcmd/initcmd_test.go:67` — 模板断言
- `daemon/internal/bootstraptoken/bootstraptoken.go:43` — `DashboardURL`
- `daemon/internal/server/server.go:262` — 注释举例
- `daemon/internal/server/openapi.yaml:30` — OpenAPI servers
- `daemon/internal/server/handlers/mint_test.go:105, 180, 190` — Origin gate 测试
- `daemon/cmd/meowthd/main_test.go:156, 237` — 启动横幅 + 黑名单断言

#### Dashboard 源码

- `apps/dashboard/vite.config.ts` — dev port 5173 → 37040 + proxy target 7777 → 7040 + **新增 `server.allowedHosts: ['meowth-vite.dev.hexly.ai']`**（Vite 5.0.12+ default-deny 非 loopback host,Caddy 反代过来 403）+ 视实测决定 `server.hmr` 配置（Caddy 终 TLS → 浏览器 wss → Vite ws,可能需要 `hmr: { clientPort: 443, protocol: 'wss', host: 'meowth-vite.dev.hexly.ai' }`）
- `apps/dashboard/e2e/embed/headers.spec.ts:7` — 注释
- `apps/dashboard/e2e/embed/secret-reveal.spec.ts:26` — 显式 origin

#### E2E / L2 harness

- `apps/dashboard/playwright.config.ts:4-7, 36, 43, 44, 53, 64, 115, 121, 127` — 三 project + webServer port
- `scripts/e2e-dev-fixture.ts:11, 113, 116`
- `scripts/e2e-embed-fixture.ts:12, 34, 54`
- `scripts/e2e-embed-mint-fixture.ts:30`
- `scripts/run-mint-l2.ts:332`
- `scripts/run-remote-access-l2.ts:292, 368, 382, 396, 409-410, 438`

#### 文档

- `docs/01-project-overview.md:158, 207, 247-249, 252`
- `docs/architecture/02-daemon-http-protocol.md:45, 618`
- `docs/architecture/04-bootstrap-and-first-run-mint.md:78, 108, 331, 346, 361` —— 同时补一节「mint 必须 loopback 直连,不经 Caddy 反代」（详 §2.3）
- `docs/architecture/05-remote-access-modes.md` — 15 处
- `docs/architecture/06-dashboard-mvvm-and-basalt.md:201-235, 668, 714` —— `useSetupViewModel` origin 检测扩展到「非 loopback」
- `docs/architecture/08-6dq-hooks-wiring.md:156-168`
- `docs/features/README.md:9` — 索引标题更新

**待改合计 27 个文件。**

## 4. 原子提交序列

按「daemon → dashboard → e2e → 文档 → 验证」自底向上推。每个 commit 独立可解释、可独立回滚。

> Caddyfile、nmem、本机 `~/.meowth/config.toml` 不在仓库内，已在第 3.1/3.2 节描述执行结果。

1. **`refactor(daemon): default bind_port 7777 → 7040`**
   改 `DefaultBindPort` + diag 文案 + 所有 `daemon/` 下的测试常量与 fixture + openapi.yaml + DashboardURL。Go 单元测试需绿。

2. **`chore(dashboard): Vite dev 5173 → 37040, proxy target → 7040, allowedHosts for Caddy`**
   `apps/dashboard/vite.config.ts`：port + proxy + allowedHosts + hmr 配置。

3. **`test(e2e): align fixtures/playwright to 7040/37040/17040/17041`**
   playwright config 三 project + 三个 fixture 脚本 + 两个 `.spec.ts` 硬编码值 + `scripts/run-*-l2.ts` 里的 toml 模板。

4. **`docs: migrate port references + Caddy domain mapping + mint loopback constraint`**
   `docs/01-project-overview.md`、`docs/architecture/02/04/05/06/08`、`docs/features/README.md`。新增「§ Caddy 反代域名」+「mint 必须 loopback 直连」两节。

5. **6DQ 验证（不入 commit，结果写在第 6 节）**

## 5. 6DQ 质量计划

| 层 | 验证手段 | 通过条件 |
|---|---|---|
| **G1 静态** | `pnpm daemon:g1 && pnpm dashboard:g1` | 全绿 |
| **L1 单元 + 覆盖率** | `pnpm daemon:test:cover && pnpm daemon:cover:check && pnpm dashboard:test:cover && pnpm dashboard:cover:check` | 全绿;daemon ≥95% / dashboard ≥90% gate 通过 |
| **L2 API** | `pnpm test:l2`（含 tokens / mint / exec / remote-access） | 全绿,新端口 ok |
| **L3 E2E** | `pnpm --filter @meowth/dashboard e2e`（dashboard-dev + embed + embed-mint 三 project） | 全绿,三个 fixture 都能起来 |
| **L3 Caddy 实测**（手工） | `https://meowth.dev.hexly.ai/healthz` 200 + `https://meowth-vite.dev.hexly.ai/` 返回 dashboard HTML + HMR 可工作 + `http://127.0.0.1:7040/setup` 同源 mint 能成功 + `https://meowth.dev.hexly.ai/setup` mint 按钮 disabled + 提示语正确 | 全部通过 |
| **D1 隔离** | `pnpm scan:d1` | 不引入 prod/test 混合 |
| **G2 安全** | `pnpm scan:g2` | 无回归 |

不做：BDD（项目当前未引入）、Worker dev 端口（项目无 Cloudflare Worker）。

## 6. 验证结果

> 落地完成后填。
