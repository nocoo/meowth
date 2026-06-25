# Architecture · 06 · Dashboard MVVM & basalt

> **更新规则**：本文档定义 `apps/dashboard/` 的目录结构、basalt 设计系统的源码复制方式、Vite + Tailwind v4 + React 19 工程接入、MVVM 三段式分层、5 个核心页面 + `/setup` 入口判定。
> 任何 dashboard 目录拓扑、basalt copy 清单、MVVM 边界、`/setup` 决策树的改动，必须先回到这里更新，再向下推进。
> 历史在 `git log -- docs/architecture/06-dashboard-mvvm-and-basalt.md`。

> 上层依据：[`docs/01-project-overview.md`](../01-project-overview.md) §7.5、§9.2 Phase 3.13–3.20。
> 本文档**不涉及**：
> - HTTP wire protocol / NDJSON envelope（→ [`02-daemon-http-protocol.md`](02-daemon-http-protocol.md)；本文档**消费** wire 语义，不重新定义）
> - token 表 / argon2id（→ [`03-sqlite-schema-and-tokens.md`](03-sqlite-schema-and-tokens.md)）
> - `setup_nonce.hash` / mint endpoint 内部逻辑（→ [`04-bootstrap-and-first-run-mint.md`](04-bootstrap-and-first-run-mint.md)；本文档**消费** mint endpoint 的 wire response）
> - `[remote_access]` 配置 / bind 校验（→ [`05-remote-access-modes.md`](05-remote-access-modes.md)）
> - **CSP / XSS / sanitizer / `dangerouslySetInnerHTML` / DOMPurify / secret 显示遮罩 / 日志脱敏的详细策略**（→ `07-dashboard-security-csp-and-xss.md`；本文档仅交叉引用，**不**展开安全细节）
> - 6DQ hook 接线（→ `08-6dq-hooks-wiring.md`）

---

## 1. 范围

本文档管：

- `apps/dashboard/` 的目录拓扑与构建产物
- basalt 设计系统的**源码复制**（source copy，不是 npm 依赖）清单与 upstream 锁定方式
- Vite + Tailwind v4 + React 19 + React Router 8 接入细节
- MVVM 三段式（`models/` / `viewmodels/` / `pages/`）的分层规则与可执行约束
- 5 个核心页面 + `/setup` 的 page→viewmodel→model 映射
- HTTP 客户端 `src/lib/api.ts` 的形态与约束
- `/setup` 入口判定决策树（不依赖未授权 introspection）
- 路由守卫与 bearer hydrate 流程

本文档不管：

- token / setup-code 的实际格式（→ 03 / 04）
- mint endpoint 内部硬约束（→ 04）
- 安全 header、CSP 注入点、DOMPurify 调用点（→ 07）
- backend stream-json / NDJSON event envelope schema（→ 02 §5）

---

## 2. 目录拓扑

```
apps/dashboard/
├── index.html                       Vite entry HTML
├── package.json                     name: @meowth/dashboard
├── vite.config.ts                   @tailwindcss/vite plugin + proxy
├── tsconfig.json                    extends ../../tsconfig.base.json (strict)
├── biome.json                       optional override; otherwise inherit root
├── public/                          favicon / static assets only (no JS)
└── src/
    ├── main.tsx                     React root, mounts <App/>
    ├── App.tsx                      <Router/> + global providers
    ├── index.css                    basalt token full copy (§4.1)
    ├── routes/
    │   ├── index.tsx                React Router 8 route table
    │   └── guards.tsx               auth/setup hydration guards (§10)
    ├── pages/
    │   ├── Overview/                MVVM 三段式：Page + Content + Skeleton (+ tests) — see §6.4
    │   │   ├── OverviewPage.tsx     shell: owns useOverviewViewModel + branch
    │   │   ├── OverviewContent.tsx  pure-props: business render
    │   │   ├── OverviewSkeleton.tsx pre-data placeholder
    │   │   └── index.ts             re-export
    │   ├── Agents/
    │   │   ├── AgentsPage.tsx       shell
    │   │   ├── AgentsContent.tsx    pure-props (table or EmptyState)
    │   │   ├── AgentsSkeleton.tsx
    │   │   └── index.ts
    │   ├── Sessions/
    │   │   ├── SessionsListPage.tsx     shell
    │   │   ├── SessionsListContent.tsx
    │   │   ├── SessionsListSkeleton.tsx
    │   │   ├── SessionDetailPage.tsx    shell (route param + vm)
    │   │   ├── SessionDetailContent.tsx pure-props (header + session-messages)
    │   │   ├── SessionDetailSkeleton.tsx
    │   │   └── index.ts
    │   ├── Tokens/
    │   │   ├── TokensPage.tsx           shell + Create button toolbar
    │   │   ├── TokensContent.tsx
    │   │   ├── TokensSkeleton.tsx
    │   │   ├── TokensCreateDialog.tsx   extracted dialog (see §7.4)
    │   │   └── index.ts
    │   ├── Settings/
    │   │   ├── SettingsPage.tsx         shell + always-on Dashboard build row
    │   │   ├── SettingsContent.tsx      Notice (success / warning / destructive)
    │   │   ├── SettingsSkeleton.tsx     placeholder for the Daemon row only
    │   │   └── index.ts
    │   └── Setup/
    │       ├── SetupPage.tsx        pre-login shell; not split (styling-only Gen 2 pass)
    │       └── index.ts
    ├── viewmodels/
    │   ├── useOverviewViewModel.ts
    │   ├── useAgentsViewModel.ts
    │   ├── useSessionsViewModel.ts
    │   ├── useSessionDetailViewModel.ts
    │   ├── useTokensViewModel.ts
    │   ├── useSettingsViewModel.ts
    │   └── useSetupViewModel.ts
    ├── models/
    │   ├── agents.ts                fetchAgents() / AgentInfo
    │   ├── sessions.ts              listSessions() / getSession() / followSessionMessages()
    │   ├── tokens.ts                listTokens() / createToken() / revokeToken()
    │   ├── health.ts                pingHealthz()
    │   ├── bootstrap.ts             mintWithSetupCode()
    │   ├── types.ts                 wire types (manually authored or generated from openapi.yaml)
    │   └── envelope.ts              NDJSON envelope decoder
    ├── components/
    │   ├── ui/                      source-copy/source-derived primitives — see §4.1
    │   │   ├── button.tsx
    │   │   ├── input.tsx
    │   │   ├── dialog.tsx
    │   │   ├── skeleton.tsx
    │   │   ├── notice.tsx           inline status block (info/success/warning/destructive)
    │   │   ├── empty-state.tsx      icon + title + description placeholder
    │   │   └── ...                  add more on demand
    │   ├── layout/                  Gen 2 app shell (replaces Gen 1 DashboardLayout)
    │   │   ├── app-shell.tsx        page chrome + Sheet-driven mobile sidebar
    │   │   ├── sidebar.tsx          floating-island L1 navigation
    │   │   ├── sidebar-context.tsx  collapsed/open state shared via context
    │   │   ├── breadcrumbs.tsx
    │   │   └── index.ts
    │   ├── StatCard.tsx             Overview metric card (title/body/optional icon)
    │   ├── ThemeToggle.tsx          meowth-local (adapted from basalt; uses dark variant token)
    │   ├── Spinner.tsx              meowth-local (basalt has no Spinner; uses lucide-react Loader2)
    │   ├── SecretReveal.tsx         meowth-local (see 07)
    │   └── ...
    └── lib/
        ├── api.ts                   bearer-aware fetch wrapper (§8)
        ├── localStorage.ts          typed wrapper over window.localStorage
        ├── utils.ts                 source-copied from basalt
        └── palette.ts               source-copied from basalt
```

构建产物：`apps/dashboard/dist/` 经 `pnpm --filter @meowth/dashboard build` 生成；daemon 通过 `go:embed apps/dashboard/dist` 在生产挂载到 `GET /` 与子路径（[`02`](02-daemon-http-protocol.md) §3 静态资源行）。

---

## 3. Vite + Tailwind v4 + React 19 接入

### 3.1 依赖

`apps/dashboard/package.json` 的当前 dependency 形态（精确版本以 `pnpm-lock.yaml` 为准；本文档**不**复制具体次版本号，避免与未来基线刷新冲突）：

**dependencies**：

- `react`、`react-dom`
- `react-router`
- `clsx`
- `tailwind-merge`
- `class-variance-authority`
- `lucide-react`
- `radix-ui` — Radix primitives 走**聚合包**（aggregate package），不再逐包 `@radix-ui/react-<x>` 增量添加。所有 source-copy 的 ui 文件（`dialog.tsx` / `sheet.tsx` / `tooltip.tsx` / `dropdown-menu.tsx` / `select.tsx` 等）统一从 `radix-ui` 命名空间 import；详 §4.1.5 / §4.3。

**devDependencies**：

- `@vitejs/plugin-react`
- `@tailwindcss/vite`
- `tailwindcss`
- `tw-animate-css`
- `vite`
- `typescript`
- `dependency-cruiser`（§6.2 的强制边界约束）
- `vitest` + `@vitest/coverage-v8`（L1 + ratchet gate）
- `@playwright/test`（L3）
- `@biomejs/biome`（G1 fmt + lint）

**约束的"大方向"**（强制）：

- React **19** 系
- React Router **8** 系
- Tailwind **v4**（必须用 `@tailwindcss/vite` 插件路径，不用 PostCSS 路径）
- Radix 用 **`radix-ui` 聚合包**，**不**用单包 `@radix-ui/react-<x>`

其它包的精确版本号由 `pnpm-lock.yaml` 锁定；与 basalt/surety 当前版本可不完全一致（两个 upstream 都是参考工程，meowth 选自己 toolchain 兼容的版本即可）。

**为什么这些 deps**（每条来自 upstream source-copy / source-derived 的具体需求）：

| Dep | 由谁触发 | 必要性 |
|-----|---------|-------|
| `clsx` + `tailwind-merge` | `lib/utils.ts` 的 `cn()`（basalt 抄过来） | 所有 component 拼 className 都依赖 `cn`，缺则编译红 |
| `class-variance-authority` | `components/ui/button.tsx` / `notice.tsx` / `empty-state.tsx` 等 shadcn 风格组件用 `cva()` 定义 variant | 缺则相关 component 编译红 |
| `lucide-react` | layout 三件套图标 + Spinner Loader2 + Notice / EmptyState 默认 icon prop + dialog X close | 缺则上述组件与 dialog 编译红 |
| `tw-animate-css` | basalt 的 `src/index.css` 顶部 `@import "tw-animate-css"` | 缺则 Tailwind 编译时找不到 import |
| `radix-ui` | 所有 source-copy 的 ui 原语依赖 Radix primitives（Dialog / Sheet / Tooltip / DropdownMenu / Select / Avatar / Collapsible / Separator / Switch / Toggle / ToggleGroup 等） | 缺则 ui 原语整片编译红；聚合包替代 §3.1 旧版"按需逐包增量"流程 |

**copy → require 映射**（与 §4.1 同步；只覆盖 source-copy / source-derived ui 文件）：

| Copy file | Required deps |
|-----------|---------------|
| `lib/utils.ts` | `clsx`、`tailwind-merge` |
| `index.css` | `tw-animate-css` |
| `components/ui/button.tsx` | `class-variance-authority`、`radix-ui`（Slot） |
| `components/ui/input.tsx` | （仅 React + cn） |
| `components/ui/dialog.tsx` | `radix-ui`、`lucide-react`（X 图标） |
| `components/ui/sheet.tsx` | `radix-ui`、`lucide-react` |
| `components/ui/tooltip.tsx` | `radix-ui` |
| `components/ui/skeleton.tsx` | （仅 React + cn） |
| `components/ui/notice.tsx` | `class-variance-authority` |
| `components/ui/empty-state.tsx` | `lucide-react`（icon prop 类型） |
| `components/layout/{app-shell,sidebar,sidebar-context,breadcrumbs}.tsx` | `radix-ui`（Sheet）、`lucide-react`（menu/chevron icons）、`react-router`（NavLink） |

**meowth-local 组件**（§4.1.4）按 meowth 实际需要引入 deps，不强制对齐 upstream：

- `StatCard.tsx`：`lucide-react`（icon prop 类型）
- `ThemeToggle.tsx`：`lucide-react`（sun/moon icon）；直接读写 `localStorage` + `documentElement.classList`，**不**引入 i18n
- `Spinner.tsx`：`lucide-react`（Loader2）
- `SecretReveal.tsx`：仅 React + lib 内部依赖
- `MessageText.tsx`：内部 sanitiser（见 [`07`](07-dashboard-security-csp-and-xss.md)）

新增 copy 时，必须在 commit message 中显式列出新引入的依赖包（即使仍是 `radix-ui` 聚合包内的新 namespace 也要注明 namespace）。

### 3.1a `@/` path alias

basalt 抄过来的所有文件 import 写成 `@/lib/utils` / `@/components/ui/button` 等 shadcn 习惯。dashboard **保留** `@/` alias，**不**做 import rewrite：

- `vite.config.ts` 加 `resolve.alias`：
  ```ts
  resolve: { alias: { '@': path.resolve(__dirname, './src') } }
  ```
- `tsconfig.json` 加 `paths`：
  ```json
  { "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }
  ```
- vitest config（[`08`](08-6dq-hooks-wiring.md) 详细）同步配 alias

这与 basalt 当前 `vite.config.ts` 的 alias 一致（`~/workspace/personal/basalt/vite.config.ts` line: `alias: { "@": path.resolve(__dirname, "./src") }`），避免 source-copy 后逐文件 rewrite import。

### 3.2 `vite.config.ts`

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }, // §3.1a
  },
  server: {
    port: 37040,
    proxy: {
      '/v1':      { target: 'http://127.0.0.1:7040', changeOrigin: false },
      '/healthz': { target: 'http://127.0.0.1:7040', changeOrigin: false },
      // /bootstrap/* 不 proxy（与 04 §6.6 浏览器来源门冲突；详 §3.4）
    },
  },
});
```

**dev proxy 与 production zero-CORS 的边界**：

- dev 模式下 dashboard 跑 Vite dev server `:37040`，Vite 把 **`/v1/*` 与 `/healthz`** 转发到 daemon `127.0.0.1:7040`。dashboard 与 daemon 在浏览器侧**同源**（都通过 Vite dev server），daemon 不需要返回任何 CORS header
- **`/bootstrap/*` 不由 Vite proxy 接管**——理由与方案详 §3.4
- 生产模式下 dashboard 由 daemon `go:embed` 同源提供（[`02`](02-daemon-http-protocol.md) §3）；同源所以 daemon **不**返回 `Access-Control-Allow-Origin`
- **任何 mode**（含 [`05`](05-remote-access-modes.md) 的 tailscale / ssh_tunnel / https_proxy）都不能让 daemon 在生产打开 CORS——`Vite proxy` 是 dev-only 的工程便利，与 [`02`](02-daemon-http-protocol.md) §2.4 production zero-CORS 一致

### 3.3 Tailwind v4

按 [Tailwind v4 `@tailwindcss/vite` 路线](https://tailwindcss.com/docs/installation/using-vite)：

- 不需要 `postcss.config.js`、不需要 `tailwind.config.js`（v4 默认零配置启动；token 在 CSS 里用 `@theme` 块定义）
- 入口 `src/index.css` 顶部 `@import "tailwindcss";` 与 `@import "tw-animate-css";`（与 basalt 一致）
- `main.tsx` 顶部 `import './index.css';`

basalt 的 token 全文以 `@theme` 形式存在于 `src/index.css`，由 §4.1 source-copy 引入。token 命名详 §5。

### 3.4 dev proxy **不**覆盖 `/bootstrap/*`

[`04`](04-bootstrap-and-first-run-mint.md) §6.6 浏览器来源门要求 `POST /bootstrap/mint` 请求的 `Origin` header 必须**精确等于** `http://` + daemon `r.Host`。Vite dev server 在 `http://meowth-vite.dev.hexly.ai` 跑，浏览器发的请求 `Origin: http://meowth-vite.dev.hexly.ai`；即使 Vite proxy 把 path 转到 daemon `127.0.0.1:7040`，daemon 看到的 `Origin` 仍是 `http://meowth-vite.dev.hexly.ai`，不匹配 `http://127.0.0.1:7040` → 04 §6.6 判定 cross-site → 统一 404。dev 下 `/setup` mint 表单因此会**假失败**。

v1 选定方案（**不**修改 04 安全边界）：

- **dev proxy 不接管 `/bootstrap/*`**（§3.2 已落实）
- dev 下 `/setup` mint 表单**仍渲染**（同一份 page 代码，方便 UI 开发），但**提交按钮按"是否 HTTP loopback origin"判定**——`useSetupViewModel` 检测当前 `window.location.origin`：HTTP loopback（`http://127.0.0.1:*`、`http://localhost:*`、`http://[::1]:*`）放行（mint 路径 B 真实跑在 daemon `http://127.0.0.1:7040`，e2e `dashboard-embed-mint` 也跑在 `http://127.0.0.1:17041`，都属 loopback），其它任何 origin（如 `http://meowth-vite.dev.hexly.ai`、Caddy HTTPS `https://meowth.dev.hexly.ai`）一律 disabled，旁边显示文案「Mint must be reached at http://127.0.0.1:7040/setup (not via Caddy HTTPS; localhost may resolve to IPv6 — prefer 127.0.0.1)」。这条规则同时保护 Caddy HTTPS 入口：浏览器从 `https://meowth.dev.hexly.ai/setup` 访问时表单不可点
- mint L3 测试因此只在"production embed 形态"下跑（Phase 3.20 / 3.21 用 daemon embed dashboard dist 后通过 same-origin 触达 `http://127.0.0.1:17041`）；dev 下 mint 行为 = "按钮 disabled + 文案" 即视为正确
- L2 层面对 mint endpoint 的 wire 测试由 daemon 侧 curl-level harness 覆盖（[`08`](08-6dq-hooks-wiring.md)），不在 dashboard 测试范围

后续若要让 Vite dev 也支持 mint：需要先在 04 §6.6 显式允许 Vite dev origin（修改安全边界，单独立项）；本文档不在 v1 走该路径。

`/setup` 手输入框（路径 A）不受影响——它只调 `GET /v1/agents`，走 v1 endpoint + Vite proxy + 同源 fetch，dev 下完全可用。

---

## 4. UI primitives — source-copy and source-derived

`apps/dashboard/src/components/` is assembled from two upstream design systems plus a small set of meowth-local additions:

- **basalt** (`~/workspace/personal/basalt`) — the visual design system this dashboard inherits tokens and the original primitive set from. basalt is the project author's own local repository (not an npm package).
- **surety** (`~/workspace/personal/surety`, MIT) — sibling project that already ships the Gen 2 floating-island app shell + extended primitive set (`empty-state`, `notice`, `skeleton`, the `layout/{app-shell,sidebar,sidebar-context}` triplet, etc.). Phase 2 Stage A/B introduced these by porting from surety rather than re-inventing them.

dashboard **does not** depend on either project as an npm package; sources are copied (or formatted/coverage-annotated copies derived from them) into `apps/dashboard/src/`. The `_UPSTREAM.md` record at the root of `apps/dashboard/src/` tracks every primitive's origin and provenance class — see `§4.2`.

### 4.1 复制清单（文件级映射）

basalt 当前 `src/components/ui/` 是 shadcn 风格 **小写文件名**（如 `button.tsx` / `input.tsx` / `dialog.tsx`），surety 同样保留小写文件名约定。dashboard **保留 upstream 的原文件名**，避免 import rewrite。

**三类继承策略**：

- **source-copy (verbatim)**：低层 UI primitives + 顶级样式片段，逐字节复制
- **source-derived (formatted / coverage-annotated)**：从 upstream 复制后，仅做 biome 格式化、`v8 ignore` 覆盖率注释、或受 jsdom 测试约束的最小行调整；视觉/逻辑契约不变
- **meowth-local**：完全在 meowth 编写（无 upstream），见 §4.1.4

#### 4.1.1 source-copy primitives — basalt baseline

These files are the original Phase 3.13 basalt source-copy set; provenance class is **source-copy** (verbatim from basalt).

| upstream path (basalt) | meowth path | provenance |
|---------------|-------------|------------|
| `src/index.css` (basalt `@theme inline {...}` + `@import "tw-animate-css"`) | `apps/dashboard/src/index.css` | source-copy; do not modify token values; meowth-specific tokens appended at file end only |
| `src/lib/utils.ts` (`cn()` = `clsx` + `tailwind-merge`) | `apps/dashboard/src/lib/utils.ts` | source-copy |
| `src/lib/palette.ts` | `apps/dashboard/src/lib/palette.ts` | source-copy |
| `src/components/ui/button.tsx` | `apps/dashboard/src/components/ui/button.tsx` | source-copy |
| `src/components/ui/input.tsx` | `apps/dashboard/src/components/ui/input.tsx` | source-copy |
| `src/components/ui/dialog.tsx` | `apps/dashboard/src/components/ui/dialog.tsx` | source-copy (Tokens page dialog depends on it) |

`badge` / `label` / `separator` / `tooltip` etc. **are not** part of this basalt baseline anymore — they were re-imported from surety during Stage A3/A4 as part of the Gen 2 G1/G2 sets (see §4.1.3); `_UPSTREAM.md` lists each of them under the surety block.

#### 4.1.2 Gen 2 layout — surety triplet (source-derived)

Phase 2 Stage B replaced the Gen 1 `DashboardLayout` + monolithic `AppSidebar` + `ThemeToggle`-as-shell-control trio with the surety Gen 2 floating-island app shell. Three companion files compose the shell:

| meowth path | surety origin | role |
|-------------|---------------|------|
| `components/layout/app-shell.tsx` | surety `components/layout/app-shell.tsx` | page chrome; owns the Sheet drawer trigger ref + manual `onCloseAutoFocus` so focus returns to the menu button after the drawer closes |
| `components/layout/sidebar.tsx` | surety `components/layout/sidebar.tsx` | the floating-island L1 navigation panel |
| `components/layout/sidebar-context.tsx` | surety `components/layout/sidebar-context.tsx` | shared collapsed/open state via React context so AppShell + Sidebar do not need to thread state through props |
| `components/layout/breadcrumbs.tsx` | surety `components/layout/breadcrumbs.tsx` | per-page breadcrumb row |
| `components/layout/index.ts` | n/a | barrel re-export (exempt-structural in coverage) |

Provenance class is **source-derived** because biome reformatted line breaks and a small set of `/* v8 ignore start/stop */` markers were added around SSR-only branches (`useSyncExternalStore` `getServerSnapshot`); the visible/behavioral contract is unchanged.

#### 4.1.3 G1 + G2 primitives — surety source-derived inventory

Stage A imported the following from surety, batched as G1 (layout-required, Stage A3) and G2 (page-migration-required, Stage A4). All entries are **source-derived** (biome-formatted, occasionally `/* v8 ignore */` annotated) and tracked under the surety block of `_UPSTREAM.md`.

**Stage A3 — G1 (layout-required, 8 files)**

| meowth path | surety origin |
|-------------|---------------|
| `components/ui/tooltip.tsx` | surety `components/ui/tooltip.tsx` |
| `components/ui/sheet.tsx` | surety `components/ui/sheet.tsx` |
| `components/ui/avatar.tsx` | surety `components/ui/avatar.tsx` |
| `components/ui/collapsible.tsx` | surety `components/ui/collapsible.tsx` |
| `components/ui/separator.tsx` | surety `components/ui/separator.tsx` |
| `components/ui/badge.tsx` | surety `components/ui/badge.tsx` |
| `components/ui/skeleton.tsx` | surety `components/ui/skeleton.tsx` |
| `components/ui/empty-state.tsx` | surety `components/ui/empty-state.tsx` |

**Stage A4 — G2 (page-migration-required, 11 files)**

| meowth path | surety origin |
|-------------|---------------|
| `components/ui/table.tsx` | surety `components/ui/table.tsx` |
| `components/ui/dropdown-menu.tsx` | surety `components/ui/dropdown-menu.tsx` |
| `components/ui/select.tsx` | surety `components/ui/select.tsx` |
| `components/ui/label.tsx` | surety `components/ui/label.tsx` |
| `components/ui/notice.tsx` | surety `components/ui/notice.tsx` |
| `components/ui/section-divider.tsx` | surety `components/ui/section-divider.tsx` |
| `components/ui/switch.tsx` | surety `components/ui/switch.tsx` |
| `components/ui/textarea.tsx` | surety `components/ui/textarea.tsx` |
| `components/ui/toggle.tsx` | surety `components/ui/toggle.tsx` |
| `components/ui/toggle-group.tsx` | surety `components/ui/toggle-group.tsx` |
| `components/ui/sort-header.tsx` | surety `components/ui/sort-header.tsx` |

surety provenance is locked at commit `cbf7045facc32f03bfb562d6491f6ee3003e538c` (MIT). Future refreshes follow the same `_UPSTREAM.md` flow as basalt — see §4.2. Per-primitive consumption status (which pages/layouts actually `import` each one as of D1) is documented in §4.1.5.

#### 4.1.4 meowth-local additions (not from upstream)

- `components/StatCard.tsx` — Overview metric tile with `{ title, body, icon? }` props; introduced in Stage C1 to standardise the four "Daemon / Tokens / Sessions / Agents" tiles
- `components/Spinner.tsx` — basalt has no Spinner; uses `lucide-react` `Loader2` + Tailwind `animate-spin`
- `components/SecretReveal.tsx` — Tokens / Setup one-time secret reveal (see [`07`](07-dashboard-security-csp-and-xss.md))
- `components/MessageText.tsx` — sanitiser-aware text renderer used by SessionDetailContent (see `07`)

#### 4.1.5 Primitive consumption status (as of D1)

The §4.1.3 inventory is the full file set on disk; not every primitive is consumed by pages or layout yet. Current ground-truth consumers (excluding ui smoke tests, which exist for every primitive to guarantee build / type / minimal-render):

| primitive | tier | consumer files (non-test) |
|-----------|------|---------------------------|
| `sheet` | G1 | `components/layout/app-shell.tsx` |
| `avatar` | G1 | `components/layout/sidebar.tsx` |
| `tooltip` | G1 | `components/layout/sidebar.tsx` |
| `skeleton` | G1 | every `pages/<Xxx>/<Xxx>Skeleton.tsx` (Overview / Agents / SessionsList / SessionDetail / Tokens / Settings) |
| `empty-state` | G1 | Agents (Page+Content), SessionsList (Page+Content), SessionDetail (Page), Tokens (Page+Content), Overview (Content) |
| `notice` | G2 | Settings (Content), Setup (Page) |
| `button` / `input` / `dialog` | baseline | Tokens dialog, Setup form, layout chrome |
| `collapsible` / `separator` / `badge` (G1); `table` / `dropdown-menu` / `select` / `label` / `section-divider` / `switch` / `textarea` / `toggle` / `toggle-group` / `sort-header` (G2) | G1/G2 | **not yet imported by any non-test consumer** — copied + smoke-tested only; reserved for future pages |

`switch` and `sort-header` are kept on disk for the next surface that needs them, but per §6.4 #3 must not be wired without backing viewmodel state. G3 `alert-dialog` is **not** present on disk; it would be introduced in its own commit only when a real destructive-confirm path appears.

#### 4.1.6 Card primitive deletion (Stage B4)

`components/ui/card.tsx` (basalt source-copy) was deleted in Stage B4. The Gen 2 design uses Tailwind utility surfaces (`bg-card` / `bg-secondary` / `rounded-card`) directly inside each Content component; nothing in the dashboard imports `<Card>` any more. The local `StatPanel` (Stage B3) covered the small remaining "padded surface" use case before `StatCard` (§4.1.4) subsumed it.

### 4.2 来源锁定记录

`apps/dashboard/src/_UPSTREAM.md` 同时记录 basalt 与 surety 两个来源（位置放 `src/` 根，覆盖整个 source-copy 范围：`index.css` + `lib/*` + `components/*`）：

```markdown
# UI primitive provenance

Files in this dashboard are source-copied (or source-derived) from two
upstream design systems. Track upstream so the copy can be refreshed.

## basalt — visual tokens + Gen 1 primitives

| Field            | Value |
|------------------|-------|
| source_repo      | local: ~/workspace/personal/basalt |
| source_commit    | <40-char git SHA at copy time> |
| copied_at        | YYYY-MM-DD |
| copy_method      | manual cp (per-file; not directory vendor) |
| license          | <basalt LICENSE summary; see ~/workspace/personal/basalt/LICENSE> |

## surety — Gen 2 layout + extended primitives

| Field            | Value |
|------------------|-------|
| source_repo      | local: ~/workspace/personal/surety |
| source_commit    | cbf7045facc32f03bfb562d6491f6ee3003e538c |
| copied_at        | 2026-06-25 |
| copy_method      | manual cp + biome format + v8 ignore annotations |
| license          | MIT |
| provenance_class | source-derived (formatted / coverage-annotated) |

## File map

See docs/architecture/06-dashboard-mvvm-and-basalt.md §4.1.

## Meowth-local additions (not from upstream)

- components/StatCard.tsx       (Overview metric tile)
- components/Spinner.tsx        (basalt has no Spinner)
- components/SecretReveal.tsx   (see 07)
- components/MessageText.tsx    (sanitiser-aware text renderer; see 07)
```

basalt 与 surety 都是项目作者本人维护的本机仓库；与 multica 的"上游"语义不同（multica 是远端），两者的 `source_commit` 用本机 git SHA 即可。"refresh" 流程：去对应仓库 git log 看变动 → 决定哪些文件需要再 copy → 更新 `_UPSTREAM.md` 的 `source_commit` 与 `copied_at`。**禁止**：

- 从 basalt / surety npm package import（两者都不发包）
- 直接 `cp -R` 整个 upstream `src/` 进来（dashboard 只用其中一部分，避免冗余代码）
- 让 dashboard 风格偏离 basalt 的视觉规范 / typography / tabular-nums（§5）

### 4.3 复制后允许的本地修改

- 命名适配（如把 upstream 的某 menu item 改成 meowth 的页面名）
- 路由适配（适配 meowth `/overview` / `/agents` / 等路径）
- 删除 meowth 不用的 prop / 组件 variant
- biome format / `v8 ignore` 注释（标 source-derived，非 verbatim）
- 受 jsdom 测试约束的最小行调整（如 `useSyncExternalStore` `getServerSnapshot` 注释覆盖）

**不允许**：

- 引入嵌套 card-in-card / 嵌套 modal-in-modal 等违反 basalt / surety 视觉密度的结构
- 另起一套 design token 与 basalt 并列（只允许在 `index.css` 末尾追加 meowth-specific token，不覆盖 basalt token）
- 使用与 basalt / surety 风格冲突的第三方 UI 库（Radix / shadcn 之类——除非 upstream 自己已经这样做了，我们对齐）

---

## 5. basalt 视觉规范继承

basalt 的视觉规范以 `index.css` 顶部 `@theme inline { ... }` 块定义的 token 为权威（shadcn/ui CSS-variable 风格映射到 Tailwind v4 namespace）。dashboard 必须沿用同一套 token，不引入并行的 design system。

### 5.1 surface tier — 4 layer brightness (L0 / L1 / L2 / L3)

Phase 2 redesign mapped basalt B05 surface tokens to a fixed four-layer brightness ladder so every screen has a consistent depth grammar. Tokens come from basalt unchanged; only their **assigned role** is documented here.

| layer | role | basalt token / utility | typical use |
|-------|------|------------------------|-------------|
| **L0** | page underlayer | `--color-background` → `bg-background` | `<html>` / outer `<main>` / page root chrome |
| **L1** | floating-island panel | `--color-card` → `bg-card` + `border` + `rounded-card` | Sidebar floating panel, top-level page section, Tokens reveal-dialog inner card |
| **L2** | embedded surface inside L1 | `--color-secondary` → `bg-secondary` + `rounded-card` | StatCard tile, EmptyState container, Notice fill |
| **L3** | nested inset / chip / row separator | `bg-secondary` + `border-border border-t/b` | table row dividers, code block, in-card subdued strips |

Constraints:

- **One layer step per nesting level**. L0 → L1 → L2 → L3; do not skip from L0 directly to L3 (that re-introduces the Gen 1 "card-in-card" look the redesign removed).
- **Do not invent `bg-L0` / `bg-L1` aliases**. Use the basalt utility tokens directly so any future basalt re-theme propagates.
- Per-page Skeleton placeholders inherit the same layer ladder; if a section is L2 in `Content`, its `Skeleton` slot is also L2.
- The Sidebar floating-island is the canonical L1 example; the previous Gen 1 full-bleed sidebar (`bg-background`) was deliberately removed in Stage B1.

### 5.2 typography

basalt 当前没有 `text-h1` / `text-h2` 等 6 typography utility token。dashboard **沿用 Tailwind v4 内置 utility**（`text-2xl font-semibold` / `text-base` / `text-sm text-muted-foreground` 等）+ basalt 的 `--color-foreground` / `--color-muted-foreground` token；不并行另起一套 typography token。

如果未来 basalt 引入 `--font-display` / `--font-mono` 等 token，dashboard 同步引入。

### 5.3 `tabular-nums`

数值列必须 `font-variant-numeric: tabular-nums`（Tailwind 内置 utility class `tabular-nums`）。具体落点：

- `Tokens` 页表格：`created_at` / `last_used_at` 列
- `Sessions` 页表格：`started_at` / `ended_at` / `duration_ms` 列
- 任何 token usage 数字（input/output/cache tokens）
- Setup 页的 token / setup-code 显示框（等宽对齐）

### 5.4 配色

basalt 已包含 light/dark 两套（`@custom-variant dark (&:where(.dark, .dark *))`）。dashboard 通过 meowth-local `ThemeToggle.tsx`（§4.1.2 adapted，不 verbatim）复用 basalt 的 dark class / token 约定（`.dark` 触发 `@custom-variant dark` 切换），不修改 token 值。

---

## 6. MVVM 三段式分层

### 6.1 层职责

| 层 | 文件位置 | 允许的依赖 | 禁止的依赖 |
|----|---------|----------|----------|
| **`models/`** | `apps/dashboard/src/models/` | TypeScript stdlib、`fetch` 通过 `src/lib/api.ts`、纯 JS 数据结构 | React（`react` / `react-dom` / `react-router`）、React Hooks、JSX、DOM API（除 `lib/api.ts` 已封装的 fetch） |
| **`viewmodels/`** | `apps/dashboard/src/viewmodels/` | React Hooks (`useState` / `useEffect` / `useMemo`)、`models/` 函数、`lib/api.ts` 间接通过 model | DOM API、`window` / `document` 直接访问、JSX |
| **`pages/`** | `apps/dashboard/src/pages/` | React + JSX、`viewmodels/` hooks、`components/` UI | **直接** `import` `models/`、**直接** 调 `fetch` / `lib/api.ts`、`localStorage` 直接访问 |

### 6.2 可执行的边界约束

MVVM 边界由 `apps/dashboard/.dependency-cruiser.cjs` 强制执行，已在 G1 中通过 `pnpm dashboard:depcruise` 跑成检查（每个 commit 都跑）：

```js
{
  forbidden: [
    { name: 'pages-must-not-import-models',
      from: { path: '^src/pages/' },
      to:   { path: '^src/models/' } },
    { name: 'models-must-not-import-react',
      from: { path: '^src/models/' },
      to:   { path: '^(react|react-dom|react-router)' } },
    { name: 'pages-must-not-import-api',
      from: { path: '^src/pages/' },
      to:   { path: '^src/lib/api' } },
  ]
}
```

实际状态：`pnpm dashboard:depcruise` 当前 `no dependency violations found`（精确 module 数随 source-copy / page split 变化，参考 `pnpm dashboard:g1` 输出，本文档不硬编码）。新规则（如 §6.4 per-page split 的 `Content-must-not-import-viewmodel`）按需添加；任何违反 G1 红。Biome `noRestrictedImports` 与 vitest import-boundary test 当前**未启用**，dependency-cruiser 已经是 single source of truth。

### 6.3 viewmodel 命名约定

- 文件名：`useXxxViewModel.ts`（kebab-case 不用，TS 文件直接 PascalCase 函数名 + `use` 前缀，文件用 camelCase）
- 单一 default export：`export default function useXxxViewModel(...)`
- 返回 object，字段类型可由 model `types.ts` 派生

例：`useTokensViewModel.ts`

```ts
import { useEffect, useState } from 'react';
import { listTokens, createToken, revokeToken } from '../models/tokens';
import type { TokenView, TokenCreateResponse } from '../models/types';

export default function useTokensViewModel() {
  const [tokens, setTokens] = useState<TokenView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  // ... effects + create / revoke handlers ...

  return { tokens, loading, error, createdSecret, createToken: /*...*/, revokeToken: /*...*/ };
}
```

`pages/Tokens/TokensPage.tsx` 仅 `const vm = useTokensViewModel(); return <View {...vm} />;` 形态。

### 6.4 per-page split — Page / Content / Skeleton (+ optional Dialog)

Phase 2 Stage C refined the page layer so every page (except the pre-login `/setup` shell) is itself split into a stable set of files. This keeps each unit testable in isolation and prevents shell logic from leaking into business render.

| sub-file | responsibility | typical imports |
|----------|----------------|-----------------|
| `XxxPage.tsx` | **shell** — owns `useXxxViewModel()` + the `loading / error / ready` branch; renders the heading and any always-on toolbar (e.g. Tokens `Create token` button); does not import models or API | `@/viewmodels/*`, `@/components/ui/empty-state`, the per-page Content + Skeleton siblings |
| `XxxContent.tsx` | **pure-props** — receives the resolved domain data and renders the business UI (table / list / detail / etc.) plus the true-empty branch | `@/models/types` for prop types (or vm-re-exported types when the page's domain shape lives on the vm), `@/components/ui/*` |
| `XxxSkeleton.tsx` | **pre-data placeholder** — mirrors the Content footprint with `animate-pulse` cells using **stable string-key arrays** (never `index` as `key`) | `@/components/ui/skeleton` only |
| `XxxDialog.tsx` (optional) | **extracted modal** — only when the page hosts a non-trivial dialog (currently `TokensCreateDialog`); kept separate so the shell stays small and the dialog's lifecycle (mount/unmount, plaintext clearing) can be tested independently | `@/viewmodels/*` for the vm contract, `@/components/SecretReveal`, etc. |

Constraints:

1. **Loading never reaches Content.** Content prop types should be `Extract<XxxStatus, { kind: 'ready' | 'error' }>` (or equivalent) — the union narrowed to non-loading. This is a TypeScript-level guarantee that Skeleton owns the loading placeholder.
2. **Skeleton owns the placeholder footprint, not invented data.** A Skeleton must not present compile-time constants as fake placeholders. Example: `SettingsSkeleton` renders only the Daemon row + Notice slot; the always-known Dashboard build version stays in the Page shell so users see the real value even while healthz is still loading.
3. **No SortHeader / Switch / G3 alert-dialog without a real backing.** A Content must not render an interactive primitive whose state is not actually wired. If you need true sorting / toggling / destructive confirm, lift the state into the viewmodel first, then introduce the primitive in its own commit.
4. **The Setup page is intentionally not split** — it is a single-form pre-login shell with no list/detail/empty-loading shape that would benefit from three files. Stage C6 covers it via styling-only Notice replacements.
5. **Empty state uses `<EmptyState>` only when the resolved data is legitimately empty** — not as a generic error or loading slot. Error branches use `<Notice variant="destructive" role="alert">` or `<EmptyState tone="error" icon={AlertCircle}>` (the choice per page is documented in §7).

### 6.5 per-page split test contract

Each split page ships with three (or four, when Dialog is present) test files:

- `XxxPage.test.tsx` — uses `vi.hoisted` + `vi.mock('@/viewmodels/useXxxViewModel', ...)` to drive each `vm.status.kind` branch. Asserts: heading always rendered, loading→Skeleton (pulse-count check), error→appropriate alert/EmptyState with the vm message, ready→Content cells visible.
- `XxxContent.test.tsx` — pure props tests using `render(<Content {...fixtureProps} />)`. No vm, no fetch. Covers header rendering, per-row / per-cell render, and the true-empty branch.
- `XxxSkeleton.test.tsx` — minimal: asserts the expected pulse-count so the placeholder footprint cannot silently shrink.
- `XxxDialog.test.tsx` (when present) — covers dialog `role` / `name`, per-phase rendering (idle / submitting / error / reveal), and any lifecycle invariants (e.g. plaintext absent from DOM, listeners cleaned up on close).

The viewmodel itself keeps a separate fetch-driven test (`useXxxViewModel.test.tsx`) so the page→VM→model→api seam stays honest while the per-page split tests stay fast and decoupled.

---

## 7. 5 个核心页面 + `/setup` 的 page→viewmodel→model 映射

### 7.1 Overview

| 元素 | 文件 |
|------|------|
| Page (shell) | `pages/Overview/OverviewPage.tsx` |
| Content (pure-props) | `pages/Overview/OverviewContent.tsx` (uses `StatCard` for the 4 metric tiles — Daemon healthz / Tokens / Sessions / Agents) |
| Skeleton | `pages/Overview/OverviewSkeleton.tsx` |
| ViewModel | `viewmodels/useOverviewViewModel.ts` |
| Models 调用 | `health.pingHealthz()`、`tokens.listTokens()`、`sessions.listSessions({ status:'running', limit:10 })`、`agents.fetchAgents()` |
| 显示 | 4 个 StatCard tile（L2 surface）+ 近期 session 列表 + agent 安装状态 |

### 7.2 Agents

| 元素 | 文件 |
|------|------|
| Page (shell) | `pages/Agents/AgentsPage.tsx` |
| Content (pure-props) | `pages/Agents/AgentsContent.tsx` (table when populated, `<EmptyState icon={Bot}>` when daemon returns zero agents) |
| Skeleton | `pages/Agents/AgentsSkeleton.tsx` (5 rows × 4 cols animate-pulse) |
| ViewModel | `viewmodels/useAgentsViewModel.ts` |
| Models 调用 | `agents.fetchAgents()` |
| 显示 | 5 行 backend 表，含 `installed` / `executable` / `version`（[`02`](02-daemon-http-protocol.md) §6.1）;**no fake stats** — only fields the daemon actually returns |

### 7.3 Sessions

| 元素 | 文件 |
|------|------|
| Page (shell) — list | `pages/Sessions/SessionsListPage.tsx` |
| Content — list | `pages/Sessions/SessionsListContent.tsx` (plain G2 table; `Backend` cell wraps a `<Link to="/sessions/<id>">`) |
| Skeleton — list | `pages/Sessions/SessionsListSkeleton.tsx` (5 rows × 5 cols animate-pulse) |
| Page (shell) — detail | `pages/Sessions/SessionDetailPage.tsx` (error branch keeps `data-testid="session-detail-id"` + `EmptyState tone="error"`) |
| Content — detail | `pages/Sessions/SessionDetailContent.tsx` (header + `data-testid="session-messages"` envelope list; renders `payload.content ?? payload.output ?? ''` via MessageText; heartbeat/usage hidden; StatusRow for `session_started` / `error` / `session_ended`) |
| Skeleton — detail | `pages/Sessions/SessionDetailSkeleton.tsx` |
| ViewModel | `viewmodels/useSessionsViewModel.ts`、`useSessionDetailViewModel.ts` |
| Models 调用 | `sessions.listSessions(...)`、`sessions.getSession(id)`、`sessions.getSessionMessages(id, { after_seq })` |
| 显示 | 列表：[`02`](02-daemon-http-protocol.md) §6.2 字段；详情：消息流 + token usage |

**消息流契约（承接 [`02`](02-daemon-http-protocol.md) §5–§6.4）**：

- `sessions.getSessionMessages(id, opts)` 是 snapshot-paged（daemon does not yet support `follow=true`）；viewmodel loops while `has_more` and guards a stuck `next_after_seq` (aborts when it does not advance)
- envelope 解码器在 `models/envelope.ts`，逐行 `JSON.parse`，按 `event.type` 分发
- **`heartbeat` 默认显示过滤掉**（UI 不显示，但 viewmodel 仍累计 `seq` 用于 reconnect `after_seq`）
- `usage` 是**累计快照**（[`02`](02-daemon-http-protocol.md) §5.4），viewmodel 按 `model` 名 `replace/upsert`，**不**累加
- 客户端断线重连：用最后看到的 `seq` 作为 `after_seq` 参数（[`02`](02-daemon-http-protocol.md) §6.4）；这是 viewmodel 状态机管的，不发明新协议
- `session_ended` event close stream；UI 显示终态徽章

### 7.4 Tokens

| 元素 | 文件 |
|------|------|
| Page (shell) | `pages/Tokens/TokensPage.tsx` (Heading + always-on `Create token` button + the dialog is always mounted, gates on `vm.modal.open` internally) |
| Content (pure-props) | `pages/Tokens/TokensContent.tsx` (5-col table: Name / Prefix / Created / Last used / Revoke; `EmptyState icon={KeyRound}` when daemon returns zero tokens) |
| Skeleton | `pages/Tokens/TokensSkeleton.tsx` (5 rows × 5 cols animate-pulse) |
| Dialog | `pages/Tokens/TokensCreateDialog.tsx` (manual `role="dialog" + aria-modal + aria-label="Create token"`; not a G3 alert-dialog because the create flow is non-destructive) |
| ViewModel | `viewmodels/useTokensViewModel.ts` |
| Models 调用 | `tokens.listTokens()`、`tokens.createToken({name})`、`tokens.revokeToken(id)` |
| 显示 | 列表 + 创建按钮 + 撤销按钮 |

**Create token modal 行为**：

- 点击「Create」→ Dialog 打开 (`vm.modal.open = true, phase = 'idle'`) → 输入 `name` → submit → POST `/v1/tokens`（[`02`](02-daemon-http-protocol.md) §9.1）
- 成功响应包含 `secret`（**唯一一次**）→ vm 把 plaintext 放进 `modal.createdSecret`，phase 切到 `'reveal'` → Dialog 显示 `SecretReveal` (masked by default) + 复制按钮
- **plaintext lifecycle**：`closeCreateModal()` 把 vm modal reduce 为 `{ open: false }` → Dialog 卸载 → `SecretReveal` 卸载 (其 useEffect cleanup 清 reveal/feedback timers) → plaintext 离开 DOM。再次 `openCreateModal()` 从 `{ open: true, phase: 'idle', name: '' }` 起步，旧 secret 不复现
- **TokenView 是 secret-free 类型**（[`03`](03-sqlite-schema-and-tokens.md) §3）；vm 把 `TokenCreateResponse` 通过 `toTokenView()` 投影后再追加到 `status.ready.tokens`，list state **永远不持有** secret
- 用户关闭 modal 后 dashboard **不**保留 secret（不写 localStorage、不存任何 store）
- secret 显示遮罩 / 复制行为的安全细节 → [`07-dashboard-security-csp-and-xss.md`](07-dashboard-security-csp-and-xss.md)

### 7.5 Settings（read-only v1）

| 元素 | 文件 |
|------|------|
| Page (shell) | `pages/Settings/SettingsPage.tsx` (Heading + always-on Dashboard build row — version is compile-time, orthogonal to healthz) |
| Content (pure-props) | `pages/Settings/SettingsContent.tsx` (Notice variant maps healthz state) |
| Skeleton | `pages/Settings/SettingsSkeleton.tsx` (Daemon-row placeholder + Notice slot only; Dashboard build row stays in the Page so the known value is never a fake placeholder) |
| ViewModel | `viewmodels/useSettingsViewModel.ts` |
| Models 调用 | `health.pingHealthz()` |
| 显示 | Dashboard build version + Daemon healthz Notice + read-only config note |

**healthz state → Notice mapping**：

| `vm.status` | Notice variant | role | text |
|-------------|---------------|------|------|
| `{ kind: 'loading' }` | n/a — shown by `SettingsSkeleton` | n/a | (animate-pulse placeholder) |
| `{ kind: 'ready', daemonReachable: true }` | `success` | `status` (polite, Notice default) | `Daemon reachable.` |
| `{ kind: 'ready', daemonReachable: false }` | `warning` | `status` (polite — healthz down is not a system-level alert) | `Daemon unreachable.` |
| `{ kind: 'error', message }` | `destructive` | `alert` (override Notice default) | `vm.status.message` |

**v1 read-only 硬约束 + 显示边界**：

- dashboard **不**修改 `[remote_access]`、**不**写 `~/.meowth/config.toml`（与 [`05`](05-remote-access-modes.md) §13 #3 一致）
- v1 **没有** `GET /v1/settings` endpoint（[`02`](02-daemon-http-protocol.md) v1 端点清单未含）；Settings 页因此**不**显示 daemon-side 的 `bind_addr` / `bind_port` / `remote_access.mode` / log level——这些配置只在 daemon 进程内、`~/.meowth/config.toml` 文件、daemon 启动日志中可见，**不**通过 wire 暴露给所有持有 token 的客户端
- 用户想看 daemon bind/mode → 直接 `cat ~/.meowth/config.toml` 或读 daemon 启动日志

后续若 dashboard 需要显示 daemon-side 配置（bind / mode / log level），**必须**先在 [`02`](02-daemon-http-protocol.md) 设计 endpoint 并锁定授权边界（例如 admin-scope token），再在本文档 §7.5 同步扩展显示字段（[`§13`](#13-未决问题) #4 留此项给 @zheng-li 决策）。

### 7.6 Setup（`/setup`，§9 决策树）

| 元素 | 文件 |
|------|------|
| Page | `pages/Setup/SetupPage.tsx` (single-file pre-login shell — **not split into Content/Skeleton**, see §6.4 #4) |
| ViewModel | `viewmodels/useSetupViewModel.ts` |
| Models 调用 | `health.pingHealthz()`、`bootstrap.mintWithSetupCode(code)` |
| 显示 | 默认 token 手输入框 (mode A)；可选「I have a setup-code instead」切换到 mint 表单 (mode B)；error 用 `<Notice variant="destructive" role="alert">`；mode B 的 dev-mint disabled reason 用 `<Notice variant="info">`（polite default `role="status"`） |

§9 详细决策树。Stage C6 仅把内联 `ErrorBanner` / disabled-mint footnote 替换为语义化 `Notice`，token / setup-code regex、placeholders、按钮文案、`noValidate` / `type="password"` / dev-mint origin guard、`resp.secret` 处理全部保留原状。

---

## 8. HTTP 客户端 `src/lib/api.ts`

### 8.1 形态

```ts
// src/lib/api.ts
import { getStoredToken, clearStoredToken } from './localStorage';

export type ApiError = {
  status: number;
  problem: { type: string; title: string; status: number; detail?: string; instance?: string };
};

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  // Content-Type defaults to JSON for non-GET requests with body
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }
  const resp = await fetch(path, { ...init, headers });
  if (!resp.ok) {
    let problem: ApiError['problem'];
    try { problem = await resp.json(); } catch {
      problem = { type: '/problems/unknown', title: resp.statusText, status: resp.status };
    }
    if (resp.status === 401) clearStoredToken(); // token 失效则清掉
    throw { status: resp.status, problem } satisfies ApiError;
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

export async function apiStream(path: string, init: RequestInit = {}): Promise<ReadableStream<Uint8Array>> {
  const token = getStoredToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const resp = await fetch(path, { ...init, headers });
  if (!resp.ok) {
    let problem: ApiError['problem'];
    try { problem = await resp.json(); } catch {
      problem = { type: '/problems/unknown', title: resp.statusText, status: resp.status };
    }
    if (resp.status === 401) clearStoredToken();
    throw { status: resp.status, problem } satisfies ApiError;
  }
  if (!resp.body) throw { status: 500, problem: { type: '/problems/no_body', title: 'No stream body', status: 500 } };
  return resp.body;
}
```

### 8.2 约束

- **`api.ts` 是唯一获取 token 的地方**——所有 model 调用 `apiFetch` / `apiStream`，**不**自己读 `localStorage.getItem('token')`
- **401 自动清 token**：避免持有失效 bearer 反复尝试
- **不在 error message / 任何 throw 里包含 bearer**：error 体只含 problem+json，bearer 永远不进 `console.error` / `error.stack`
- **secret 创建响应的处理**：`apiFetch<TokenCreateResponse>('/v1/tokens', { method: 'POST', body: ... })` 返回值含 `secret`；调用方（model `tokens.createToken`）拿到后立即返回给 viewmodel；viewmodel 只在 modal state 里保留，关闭即清；详细 zeroization 边界 → [`07`](07-dashboard-security-csp-and-xss.md)
- token / secret 永远走 `Authorization` header，**不**走 query string（[`02`](02-daemon-http-protocol.md) §2.2 + [`05`](05-remote-access-modes.md) §9 已明令禁止）

### 8.3 `localStorage` wrapper

```ts
// src/lib/localStorage.ts
const KEY = 'meowth_token';
export function getStoredToken(): string | null { return localStorage.getItem(KEY); }
export function setStoredToken(t: string): void { localStorage.setItem(KEY, t); }
export function clearStoredToken(): void { localStorage.removeItem(KEY); }
```

- 唯一 key 命名空间 `meowth_token`；不混淆 `setup_code`（setup-code 永远不入 localStorage——用户 mint 后丢弃明文）
- XSS 防御使 localStorage 安全 → [`07`](07-dashboard-security-csp-and-xss.md)

---

## 9. `/setup` 入口判定（决策树）

**反模式（不要这么做）**：dashboard 用未授权 `GET /v1/tokens` 区分 first-run 状态。`GET /v1/tokens` 是 v1 受保护端点；没有 bearer 时一律 401，无法用 401/200 区分"表为空 vs 表非空"，那是在 dashboard 侧发明 unauthenticated introspection。

**采用规则**：dashboard 启动期路由守卫：

```
1. 从 localStorage 读 bearer token
   ├── 缺 → 跳 /setup（模式：默认手输入框）
   └── 有 → 继续 step 2
2. 调 GET /v1/agents（任一受保护端点；选 agents 因为它便宜、稳定）
   ├── 200 → 已认证；跳到用户原 deeplink 或 /overview
   ├── 401 → 清掉 localStorage token；跳 /setup（模式：默认手输入框）
   └── 网络错 → 显示 "daemon unreachable" 错误页；不进 /setup
```

### 9.1 `/setup` 页面行为（两个模式 UI 共存于一个 page）

`/setup` **默认显示手输入框**（路径 A 用户最常用：从 `meowthd init` stdout 粘 token）：

```
┌─ Meowth · Setup ─────────────────────────────────────────┐
│                                                          │
│  Paste your root token to continue:                      │
│  ┌────────────────────────────────────────────────────┐  │
│  │ mwt_____________________________________________   │  │
│  └────────────────────────────────────────────────────┘  │
│                              [ Continue ]                │
│                                                          │
│  Don't have a token yet?                                 │
│  ▸ I have a setup-code instead                           │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

点 ▸ 切换到 mint 表单（路径 B）：

```
┌─ Meowth · Setup ─────────────────────────────────────────┐
│                                                          │
│  Paste the setup-code from `meowthd init --skip-token`:  │
│  ┌────────────────────────────────────────────────────┐  │
│  │ mws_____________________________________________   │  │
│  └────────────────────────────────────────────────────┘  │
│                                  [ Mint token ]          │
│                                                          │
│  ◂ Back to "I already have a token"                      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 9.2 两模式的请求语义

| 模式 | 用户输入 | dashboard 行为 |
|------|---------|---------------|
| **手输入框（默认）** | bearer token `mwt_...` | `setStoredToken(input)` → 调 `GET /v1/agents` 探活 → 200 跳 `/overview`；401 显示「token invalid」并清 token（保持 /setup） |
| **mint 表单** | setup-code `mws_...` | `POST /bootstrap/mint { setup_code }` → 200 拿 `secret` → `setStoredToken(secret)` → 跳 `/overview`；404（[`04`](04-bootstrap-and-first-run-mint.md) §6.5 统一 404）显示**统一文案**「Setup not available. If you have a token already, paste it above; otherwise see daemon logs.」并切回手输入框 |

**关键约束**：

- mint 表单的 404 响应**不区分**原因（[`04`](04-bootstrap-and-first-run-mint.md) §6.5）；dashboard 也**不**尝试根据 404 推断 daemon 状态（如 "remote mode" / "lockout" / "hash missing"）。统一文案，把进一步诊断留给 daemon 日志
- dashboard **不**做任何 unauthenticated daemon state introspection（无 ping 状态 endpoint、无 `GET /bootstrap/status`、无 first-run probe）；§9 决策树**只**用受保护 `/v1/agents` 的 200/401 + mint 端点的 200/404 这两条线索
- **dev 模式下 mint 表单不承诺工作**（§3.4 已说明）：[`04`](04-bootstrap-and-first-run-mint.md) §6.6 浏览器来源门要求 `Origin` 等于 daemon `Host`，dev 下 Vite dev server `meowth-vite.dev.hexly.ai` 与 daemon `127.0.0.1:7040` 不同源；`useSetupViewModel` 检测到 `window.location.origin` 非 HTTP loopback 时（含 Caddy HTTPS 入口 `https://meowth.dev.hexly.ai`），mint 表单 submit 按钮 **disabled** 且显示提示「Mint must be reached at http://127.0.0.1:7040/setup」；按钮 disabled = 不发出 cross-site POST。HTTP loopback origin（含 e2e 的 17041 fixture）放行

### 9.3 setup 路由守卫不能循环

- `/setup` 自身被 401 触发也只能停在 `/setup`，**不**因为"没 token → 401 → /setup → 没 token → /setup"无限循环
- 路由守卫显式 short-circuit：`if (location.pathname === '/setup') return;`
- 任何 401 清掉 token 后**只**做一次 redirect 到 `/setup`，不在 `/setup` 上反复 redirect

---

## 10. 路由守卫与 bearer hydrate

### 10.1 hydrate 顺序

```
App boot:
  1. 从 localStorage 读 bearer
  2. 包裹整个路由树的 <AuthGate>
     - 当前路由是 /setup → 不做 auth check，直接渲染 SetupPage
     - 否则：
       - 没 token → redirect /setup
       - 有 token → 调 GET /v1/agents 探活
         - 200 → render children
         - 401 → clearStoredToken; redirect /setup
         - network error → render <DaemonUnreachable/>
```

### 10.2 错误边界

- React `ErrorBoundary` 在每个 page 包裹；error 信息**不**含 bearer / secret（[`07`](07-dashboard-security-csp-and-xss.md) 落地约束）
- network log（`console.error`）只 print `error.status` + `error.problem.type`，不 print `error.stack` 里可能含的 Authorization header

### 10.3 session detail 的认证保持

- `useSessionDetailViewModel` 内 `apiStream('/v1/sessions/{id}/messages?follow=true&after_seq=N')` 在断流时按指数退避重连
- 重连前先 `getStoredToken()` 确认 bearer 还在；不在则停止重连，redirect `/setup`

---

## 11. 测试落点（与 6DQ 的映射）

> 详 → 08；本节只列 06 范围内的覆盖目标。

| 层 | 覆盖什么 |
|----|---------|
| **L1** | viewmodels：useXxxViewModel hook 单测（mock model 函数返回值，断言 hook 返回 state）；models：fetch wrapper 测（mock `fetch`，断言 Authorization header / problem+json 解码）；envelope decoder：NDJSON 多行解析 / heartbeat 占 seq / usage replace 语义；§6.2 import-boundary 静态约束（dependency-cruiser run 或 import-boundary test）；§9 setup 决策树纯逻辑（mock fetch 200/401/404） |
| **L3** | Playwright：(a) 手输 token 路径（dev or production embed）：mock daemon 返回 token → dashboard 跳 /overview → 列 5 agent → 创 token → 调 fake agent exec → 看消息；(b) **mint 路径必须走 production embed 形态**（[`§3.4`](#34-dev-proxy-不覆盖-bootstrap)）：跑 `daemon` + 通过 daemon 同源 origin `http://127.0.0.1:7040/setup` → mint 表单 → POST mint → 拿 secret → 跳 /overview；dev 模式 mint 表单显示禁用提示，不算回归；(c) 401 重定向：手工清 localStorage token → 任意页面访问 → redirect /setup |

---

## 12. 实施历史（Phase 3.13–3.20 → Phase 2 dashboard redesign Stage A/B/C/D）

**Phase 3.13–3.20（已落地，2026-Q2）** — 初版 dashboard 上线（5 page + Setup + bearer + Playwright）：

| Commit subject 形态 | Phase | 内容（已落地） |
|--------|-------|------|
| `feat(dashboard): vite + basalt token system` | 3.13 | §2 目录骨架 + §3 Vite + Tailwind v4 + §4.1 basalt source-copy（`index.css` / `lib/utils.ts` / `lib/palette.ts`） + §4.2 `_UPSTREAM.md` |
| `feat(dashboard): app shell + theme init` | 3.14 | Gen 1 `App.tsx` + `routes/index.tsx` + meowth-local Gen 1 shell（`AppSidebar` + `DashboardLayout` + `ThemeToggle`）；L1 vitest 起 |
| `feat(dashboard): noDanger + source safety gate` | 3.15 | 同 [`07`](07-dashboard-security-csp-and-xss.md) |
| `feat(dashboard): sanitizer + ANSI parser + logger redaction` | 3.16 | 同 [`07`](07-dashboard-security-csp-and-xss.md) |
| `feat(dashboard): 5 page skeletons (MVVM 三段式)` | 3.17 | §7.1–§7.5 五个 page + viewmodel 骨架 |
| `feat(dashboard): daemon http client + bearer storage` | 3.18 | §8 `lib/api.ts` + §8.3 `lib/localStorage.ts` |
| `feat(dashboard): /setup page (mode A 手输 + mode B nonce + mint)` | 3.19 | §7.6 + §9 决策树 |
| `feat(dashboard): wire 5 pages to live daemon` | 3.20 | viewmodel 接入真实 model + AuthGate + dev L3 Playwright fixture |

**Phase 2 dashboard redesign（2026-06-25 落地，详 [`docs/features/02-dashboard-redesign-to-basalt-gen2.md`](../features/02-dashboard-redesign-to-basalt-gen2.md)）** — Gen 2 重构对齐 basalt B05 + surety Gen 2 layout：

| Stage | Commit hash | 内容 |
|-------|-------------|------|
| **A1-A4** | (4 commits) | 依赖刷新（vite 8 / react-router 8 / radix-ui 1.6 聚合包） + G1 + G2 ui 原语批量引入（§4.1.5）+ surety provenance |
| **B1-B4** | (4 commits) | Gen 2 layout 三件套（`components/layout/{app-shell,sidebar,sidebar-context}.tsx` 替换 Gen 1 AppSidebar/DashboardLayout）+ `card.tsx` 删除（§4.1.6） |
| **C1** `00946d9` | refactor(dashboard): split Overview into Page/Content/Skeleton + introduce StatCard component | Overview 三段式 + `components/StatCard.tsx` 引入 |
| **C2** `8075c26` | refactor(dashboard): split Agents into Page/Content/Skeleton (no fake stats) | Agents 三段式 + 严格只展示 daemon 真返字段 |
| **C3a** `5c2c225` | refactor(dashboard): split SessionsListPage into Page/Content/Skeleton (plain G2 Table semantics) | Sessions list 三段式（plain Table，无 sort header） |
| **C3b** `1393aa5` | refactor(dashboard): split SessionDetailPage into Page/Content/Skeleton | Sessions detail 三段式 |
| **C4** `9d61440` | refactor(dashboard): split TokensPage into Page/Content/Skeleton + extract CreateDialog | Tokens 三段式 + dialog 提取 + plaintext lifecycle 边界测试 |
| **C5** `c8145e9` | refactor(dashboard): split SettingsPage into Page/Content/Skeleton + Notice for healthz | Settings 三段式 + Notice 接入（§7.5 mapping） |
| **C6** `fdcc8ee` | style(dashboard): replace SetupPage ErrorBanner and disabled-mint footnote with semantic Notice | Setup styling-only 升级（非 split） |
| C7 / C8 | SKIPPED | 无 stale e2e selector 累积 / 无跨页重复 fixture / coverage 整理在 C1–C6 内完成 |
| **D1** | docs(arch): rewrite 06 for Gen 2 layout + L0..L3 + per-page Page/Content/Skeleton | 本文档：§2 / §4 / §5.1 / §6.4 / §6.5 / §7 / §12 同步到 Gen 2 落地形态 |
| **D2** | chore(release): bump to 0.3.0 + CHANGELOG | release bump (root + apps/dashboard + packages/shared all `0.2.0 → 0.3.0`) + `CHANGELOG.md` `[0.3.0]` entry; daemon binary version probe `./daemon/meowthd` prints `meowthd 0.3.0` (injected via `scripts/build-daemon.sh -ldflags`) |

Phase 2 闭环 gate 状态（D1 时点）：dashboard 75 files / 438 tests；Playwright 3 projects × 14/14；`dashboard:cover:check` `ok=55 baseline_floors=3 structural_exempt=10`。3 个剩余 baseline（`lib/ansi.ts` / `useSessionDetailViewModel.ts` / `useTokensViewModel.ts`）均明确在 Stage C 范围外，后续独立 lift。

每个 commit 自带必要测试 + G1/G2 hook 全绿 + 不留 TODO。

---

## 13. 未决问题

| # | 问题 | 决策方 | 状态 |
|---|------|-------|------|
| 1 | basalt source-copy 的 `_UPSTREAM.md` 是否需要在 CI 校验本机 basalt commit 仍存在？v1 倾向不做 | @zheng-li | 暂不实现 |
| 2 | `apiStream` 重连退避算法（指数 / 固定）？v1 倾向"先固定 1s / 2s / 5s 三次后放弃"，简单可测 | SDE 实施 Phase 3.20 时 | 待 |
| 3 | Settings 页面要不要在 v1 至少暴露 `bind_addr` 之类只读信息？需要 02 新增 endpoint；倾向 v2 再做 | @zheng-li | 暂不实现 |

---

## 14. 相关文档

- 上层：[`docs/01-project-overview.md`](../01-project-overview.md) §7.5 / §9.2 Phase 3.13–3.20
- 兄弟文档：
  - [`02-daemon-http-protocol.md`](02-daemon-http-protocol.md)（wire 语义；§7.3 sessions / §7.4 tokens / §7.6 setup 都消费它）
  - [`03-sqlite-schema-and-tokens.md`](03-sqlite-schema-and-tokens.md)（token 创建响应的 wire schema 派生）
  - [`04-bootstrap-and-first-run-mint.md`](04-bootstrap-and-first-run-mint.md)（mint 端点；§7.6 / §9 消费）
  - [`05-remote-access-modes.md`](05-remote-access-modes.md)（Settings 不可改 config；mode UI 缺席的依据）
  - `07-dashboard-security-csp-and-xss.md`（**所有**安全细节：CSP / sanitizer / secret modal 遮罩 / error log 脱敏）
  - `08-6dq-hooks-wiring.md`（L1 vitest / L3 Playwright 工具链与 CI）
- 参考实现：`~/workspace/personal/basalt`（source-copy 来源）
- 工作约束：[`../../CLAUDE.md`](../../CLAUDE.md)
