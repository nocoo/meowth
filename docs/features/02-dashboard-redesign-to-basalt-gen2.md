# 02 · Dashboard 重构对齐 basalt Gen 2

> 状态:Stage A / B / C 已完成实施（2026-06-25）; D1 docs sync 完成; D2 release bump 待发. C7 / C8 SKIPPED — 详 §6 顶部 banner.
> 历史在 `git log -- docs/features/02-dashboard-redesign-to-basalt-gen2.md`
> 配套:[docs/architecture/06](../architecture/06-dashboard-mvvm-and-basalt.md)（D1 同步重写了 §2 / §4 / §5.1 / §6.4 / §6.5 / §7 / §12 反映 Gen 2 落地形态; 本文档下面 §3–§5 仍是原始规划稿, §6 表格 commit subject 与实际落地 hash 一致; §6 表格中的 `sort-header` (C3a) 与 `Switch` (C5) 段最终未被实际使用——见 06 §4.1.5 / §6.4 #3）.

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
| `--popover` / `--popover-foreground` | ✅ 已就位（`index.css` line 35 / 120 / 220；dark 下与 `--card` 同值 #1b1b1b，符合 B05） |
| `--radius-card: 14px` | ✅ 已存在（`index.css` line 84） |
| `--radius-widget: 10px` | ✅ 已存在（`index.css` line 85） |
| `--radius-island` | ❌ **缺**（Stage A2 落 20px） |
| semantic colors (success / warning / info / purple / teal) | ⚠ 只有 success + destructive,缺 warning / info / purple / teal（Stage A2 落） |
| semantic *text* tokens（low-contrast 文本） | ❌ 缺（Stage A2 落） |
| Avatar palette（16 色,WCAG AA） | ❌ 缺（Stage A2 落） |

### 3.3 MVVM 切分现状

| 项目 | model | viewmodel | page | page-content | skeleton |
|---|---|---|---|---|---|
| **surety** | `lib/dashboard-vm.ts` + `lib/dashboard-health.ts` | useSWR hook | `dashboard.tsx`（壳子,只管 loading/error） | `dashboard-content.tsx`（业务渲染） | `components/skeletons.tsx`（per-page） |
| **meowth** | `models/*.ts` | `viewmodels/use*.ts` | `pages/*Page.tsx` 一锅煮 | ❌ 缺 | ❌ 缺（只有 Spinner） |

meowth 现状是 vm 返回 `vm.status: { kind: 'loading' | 'error' | 'ready', data?, message? }`,page 自己分支渲染三态。这不是"MVVM 三段式不彻底",是**少了一层 Content** —— page 应该只关心"是 loading 还是 ready",真正的业务 DOM 应在 `*Content.tsx`。

### 3.4 当前 ui/ 原语清单 vs surety

surety 实际 `ls apps/web/src/components/ui/` 输出 23 个 primitive（含 alert-dialog）。下表按 **B-2 Gen 2 用途** 分三组（reviewer/SDE cross-check 共识）：

#### G1 — Gen 2 layout 必需（Stage B1 commit 之前必须就位，共 8 个）

| ui/ 原语 | meowth | surety 路径 | 用途 |
|---|---|---|---|
| **tooltip** | ❌ | `components/ui/tooltip.tsx` | sidebar 折叠态 label |
| **sheet** | ❌ | `components/ui/sheet.tsx`（基于 `radix-ui` Dialog；不引 vaul） | mobile sidebar drawer |
| **avatar** | ❌ | `components/ui/avatar.tsx` | sidebar 底部、用户占位 |
| **collapsible** | ❌ | `components/ui/collapsible.tsx` | sidebar 分组折叠 |
| **separator** | ❌ | `components/ui/separator.tsx` | section 分隔线 |
| **badge** | ❌ | `components/ui/badge.tsx` | version pill、status badge |
| **skeleton** | ❌ | `components/ui/skeleton.tsx` | per-page 骨架 |
| **empty-state** | ❌ | `components/ui/empty-state.tsx` | error / empty 三态 |

#### G2 — 页面迁移必需（Stage C 按页消费时引入，共 11 个）

| ui/ 原语 | meowth | surety 路径 | 消费页面 |
|---|---|---|---|
| **table** | ❌ | `components/ui/table.tsx` | Tokens / Sessions list（注意 hover/footer 用 L0 不是 L2） |
| **dropdown-menu** | ❌ | `components/ui/dropdown-menu.tsx` | Token 操作菜单 |
| **select** | ❌ | `components/ui/select.tsx` | filter / period selector |
| **label** | ❌ | `components/ui/label.tsx` | Setup / Tokens dialog 表单 label |
| **notice** | ❌ | `components/ui/notice.tsx` | Settings / Setup 信息条 |
| **section-divider** | ❌ | `components/ui/section-divider.tsx` | Settings 分组 |
| **switch** | ❌ | `components/ui/switch.tsx` | Settings 开关 |
| **textarea** | ❌ | `components/ui/textarea.tsx` | 备用（暂无固定页消费） |
| **toggle** | ❌ | `components/ui/toggle.tsx` | period 切换 |
| **toggle-group** | ❌ | `components/ui/toggle-group.tsx` | period 切换 |
| **sort-header** | ❌ | `components/ui/sort-header.tsx` | Tokens / Sessions 表格排序 |

#### G3 — 破坏性 confirm 用（按需引入，默认不进 A3/A4，共 1 个）

| ui/ 原语 | meowth | surety 路径 | 触发条件 |
|---|---|---|---|
| alert-dialog | ❌ | `components/ui/alert-dialog.tsx` | 仅当某 page commit 真实需要 destructive confirm（如 Tokens revoke）才随该 commit 引入 |

#### 已有原语

| ui/ 原语 | meowth | surety | 处理 |
|---|---|---|---|
| button | ✅ | ✅ | 保留 |
| input | ✅ | ✅ | 保留 |
| dialog | ✅ | ✅ | **Stage A1 import rewrite：`@radix-ui/react-dialog` → `from "radix-ui"`** |
| card | ✅ | ❌ | **业务清除 + cleanup commit 删除**（详 §6 B3 / §4.3） |

**总计 G1 + G2 = 19 个新原语；G3 按需 1 个。** Stage A3 落 G1 全部 8 个；Stage A4 落 G2 全部 11 个；G3 alert-dialog 不进 Stage A 安装序列。

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
- `v{APP_VERSION}` pill：`rounded-md bg-secondary px-1.5 py-0.5 text-[10px]`。**APP_VERSION 注入方式锁定 Vite `define`**：`vite.config.ts` 加 `define: { __APP_VERSION__: JSON.stringify(pkg.version) }`，`apps/dashboard/src/lib/version.ts` 仅 re-export 该常量（配合 ambient `.d.ts` 声明 `declare const __APP_VERSION__: string`）。**不允许 dashboard 直接读 root `package.json` 或 `process.env`**；不通过 `@meowth/shared` 暴露 version（避免 release commit 必须同步 shared 包）
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
- `components/ui/card.tsx` **分两步清理**：先 Stage B3 把所有业务里 `<Card>` 使用替换为 `bg-secondary rounded-card p-4`（**不删文件**）；待 B3 通过 review + grep 证明无 import 后，Stage B4 独立 `chore(dashboard): drop ui/card.tsx and update _UPSTREAM.md` commit 删除文件并同步 `_UPSTREAM.md` 移除 card 行。这保证 source-copy 契约（`_UPSTREAM.md`）不被默默打破。
- `pages/Overview/OverviewPage.tsx` 内的 `function Card(...)` 删除,改用 surety 的 `StatCard`
- 所有 `<input>` 当前是裸 shadcn,要确认是 `bg-secondary border-border` 而非 `bg-input`
- 现状 `--radius-card: 14px` / `--radius-widget: 10px` 已存在（`index.css` line 84/85），**保留**；新增 `--radius-island: 20px`

### 4.4 MVVM 架构完全重构

**与 surety 的形态差异（明确 deviate）**：surety 是单一 `app/dashboard.tsx` + `app/dashboard-content.tsx` 的 flat 形态（外加集中 `components/skeletons.tsx`），适合"主仪表盘 + 子 page 都很薄"的形态。meowth 有 7 个独立 page（Overview / Agents / Sessions list / Sessions detail / Tokens / Settings / Setup），各自有独立 viewmodel + 独立 skeleton，**采用 per-page 目录（Page + Content + Skeleton 三件套）便于 L1 单测聚合 + 文件就近查找**。Setup 因为是表单页无异步加载例外（详 §4.4 重构清单）。

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

apps/dashboard/src/components/ui/    新增原语（Stage A3 落 G1 8 个，A4 落 G2 11 个；G3 alert-dialog 按需，不进 Stage A 默认序列）
# G1 — Gen 2 layout 必需（Stage A3）
├── avatar.tsx
├── badge.tsx
├── collapsible.tsx
├── empty-state.tsx
├── separator.tsx
├── sheet.tsx
├── skeleton.tsx
├── tooltip.tsx
# G2 — 页面迁移必需（Stage A4）
├── dropdown-menu.tsx
├── label.tsx
├── notice.tsx
├── section-divider.tsx
├── select.tsx
├── sort-header.tsx
├── switch.tsx
├── table.tsx
├── textarea.tsx
├── toggle.tsx
└── toggle-group.tsx
# G3 — 按需引入（不进 Stage A 默认序列；某 C* commit 真实需要 destructive confirm 时引入）
#   alert-dialog.tsx

apps/dashboard/src/components/
├── StatCard.tsx               ★ B-2 / B-4 规范
└── PageHeader.tsx             ★ B-4 标题+副标题+右侧 filter 行

apps/dashboard/src/hooks/
└── use-mobile.ts              ★ surety 同名

apps/dashboard/src/lib/
├── navigation.ts              ★ B-2 要求纯数据
└── version.ts                 ★ re-export Vite `define` 注入的 `__APP_VERSION__`（配合 ambient `.d.ts`，**不读** root `package.json`）

apps/dashboard/src/pages/{Overview,Agents,...}/
├── *Content.tsx               ★ 每页 1 个
└── *Skeleton.tsx              ★ 每页 1 个（Setup 例外）

apps/dashboard/public/
└── logo-192.png               ★ B-3 dev/login 用（resize-logos.py 加一行）
```

### 5.2 需新增的依赖

**策略锁定（reviewer + SDE 共识；如 @zheng-li 未反对则按此执行）**：跟 surety 一致引入 `radix-ui@1.6.0` 聚合包，新 copy 的 ui 文件保持 `from "radix-ui"` 形态（与 surety 同款），现有 `@radix-ui/react-dialog@1.1.17` 单包同步迁出。

| 包 | 版本 | 来源 / 用途 |
|---|---|---|
| `radix-ui` | `1.6.0` | surety 同款聚合包；提供 G1/G2 全部 19 个原语所需的 Radix primitive（含 Dialog → Sheet 底层、Dropdown、Select、Tooltip、Collapsible、Popover、Separator、Switch、Toggle/ToggleGroup、Label、Avatar 等） |

**不引入**：

- `vaul` —— surety 的 `Sheet` 实际是 `radix-ui` Dialog wrapper（验证：`surety/apps/web/src/components/ui/sheet.tsx` 第 3 行 `import { Dialog as SheetPrimitive } from "radix-ui"`）；本次也走 Dialog wrapper，不引 vaul。
- 任何 `@radix-ui/react-*` 单包（除非聚合包未覆盖；目前 1.6.0 已涵盖所需）。

**Stage A1 子步骤**（落 §6 时强制）：

1. `apps/dashboard/package.json` 加 `"radix-ui": "1.6.0"`；删除 `"@radix-ui/react-dialog": "1.1.17"`。
2. `apps/dashboard/src/components/ui/dialog.tsx` 把 `from "@radix-ui/react-dialog"` 改为 `from "radix-ui"` 命名空间引用（参照 surety 同名文件形态）。
3. `pnpm install` 同步 lockfile；G1 (fmt + lint + tsc + depcruise + source scan) 必须全绿；G2 osv 必须无新增 advisory。
4. `pnpm dashboard:cover:check` 不下降（dialog 仅 import 路径改动，行为不变）。

### 5.3 修改文件

```
apps/dashboard/src/
├── index.css                              + radius-island（保留现有 radius-card/widget）, 补 semantic colors (warning/info/purple/teal), 补 semantic text, 补 avatar palette
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
                                                   "Gen 2 三件套 + L0..L3 + G1/G2 19 个默认 ui 原语 + G3 alert-dialog 按需 + per-page Page/Content/Skeleton"
docs/architecture/07-dashboard-security-csp-and-xss.md  §11 L3 sanitizer 引用 MessageText 不变,
                                                   但 e2e 选择器需要更新（侧边栏结构变了)
README.md                                          截图可能要换新（OG image 不动）
```

### 5.5 source-copy provenance（`_UPSTREAM.md` 实施规则）

本次重构会从 surety 复制 ui 原语 + Gen 2 layout 三件套；basalt 是历史 source-copy。`apps/dashboard/src/_UPSTREAM.md` 当前只跟踪 basalt 来源（`source_commit bbd99c122ccfc7a3572a16bf8fe5cab37c1822d1`，本机 basalt HEAD 已是 `67d2945...`）。**Stage A 必须把 `_UPSTREAM.md` 扩成 basalt + surety 双来源**：

**Stage A1 子步骤（除依赖锁定外）**：
- `apps/dashboard/src/_UPSTREAM.md` 顶部新增 **"## surety provenance"** 段（与现有 basalt 段并列），字段：
  - `source_repo`：`local: ~/workspace/personal/surety`
  - `source_commit`：本 commit 落地时实测的 surety HEAD `git -C ~/workspace/personal/surety rev-parse HEAD`
  - `copied_at`：本 commit 日期（UTC ISO 8601 date）
  - `copy_method`：`manual cp (per-file; not directory vendor)`
  - `license`：依据 `surety/LICENSE` 实测填写
  - `allowed_modifications`：仅允许 `cn()` import 别名调整、`@/lib/utils` → `meowth utils` 路径替换、空文件移除；不允许业务逻辑改动
- basalt 段 `source_commit` 本 commit **不刷新**（保持 `bbd99c12...`）；basalt refresh 由独立 commit `chore(dashboard): refresh basalt source-copy to <commit>` 处理，**不在本 Phase 范围**

**Stage A3 / A4 每个新 copy 文件落 commit 时同步登记**：在 `_UPSTREAM.md` 的 surety 段下，按文件路径登记 `surety/apps/web/src/components/ui/<name>.tsx` → `apps/dashboard/src/components/ui/<name>.tsx` 一行。A3 一次写 8 行，A4 一次写 11 行。

**约束**：
- 任何 Stage 内的"copy from surety" 行为必须同步更新 `_UPSTREAM.md`，否则 commit 不能通过 review。
- `_UPSTREAM.md` 不在本轮 doc-only 修订范围；它由 Stage A1/A3/A4 实施 commit 触动。

## 6. 原子提交序列

> **实施状态（2026-06-25）**：Stage A / B / C 已完成实施。C7 / C8 SKIPPED — Playwright 14/14 全程通过证明无 stale selector 累积；跨页 fixture 抽取 / coverage 整理在 C1-C6 期间已逐 commit 完成，无需独立 commit。架构细节最终落地形态已同步到 [`docs/architecture/06`](../architecture/06-dashboard-mvvm-and-basalt.md) §2 / §4 / §5.1 / §6.4 / §7。Stage C 累计 commits：
>
> - C1 `00946d9` Overview split + introduce StatCard
> - C2 `8075c26` Agents split (no fake stats)
> - C3a `5c2c225` SessionsListPage split (plain G2 Table)
> - C3b `1393aa5` SessionDetailPage split
> - C4 `9d61440` TokensPage split + TokensCreateDialog extraction
> - C5 `c8145e9` SettingsPage split + Notice for healthz
> - C6 `fdcc8ee` SetupPage ErrorBanner/footnote → Notice (styling-only)
>
> 闭环 gate：dashboard 75 files / 438 tests; Playwright 3 projects × 14/14; `dashboard:cover:check` `ok=55 baseline_floors=3 structural_exempt=10`. 3 个剩余 baseline 都在 `lib/ansi.ts` / `viewmodels/useSessionDetailViewModel.ts` / `viewmodels/useTokensViewModel.ts`,均明确出 Stage C 范围。

**分 4 大阶段、共 ~18 个原子 commit（A 4 + B 4 + C 8 + D 2）**。每段独立可 review/回滚;后段不依赖前段未落地的代码。

**commit subject 约定**：所有 commit subject **不含** `A1` / `B2` / `C3a` 等本 doc 内部序号；只用标准前缀（`feat(dashboard):` / `chore(deps):` / `refactor(dashboard):` / `test(dashboard):` / `docs(arch):` 等）+ 简短描述。内部序号仅作 doc 跟踪用，便于 review 时定位本表对应行。

### Stage A — 基础设施（4 commit）

| # | Commit | 内容 | 测试 |
|---|---|---|---|
| A1 | `chore(deps): lock radix-ui@1.6.0 aggregate; migrate dialog import` | `apps/dashboard/package.json`：加 `"radix-ui": "1.6.0"`，删 `"@radix-ui/react-dialog": "1.1.17"`；rewrite `components/ui/dialog.tsx` 的 import 为 `from "radix-ui"`（与 surety 同款）；`pnpm install` 同步 lockfile。**不引 vaul**（surety Sheet 用 radix-ui Dialog；详 §5.2）。 | install 通过 + `pnpm dashboard:g1` 全绿 + `pnpm dashboard:cover:check` 不下降 + `pnpm scan:g2` osv 无新增 advisory |
| A2 | `feat(dashboard): add Basalt B05 missing radius + semantic colors + avatar palette` | `index.css` 新增 `--radius-island: 20px`（保留现有 `--radius-card: 14px` / `--radius-widget: 10px`）；补 warning / info / purple / teal 4 个 semantic colors；补 16-slot avatar palette；补 semantic text tokens | L1 vitest 全绿；`palette.test` 扩展 1 case 覆盖新 semantic colors |
| A3 | `feat(dashboard): copy 8 Gen 2 layout ui primitives from surety (G1 set)` | `components/ui/` 复制 G1 全部 8 个：tooltip / sheet / avatar / collapsible / separator / badge / skeleton / empty-state（详 §3.4 G1 表）。**只改 import 路径与 cn() 别名，不写业务代码**。 | 每个 ui 文件加最小 L1 vitest 烟雾测试（渲染 + base 类断言）+ `pnpm dashboard:cover:check` 通过 |
| A4 | `feat(dashboard): copy 11 page-migration ui primitives from surety (G2 set)` | `components/ui/` 复制 G2 全部 11 个：table / dropdown-menu / select / label / notice / section-divider / switch / textarea / toggle / toggle-group / sort-header（详 §3.4 G2 表）。同 A3 不写业务代码。G3 alert-dialog **不**进本 commit。 | 同 A3 |

### Stage B — Gen 2 layout（4 commit）

| # | Commit | 内容 | 测试 |
|---|---|---|---|
| B1 | `feat(dashboard): add Gen 2 layout — app-shell + sidebar + sidebar-context` | `components/layout/` 三件套 + breadcrumbs + site-footer;`lib/navigation.ts` + `lib/version.ts`;**App.tsx 切换为 AppShell**;删 DashboardLayout/AppSidebar | RTL 测试:折叠 toggle / mobile sheet 开关 / 当前路由高亮 |
| B2 | `feat(dashboard): wire sidebar to actual routes + logo-192 + version pill` | nav data + APP_VERSION pill + 折叠态 logo-24,展开态 logo-24+文字+pill | E2E embed:截图断言 sidebar 渲染（非业务） |
| B3 | `refactor(dashboard): replace business <Card> usage with bg-secondary rounded-card` | 改 page 里所有 `<Card>` / 局部 Card 函数 / `<div class="border ...">` 包装为 `bg-secondary rounded-card p-4`（**只改样式,不动逻辑**）。**保留** `components/ui/card.tsx` 文件本身。 | 现有 L1/L3 测试需更新选择器（如有按 class 名查的） |
| B4 | `chore(dashboard): drop ui/card.tsx and update _UPSTREAM.md` | 前置：`grep -r "from.*['\"]@?.*ui/card['\"]" apps/dashboard/src` 输出空（B3 已清除全部业务 import）。删 `components/ui/card.tsx`，同步 `_UPSTREAM.md` basalt 段中 card 的登记行。 | G1 + L1 + L3 全绿；`pnpm dashboard:depcruise` 不报 orphan |

### Stage C — MVVM 三段式（8 commit,**每页一个 commit，每个 commit 自带测试**）

每个 page 拆为 `Page + Content + Skeleton` 三文件。**每个 C* commit 自带对应 Content / Skeleton / page-regression L1 测试，不后置**。C8 只做跨页一致性补漏 / 覆盖率整理 / e2e selector 统一更新，不作为 missing tests 的兜底。

| # | Commit | 内容 | 测试（commit 内必须包含） |
|---|---|---|---|
| C1 | `refactor(dashboard): split Overview into Page/Content/Skeleton` | Overview 三件套 + `components/StatCard.tsx` 引入 | `OverviewContent.test.tsx`（props 注入）+ `OverviewSkeleton.test.tsx`（渲染断言）+ `OverviewPage.test.tsx`（三态分支） |
| C2 | `refactor(dashboard): split Agents into Page/Content/Skeleton` | Agents 三件套，用 StatCard + EmptyState | `AgentsContent.test.tsx` + `AgentsSkeleton.test.tsx` + `AgentsPage.test.tsx` |
| C3a | `refactor(dashboard): split SessionsListPage into Page/Content/Skeleton (plain G2 Table semantics)` | SessionsList 三件套，使用 G2 table; **实际落地**：不引入 `sort-header`（无 vm 排序状态支持，避免假交互），plain G2 table only — 详 [06](../architecture/06-dashboard-mvvm-and-basalt.md) §6.4 #3 | `SessionsListContent.test.tsx` + `SessionsListSkeleton.test.tsx` + `SessionsListPage.test.tsx` |
| C3b | `refactor(dashboard): split SessionDetailPage into Page/Content/Skeleton` | SessionDetail 三件套，复用 MessageText 安全渲染 | `SessionDetailContent.test.tsx` + `SessionDetailSkeleton.test.tsx` + `SessionDetailPage.test.tsx` |
| C4 | `refactor(dashboard): split TokensPage into Page/Content/Skeleton + extract CreateDialog` | Tokens 三件套 + 提取 `TokensCreateDialog`；create 是非破坏性流程，**不**引入 G3 alert-dialog；plaintext lifecycle boundary 测试 | `TokensContent.test.tsx` + `TokensSkeleton.test.tsx` + `TokensPage.test.tsx` + `TokensCreateDialog.test.tsx` |
| C5 | `refactor(dashboard): split SettingsPage into Page/Content/Skeleton + Notice for healthz` | Settings 三件套（**实际落地有 Skeleton**：daemon 行 placeholder）；**不**引入 `Switch`（无 user-toggleable 状态）；healthz 三态 → Notice variant 映射 | `SettingsContent.test.tsx` + `SettingsSkeleton.test.tsx` + `SettingsPage.test.tsx` |
| C6 | `style(dashboard): replace SetupPage ErrorBanner and disabled-mint footnote with semantic Notice` | Setup 表单页只动样式，**不拆 Page/Content**（pre-login 单 form 壳） | `SetupPage.test.tsx` + `SetupPage.mintDisabled.test.tsx` |
| C7 | SKIPPED | Playwright 14/14 全程通过证明无 stale e2e selector 累积 — 详 §6 顶部 banner | n/a |
| C8 | SKIPPED | 跨 page 共用 fixture 抽取与 coverage 整理在 C1–C6 各 commit 内已完成；剩余 3 个 baseline (`lib/ansi.ts` / `useSessionDetailViewModel.ts` / `useTokensViewModel.ts`) 明确出 Stage C 范围 | n/a |

### Stage D — 文档与发布（2 commit）

| # | Commit | 内容 |
|---|---|---|
| D1 | `docs(arch): rewrite 06 §4 for Gen 2 + L0..L3 + per-page 4 files` | 06 文档 §4 整段重写 |
| D2 | `chore(release): bump to 0.3.0 + CHANGELOG` | minor 升级（因为 ui 结构破坏性变更） |

**总计 ~18 个 commit**（A 4 + B 4 + C 8 + D 2），但**每个 commit 都自带测试且全绿**。哥可以在任何 Stage 边界停下来,代码不会处于半残态。

## 7. 6DQ 质量计划

**阶段边界（A/B/C/D 每段结束时）跑完整 gate 矩阵；commit 内可按风险跑 focused subset**。不允许 plan 写"不需重测"——L2 / scan 等可低频，但每个 Stage 边界必须验证。

| 层 | 命令 | 通过条件 |
|---|---|---|
| **G1 静态** | `pnpm dashboard:g1` | 全绿(fmt + lint + tsc + depcruise + source scan) |
| **L1 单元 + 覆盖率 ratchet** | `pnpm dashboard:test:cover && pnpm dashboard:cover:check` | 覆盖率不回归（baseline floor 不能下降）；新增 per-page Content + Skeleton 单测；每个 ui 原语至少 1 个烟雾测；`scripts/check-dashboard-coverage.sh` 严格态通过 |
| **L2 API（daemon-side smoke）** | `pnpm test:l2` + `pnpm test:l2:embed` | 阶段边界跑；daemon 行为不变本次不应红，但必须验证 |
| **L3 e2e — 三 project 全跑** | `pnpm --filter @meowth/dashboard exec playwright test --project=dashboard-dev --project=dashboard-embed --project=dashboard-embed-mint` | 全绿；**含 dashboard-dev（不能只跑 embed）**；sidebar / header / setup / mint / exec 等选择器随 stage 同步更新 |
| **G2 安全** | `pnpm scan:g2` | radix-ui@1.6.0 + 新增 ui 复制不引入新 osv advisory；gitleaks `--redact --no-banner`；govulncheck 全绿 |
| **D1 prod/test 隔离** | `pnpm scan:d1` | 测试 fixture 不漏入生产路径（与 token 注入 / fake backend 隔离一致） |
| **shared types no-drift** | `pnpm --filter @meowth/shared generate-types` 后 `git diff` 空 | OpenAPI 派生类型不被本次重构污染 |
| **daemon embed smoke** | `GOOS=darwin GOARCH=arm64 pnpm daemon:build && GOOS=darwin GOARCH=amd64 pnpm daemon:build` | 内嵌 dashboard dist 编进 daemon，两 arch 都构建通过 |
| **CI** | github actions | 10/10 全绿 |

### 7.1 e2e spec 预审计（Stage C 落地前必看）

`apps/dashboard/e2e/` 当前 9 个 spec（2 dev + 6 embed + 1 embed-mint）分布如下；列在这里便于 review 时定位每个 Stage C commit 的更新面：

| spec 文件 | project | 触动来源 | 大致更新面 |
|---|---|---|---|
| `e2e/dev/auth-redirect.spec.ts` | dashboard-dev | Stage B AuthGate / AppShell 改造 | redirect 路径选择器（如有按 layout class 名查的） |
| `e2e/dev/setup.spec.ts` | dashboard-dev | Stage B + Stage C6 Setup 样式 | input label / button role / `getByRole('navigation')` |
| `e2e/embed/setup.spec.ts` | dashboard-embed | Stage B + Stage C6 Setup 样式 | input label / button role 选择器 |
| `e2e/embed/headers.spec.ts` | dashboard-embed | 无（CSP / nosniff 不变） | 不动 |
| `e2e/embed/xss.spec.ts` | dashboard-embed | C3b SessionDetail 渲染管道 | session-messages testid 保持，但 layout 包裹层变化 |
| `e2e/embed/secret-reveal.spec.ts` | dashboard-embed | C4 Tokens 拆分 + role=alert plaintext 检查 | dialog role+name / `secret-reveal-value` testid 保持 |
| `e2e/embed/tokens.spec.ts` | dashboard-embed | C4 Tokens 拆分 + table | 表格 cell 选择器从 ul 改为 table role |
| `e2e/embed/exec-and-session.spec.ts` | dashboard-embed | C3b + happy.jsonl 不变 | session detail layout 包裹层变化 |
| `e2e/embed-mint/mint.spec.ts` | dashboard-embed-mint | Stage B + Setup mint mode | overview heading role+name |

**约束**：尽量使用 `getByRole / getByLabel / getByTestId`，避免按 class 名查；任何受影响 spec 的最小修法在对应 C* commit 中**同 commit** 更新，不堆积到 C7。

### 7.2 已知会破坏的现有测试

| 文件 | 原因 | 修法 |
|---|---|---|
| `apps/dashboard/src/components/AppSidebar.test.tsx` | 整个组件被替换 | Stage B1 删除 |
| `apps/dashboard/src/components/DashboardLayout.test.tsx` | 整个组件被替换 | Stage B1 删除,补 `layout/app-shell.test.tsx` |
| `apps/dashboard/src/components/AuthGate.test.tsx` | 401 跳转 fixture 可能受 AppShell 影响 | B1 验证是否受影响；如选择器变更需同 commit 修 |
| `apps/dashboard/src/components/SecretReveal.test.tsx` | TokensPage 拆分后 import 路径可能变 | C4 同 commit 修 import |
| `apps/dashboard/src/components/MessageText.test.tsx` | SessionDetail 拆分后 import 路径可能变 | C3b 同 commit 修 import |
| `apps/dashboard/e2e/embed/*.spec.ts` 等 | DOM 选择器（class、role）可能变 | 详 §7.1 预审计，按表逐 commit 更新 |

### 7.3 Sheet 可访问性测试要求（Stage B1 强制）

Stage B1 引入 Sheet drawer（mobile sidebar）时，**必须**覆盖以下行为：

- route change closes drawer（导航后 drawer 自动 close，避免在新页保持遮罩）
- body scroll unlock（drawer close 后 `document.body` overflow 恢复）
- dialog `aria-title` + `aria-description`（屏幕阅读器可识别）
- escape key + overlay click close（两条 close 路径都生效）
- focus return to toggle button（drawer close 后焦点回到打开按钮）

测试位置：`apps/dashboard/src/components/layout/sheet.test.tsx` 或 `app-shell.test.tsx` 内 Sheet 段。

### 7.4 不打算做的事（明确范围）

- **不引入** Recharts/charts —— Meowth dashboard 当前没有图表需求（监控类页面后续再做）
- **不做** mobile 完整布局适配（surety 是 mobile-first,Meowth 是本机 dashboard,主要桌面浏览器使用） —— 但 sidebar 的 Sheet 还是要做,因为 B-2 要求,不做会拖后续
- **不做** Command Palette（Cmd+K） —— surety 有,但 Meowth 6 个页面用不到,留到 v0.4
- **不引入** i18n —— Meowth 单用户,英文 + 必要中文混合即可
- **不改** dashboard 与 daemon 的 HTTP API 契约 —— 这次是纯前端重构

## 8. 风险与回滚

| 风险 | 概率 | 缓解 |
|---|---|---|
| L3 e2e 选择器集体失败 | 高 | C 阶段每个 page commit 单独跑 Playwright（含 dashboard-dev），失败立即 fix 不堆积；§7.1 预审计已列出每个 spec 触动来源 |
| 覆盖率回归 | 低 | 每个 C* commit 自带 Content/Skeleton/page-regression L1 测试；C8 只做跨页补漏；`pnpm dashboard:cover:check` 严格 baseline floor ratchet 拦截 |
| radix 1.6.0 与 React 19 peer 警告 | 低 | surety 已用 radix-ui@1.6.0 + react 19.2 无 peer error；install 前 `pnpm install --frozen-lockfile` 验证，warning 允许，error 才拦 |
| 视觉 regression 没人手 review | 中 | D 阶段 release 前手动 `dashboard:dev` + `daemon serve` 各跑一遍，截图存档到 `docs/features/02-screenshots/`（不入仓） |
| 18 commit 中间阶段在 main 上半残 | 低 | 每个 commit 独立全绿，半残不会进 main |
| `_UPSTREAM.md` provenance 漂移 | 中 | Stage A1 建立双来源块，A3/A4 每个 copy 同步登记；review 时 grep `_UPSTREAM.md` 行数与新增 ui 文件数一致 |

回滚策略:`git revert` 单个 commit;Stage 边界**仅在本地打 lightweight tag** 作为 revert 定位锚（如 `stage-A-end` / `stage-B-end`），**不 push 到 origin**。本地 tag 仅供 SDE 自己回退使用，与远端版本管理无关。

## 9. 验证结果

> 落地完成后填。每个 Stage 边界勾选下表对应行（A end / B end / C end / D end）。

| 检查项 | A end | B end | C end | D end |
|---|---|---|---|---|
| `pnpm dashboard:g1` | ☐ | ☐ | ☐ | ☐ |
| `pnpm dashboard:test:cover && pnpm dashboard:cover:check` | ☐ | ☐ | ☐ | ☐ |
| `pnpm test:l2 && pnpm test:l2:embed` | ☐ | ☐ | ☐ | ☐ |
| Playwright `dashboard-dev` | ☐ | ☐ | ☐ | ☐ |
| Playwright `dashboard-embed` | ☐ | ☐ | ☐ | ☐ |
| Playwright `dashboard-embed-mint` | ☐ | ☐ | ☐ | ☐ |
| `pnpm scan:g2` | ☐ | ☐ | ☐ | ☐ |
| `pnpm scan:d1` | ☐ | ☐ | ☐ | ☐ |
| `pnpm --filter @meowth/shared generate-types` no-drift | ☐ | ☐ | ☐ | ☐ |
| `GOOS=darwin GOARCH={arm64,amd64} pnpm daemon:build` | ☐ | ☐ | ☐ | ☐ |
| 视觉 review（dev + embed dashboard 截图存档） | ☐ | ☐ | ☐ | ☐ |
| CI 全绿 | ☐ | ☐ | ☐ | ☐ |

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
