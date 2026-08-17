# 04 · Dashboard 控件与页面视觉对齐 pew / zhe

> 状态：已落地（2026-08-17）；Codex review 迭代中
> 历史在 `git log -- docs/features/04-dashboard-control-alignment.md`
> 配套：[docs/architecture/06](../architecture/06-dashboard-mvvm-and-basalt.md)（MVVM / Gen 2 壳保持不动）
> 参考源：`~/workspace/personal/zhe`（`nocoo/zhe`，本机 clone）、`~/workspace/personal/pew`、`~/workspace/personal/gecko`、`~/workspace/personal/surety`

---

## 1. 背景

Phase 2（[`02`](./02-dashboard-redesign-to-basalt-gen2.md)）把 AppShell / Sidebar / 四层亮度 / Page+Content+Skeleton 切齐了。控件层和页面内容没有跟上：

- `Button` / `Input` / `Dialog` 仍是旧 shadcn（`bg-background`、`ring-offset-2`、无 `xs` / `asChild`）
- Tokens 创建弹层、Setup 表单、Revoke、SecretReveal 全部手写 `<button>` / `<input>`
- `Badge` / `Label` / `Dialog` / `Input` 页面零引用
- 各页 `space-y-2|3|4` 不齐；Agents `yes/no`、Sessions status 裸文本
- Session detail / Settings 没有 L2 卡

zhe `docs/22-design-tokens.md` 把密度和表面写成了硬契约。pew 把 Dialog / Confirm / L2 卡配方写死。本次把这两套抄进 meowth，再逐页换掉手写控件。

**不改**：HTTP 契约、viewmodel 状态机、MVVM 边界、AppShell 浮岛 class（测试锁 `.rounded-island.bg-card`）。

## 2. 参考源与抄什么

| 源 | 抄 | 不抄 |
|---|---|---|
| **zhe** `components/ui/{button,input,card,page-header,label}.tsx` + `docs/22-design-tokens.md` | 密度档（default h-10 / sm h-9 / xs h-8）、Input `bg-secondary` + `ring-[3px] ring-ring/50`、Card=`bg-secondary rounded-card`（无边无影）、PageHeader | Next.js 路径、`@radix-ui/react-*` 分包（meowth 用 `radix-ui` 命名空间） |
| **pew** `confirm-dialog.tsx` + 全站 Dialog 配方 | Overlay `bg-black/60`、Content `rounded-xl bg-card p-6 shadow-lg`、关闭钮 `h-8 w-8`、ConfirmDialog + `useConfirm` | pew 业务页里的裸 `<button>` 回潮、三层亮度改写 meowth 已有四层 token |
| **gecko** Input 表面 | `border-border hover:border-foreground/20 bg-secondary` | `rounded-2xl` 混用、硬编码 zinc overlay |
| **surety** | 已落地的 Badge / Notice / EmptyState / Table / Sheet 保持 | 再 vendor 一遍已有原语 |

meowth 已有 `--radius-island: 20px`、semantic text token、16 色 avatar。token 文件不重写，只让页面真正用上。

## 3. 控件契约（落地后唯一口径）

摘自 zhe `docs/22-design-tokens.md`，路径改成 meowth。

### 3.1 表面

| 层 | class | 用途 |
|---|---|---|
| L0 | `bg-background` | 窗外、Sidebar |
| L1 | `bg-card` / `rounded-island` | AppShell 岛、Dialog 面板 |
| L2 | `bg-secondary rounded-card` | 表壳、StatCard、设置卡、空态 |
| L3 | `bg-secondary border-border shadow-xs` | Button outline / Input / Select |

禁止在 L2 卡上再画 `border` / `shadow`。

### 3.2 密度

| 档 | 高度 | Button | Input | 何时 |
|---|---|---|---|---|
| default | 40px | `size="default"` | `size="default"` | 表单主按钮、Dialog 主操作 |
| form small | 36px | `size="sm"` | — | 表单次要（Cancel） |
| toolbar | 32px | `size="xs"` / `icon-sm` | `size="sm"` | PageHeader、行内 Revoke |

禁止 call site 再写 `h-8` / `px-3 py-2` / `rounded border`。

### 3.3 Dialog

pew 配方（替换当前 `bg-background` + slide）：

- Overlay: `fixed inset-0 z-50 bg-black/60` + fade
- Content: `rounded-xl bg-card p-6 shadow-lg` + fade/zoom，**无 slide、无 border 当主轮廓**
- Close: `absolute right-4 top-4 flex h-8 w-8 … rounded-md text-muted-foreground hover:bg-accent`

### 3.4 新增原语

| 文件 | 来源 | 用途 |
|---|---|---|
| `components/ui/card.tsx` | zhe | L2 表面，替代散落的 `div.rounded-card.bg-secondary` |
| `components/ui/page-header.tsx` | zhe | 每页 `h2` + 可选 description + actions；保留 `headingId` 给 `aria-labelledby` |
| `components/ui/confirm-dialog.tsx` | pew | Tokens Revoke 等破坏性确认 |

`from "radix-ui"` 命名空间不变。zhe 的 `Slot` 在 meowth 写成 `Slot.Root`。

## 4. 逐页改动

现有测试锁（heading 文案、`role=dialog name="Create token"`、`getByLabelText('Name')`、`role=alert`、`.rounded-card.bg-secondary` 包 table、`data-testid`、Agents `"yes"`/`"no"` 文本）必须保住。Badge 包住 `yes`/`no`，不改 cell 文本。

| 页 | 改什么 |
|---|---|
| 全页 | `PageHeader` 替换手写 `h2`；section `space-y-6` |
| Overview | PageHeader；StatCard 加 icon；Daemon 用 Badge |
| Agents | Installed 列 Badge（文本仍 yes/no）；表壳改 `<Card>` |
| Sessions list | Status Badge；表壳 `<Card>` |
| Session detail | 上卡 metadata + Badge；下卡消息列表；保留 `session-detail-id` / `session-messages` / ISO 原文 |
| Tokens | Create = `Button`；弹层迁 `Dialog`+`Input`+`Label`+`Notice`；Revoke = `Button xs` + ConfirmDialog |
| Settings | PageHeader；L2 Card 包 build 行 + Notice |
| Setup | `Input` / `Label` / `Button`；卡保持 `rounded-card bg-secondary` |
| Chat | PageHeader；外层去嵌套 `<main>`；composer `Button size=default`；气泡用 L2 `bg-secondary` 而不是叠在 L1 `bg-card` 上 |
| SecretReveal | Reveal / Copy 改 `Button` |

## 5. 代码引用

- 现有粗糙点：`apps/dashboard/src/pages/Tokens/TokensCreateDialog.tsx`、`pages/Setup/SetupPage.tsx`、`pages/Tokens/TokensContent.tsx`、`pages/Sessions/SessionDetailContent.tsx`
- 原语：`apps/dashboard/src/components/ui/{button,input,dialog,textarea,label,badge}.tsx`
- 参考：`zhe/components/ui/{button,input,card,page-header}.tsx`、`zhe/docs/22-design-tokens.md`、`pew/packages/web/src/components/ui/confirm-dialog.tsx`
- 测试锁清单见本次审计（各 `*Content.test.tsx` / `*Page.test.tsx` / `TokensCreateDialog.test.tsx` / e2e `setup.spec.ts` `chat.spec.ts`）

## 6. 原子化提交计划

| # | Commit | 内容 |
|---|---|---|
| 1 | `docs: plan dashboard control alignment` | 本文档 + README 索引 |
| 2 | `feat(dashboard): align button density to zhe` | button.tsx + L1 |
| 3 | `feat(dashboard): align input density to zhe` | input.tsx + L1 |
| 4 | `feat(dashboard): polish dialog to pew recipe` | dialog.tsx + L1 |
| 5 | `feat(dashboard): add card and page-header` | card / page-header + L1 |
| 6 | `feat(dashboard): add pew confirm-dialog` | confirm-dialog + L1 |
| 7 | `feat(dashboard): wire tokens create to dialog` | TokensCreateDialog + TokensPage + SecretReveal |
| 8 | `feat(dashboard): confirm token revoke` | TokensContent + ConfirmDialog |
| 9 | `feat(dashboard): polish setup form controls` | SetupPage |
| 10 | `feat(dashboard): unify page headers and badges` | Overview / Agents / Sessions list / Chat / Settings headers + Badge |
| 11 | `feat(dashboard): lift settings and session onto l2` | Settings / Session detail 卡 |
| 12 | `feat(dashboard): restyle chat bubbles off l1` | Chat 气泡 / 去嵌套 main |

每步 commit 后 `pnpm --filter @meowth/dashboard test:run` 必须绿。

## 7. 6DQ

| 维 | 落点 |
|---|---|
| **L1** | 新原语各一份 smoke（size/variant/role）；页面测试同步选择器，不放宽 heading / dialog name / data-testid |
| **L2** | 无 HTTP 变更；不跑 `test:l2` |
| **L3** | 现有 Playwright（setup → Overview、chat combobox/Send）必须仍绿 |
| **G1** | `pnpm dashboard:g1`（biome + tsc + depcruise）。pages 只许 import `components/ui/*` + viewmodels，不许 import models |
| **G2** | 不新增 npm 包；沿用 `radix-ui` |
| **D1** | 不涉及 SQLite |

**SKIPPED**：浏览器手点（本会话无 browser MCP）；zhe 的 Command / ContextMenu / Slider / Sonner（meowth 无对应 call site）。
