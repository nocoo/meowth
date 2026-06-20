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
- Vite + Tailwind v4 + React 19 + React Router 7 接入细节
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
    │   ├── index.tsx                React Router 7 route table
    │   └── guards.tsx               auth/setup hydration guards (§10)
    ├── pages/
    │   ├── Overview/
    │   │   ├── OverviewPage.tsx     consumes useOverviewViewModel
    │   │   └── index.ts             re-export
    │   ├── Agents/
    │   ├── Sessions/
    │   │   ├── SessionsListPage.tsx
    │   │   ├── SessionDetailPage.tsx
    │   │   └── index.ts
    │   ├── Tokens/
    │   ├── Settings/
    │   └── Setup/
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
    │   ├── ui/                      source-copied from basalt (shadcn-style, lowercase filenames)
    │   │   ├── button.tsx
    │   │   ├── card.tsx
    │   │   ├── input.tsx
    │   │   ├── dialog.tsx
    │   │   └── ...                  add more on demand; see §4.1 file map
    │   ├── AppSidebar.tsx           meowth-local (adapted from basalt layout pattern; not verbatim)
    │   ├── DashboardLayout.tsx      meowth-local (adapted from basalt layout pattern; not verbatim)
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

`apps/dashboard/package.json` 需要的 dependency **包名**清单（精确版本由 Phase 3.13 SDE 用 `pnpm add` 选定，并以能通过 `pnpm --filter @meowth/dashboard typecheck/build` 为准；本文档**不**锁主版本号，避免与未来 basalt 实测版本冲突）：

**dependencies**：

- `react`、`react-dom`
- `react-router`
- `clsx`
- `tailwind-merge`
- `class-variance-authority`
- `lucide-react`
- Radix packages required by copied ui files; **first batch includes `@radix-ui/react-dialog`**（用于 `components/ui/dialog.tsx`）；后续按需增量（select / dropdown / sheet / tooltip 等触发哪个 copy 哪个）

**devDependencies**：

- `@vitejs/plugin-react`
- `@tailwindcss/vite`
- `tailwindcss`
- `tw-animate-css`
- `vite`
- `typescript`

**约束的"大方向"**（强制）：

- React **19** 系
- React Router **7** 系
- Tailwind **v4**（必须用 `@tailwindcss/vite` 插件路径，不用 PostCSS 路径）

其它包的精确版本号在 Phase 3.13 实施时锁定到 `pnpm-lock.yaml`；与 basalt 当前版本可不完全一致（basalt 是参考工程，meowth 选自己 toolchain 兼容的版本即可）。

**为什么这些 deps**（每条来自 basalt source-copy 的具体需求）：

| Dep | 由谁触发 | 必要性 |
|-----|---------|-------|
| `clsx` + `tailwind-merge` | `lib/utils.ts` 的 `cn()`（basalt 抄过来） | 所有 component 拼 className 都依赖 `cn`，缺则编译红 |
| `class-variance-authority` | `components/ui/button.tsx` 等 shadcn 风格组件用 `cva()` 定义 variant | 缺则 button/badge 等 component 编译红 |
| `lucide-react` | meowth-local shell 组件（AppSidebar 菜单 icon、ThemeToggle sun/moon、Spinner Loader2）+ `components/ui/dialog.tsx`（X close icon） | 缺则 meowth-local components 与 dialog 编译红 |
| `tw-animate-css` | basalt 的 `src/index.css` 顶部 `@import "tw-animate-css"` | 缺则 Tailwind 编译时找不到 import |
| 各 `@radix-ui/react-*` | basalt 的 `components/ui/dialog.tsx` 等 shadcn 风格组件依赖 Radix primitives | **按需增量添加**：copy 哪个 ui 文件就 require 哪个 Radix 包；首批 (button/card/input/dialog) 需要 `@radix-ui/react-dialog`；后续 copy sheet/dropdown/tooltip/select 等再增量 |

**copy → require 映射**（Phase 3.13 落地清单，与 §4.1.1 同步；只覆盖 source-copy verbatim 文件）：

| Copy file | Required deps |
|-----------|---------------|
| `lib/utils.ts` | `clsx`、`tailwind-merge` |
| `index.css` | `tw-animate-css` |
| `components/ui/button.tsx` | `class-variance-authority`、`lucide-react`（视实际 button 内是否含 icon） |
| `components/ui/card.tsx` | （仅 React + cn） |
| `components/ui/input.tsx` | （仅 React + cn） |
| `components/ui/dialog.tsx` | `@radix-ui/react-dialog`、`lucide-react`（X 图标） |

**meowth-local adapted 组件**（§4.1.2 `AppSidebar` / `DashboardLayout` / `ThemeToggle`）按 meowth 实际需要引入 deps，不强制对齐 basalt：

- `AppSidebar.tsx`：`lucide-react`（菜单 icon）；**不**引入 `react-i18next` / `cmdk` / Radix command
- `DashboardLayout.tsx`：`lucide-react`（如需）；**不**引入 `react-i18next` / GitHub icon / `use-mobile` hook
- `ThemeToggle.tsx`：`lucide-react`（sun/moon icon）；直接读写 `localStorage` + `documentElement.classList`，**不**引入 i18n

后续 copy 额外 basalt 组件时，必须在 commit message 中显式列出新引入的依赖包。

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
    port: 5173,
    proxy: {
      '/v1':      { target: 'http://127.0.0.1:7777', changeOrigin: false },
      '/healthz': { target: 'http://127.0.0.1:7777', changeOrigin: false },
      // /bootstrap/* 不 proxy（与 04 §6.6 浏览器来源门冲突；详 §3.4）
    },
  },
});
```

**dev proxy 与 production zero-CORS 的边界**：

- dev 模式下 dashboard 跑 Vite dev server `:5173`，Vite 把 **`/v1/*` 与 `/healthz`** 转发到 daemon `127.0.0.1:7777`。dashboard 与 daemon 在浏览器侧**同源**（都通过 Vite dev server），daemon 不需要返回任何 CORS header
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

[`04`](04-bootstrap-and-first-run-mint.md) §6.6 浏览器来源门要求 `POST /bootstrap/mint` 请求的 `Origin` header 必须**精确等于** `http://` + daemon `r.Host`。Vite dev server 在 `http://localhost:5173` 跑，浏览器发的请求 `Origin: http://localhost:5173`；即使 Vite proxy 把 path 转到 daemon `127.0.0.1:7777`，daemon 看到的 `Origin` 仍是 `http://localhost:5173`，不匹配 `http://127.0.0.1:7777` → 04 §6.6 判定 cross-site → 统一 404。dev 下 `/setup` mint 表单因此会**假失败**。

v1 选定方案（**不**修改 04 安全边界）：

- **dev proxy 不接管 `/bootstrap/*`**（§3.2 已落实）
- dev 下 `/setup` mint 表单**仍渲染**（同一份 page 代码，方便 UI 开发），但**提交按钮被 disabled**——`useSetupViewModel` 检测到当前 `window.location.origin !== daemon_same_origin`（dev 下 origin = `http://localhost:5173`，不是 daemon），把 submit 按钮置灰，旁边显示文案「Mint via dashboard is only available in the production build」；用户不能从 dev 下点出 POST 请求，因此 daemon 端不会收到任何 cross-site mint 尝试
- mint L3 测试因此只在"production embed 形态"下跑（Phase 3.20 / 3.21 用 daemon embed dashboard dist 后通过 same-origin 触达）；dev 下 mint 行为 = "按钮 disabled + 文案" 即视为正确
- L2 层面对 mint endpoint 的 wire 测试由 daemon 侧 curl-level harness 覆盖（[`08`](08-6dq-hooks-wiring.md)），不在 dashboard 测试范围

后续若要让 Vite dev 也支持 mint：需要先在 04 §6.6 显式允许 Vite dev origin（修改安全边界，单独立项）；本文档不在 v1 走该路径。

`/setup` 手输入框（路径 A）不受影响——它只调 `GET /v1/agents`，走 v1 endpoint + Vite proxy + 同源 fetch，dev 下完全可用。

---

## 4. basalt source-copy

basalt 是本机参考工程 `~/workspace/personal/basalt`（[`docs/01-project-overview.md`](../01-project-overview.md) §7.5 引用）。dashboard **不**把它当 npm dependency，而是**源码复制**到 `apps/dashboard/src/` 下，类似 [`01`](01-agent-sdk-pump-from-multica.md) 把 multica `pkg/agent` vendor 进 daemon 的做法（但 dashboard 的 source-copy 是逐文件、按需挑选）。

### 4.1 复制清单（文件级映射）

basalt 当前 `src/components/ui/` 是 shadcn 风格 **小写文件名**（如 `button.tsx` / `card.tsx` / `dialog.tsx`），不是 PascalCase。dashboard **保留 basalt 的原文件名**，避免 import rewrite。

**两类继承策略**：

- **source-copy（verbatim）**：低层 UI primitives + 顶级样式片段，逐字节复制
- **meowth-local adapted**：shell / layout 组件在 meowth 本地重写，视觉上沿用 basalt 但不承诺 verbatim（理由：basalt 的 `AppSidebar` / `DashboardLayout` / `ThemeToggle` 依赖 i18n、自定义 hooks、命令面板、language toggle 等 meowth 不需要的特性；verbatim 会拖入大量不相关 deps）

#### 4.1.1 source-copy（verbatim）

| basalt 上游路径 | meowth 目标路径 | 说明 |
|----------------|----------------|------|
| `src/index.css`（含 `@theme inline {...}` token 与 `@import "tw-animate-css"` 等） | `apps/dashboard/src/index.css` | 不修改 token 值；按需在文末追加 meowth-specific token |
| `src/lib/utils.ts`（`cn()` = `clsx` + `tailwind-merge`） | `apps/dashboard/src/lib/utils.ts` | 不修改 |
| `src/lib/palette.ts` | `apps/dashboard/src/lib/palette.ts` | basalt 的色板枚举 |
| `src/components/ui/button.tsx` | `apps/dashboard/src/components/ui/button.tsx` | 首批必抄 |
| `src/components/ui/card.tsx` | `apps/dashboard/src/components/ui/card.tsx` | 首批必抄 |
| `src/components/ui/input.tsx` | `apps/dashboard/src/components/ui/input.tsx` | 首批必抄 |
| `src/components/ui/dialog.tsx` | `apps/dashboard/src/components/ui/dialog.tsx` | 首批必抄（Tokens 页 secret modal 依赖） |
| `src/components/ui/badge.tsx`、`label.tsx`、`separator.tsx`、`tooltip.tsx` 等 | `apps/dashboard/src/components/ui/<同名>.tsx` | 按 page 需要逐个增量 copy；每次 copy 在 commit message 列出 |

#### 4.1.2 meowth-local adapted（不 verbatim copy）

| meowth 组件 | basalt 参考 | 适配做法 |
|------------|------------|----------|
| `components/AppSidebar.tsx` | basalt `AppSidebar.tsx`（视觉布局/侧栏结构） | 在 meowth 重写：菜单项是 meowth 的 5 page + Setup；**不**引入 `react-i18next`（meowth v1 不做 i18n）、**不**引入 `command` / `LanguageToggle`；只复用 basalt 的视觉层级 + Tailwind class |
| `components/DashboardLayout.tsx` | basalt `DashboardLayout.tsx`（整页布局） | 在 meowth 重写：header 显示 "Meowth"（无 logo，[`docs/01-project-overview.md`](../01-project-overview.md) §6 排除保留 logo 条款）；**不**引入 i18n / GitHub icon / `LanguageToggle` / `use-mobile`；只复用 basalt 的 surface tier + Tailwind class |
| `components/ThemeToggle.tsx` | basalt `ThemeToggle.tsx`（dark/light 切换） | 在 meowth 重写：直接读写 `localStorage.meowth_theme` + `document.documentElement.classList.toggle('dark')`；**不**引入 `react-i18next`；basalt 的 `@custom-variant dark (&:where(.dark, .dark *))` token 已通过 `index.css` source-copy 进来，所以 dark class 直接生效 |

#### 4.1.3 meowth-local additions（不来自 basalt）

- `components/Spinner.tsx`：basalt 无此组件；用 `lucide-react` 的 `Loader2` + Tailwind `animate-spin`
- `components/SecretReveal.tsx`：Tokens / Setup 页显示 secret 一次性遮罩组件；详 → [`07`](07-dashboard-security-csp-and-xss.md)

basalt 当前列出的其它 ui 组件（accordion / alert-dialog / avatar / checkbox / collapsible / command / context-menu / dropdown-menu / hover-card / menubar / navigation-menu / popover / progress / radio-group / select / sheet / slider / sonner 等）**按需 copy**：实际页面用到才进 commit；每次 commit 同步在 commit message 中列出新引入的 Radix 包（[`§3.1`](#31-依赖) 增量 deps 规则）。

### 4.2 来源锁定记录

在 `apps/dashboard/src/_UPSTREAM.md` 记录（位置放 `src/` 根，覆盖整个 source-copy 范围：`index.css` + `lib/*` + `components/*`）：

```markdown
# Basalt source-copy

Files in this dashboard are source-copied (not npm-imported) from the basalt
design system. Track upstream so the copy can be refreshed.

| Field            | Value |
|------------------|-------|
| source_repo      | local: ~/workspace/personal/basalt |
| source_commit    | <40-char git SHA at copy time> |
| copied_at        | YYYY-MM-DD |
| copy_method      | manual cp (per-file; not directory vendor) |
| license          | <basalt LICENSE summary; see ~/workspace/personal/basalt/LICENSE> |

## File map

See docs/architecture/06-dashboard-mvvm-and-basalt.md §4.1.1.

## Meowth-local adapted (not verbatim copy)

These components are written locally in Meowth, inspired by basalt's
layout pattern but not source-copied. See §4.1.2.

- components/AppSidebar.tsx (no i18n, no command palette; 5 pages + Setup)
- components/DashboardLayout.tsx (no i18n, no LanguageToggle, no GitHub icon)
- components/ThemeToggle.tsx (no i18n; direct localStorage + classList)

## Meowth-local additions (not from basalt)

- components/Spinner.tsx
- components/SecretReveal.tsx (see 07)
```

basalt 是项目作者本人维护的本机仓库；与 multica 的"上游"语义不同（multica 是远端），basalt 的"source_commit"用本机 git SHA 即可。"refresh"流程：去 basalt 仓库 git log 看变动 → 决定哪些文件需要再 copy → 更新 `_UPSTREAM.md` 的 `source_commit` 与 `copied_at`。**禁止**：

- 从 basalt npm package import（basalt 不发包）
- 直接 `cp -R` 整个 basalt `src/` 进来（dashboard 只用其中一部分，避免冗余代码）
- 让 dashboard 风格偏离 basalt 的视觉规范 / typography / tabular-nums（§5）

### 4.3 复制后允许的本地修改

- 命名适配（如把 basalt 的某 menu item 改成 meowth 的页面名）
- 路由适配（适配 meowth `/overview` / `/agents` / 等路径）
- 删除 meowth 不用的 prop / 组件 variant

**不允许**：

- 引入嵌套 card-in-card / 嵌套 modal-in-modal 等违反 basalt 视觉密度的结构（保持 basalt 的视觉规范）
- 另起一套 design token 与 basalt 并列（只允许在 `index.css` 末尾追加 meowth-specific token，不覆盖 basalt token）
- 使用与 basalt 风格冲突的第三方 UI 库（Radix / shadcn 之类——除非 basalt 自己已经这样做了，我们对齐）

---

## 5. basalt 视觉规范继承

basalt 的视觉规范以 `index.css` 顶部 `@theme inline { ... }` 块定义的 token 为权威（shadcn/ui CSS-variable 风格映射到 Tailwind v4 namespace）。dashboard 必须沿用同一套 token，不引入并行的 design system。

### 5.1 surface tier（背景层级）

basalt 当前 token（截至本文档写作时 commit `bbd99c122ccfc7a3572a16bf8fe5cab37c1822d1`；变动以 `src/index.css` 实际为准）：

- `--color-background` → Tailwind utility `bg-background`：页面外层背景（屏幕底色）
- `--color-card` → `bg-card`：卡片层（高于 background）
- `--color-secondary` / `--color-muted` → `bg-secondary` / `bg-muted`：卡片内嵌入元素层

dashboard 设计中：

- 页面 root：`bg-background`
- Page section / card：`bg-card` + `border` + `rounded-lg`
- card 内嵌入元素（subdued chip / inner badge）：`bg-secondary` 或 `bg-muted`
- 不发明 `bg-L0` / `bg-L1` / `bg-L2` 新别名；直接使用 basalt 的语义 token

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

为防止 MVVM 沦为口号，Phase 3.13 实施时在工程层添加以下静态约束（**至少**满足其一）：

1. **dependency-cruiser**（推荐）：在 `apps/dashboard/.dependency-cruiser.cjs` 配置规则
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
2. **Biome 规则**（次选）：用 `noRestrictedImports` 实现等价语义
3. **L1 import-boundary test**：用 vitest + `globby` 写一个测试遍历 `src/pages/**/*.tsx` 检查 import 语句不包含 `from '../models/'` / `from '../lib/api'`

至少其一在 Phase 3.13 commit 落地；缺失时 G1 红。

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

---

## 7. 5 个核心页面 + `/setup` 的 page→viewmodel→model 映射

### 7.1 Overview

| 元素 | 文件 |
|------|------|
| Page | `pages/Overview/OverviewPage.tsx` |
| ViewModel | `viewmodels/useOverviewViewModel.ts` |
| Models 调用 | `health.pingHealthz()`、`tokens.listTokens()`、`sessions.listSessions({ status:'running', limit:10 })`、`agents.fetchAgents()` |
| 显示 | daemon healthz 状态卡（[`02`](02-daemon-http-protocol.md) §3）、活跃 token 数、近期 10 个 session、5 个 agent 安装状态 |

### 7.2 Agents

| 元素 | 文件 |
|------|------|
| Page | `pages/Agents/AgentsPage.tsx` |
| ViewModel | `viewmodels/useAgentsViewModel.ts` |
| Models 调用 | `agents.fetchAgents()` |
| 显示 | 5 行 backend 卡片，含 `installed` / `executable` / `version`（[`02`](02-daemon-http-protocol.md) §6.1） |

### 7.3 Sessions

| 元素 | 文件 |
|------|------|
| Page | `pages/Sessions/SessionsListPage.tsx`、`SessionDetailPage.tsx` |
| ViewModel | `viewmodels/useSessionsViewModel.ts`、`useSessionDetailViewModel.ts` |
| Models 调用 | `sessions.listSessions(...)`、`sessions.getSession(id)`、`sessions.followSessionMessages(id, { after_seq })` |
| 显示 | 列表：[`02`](02-daemon-http-protocol.md) §6.2 字段；详情：消息流 + token usage |

**消息流契约（承接 [`02`](02-daemon-http-protocol.md) §5–§6.4）**：

- `sessions.followSessionMessages(id, opts)` 内部用 `fetch` + `ReadableStream` 解析 NDJSON
- envelope 解码器在 `models/envelope.ts`，逐行 `JSON.parse`，按 `event.type` 分发
- **`heartbeat` 默认显示过滤掉**（UI 不显示，但 viewmodel 仍累计 `seq` 用于 reconnect `after_seq`）
- `usage` 是**累计快照**（[`02`](02-daemon-http-protocol.md) §5.4），viewmodel 按 `model` 名 `replace/upsert`，**不**累加
- 客户端断线重连：用最后看到的 `seq` 作为 `after_seq` 参数（[`02`](02-daemon-http-protocol.md) §6.4）；这是 viewmodel 状态机管的，不发明新协议
- `session_ended` event close stream；UI 显示终态徽章

### 7.4 Tokens

| 元素 | 文件 |
|------|------|
| Page | `pages/Tokens/TokensPage.tsx` |
| ViewModel | `viewmodels/useTokensViewModel.ts` |
| Models 调用 | `tokens.listTokens()`、`tokens.createToken({name})`、`tokens.revokeToken(id)` |
| 显示 | 列表 + 创建按钮 + 撤销按钮 |

**Create token modal 行为**：

- 点击「Create」→ 模态对话框输入 `name` → POST `/v1/tokens`（[`02`](02-daemon-http-protocol.md) §9.1）
- 成功响应包含 `secret`（**唯一一次**）→ modal 切换显示 secret + 复制按钮
- 用户关闭 modal 后 dashboard **不**保留 secret（不写 localStorage、不存任何 store）
- secret 显示遮罩 / 复制行为的安全细节 → [`07-dashboard-security-csp-and-xss.md`](07-dashboard-security-csp-and-xss.md)

### 7.5 Settings（read-only v1）

| 元素 | 文件 |
|------|------|
| Page | `pages/Settings/SettingsPage.tsx` |
| ViewModel | `viewmodels/useSettingsViewModel.ts` |
| Models 调用 | `health.pingHealthz()` |
| 显示 | daemon reachable 状态（healthz 200 / 网络错）+ dashboard 自身版本号（来自 build-time env）+ docs 链接（指向 `docs/architecture/` 入口） |

**v1 read-only 硬约束 + 显示边界**：

- dashboard **不**修改 `[remote_access]`、**不**写 `~/.meowth/config.toml`（与 [`05`](05-remote-access-modes.md) §13 #3 一致）
- v1 **没有** `GET /v1/settings` endpoint（[`02`](02-daemon-http-protocol.md) v1 端点清单未含）；Settings 页因此**不**显示 daemon-side 的 `bind_addr` / `bind_port` / `remote_access.mode` / log level——这些配置只在 daemon 进程内、`~/.meowth/config.toml` 文件、daemon 启动日志中可见，**不**通过 wire 暴露给所有持有 token 的客户端
- 用户想看 daemon bind/mode → 直接 `cat ~/.meowth/config.toml` 或读 daemon 启动日志

后续若 dashboard 需要显示 daemon-side 配置（bind / mode / log level），**必须**先在 [`02`](02-daemon-http-protocol.md) 设计 endpoint 并锁定授权边界（例如 admin-scope token），再在本文档 §7.5 同步扩展显示字段（[`§13`](#13-未决问题) #4 留此项给 @zheng-li 决策）。

### 7.6 Setup（`/setup`，§9 决策树）

| 元素 | 文件 |
|------|------|
| Page | `pages/Setup/SetupPage.tsx` |
| ViewModel | `viewmodels/useSetupViewModel.ts` |
| Models 调用 | `health.pingHealthz()`、`bootstrap.mintWithSetupCode(code)` |
| 显示 | 默认 token 手输入框；可选「I have a setup-code instead」切换到 mint 表单 |

§9 详细决策树。

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
- **dev 模式下 mint 表单不承诺工作**（§3.4 已说明）：[`04`](04-bootstrap-and-first-run-mint.md) §6.6 浏览器来源门要求 `Origin` 等于 daemon `Host`，dev 下 Vite dev server `localhost:5173` 与 daemon `127.0.0.1:7777` 不同源；`useSetupViewModel` 检测到 `window.location.origin` 非 daemon 同源时，mint 表单 submit 按钮 **disabled** 且显示提示「Mint via dashboard is only available in the production build」；按钮 disabled = 不发出 cross-site POST。手输入框（路径 A）不受影响

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
| **L3** | Playwright：(a) 手输 token 路径（dev or production embed）：mock daemon 返回 token → dashboard 跳 /overview → 列 5 agent → 创 token → 调 fake agent exec → 看消息；(b) **mint 路径必须走 production embed 形态**（[`§3.4`](#34-dev-proxy-不覆盖-bootstrap)）：跑 `daemon` + 通过 daemon 同源 origin `http://127.0.0.1:7777/setup` → mint 表单 → POST mint → 拿 secret → 跳 /overview；dev 模式 mint 表单显示禁用提示，不算回归；(c) 401 重定向：手工清 localStorage token → 任意页面访问 → redirect /setup |

---

## 12. 原子化提交计划（对应 [`docs/01-project-overview.md`](../01-project-overview.md) §9.2 Phase 3.13–3.20）

| Commit | Phase | 内容 |
|--------|-------|------|
| `feat(dashboard): vite + basalt token system` | 3.13 | §2 目录骨架 + §3 Vite + Tailwind v4 + §4.1 basalt source-copy（`index.css` / `lib/utils.ts` / `lib/palette.ts`） + §4.2 `_UPSTREAM.md` |
| `feat(dashboard): app shell + theme init` | 3.14 | `App.tsx` + `routes/index.tsx` 骨架 + meowth-local adapted shell components (AppSidebar / DashboardLayout / ThemeToggle，§4.1.2)；L1 vitest 起 |
| `chore(dashboard): biome rule + osv-scanner baseline` | 3.15 | G1 / G2 配置；属 07 范围更详（CSP / XSS），本文档 commit 范畴仅 G1/G2 接通；详 → 07 |
| `feat(dashboard): sanitizer wrapper for agent stdout / messages` | 3.16 | DOMPurify 包装 + ANSI → React nodes 结构化；本文档**不**详细规定，详 → 07 |
| `feat(dashboard): 5 page skeletons (MVVM 三段式)` | 3.17 | §7.1–§7.5 五个 page + viewmodel 骨架；每页 vitest |
| `feat(dashboard): daemon http client + bearer storage` | 3.18 | §8 `lib/api.ts` + §8.3 `lib/localStorage.ts`；L1 |
| `feat(dashboard): /setup page (mode A 手输 + mode B nonce + mint)` | 3.19 | §7.6 + §9 决策树；L1 |
| `feat(dashboard): wire 5 pages to live daemon` | 3.20 | viewmodel 接入真实 model；L3 Playwright happy path（通过 Vite proxy） |

每个 commit 自带必要测试 + G1/G2 hook 全绿 + 不留 TODO。

---

## 13. 未决问题

| # | 问题 | 决策方 | 状态 |
|---|------|-------|------|
| 1 | dependency-cruiser / Biome `noRestrictedImports` / L1 import-boundary test 三选一在 Phase 3.13 时选哪个？倾向 dependency-cruiser（最明确） | SDE 实施 Phase 3.13 时 | 待 |
| 2 | basalt source-copy 的 `_UPSTREAM.md` 是否需要在 CI 校验本机 basalt commit 仍存在？v1 倾向不做 | @zheng-li | 暂不实现 |
| 3 | `apiStream` 重连退避算法（指数 / 固定）？v1 倾向"先固定 1s / 2s / 5s 三次后放弃"，简单可测 | SDE 实施 Phase 3.20 时 | 待 |
| 4 | Settings 页面要不要在 v1 至少暴露 `bind_addr` 之类只读信息？需要 02 新增 endpoint；倾向 v2 再做 | @zheng-li | 暂不实现 |

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
