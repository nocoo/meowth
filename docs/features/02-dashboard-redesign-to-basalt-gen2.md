# 02 · Dashboard 重构对齐 basalt Gen 2

> 状态:规划中,等哥 review 通过再进 Stage 2 / Stage 3
> 历史在 `git log -- docs/features/02-dashboard-redesign-to-basalt-gen2.md`
> 配套:[docs/architecture/06](../architecture/06-dashboard-mvvm-and-basalt.md)（这个文档会被本次重构改写一节）

---

## 1. 背景

v0.2.0 把前端工具链对齐到 surety 基线（Vite 8.1.0 / React 19 / RR 8 / TS 6 / Tailwind 4.3.1）。但 **dashboard 的视觉与组件结构仍停留在 Phase 3.13 的 basalt source-copy 最小子集** —— 只 copy 了 4 个 shadcn 原语（button/card/dialog/input）+ Gen 1 风格的 DashboardLayout + 单态 56px 侧边栏,缺少 basalt 体系的关键能力:

- ❌ Gen 2 三文件结构（app-shell / sidebar / sidebar-context）—— sidebar 单态固定 w-56,无折叠态、无 mobile drawer、无 tooltip
- ❌ 四层亮度模型（L0 ~ L3）—— 现有 `Card` 在 L0 上画 `bg-card border`,导致 L0/L1/L2 视觉无差,「层级」无从看出
- ❌ 浮岛 layout —— 主内容直接平铺,没有 `rounded-island bg-card` 包裹
- ❌ Breadcrumbs / Theme toggle 集成 header / Avatar 占位 / Command palette —— 全缺
- ❌ MVVM 三段式只切了 `useXXXViewModel.ts` + `XXXPage.tsx` 两层,**没有 model/page-content 分离**,VM 返回 `vm.status.data` 直接被 page 解构、再用大量 if 分支控制 loading/error/empty 三态。surety 的做法是 page 只负责"加载/错误/空"三态的壳子,把"业务渲染"交给独立 `DashboardContent` 组件
- ❌ Skeleton / Empty State / Notice / Toast / Sheet / DropdownMenu / Select / Avatar / Tooltip / Badge 等基础原语缺失
- ❌ 当前所有 page 都是"标题 + 朴素 div" 的最小可用形态,完全没有 StatCard / Filter Bar / 卡片网格的 basalt 风格

直观对比:surety dashboard 是「金融工牌登录 + 浮岛三栏布局 + 4 卡 stat grid + 6 个 chart 卡」,Meowth dashboard 是「白底页 + 朴素文本 + flex 列表」。

本次重构目标:**让 Meowth dashboard 的视觉/架构与 surety 同档,跟随 basalt B-0..B-5 全套规范**。

## 2. 信息源对照（先确认我没瞎编）

| 来源 | 落点 |
|---|---|
| nmem `Basalt 模板规范体系总览（B-0~B-5）` | 项目家族 + Gen 1/Gen 2 划线 + 浮岛模式 + token 架构 |
| nmem `Basalt 规范 B05:色彩亮度系统 — 四层亮度模型` | L0~L3 + dark hex + 控件 affordance 规则 |
| nmem `Basalt 规范 B-2:Dashboard 框架` | app-shell.tsx + sidebar.tsx + sidebar-context.tsx 三文件契约 |
| nmem `Basalt 规范 B-4:内容页面 UI` | Skeleton / Filter Bar / Button 尺寸 / Badge / 数字卡片 |
| nmem `Dashboard 设计规范完整指南（B05 四层亮度版）` | StatCard / Empty State / Animation 时序 / Table 亮度 |
| `~/workspace/personal/surety/apps/web/` | 完整 Gen 2 + 4 层亮度 + MVVM 切分的活样本（最贴近 meowth 的 Vite SPA 形态） |
| `~/workspace/personal/basalt/src/` | 原始 Gen 1 模板源 + 30+ chart 卡片参考 |
| `apps/dashboard/src/`（meowth 现状） | 重构起点 |

## 3. 现状审计

### 3.1 文件清单（重构前）

```
apps/dashboard/src/
├── App.tsx
├── main.tsx
├── index.css                                       ← 已有 4 层亮度 token（B05 完成度 ~70%）
├── App.test.tsx
├── components/
│   ├── AppSidebar.tsx              Gen 1 单态 w-56,有 lucide 图标 + 平面列表
│   ├── DashboardLayout.tsx         平铺布局,header 一条 border-b,无浮岛
│   ├── AuthGate.tsx                401 拦截 → /setup
│   ├── ThemeToggle.tsx             角落按钮
│   ├── SecretReveal.tsx            token 一次性 modal
│   ├── Spinner.tsx                 加载圈
│   ├── MessageText.tsx             安全渲染 agent 输出
│   └── ui/
│       ├── button.tsx              shadcn 原语
│       ├── card.tsx                ⚠ 用 border 而非 4 层亮度
│       ├── dialog.tsx
│       └── input.tsx
├── pages/
│   ├── Overview/OverviewPage.tsx   "标题 + 4 个朴素 Card,Card 局部定义"
│   ├── Agents/AgentsPage.tsx       "标题 + ul"
│   ├── Sessions/{SessionsListPage,SessionDetailPage}.tsx
│   ├── Tokens/TokensPage.tsx
│   ├── Settings/SettingsPage.tsx
│   └── Setup/SetupPage.tsx
├── viewmodels/                     ← 7 个 useXXXViewModel.ts（已有 L1 单测）
├── models/                         ← 类型 + fetch helpers（已有 L1 单测）
└── lib/
    ├── api.ts                      fetch wrapper + 401 → AuthGate
    ├── palette.ts                  basalt source-copy（24 色 chart palette）
    ├── localStorage.ts             token 持久化
    ├── logger.ts
    ├── redact.ts
    └── utils.ts                    cn()
```

### 3.2 token 现状（`apps/dashboard/src/index.css`）

| 项 | 状态 |
|---|---|
| L0 `--background` 9% / L1 `--card` 10.6% / L2 `--secondary` 12.2% | ✅ 完整 |
| L3 `--input`/`--border` | ✅ 完整,但 dev 是否真按 B05 用 `bg-secondary border-border` 还要审计 |
| Sidebar 7 token | ✅ |
| chart-1..24 + chart-axis / chart-muted | ✅ 完整 |
| heatmap-{green,red,blue,orange}-1..4 | ✅ |
| `--radius-card` / `--radius-widget` / `--radius-island` | ❌ **缺** |
| semantic colors (success / warning / info / purple / teal) | ⚠ 只有 success + destructive,缺 warning / info / purple / teal |
| semantic *text* tokens（low-contrast 文本） | ❌ 缺 |
| Avatar palette（16 色,WCAG AA） | ❌ 缺 |

### 3.3 MVVM 切分现状

| 项目 | model | viewmodel | page | page-content | skeleton |
|---|---|---|---|---|---|
| **surety** | `lib/dashboard-vm.ts` + `lib/dashboard-health.ts` | useSWR hook | `dashboard.tsx`（壳子,只管 loading/error） | `dashboard-content.tsx`（业务渲染） | `components/skeletons.tsx`（per-page） |
| **meowth** | `models/*.ts` | `viewmodels/use*.ts` | `pages/*Page.tsx` 一锅煮 | ❌ 缺 | ❌ 缺（只有 Spinner） |

meowth 现状是 vm 返回 `vm.status: { kind: 'loading' | 'error' | 'ready', data?, message? }`,page 自己分支渲染三态。这不是"MVVM 三段式不彻底",是**少了一层 Content** —— page 应该只关心"是 loading 还是 ready",真正的业务 DOM 应在 `*Content.tsx`。

### 3.4 当前 ui/ 原语清单 vs surety

| ui/ 原语 | meowth | surety |
|---|---|---|
| button | ✅ | ✅ |
| card | ✅ | ❌（不再需要,改用 `bg-secondary rounded-card`） |
| input | ✅ | ✅ |
| dialog | ✅ | ✅ |
| **avatar** | ❌ | ✅ |
| **badge** | ❌ | ✅ |
| **collapsible** | ❌ | ✅ |
| **dropdown-menu** | ❌ | ✅ |
| **empty-state** | ❌ | ✅ |
| **label** | ❌ | ✅ |
| **notice** | ❌ | ✅ |
| **section-divider** | ❌ | ✅ |
| **select** | ❌ | ✅ |
| **separator** | ❌ | ✅ |
| **sheet** | ❌ | ✅（mobile sidebar drawer 用） |
| **skeleton** | ❌ | ✅ |
| **sort-header** | ❌ | ✅ |
| **switch** | ❌ | ✅ |
| **table** | ❌ | ✅（注意 hover/footer 用 L0 不是 L2） |
| **textarea** | ❌ | ✅ |
| **toggle / toggle-group** | ❌ | ✅ |
| **tooltip** | ❌ | ✅ |
| alert-dialog | ❌ | ✅（destructive 确认） |

**缺口:18 个原语**。其中 **tooltip / sheet / skeleton / dropdown-menu / select / table** 是 Gen 2 强依赖（sidebar 折叠态 tooltip、mobile drawer、loading skeleton、token 操作菜单、period selector、session 列表）。

## 4. 重构目标蓝图（哥要的 4 个维度）

### 4.1 整个容器布局

按 basalt B-2 + surety 实际形态:

```
<AppShell>                                          // 顶层壳
  <SidebarProvider>                                 // context: collapsed / mobileOpen
    <div class="flex min-h-screen bg-background">   // L0
      <Sidebar />                                   // L0 同色,无 border,sticky h-screen
      <main class="flex flex-1 flex-col min-w-0">
        <header class="flex h-14 ...">              // L0 同色,无 border
          <Breadcrumbs />                           // 左
          <div class="...">                         // 右: ThemeToggle / GitHub / ...
        </header>
        <div class="flex-1 px-2 pb-2 md:px-3 md:pb-3">
          <div class="rounded-[20px] bg-card p-3 md:p-5"> // 浮岛 L1
            <Outlet />                              // 各页面 Content
          </div>
        </div>
      </main>
    </div>
  </SidebarProvider>
</AppShell>
```

**关键约束**:
- `--background` (L0) 同时是 page bg、sidebar bg、header bg —— 三者无 border 分隔,靠"浮岛"形成视觉层次
- 浮岛 L1 内部所有"卡片"用 `bg-secondary rounded-card p-4` (L2),不再用 border
- meowth 当前 `DashboardLayout.tsx` 的 `border-b` 删除（Gen 1 残留）

### 4.2 Sidebar 与各种装饰

按 surety 完整复刻:

| 元素 | 折叠态 (w-68) | 展开态 (w-260) |
|---|---|---|
| 容器 | `h-screen w-[68px] flex flex-col items-center` | `h-screen w-[260px] flex flex-col` |
| Logo 区 | `h-14` 居中,只有 `<img src="/logo-24.png" w=24>` | `h-14 px-3`,logo + "Meowth" 文字 + v{APP_VERSION} pill + 折叠按钮 |
| Toggle 按钮 | 独立 `h-10 w-10` PanelLeft 图标按钮（向右展开） | logo 行右侧 `h-7 w-7` PanelLeft（向左收起） |
| 导航 | **flat 图标列表**,每项 Tooltip 显示 label | **分组**,每组 NavGroupSection 可折叠 |
| 导航项激活 | `bg-accent text-foreground` | `bg-accent text-foreground`（左侧 2px primary 竖线由 `relative` + `::before` 加） |
| 底部 | Avatar 居中 | Avatar + 用户名（或占位） |
| 移动端 | 不显示,改用 `<Sheet>` 包 Sidebar 抽屉 | 同 |
| 切换动画 | `transition-all duration-150 ease-in-out` | 同 |

**Meowth 的导航分组**（按当前 6 个页面 + Setup 重排）:

```
总览（默认展开）
  - Overview     LayoutDashboard
  - Agents       Bot
代理活动（默认展开）
  - Sessions     ListTree
管理（默认展开）
  - Tokens       KeyRound
  - Settings     Settings
[底部固定]
  Setup          （只在未认证时可见,或始终可见但用 muted 样式）
```

**装饰元素清单**:
- `v{APP_VERSION}` pill：`rounded-md bg-secondary px-1.5 py-0.5 text-[10px]`，APP_VERSION 从 `@meowth/shared` 拿（需要新加 `lib/version.ts`,引用 root `package.json` —— 跟 surety 一样不能 `process.env`）
- Sidebar 内 GitHub 链接：`h-8 w-8` 圆按钮（surety 放在 header,meowth 可以放 sidebar 底部 + header 都行，建议跟 surety 一致放 header）
- Theme toggle：header 右侧
- 折叠态 Tooltip：`side="right" sideOffset={8}`

### 4.3 四层亮度（L0/L1/L2/L3）

按 nmem B05 + dashboard 设计规范完整指南落地。**meowth 已有 token,但用法没对齐** —— 这一节细化"哪个组件该用哪一层":

| 组件 | 层 | 类 |
|---|---|---|
| `<body>` / AppShell 最外层 | L0 | `bg-background` |
| Sidebar | L0 | `bg-background`（与 body 无视觉分隔） |
| Header | L0 | `bg-background` |
| 浮岛主内容区 | L1 | `bg-card rounded-[20px]` |
| StatCard / 表格容器 / chart 卡片 | L2 | `bg-secondary rounded-card`（14px） |
| Input / Select / Button(secondary variant) | L3 | `bg-secondary border border-border` |
| Tooltip / Dropdown popover | L1 同色 | `bg-popover`（CSS var 与 L1 一致 #1b1b1b） |
| Dialog 内容 | L0 | `bg-background`（内部控件 L2 → 两级跳） |
| Table row hover / footer | L0 | `bg-background/50`（**不是** `bg-muted`） |
| Sidebar 内搜索框（如有） | L1 | `bg-card border border-border` |

**Meowth 现状要修的位置**:
- `components/ui/card.tsx` 整个废弃 —— 当前用 `bg-card border`,L0/L1/L2 平贴。改为业务代码直接用 `bg-secondary rounded-card p-4`（无 Card 抽象）
- `pages/Overview/OverviewPage.tsx` 内的 `function Card(...)` 删除,改用 surety 的 `StatCard`
- 所有 `<input>` 当前是裸 shadcn,要确认是 `bg-secondary border-border` 而非 `bg-input`
- `--radius-card: 14px` / `--radius-widget: 10px` / `--radius-island: 20px` 三 token 加进 `index.css`

### 4.4 MVVM 架构完全重构

把每个 page 拆成 4 个文件（model 共享）:

```
src/pages/Overview/
├── OverviewPage.tsx           ← 壳子,只管 isLoading/error/empty 三态(像 surety/dashboard.tsx)
├── OverviewContent.tsx        ← 业务渲染,接收 ViewModel resolved data 渲染 DOM
├── OverviewSkeleton.tsx       ← per-page 骨架（B-4 规范）
└── index.ts                   ← re-export
```

VM 仍由 `viewmodels/useOverviewViewModel.ts` 提供。生命周期:

```
[OverviewPage]
  vm = useOverviewViewModel()
  if (vm.status.kind === 'loading') return <OverviewSkeleton />
  if (vm.status.kind === 'error')   return <EmptyState tone="error" />
  return <OverviewContent data={vm.status.data} />

[OverviewContent]  (纯 props 函数, 接 data: OverviewData → 返回 ReactNode)
  return (<>
    <StatCard ... />
    <StatCard ... />
    ...
  </>)
```

**好处**:
- L1 单测（vitest + RTL）可以独立测 OverviewContent —— 不用 mock fetch,只 props 注入
- Skeleton 与 Content 结构 1:1 对应（B-4 要求）
- 错误/空态收敛到顶层 page

**重构清单**（7 个 page）:

| Page | 现状 | 重构后 |
|---|---|---|
| Overview | 1 文件 + 局部 Card 函数 | OverviewPage + OverviewContent + OverviewSkeleton |
| Agents | 1 文件 + ul | AgentsPage + AgentsContent + AgentsSkeleton |
| Sessions/List | 1 文件 | SessionsListPage + SessionsListContent + SessionsListSkeleton |
| Sessions/Detail | 1 文件 | SessionDetailPage + SessionDetailContent + SessionDetailSkeleton |
| Tokens | 1 文件 | TokensPage + TokensContent + TokensSkeleton |
| Settings | 1 文件 | SettingsPage + SettingsContent（无 skeleton,settings 几乎瞬时） |
| Setup | 1 文件 | **不动结构**（无 VM 异步加载,SetupPage 本身就是表单） |

## 5. 影响面清单

### 5.1 新增文件

```
apps/dashboard/src/components/layout/
├── app-shell.tsx              ★ B-2 三件套之一
├── sidebar.tsx                ★ B-2 三件套之一
├── sidebar-context.tsx        ★ B-2 三件套之一
├── breadcrumbs.tsx
├── site-footer.tsx
└── index.ts

apps/dashboard/src/components/ui/    新增原语（按需逐 commit 加,不一次全 copy）
├── avatar.tsx
├── badge.tsx
├── collapsible.tsx
├── dropdown-menu.tsx
├── empty-state.tsx
├── label.tsx
├── notice.tsx
├── section-divider.tsx
├── select.tsx
├── separator.tsx
├── sheet.tsx
├── skeleton.tsx
├── switch.tsx
├── table.tsx
├── textarea.tsx
└── tooltip.tsx

apps/dashboard/src/components/
├── StatCard.tsx               ★ B-2 / B-4 规范
└── PageHeader.tsx             ★ B-4 标题+副标题+右侧 filter 行

apps/dashboard/src/hooks/
└── use-mobile.ts              ★ surety 同名

apps/dashboard/src/lib/
├── navigation.ts              ★ B-2 要求纯数据
└── version.ts                 ★ APP_VERSION 从 package.json 注入

apps/dashboard/src/pages/{Overview,Agents,...}/
├── *Content.tsx               ★ 每页 1 个
└── *Skeleton.tsx              ★ 每页 1 个（Setup 例外）

apps/dashboard/public/
└── logo-192.png               ★ B-3 dev/login 用（resize-logos.py 加一行）
```

### 5.2 需新增的依赖

| 包 | 来源 | 用途 |
|---|---|---|
| `@radix-ui/react-tooltip` | surety | sidebar 折叠态 |
| `@radix-ui/react-dropdown-menu` | surety | token 操作菜单等 |
| `@radix-ui/react-select` | surety | filter / period selector |
| `@radix-ui/react-collapsible` | surety | sidebar 分组折叠 |
| `@radix-ui/react-popover` | surety | dropdown 支撑 |
| `@radix-ui/react-separator` | surety | section divider |
| `@radix-ui/react-switch` | surety | settings 开关 |
| `@radix-ui/react-toggle` / `-toggle-group` | surety | period selector 替代方案 |
| `@radix-ui/react-label` | surety | input label |
| `@radix-ui/react-avatar` | surety | sidebar 底部 |
| `vaul` 或 `@radix-ui/react-dialog`（已有） | surety | Sheet drawer mobile |

surety 用 `radix-ui` 1.6.0 这个**聚合包**,可以一次引入所有 primitive。建议跟 surety 一致。

### 5.3 修改文件

```
apps/dashboard/src/
├── index.css                              + radius-card/widget/island,补 semantic colors,补 avatar palette
├── components/DashboardLayout.tsx         删除（被 AppShell 替代）
├── components/AppSidebar.tsx              删除（被 layout/sidebar.tsx 替代）
├── components/ThemeToggle.tsx             轻改:emit 到 header 用,样式微调
├── components/ui/card.tsx                 删除（业务直接 bg-secondary rounded-card）
├── components/AuthGate.tsx                微改:redirect 时跑 EmptyState 提示页(可选)
├── App.tsx                                改用 <AppShell>
└── pages/*/.../*Page.tsx                  7 个 page 重写为壳子模式
```

### 5.4 文档同步

```
docs/architecture/06-dashboard-mvvm-and-basalt.md   §4 重写:从"source-copy 4 个原语"变为
                                                   "Gen 2 三件套 + 4 层亮度 + 18 ui 原语 + per-page 4 文件"
docs/architecture/07-dashboard-security-csp-and-xss.md  §11 L3 sanitizer 引用 MessageText 不变,
                                                   但 e2e 选择器需要更新（侧边栏结构变了)
README.md                                          截图可能要换新（OG image 不动）
```

## 6. 原子提交序列

**分 4 大阶段、共 ~14 个原子 commit**。每段独立可 review/回滚;后段不依赖前段未落地的代码。

### Stage A — 基础设施（4 commit）

| # | Commit | 内容 | 测试 |
|---|---|---|---|
| A1 | `chore(deps): add radix primitives + vaul for Gen 2 dashboard` | `apps/dashboard/package.json` 加 11 个 radix + vaul,锁版本与 surety 一致;`pnpm install` 同步 lockfile | install 通过 + pnpm dashboard:g1 绿 |
| A2 | `feat(dashboard): add Basalt B05 radius tokens + semantic colors + avatar palette` | `index.css` 加 `--radius-{card,widget,island}` / warning/info/purple/teal / 16-slot avatar palette / semantic text tokens | L1 vitest 全绿；palette.test 扩展 1 case |
| A3 | `feat(dashboard): copy 8 ui primitives from surety (skeleton/tooltip/sheet/avatar/badge/separator/select/dropdown-menu)` | `components/ui/` 复制 surety 同名文件,只改 import 路径,**不写业务代码** | 每个 ui 文件加最小 L1 vitest 烟雾测试（渲染 + base 类断言） |
| A4 | `feat(dashboard): copy 8 ui primitives (collapsible/empty-state/label/notice/section-divider/switch/table/textarea/toggle)` | 同上,剩余 8 个 | 同上 |

### Stage B — Gen 2 layout（3 commit）

| # | Commit | 内容 | 测试 |
|---|---|---|---|
| B1 | `feat(dashboard): add Gen 2 layout — app-shell + sidebar + sidebar-context` | `components/layout/` 三件套 + breadcrumbs + site-footer;`lib/navigation.ts` + `lib/version.ts`;**App.tsx 切换为 AppShell**;删 DashboardLayout/AppSidebar | RTL 测试:折叠 toggle / mobile sheet 开关 / 当前路由高亮 |
| B2 | `feat(dashboard): wire sidebar to actual routes + logo-192 + version pill` | nav data + APP_VERSION pill + 折叠态 logo-24,展开态 logo-24+文字+pill | E2E embed:截图断言 sidebar 渲染（非业务） |
| B3 | `refactor(dashboard): drop ui/card.tsx and remove all border-based card usage` | 删 `ui/card.tsx`;改 page 里所有 `<div class="border ...">` 为 `bg-secondary rounded-card p-4`（**只改样式,不动逻辑**） | 现有 L1/L3 测试需更新选择器（如有按 class 名查的） |

### Stage C — MVVM 三段式（7 commit,**每页一个 commit**）

每个 page 拆为 `Page + Content + Skeleton` 三文件。

| # | Commit | 内容 |
|---|---|---|
| C1 | `refactor(dashboard): split Overview into Page/Content/Skeleton` | Overview 三件套 + StatCard 引入(放 components/StatCard.tsx) |
| C2 | `refactor(dashboard): split Agents into Page/Content/Skeleton` | Agents 三件套,用 StatCard + EmptyState |
| C3 | `refactor(dashboard): split SessionsList + SessionDetail` | Sessions 两子页面各自 3 文件 |
| C4 | `refactor(dashboard): split Tokens (with SecretReveal modal)` | Tokens 三件套 + Table 用 surety 风格 |
| C5 | `refactor(dashboard): rewrite Settings using basalt Switch + Notice` | Settings 不需 skeleton |
| C6 | `refactor(dashboard): update Setup to use basalt Input/Notice (no skeleton)` | Setup 是表单页,只动样式 |
| C7 | `test(dashboard): add per-page L1 tests for Content + Skeleton` | 每个 Content 单独可测（props 注入） + Skeleton 渲染测 |

### Stage D — 文档与发布（2 commit）

| # | Commit | 内容 |
|---|---|---|
| D1 | `docs(arch): rewrite 06 §4 for Gen 2 + L0..L3 + per-page 4 files` | 06 文档 §4 整段重写 |
| D2 | `chore(release): bump to 0.3.0 + CHANGELOG` | minor 升级（因为 ui 结构破坏性变更） |

**总计 16 个 commit**,但**每个 commit 都自带测试且全绿**。哥可以在任何 Stage 边界停下来,代码不会处于半残态。

## 7. 6DQ 质量计划

| 层 | 命令 | 通过条件 |
|---|---|---|
| **G1 静态** | `pnpm dashboard:g1` | 全绿(fmt + lint + tsc + depcruise + source scan) |
| **L1 单元** | `pnpm dashboard:test:cover && pnpm dashboard:cover:check` | 覆盖率不回归;新增 per-page Content 单测;每个 ui 原语至少 1 个烟雾测 |
| **L2 API** | `pnpm test:l2` | 无 daemon 改动,**不需重测**,但 release 前跑一遍兜底 |
| **L3 e2e** | `pnpm --filter @meowth/dashboard e2e --project=dashboard-embed --project=dashboard-embed-mint` | 全绿;**已有 e2e 选择器可能需要更新**（sidebar 结构换了） |
| **G2 安全** | `pnpm scan:g2` | radix 包要 osv 通过 |
| **CI** | github actions | 10/10 全绿 |

### 7.1 已知会破坏的现有测试

| 文件 | 原因 | 修法 |
|---|---|---|
| `apps/dashboard/src/components/AppSidebar.test.tsx` | 整个组件被替换 | 删除 |
| `apps/dashboard/src/components/DashboardLayout.test.tsx` | 整个组件被替换 | 删除,补 layout/app-shell.test.tsx |
| `apps/dashboard/e2e/embed/setup.spec.ts` 等 | DOM 选择器（class、role）可能变 | 按需更新；建议尽量用 role+name 而非 class |

### 7.2 不打算做的事（明确范围）

- **不引入** Recharts/charts —— Meowth dashboard 当前没有图表需求（监控类页面后续再做）
- **不做** mobile 完整布局适配（surety 是 mobile-first,Meowth 是本机 dashboard,主要桌面浏览器使用） —— 但 sidebar 的 Sheet 还是要做,因为 B-2 要求,不做会拖后续
- **不做** Command Palette（Cmd+K） —— surety 有,但 Meowth 6 个页面用不到,留到 v0.4
- **不引入** i18n —— Meowth 单用户,英文 + 必要中文混合即可
- **不改** dashboard 与 daemon 的 HTTP API 契约 —— 这次是纯前端重构

## 8. 风险与回滚

| 风险 | 概率 | 缓解 |
|---|---|---|
| L3 e2e 选择器集体失败 | 高 | C 阶段每个 page commit 单独跑 e2e,失败立即 fix 不堆积 |
| 覆盖率回归 | 中 | C7 commit 专门补 Content/Skeleton 单测 |
| radix 1.6.0 与 React 19 peer 警告 | 中 | install 前先看 `pnpm peers check`,有 warning 而非 error 即可放行 |
| 视觉 regression 没人手 review | 中 | D 阶段 release 前手动 dev 跑一遍 + 截图存档 |
| 16 commit 中间阶段在 main 上半残 | 低 | 每个 commit 独立全绿,半残不会进 main |

回滚策略:`git revert` 单个 commit;Stage 边界打 tag 方便整段 revert。

## 9. 验证结果

> 落地完成后填。

---

## 附录:与 surety 的偏差表（哥过目）

| 项 | surety | meowth 选择 | 理由 |
|---|---|---|---|
| 主色 | Vermilion 朱红 | 当前 `217 91% 60%`（蓝） | 不动品牌色,沿用现 token |
| Sidebar 底部 | 用户 Avatar | **Setup 链接 + 占位 Avatar** | 单用户,无登录概念,Avatar 用空 letter |
| Header 右 | DbSelector + GitHub + ThemeToggle | **GitHub + ThemeToggle** | Meowth 无多 DB |
| Command Palette | 有 | **暂不做** | §7.2 明确范围 |
| pages 形态 | 12 个业务页 | 6 个 + Setup | 现状 |
| 字体 | Inter | sans-serif 默认 | 之前没引入,本次也不引入,留 v0.4 决策 |
