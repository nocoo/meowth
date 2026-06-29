# 03 · Dashboard · Chat 模块（与 online agent 多轮对话）

> 状态：设计稿，未实施。
> 历史在 `git log -- docs/features/03-dashboard-chat-with-online-agent.md`
> 配套：[`architecture/02`](../architecture/02-daemon-http-protocol.md)（NDJSON envelope）、[`architecture/06`](../architecture/06-dashboard-mvvm-and-basalt.md)（MVVM 三段式 + AppShell）、[`architecture/01`](../architecture/01-agent-sdk-pump-from-multica.md)（5 个 backend 的协议差异）。

---

## 1. 背景

dashboard 当前能列出 agent / session，但**用户无法在 dashboard 里直接跟 agent 对话**。要试 agent，必须开终端跑 `curl POST /v1/agents/{type}/exec` 或 backend CLI 本身。这违反 §1 项目定位「我对本机一切 coding agent 的统一控制台」的承诺——「控制台」必须能发起对话，不只是观察。

本次新增 Chat 模块：

- 在 dashboard 选一个**已安装的 backend**（`/v1/agents` 返回 `installed: true` 的那几个）
- 输入框发消息 → daemon 流式回传 envelope → UI 实时渲染
- **多轮**：同一个 Chat 会话内的后续消息复用 backend 的 conversation context（通过 `resume_session_id` 透传，详 §3.3）
- V1 不持久化：刷新页面 = 新会话；历史可以去 Sessions 页（每轮都进 daemon 的 `sessions` 表）查回放

---

## 2. 非目标

明确不做，避免范围蔓延：

- ❌ **持久化 chat 历史**（V1 仅活在内存）。理由：daemon 的 sessions / messages 表已经把每轮完整保留，dashboard 再造一套 conversation 表是重复存储；要回放走 Sessions 详情
- ❌ **跨 backend 共享 conversation**（每个 backend 的 session id 语义不同，详 §3.3 兼容性表）
- ❌ **同一个 Chat 并发多 turn**（用户必须等上一轮 `session_ended` 才能发下一句；UI 强制串行）
- ❌ **取消单条消息**（V1 用 daemon 的 `POST /v1/sessions/{id}/cancel`，取消当前流；不做 "撤回某条 user message" UI）
- ❌ **WebSocket / SSE**（坚持复用 NDJSON 流，daemon 零改动）
- ❌ **跨 Chat 的全局 unread 计数**（V1 一次只能开一个 Chat 实例，无 unread 概念）
- ❌ **markdown / 代码高亮**（沿用现有 `MessageText.tsx` 的 ANSI → React node 转换，保持安全；rich markdown 留到独立 feature）

---

## 3. 协议规范

### 3.1 端点复用清单（daemon 零改动）

| 用途 | HTTP | 复用现有 |
|---|---|---|
| 列出可选 agent | `GET /v1/agents` | ✅ [`02 §6.1`](../architecture/02-daemon-http-protocol.md) |
| 发送一句话（new turn） | `POST /v1/agents/{type}/exec` | ✅ [`02 §4`](../architecture/02-daemon-http-protocol.md) |
| 取消当前在跑的一轮 | `POST /v1/sessions/{id}/cancel` | ✅ [`02 §7`](../architecture/02-daemon-http-protocol.md) |
| 回放历史（Sessions 详情） | `GET /v1/sessions/{id}/messages` | ✅ [`02 §6.4`](../architecture/02-daemon-http-protocol.md) |

**本次 feature 不引入任何新端点**。所有"多轮"语义靠在 client 侧串联 `resume_session_id`。

### 3.2 一轮对话的请求体

每次用户按发送，dashboard 构造：

```jsonc
POST /v1/agents/{type}/exec
Authorization: Bearer <token>
Content-Type: application/json

{
  "prompt": "<用户这一句>",
  "resume_session_id": "<上一轮的 backend_session_id；首轮缺省>",
  "timeout_ms": 600000,                  // 10 min；超时由 daemon 关流
  "semantic_inactivity_timeout_ms": 60000 // 60 s 无 message → 关流
}
```

字段映射到 [`ExecRequest`](../architecture/02-daemon-http-protocol.md#42-request-body)（02 §4.2 既有 schema，本次不动）。

**禁止字段（client 侧硬性不发）**：
- `cwd`：Chat 不要 hostside 文件系统语义，避免 backend 在用户没意识到的工作目录里写文件。daemon 默认 cwd 是 daemon 自身工作目录（多半 `~/.meowth`），Chat 不接管。
- `custom_args`：开放透传 CLI 参数 ≈ 用户层 RCE 风险，Chat 不暴露。
- `mcp_config` / `system_prompt` / `thread_name` / `max_turns` / `thinking_level`：V1 全部不发，留默认；要调这些去用 SDK 直连。

### 3.3 多轮：`resume_session_id` 透传策略

daemon 的 5 个 backend **全部消费** `ExecOptions.ResumeSessionID`，但各自的语义不同，dashboard 必须按 backend 决定从哪个字段取下一轮的 id：

| backend | 取 id 字段 | 注 | 代码引用 |
|---|---|---|---|
| `claude` | `session_ended.payload.backend_session_id` | claude CLI 的 conversation id，`--resume <id>` 续 | `daemon/pkg/agent/claude.go:594` |
| `copilot` | `session_ended.payload.backend_session_id` | copilot CLI 的 thread id，`--resume <id>` 续 | `daemon/pkg/agent/copilot.go:450` |
| `codex` | `session_ended.payload.backend_session_id` | codex JSON-RPC 的 thread id | `daemon/pkg/agent/codex.go:936` |
| `hermes` | `session_ended.payload.backend_session_id` | ACP sessionId；若已失效 daemon 自动新建（透明，不报错） | `daemon/pkg/agent/hermes.go:235` |
| `pi` | `session_ended.payload.backend_session_id` | **是文件路径**，daemon 抽象为同字段；client 不需要知道 | `daemon/pkg/agent/pi.go:190` |

**统一规则**：dashboard 永远从 `session_ended.payload.backend_session_id`（[`02 §5.5`](../architecture/02-daemon-http-protocol.md#55-typesession_ended)）取 id，下一轮放进 `resume_session_id`。**不要从 `session_started.payload.backend_session_id` 取**——首轮该字段可能为空字符串，后续 `message.kind=status` event 才会填上；以 `session_ended` 那一轮的最终值为准（02 §5.2 已明确 daemon 把最终值写回）。

**id 失效路径**：
- hermes 的 ACP session 可能因为 backend 进程重启而失效。daemon `hermes.go:302/353` 已经做了 `isACPSessionNotFound` → 静默新建。client 看到的 `session_ended.backend_session_id` 是新建后的 id，自动续上。
- pi 的"id 是文件路径"语义：用户清理 `~/.meowth/...` 会导致下一轮 404。这个失败模式 V1 不在 UI 兜底，按 `session_ended.status=failed` 一刀切处理（详 §4.3）。

### 3.4 流式响应（沿用 02 §5 envelope）

`POST /v1/agents/{type}/exec` 返回 `application/x-ndjson`。Client 用现有 `models/envelope.ts:decodeChunk()` 解码——本次 feature **不**新增 envelope 类型，**不**动 schema。

```
session_started ─┬─> message (kind=status, kind=text, kind=tool-use, ...)
                 ├─> usage  (token 用量累计快照)
                 ├─> heartbeat (15s 无消息时 daemon 注入)
                 └─> session_ended (status=completed | failed | aborted | timeout | cancelled)
```

`session_ended` 永远是最后一行；之后 daemon close stream。Client 收到它 → 把 `backend_session_id` 暂存（§3.3）→ 解锁输入框允许下一轮。

### 3.5 取消当前流（用户中途想停）

两条都允许，行为相同：

1. **HTTP 取消**：`POST /v1/sessions/{id}/cancel`（[`02 §7`](../architecture/02-daemon-http-protocol.md)，id 来自当前流的 `session_started.session_id`，注意这是 daemon 视角的 session id，不是 backend_session_id）。
2. **断 TCP**：client 主动 `AbortController.abort()` 当前 `fetch`。daemon 通过 `Request.Context().Done()` 察觉断开 → 取消 backend → 写 `session_ended.status=cancelled` 到 SQLite（[`02 §4.4`](../architecture/02-daemon-http-protocol.md#44-客户端断流语义)）。

V1 Chat 用方案 2（断 TCP），原因：(1) 不需要先等 `session_started` 拿 daemon session_id 才能取消；(2) 少一次 HTTP；(3) 即使取消后 daemon 仍把状态写库，Sessions 详情可见。

---

## 4. 功能入口

### 4.1 导航

- 新增侧边栏一级入口：**Chat**（图标 `MessageSquare`，lucide-react）
- 位置：`Dashboard` 分组内，排在 **Agents** 之后 / **Sessions** 之前
- 路由：`/chat`
- 移动端 sheet drawer 同样可达
- 修改 `apps/dashboard/src/lib/navigation.ts:NAV_GROUPS`

### 4.2 路由

新增 `routes/index.tsx`：

```
{ path: 'chat', element: <ChatPage /> }
```

只一个路由——V1 没有 `/chat/:id`，所有 Chat 状态都在 `useChatViewModel` 内存里（§5.4）。

### 4.3 页面结构（MVVM 三段式，遵循 [`06 §6.1`](../architecture/06-dashboard-mvvm-and-basalt.md)）

```
pages/Chat/
├── ChatPage.tsx           Page 壳：useChatViewModel + RefreshRegistration（后者把 "新会话" 函数注册成全局 refresh，让 header 刷新按钮重置 Chat）
├── ChatContent.tsx        业务渲染主体（agent 选择器 + 消息列表 + 输入框）
├── ChatSkeleton.tsx       初次拉 /v1/agents 时的骨架
├── AgentPicker.tsx        子组件：基于 fetchAgents() 结果的下拉
├── MessageList.tsx        子组件：渲染 ChatTurn[]
├── MessageBubble.tsx      子组件：渲染单条 envelope（按 type 分发，详 §5）
└── ChatComposer.tsx       子组件：输入框 + 发送按钮 + 取消按钮
```

骨架对照 surety 的 [`06 §7.x`](../architecture/06-dashboard-mvvm-and-basalt.md) 既有页面，命名一致。

### 4.4 三态

| 状态 | 显示 |
|---|---|
| `/v1/agents` 加载中 | `<ChatSkeleton />`（agent picker + composer 都灰） |
| `/v1/agents` 失败 | `<EmptyState tone=error>`（沿用 Overview 模式） |
| `/v1/agents` 返回 0 个 installed | `<EmptyState>`，文案「没有可用的 agent，请安装至少一个 CLI（详 Agents 页）」 |
| 正常 | AgentPicker（首位 installed 默认选中）+ 空消息列表 + composer enabled |
| 正在流 | composer 输入禁用，发送按钮换成 "Cancel"；list 末尾出现 streaming 气泡 + cursor |
| 流结束 | composer 解锁；末尾气泡定型 |

---

## 5. 消息类型解析

dashboard 把 NDJSON envelope **不丢一条**地落到 `ChatTurn[]`，但 UI 渲染按 envelope.type + payload.kind 分发：

### 5.1 类型分发表

| `envelope.type` | `payload.kind`（仅 type=message 时） | 是否渲染 | UI 处理 |
|---|---|---|---|
| `session_started` | — | ❌ 不直接渲染 | 仅记录 `session_id`、初始化 turn 容器 |
| `message` | `text` | ✅ | 流式追加到 assistant 气泡正文（多个 text 块合并为一条流） |
| `message` | `thinking` | ✅ 可折叠 | 默认折叠的「思考过程」分组（仅 claude / codex 会发） |
| `message` | `tool-use` | ✅ | 紧凑卡片：`tool` 名 + 输入预览（最多 200 字符，超长截断） |
| `message` | `tool-result` | ✅ | 同上卡片的反面：`output` 预览（同截断规则） |
| `message` | `status` | ❌ 不直接渲染 | 仅用于刷新 `backend_session_id` 缓存（§3.3） |
| `message` | `error` | ✅ | 红色 inline 提示（backend 视角的应用错误，详 [`02 §5.6`](../architecture/02-daemon-http-protocol.md)） |
| `message` | `log` | ✅ 可折叠 | 默认折叠的灰色 log 行 |
| `usage` | — | ✅ | 浮动徽章显示在当前 turn 角落：`12.4k in / 3.1k out` |
| `heartbeat` | — | ❌ 永远不渲染 | 仅刷新 UI 内的「last seen」时戳；缺省 15 s 没有任何 envelope 就提示「连接保持中」 |
| `error`（daemon 协议错误） | — | ✅ | 黄色 inline 警告：`code` + `title`（这是 daemon 自己的非终结错误，[`02 §5.6`](../architecture/02-daemon-http-protocol.md)）。区别于 `message.kind=error`（红色） |
| `session_ended` | — | ✅ status 行 | 灰色 footer：`✓ completed in 4.2s` / `✗ failed: <error>` / `⊘ cancelled`；并把 `backend_session_id` 落到下一轮的 `resume_session_id` |

### 5.2 安全渲染（强制走现有 sanitizer）

所有展示给用户的字符串字段（`message.content`、`tool-result.output`、`error.title/detail`、`tool-use.input` 序列化预览）**必须**通过：

1. `apps/dashboard/src/components/MessageText.tsx` 的 ANSI → React node 转换器（已存在，[`07 §4`](../architecture/07-dashboard-security-csp-and-xss.md)）
2. 不允许任何分支直接 `dangerouslySetInnerHTML`（biome 规则 `noDangerouslySetInnerHtml=error` 由 [`07 §3.15`](../architecture/07-dashboard-security-csp-and-xss.md) 锁死）

`tool-use.input` 是任意 JSON 对象，先 `JSON.stringify` 再喂 MessageText；不允许直接 render object。

### 5.3 字段裁剪与字符上限

| 字段 | client 渲染上限 | 超出处理 |
|---|---|---|
| `message.content` (kind=text) 单 envelope | 8 KiB | 截断 + 末尾 `…(truncated, view in Sessions detail)` 链接，跳到 `/sessions/<id>` |
| `tool-use.input` JSON 字面 | 200 字符 | 同上链接 |
| `tool-result.output` | 4 KiB | 同上链接 |
| 单 Chat turn 累计渲染 envelope 数 | 1000 | 超出后停止追加，顶部提示 banner |

V1 上限是 hard cap，不做虚拟滚动；超大会话请去 Sessions 详情看全量。

### 5.4 ViewModel 数据结构

```ts
// apps/dashboard/src/viewmodels/useChatViewModel.ts

export interface ChatTurn {
  // daemon-side session id (from session_started.session_id)
  // — used for cancel + Sessions detail deep link
  sessionId: string;
  // backend-side conversation id (from session_ended.backend_session_id)
  // — populated only after session_ended; used as next turn's
  // resume_session_id
  backendSessionId: string | null;
  // user input that started this turn
  userPrompt: string;
  // every envelope in arrival order, unfiltered
  envelopes: Envelope[];
  // final status; null while still streaming
  status: 'streaming' | 'completed' | 'failed' | 'cancelled' | 'timeout' | 'aborted';
  startedAt: string;
  endedAt: string | null;
}

export interface ChatViewModel {
  agents: readonly Agent[];           // from /v1/agents
  selectedAgent: AgentType;           // user-controlled
  setSelectedAgent(t: AgentType): void;
  turns: readonly ChatTurn[];         // append-only within session
  resumeSessionId: string | null;     // tracked across turns (= last turn's backendSessionId)
  composer: {
    input: string;
    setInput(v: string): void;
    canSend: boolean;                 // !streaming && input.trim() !== ''
    submit(): void;                   // start a new turn
    cancel(): void;                   // abort current stream (only when streaming)
  };
  reset(): void;                      // clear turns + resumeSessionId; agents stay
  refresh(): void;                    // re-pull /v1/agents (for header refresh button)
}
```

切换 `selectedAgent`：清空 `turns` 和 `resumeSessionId`（不同 backend 的 conversation 不可迁移；切 backend ≈ 新会话）。

### 5.5 失败模式

| 触发 | client 行为 |
|---|---|
| `POST /v1/agents/{type}/exec` 401 | 整层走现有 `AuthGate` 重定向到 `/setup` |
| 404 unknown_backend | agent picker 把该 backend 标灰；composer 拒绝；提示「该 backend 已不可用，请重选」（理论上不该发生，UI 一律基于 `/v1/agents` 当前快照） |
| 503 backend_unavailable | 同上灰显 |
| stream 中途 daemon 断开 | 当前 turn `status='aborted'`，envelope 列表保留已收到的；composer 解锁，允许重发 |
| stream 中收到非法 JSON 行 | `decodeChunk` 已经丢掉非法行；client 不显示，envelope 序号会跳号（正常） |
| 1 MiB 单行超限 | daemon 会发 `error code=message_truncated` envelope（[`02 §5.8`](../architecture/02-daemon-http-protocol.md)），按 §5.1 黄色警告渲染 |

---

## 6. 6DQ 质量计划

| 层 | 覆盖 |
|---|---|
| **L1** | `useChatViewModel` 单测：(a) 首轮 submit 构造的 ExecRequest 不含 `resume_session_id`；(b) 第二轮 submit 携带上一轮 `session_ended.backend_session_id`；(c) 切换 backend 重置 turns + resumeSessionId；(d) cancel() 在非 streaming 状态下是 no-op；(e) envelope 分发器对每个 type/kind 都有 case；(f) 截断字符上限边界（§5.3） |
| **L1** | `ChatPage` / `ChatContent` / `AgentPicker` / `MessageBubble` / `ChatComposer` RTL 测试：三态分支、AgentPicker 仅列 installed=true、composer 在 streaming 时禁用、cancel 按钮可见性、消息按类型渲染正确 |
| **L2** | 新增 `scripts/run-chat-l2.ts`：拉起真实 daemon + fake backend factory（`MEOWTH_BACKEND_FACTORY=fake`），发两轮，断言第二轮的 ExecRequest 携带正确 resume_session_id（通过 testbackend 录制） |
| **L3** | `playwright/chat.spec.ts`：选 claude → 发 "say hi" → 看到流式 text → 看到 session_ended 行 → 发第二句 → 确认请求体含 resume_session_id |
| **G1** | tsc strict + biome（已有；新文件天然受约束） |
| **G2** | 无新依赖；osv-scanner / gitleaks 跑现有套即可 |
| **D1** | L2/L3 走 `~/.meowth-test/` 隔离；fake backend 不动真 CLI |

---

## 7. 原子化提交计划

每一步独立可编译、可测试、可回滚。**先文档、再 harness、再实现**（CLAUDE.md 工作规程）。

| # | Commit | 内容 |
|---|---|---|
| 1 | `docs(features): add 03 chat-with-online-agent` | 本文档 + features/README 索引 |
| 2 | `feat(dashboard): models/chat — ChatTurn / ChatViewModel types` | 纯类型 + helper 函数（构造 ExecRequest、从 envelope 流派生状态）；L1 完全覆盖 |
| 3 | `feat(dashboard): useChatViewModel` | VM 实现 + L1 单测（覆盖 §6 L1 全部用例） |
| 4 | `feat(dashboard): AgentPicker / ChatComposer / MessageBubble` | 子组件 + 单测 |
| 5 | `feat(dashboard): ChatPage + ChatContent + ChatSkeleton` | Page 壳 + RTL 三态测试 |
| 6 | `feat(dashboard): wire /chat route + Chat nav item` | `routes/index.tsx` + `lib/navigation.ts`；现有 navigation 单测验证新项落点 |
| 7 | `test(dashboard,l2): run-chat-l2.ts fake-backend two-turn` | L2 harness：发两轮，verify resume_session_id 传透 |
| 8 | `test(dashboard,e2e): playwright chat happy path` | L3 spec |

每个 commit 自带必要测试 + hooks 全绿 + 不留 TODO。

---

## 8. 未决问题

| # | 问题 | 暂定 | 决策方 |
|---|---|---|---|
| 1 | 切 backend 是否提示「会清空当前 Chat」？V1 直接清，不提示 | 直接清，简单优先 | 哥 |
| 2 | hermes 的 ACP session 失效后 daemon 静默新建，client 是否需要 UI 提示？ | V1 不提示，按"对话自动续上"处理 | 哥 |
| 3 | `cwd` 是否要给一个安全的 sandbox 路径（如 `~/.meowth/chat-workspace/`）？V1 不传，沿用 daemon 默认 | V1 不传 | 哥 |
| 4 | V2 是否引入 localStorage 持久化？需要解决 secret-free 与多 Chat 切换 | 留待 V2 单独 feature | — |
| 5 | 是否要在 Sessions 详情页加 "Continue in Chat" 按钮（带 `resume_session_id` 进 /chat）？这是反向入口 | V2 考虑 | — |

---

## 9. 相关文档

- [`docs/01-project-overview.md`](../01-project-overview.md) §1 / §2 / §7.6
- [`docs/architecture/01-agent-sdk-pump-from-multica.md`](../architecture/01-agent-sdk-pump-from-multica.md) — 5 backend SDK / `ResumeSessionID` 字段
- [`docs/architecture/02-daemon-http-protocol.md`](../architecture/02-daemon-http-protocol.md) §4 / §5 / §7 — exec + envelope + cancel
- [`docs/architecture/06-dashboard-mvvm-and-basalt.md`](../architecture/06-dashboard-mvvm-and-basalt.md) §6.1 / §7 — MVVM 分层 + 页面骨架
- [`docs/architecture/07-dashboard-security-csp-and-xss.md`](../architecture/07-dashboard-security-csp-and-xss.md) §3 / §4 — sanitizer + CSP（Chat 消息渲染必经）
- [`CLAUDE.md`](../../CLAUDE.md) — 文档驱动 + 原子化提交规程
