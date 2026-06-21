# Architecture · 02 · Daemon HTTP protocol

> **更新规则**：本文档定义 `meowthd` 对外的 HTTP wire contract。
> 任何端点新增、字段重命名、event envelope 改字段、错误码扩展，必须先回到这里更新，再向下推进。
> 历史在 `git log -- docs/architecture/02-daemon-http-protocol.md`。

> 上层依据：[`docs/01-project-overview.md`](../01-project-overview.md) §7.3、§9.2 Phase 3.6–3.12。
> 本文档**不涉及**：
> - Agent SDK / backend vendor / 5 backend 原生协议（→ [`01-agent-sdk-pump-from-multica.md`](01-agent-sdk-pump-from-multica.md)）
> - Token 表 / argon2id 参数 / hash 比对实现（→ `03-sqlite-schema-and-tokens.md`，本文档只写 wire schema）
> - `/bootstrap/mint` 详细契约（→ `04-bootstrap-and-first-run-mint.md`；本文档只把它列为非 v1 特例端点）
> - bind 地址、远程访问 mode、`0.0.0.0` 禁令（→ `05-remote-access-modes.md`；本文档假设 daemon 已被合法 bind）
> - CSP / 安全 header / DOMPurify / Biome XSS 规则（→ `07-dashboard-security-csp-and-xss.md`；本文档只写 middleware chain 位置）
> - 6DQ hook、CI、husky（→ `08-6dq-hooks-wiring.md`）

---

## 1. 范围

本文档管：

- v1 路由清单与每条路由的 request / response schema
- 流式响应的 NDJSON envelope schema、终止与心跳
- Cancel 协议（HTTP 侧与 daemon 内部）
- 错误响应统一格式（problem+json）
- HTTP middleware chain 顺序与每个中间件的职责边界
- daemon shutdown 时活跃 session 的 HTTP 可观察终态
- `packages/shared` 类型的来源：从 schema 单一真相源生成

本文档不管：

- bearer auth 算法、constant-time compare 实现（仅注明在 middleware chain 中的位置，详 → 03 / Phase 3.6）
- token hash / salt / argon2id 参数（详 → 03）
- bootstrap nonce / one-shot / lockout（详 → 04）
- backend stream-json / JSON-RPC / ACP 协议（详 → 01）
- backend `Execute` 内部如何把原生事件归一化（详 → 01）

---

## 2. 设计原则

1. **单一资源 wire**：所有正式资源走 `/v1/<resource>`。免认证路径仅 `/healthz`、静态资源、`/bootstrap/*`（后者详 → 04）。
2. **Bearer-only**：v1 端点强制 `Authorization: Bearer <token>`；不接受 query string token、cookie、basic auth。
3. **JSON-only**：v1 request/response 均 `application/json; charset=utf-8`，除流式端点（`application/x-ndjson`）和静态资源。
4. **同源生产，零 CORS**：dashboard 在生产由 daemon `embed.FS` 同源提供（[`docs/01-project-overview.md`](../01-project-overview.md) §7.5）；daemon **生产不开 CORS**，没有 `Access-Control-Allow-Origin` 响应。开发期 dashboard 跑 Vite dev server (`5173`)，所有 `/v1/*` 与 `/healthz` 由 **Vite proxy** 同源转发到 `127.0.0.1:7777`，daemon 端**默认不接收跨源请求**。仅当显式以 `--dev` 标志（或环境变量等价物）启动时 daemon 才挂载一个 CORS 中间件用于直连联调，默认关闭、生产构建中不存在此分支。
5. **错误统一为 RFC 7807**：所有 ≥ 400 响应返回 `application/problem+json`（§10）。
6. **流式统一为 NDJSON**：一行一 JSON object，UTF-8、以 `\n` (0x0A) 分隔、末尾 `\n`；HTTP chunked transfer。客户端不应假设单 chunk = 单 event。
7. **版本前缀稳定**：v1 字段一旦发布只能添加非必填字段，不能改语义或删字段。破坏性改动开 `/v2/`，与 v1 并存若干 release。
8. **Schema 单一真相源**：见 §11。

---

## 3. v1 端点清单

下表是规范摘要，§4–§8 展开每条端点。

| Method | Path | Auth | Body | Resp content-type | 摘要 |
|--------|------|------|------|------------------|------|
| POST | `/v1/agents/{type}/exec` | Bearer | JSON | `application/x-ndjson` | 启动一次 agent run，流式回放 envelope event |
| GET  | `/v1/agents` | Bearer | — | `application/json` | 列出 5 个白名单 backend 的安装与版本探测 |
| GET  | `/v1/sessions` | Bearer | — | `application/json` | 列出活跃 + 近期 session |
| GET  | `/v1/sessions/{id}` | Bearer | — | `application/json` | 单 session 元数据（不含消息） |
| GET  | `/v1/sessions/{id}/messages` | Bearer | — | `application/json` 或 `application/x-ndjson` | snapshot / tail follow，由 query 参数决定（§6.4） |
| POST | `/v1/sessions/{id}/cancel` | Bearer | 空 | `application/json` | 取消活跃 session；幂等 |
| GET  | `/v1/tokens` | Bearer | — | `application/json` | 列 token 元数据；**永不含 secret** |
| POST | `/v1/tokens` | Bearer | JSON | `application/json` | 创建 token；**secret 仅此一次响应**（§8.2） |
| DELETE | `/v1/tokens/{id}` | Bearer | — | `application/json` | 撤销 token（设 `revoked_at`，不物理删；详 → 03） |
| GET  | `/healthz` | — | — | `application/json` | 探活；免认证 |

非 v1 特例端点（**契约不在本文档**）：

- `POST /bootstrap/mint`：仅在路径 B（init `--skip-token`）下挂载；mode-gated + loopback-only + one-shot + lockout。完整契约以 [`04-bootstrap-and-first-run-mint.md`](04-bootstrap-and-first-run-mint.md) 为准。本文档承诺：该端点**不**走 v1 bearer middleware、**不**纳入 §11 OpenAPI 公共契约、**不**在 dashboard 客户端的 `/v1/*` 类型枚举中出现。

静态资源（dashboard `embed.FS`）：

- `GET /` 与子路径返回 dashboard HTML/JS/CSS；MIME 由 Go 标准 `mime.TypeByExtension` 决定；**不**走 bearer middleware；安全 header 详 → 07。

---

## 4. `POST /v1/agents/{type}/exec` — 启动 agent run

### 4.1 路径参数

| 参数 | 取值 | 说明 |
|------|------|------|
| `type` | `claude` / `copilot` / `codex` / `hermes` / `pi` | 必须在 `agent.SupportedTypes`（[`01`](01-agent-sdk-pump-from-multica.md) §4 裁剪后白名单） |

未在白名单 → `404 problem+json type=unknown_backend`。

### 4.2 Request body

```json
{
  "prompt": "string, required, 1..16384 chars",
  "cwd": "string, optional, absolute path",
  "model": "string, optional",
  "system_prompt": "string, optional",
  "thread_name": "string, optional",
  "max_turns": 0,
  "timeout_ms": 0,
  "semantic_inactivity_timeout_ms": 0,
  "resume_session_id": "string, optional",
  "custom_args": ["string", "..."],
  "mcp_config": { "...": "any JSON" },
  "thinking_level": "string, optional"
}
```

**映射到 `agent.ExecOptions`**（[`01`](01-agent-sdk-pump-from-multica.md) §2 锚定的接口，pkg/agent vendored verbatim）：

| Wire 字段 | `ExecOptions` 字段 | 备注 |
|----------|--------------------|------|
| `cwd` | `Cwd` | |
| `model` | `Model` | |
| `system_prompt` | `SystemPrompt` | hermes ACP 故意忽略（上游既有行为） |
| `thread_name` | `ThreadName` | |
| `max_turns` | `MaxTurns` | 0 = 不设上限 |
| `timeout_ms` | `Timeout` (`time.Duration`) | wire 用 ms 整数，daemon 转 `time.Duration` |
| `semantic_inactivity_timeout_ms` | `SemanticInactivityTimeout` | 同上 |
| `resume_session_id` | `ResumeSessionID` | |
| `custom_args` | `CustomArgs` | 用户 per-run CLI 参数 |
| `mcp_config` | `McpConfig` (`json.RawMessage`) | 透传 |
| `thinking_level` | `ThinkingLevel` | 仅 claude / codex / opencode 消费；本仓库裁剪后只剩 claude / codex 实际生效 |

**`ExecOptions.ExtraArgs` 不在 wire**：上游接口注释明确 `ExtraArgs` 是 *daemon-wide default CLI arguments*；这是 daemon 配置语义，不是 per-request 用户参数。daemon 从本机 `config.toml` 读取（详 → 05 / 03 配置加载），不接受 HTTP 客户端传入。如果客户端需要追加 CLI 参数，使用 `custom_args`（per-run 用户可控范围）。

未列字段一律 400 problem+json `type=invalid_request`。

### 4.3 Response

**Content-Type**: `application/x-ndjson`。HTTP chunked，每行一个 envelope event（§5）。daemon 在第一行 envelope 之前**不**返回任何 header 以外的字节。

**HTTP status**:

- `200` — 已成功启动 backend、stream 开始
- `400` — request body 校验失败
- `401` — bearer 缺失/非法
- `404` — `type` 不在白名单
- `409` — `resume_session_id` 指向的 session 已终结或不存在
- `503` — backend 二进制不可用（`exec.LookPath` 失败；与 `/v1/agents` 探测结果一致）
- `500` — daemon 内部错误（不应正常发生；详 §10）

204 / 304 / 3xx 永不出现在此端点。

### 4.4 客户端断流语义

客户端**主动断 TCP** = 隐式 cancel。daemon 通过 ctx 监听断开（`Request.Context().Done()`）→ 取消 backend → 把 session 的终态写入 SQLite（详 → 03）。

---

## 5. NDJSON event envelope

### 5.1 信封字段

每行一个 JSON object。字段顺序无要求，但必须可独立解析（不依赖前后行上下文）。

```json
{
  "v": 1,
  "seq": 0,
  "ts": "RFC 3339 timestamp",
  "session_id": "uuid v7",
  "type": "session_started | message | usage | error | session_ended | heartbeat",
  "payload": { "...": "type-specific" }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `v` | int | yes | Envelope schema 版本；当前固定 `1` |
| `seq` | int | yes | 单 session 内单调递增，从 `0` 开始 |
| `ts` | string | yes | RFC 3339 / ISO 8601 UTC（带 `Z`） |
| `session_id` | string | yes | UUID v7（daemon 生成，独立于上游 backend 内部 session id） |
| `type` | string | yes | 见 §5.2–§5.6 |
| `payload` | object | yes | 根据 `type` 取值不同 |

`seq` 是 **daemon 视角的事件序号**，与 backend 内部 message 顺序一致；客户端可据此去重或断点续读（结合 §6.4 `after_seq`）。

### 5.2 `type=session_started`

```json
{ "type": "session_started",
  "payload": {
    "backend_type": "claude|copilot|codex|hermes|pi",
    "backend_session_id": "string, may be empty initially",
    "started_at": "RFC 3339"
  }
}
```

`backend_session_id` 可能在最初空字符串，由后续 `agent.Message.SessionID`（[`01`](01-agent-sdk-pump-from-multica.md) §2 锚定的 `Message` 结构）填入；daemon 会把首次非空值写回 SQLite，但**不**重新发 `session_started`（用 `message` event 携带）。

### 5.3 `type=message`

封装 `agent.Message`（vendored 上游结构，daemon 不重新解码 backend 原生协议）。

```json
{ "type": "message",
  "payload": {
    "kind": "text | thinking | tool-use | tool-result | status | error | log",
    "content": "string",
    "tool": "string",
    "call_id": "string",
    "input": { "...": "any JSON" },
    "output": "string",
    "status": "string",
    "level": "string",
    "backend_session_id": "string"
  }
}
```

字段一一对应 `agent.Message`（[`01`](01-agent-sdk-pump-from-multica.md) §2 锚定）：

| Wire `payload` 字段 | `agent.Message` 字段 | 何时出现 |
|--------------------|---------------------|----------|
| `kind` | `Type`（`MessageType`） | 总是 |
| `content` | `Content` | `text / error / log` |
| `tool` | `Tool` | `tool-use / tool-result` |
| `call_id` | `CallID` | `tool-use / tool-result` |
| `input` | `Input` | `tool-use` |
| `output` | `Output` | `tool-result` |
| `status` | `Status` | `status` |
| `level` | `Level` | `log` |
| `backend_session_id` | `SessionID` | `status`（resume 锚点） |

5 个 backend 原生协议（stream-json / JSONL / JSON-RPC / ACP / pi 行格式）的解析归一化由 agent SDK 完成；daemon 只把 `Message` 转 JSON、加 envelope 字段、写一行。**daemon 不再次解析上游协议**。

### 5.4 `type=usage`

```json
{ "type": "usage",
  "payload": {
    "models": {
      "<model-name>": {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0
      }
    }
  }
}
```

**语义**：`models` map 是**当前累计快照**（每个数值都是 session 起至今的累计值，单位 token）。客户端按 model 名 **replace / upsert**，**不**累加；同一 model 后续 `usage` event 替换前值。理由：`agent.Result.Usage` 即为最终累计；若中段也是 delta，客户端累加会 double count。daemon 端如未来发现某 backend 只发 delta，由 daemon 在 SDK 与 wire 之间转换为累计快照，wire 语义不变。

`usage` event 在 backend 中段没有信号时（如 copilot）可完全跳过；客户端不应假设每个 session 都有中段 `usage` event。`session_ended.usage` 是该 session 的最终快照。

### 5.5 `type=session_ended`

```json
{ "type": "session_ended",
  "payload": {
    "status": "completed | failed | aborted | timeout | cancelled",
    "output_chars": 0,
    "error": "string",
    "duration_ms": 0,
    "backend_session_id": "string",
    "usage": { "<model>": { "input_tokens": 0, "...": 0 } }
  }
}
```

字段对应 `agent.Result`。`output_chars` 是 `len(Result.Output)`；daemon **不**把 `Result.Output` 整段塞进信封，避免长文本撑大单行。`Result.Output` 通过 §6.4 `messages` 端点的拼接拿到（agent 实际发的 `text` message 累加），或从 SQLite 拉。

`session_ended` 是该 session 的**最后一行**；之后立刻 close response stream。

### 5.6 `type=error`

```json
{ "type": "error",
  "payload": {
    "code": "string, problem+json type slug",
    "title": "string, short summary",
    "detail": "string, optional long description",
    "retryable": true
  }
}
```

**与 `message.kind=error` 的边界（不重叠）**：

- 上游 backend 报告的错误（`agent.Message.Type=MessageError`，详 [`01`](01-agent-sdk-pump-from-multica.md) §2）**一律**走 `type=message, payload.kind=error`（§5.3），即"backend 视角的应用层错误"。
- `type=error` 只用于 **daemon wire 层非终结性错误**（不来自上游 backend），例如：
  - `code=message_truncated`（§5.8 单行 1 MiB 截断）
  - `code=follow_backlog_read_error`（snapshot/follow 模式下拉历史 envelope 失败但 stream 仍可继续）
  - 其它由 daemon 自身产生、stream 可继续的错误
- **终结性错误**永远走 `session_ended.status=failed` + `error` 字段，并 close stream；不在 `type=error` 中表达。

`type=error` 因此与 `type=message kind=error` 互斥来源，客户端可据此分别染色（应用错误 vs 协议错误）。

### 5.7 `type=heartbeat`

```json
{ "type": "heartbeat",
  "payload": { "since_last_message_ms": 0 }
}
```

当上游 backend 静默超过 `15s` 时，daemon 每 `15s` 注入一次 `heartbeat`，避免上游反代（caddy / cloudflare tunnel）对 idle 长连接的默认切断。

**heartbeat 是完整 envelope，占 `seq` 并落库**：与其它 event 一样写入 SQLite messages 表、参与 `after_seq` 续读、可被 `/v1/sessions/{id}/messages` snapshot/follow 重放。客户端可在 UI 层忽略 `heartbeat` 显示（query `?types=message,session_ended` 也能在服务端过滤掉），但**不能**假设 `seq` 在 heartbeat 处跳号。心跳由 daemon 生成、不来自上游 `agent.Message`。

### 5.8 Envelope 编码规则

- 每行 strict UTF-8 JSON；**不允许** BOM
- 行末仅 `\n` (0x0A)，不允许 `\r\n`
- 单行不允许内嵌换行（即使在 string 字面量里也以 `
` 转义）；客户端按 `\n` 安全切分
- 每行长度上限 `1 MiB`；单条 message 超长 → daemon 把 `content` 截断到 `1 MiB - 4 KiB`，并在该 message 后立刻发一个 `type=error code=message_truncated` 事件
- 末尾 sentinel：`session_ended` 是最后一行；daemon 之后不再写字节、close 写半边

---

## 6. Session endpoints

### 6.1 `GET /v1/agents`

```json
{
  "agents": [
    { "type": "claude",  "installed": true,  "executable": "/usr/local/bin/claude", "version": "1.2.3" },
    { "type": "copilot", "installed": false, "executable": "",                     "version": "" },
    { "type": "codex",   "installed": true,  "executable": "/opt/homebrew/bin/codex","version": "0.9.0" },
    { "type": "hermes",  "installed": true,  "executable": "/usr/local/bin/hermes", "version": "0.4.1" },
    { "type": "pi",      "installed": false, "executable": "",                     "version": "" }
  ]
}
```

`installed` = `exec.LookPath` 成功；`version` 由 agent SDK 的 `version.go` 探测（[`01`](01-agent-sdk-pump-from-multica.md) §4.1 #5），失败时空字符串。结果**不缓存**（首版）；dashboard 上自行节流。

### 6.2 `GET /v1/sessions`

```json
{
  "sessions": [
    {
      "id": "uuid v7",
      "backend_type": "claude",
      "backend_session_id": "string",
      "status": "running | completed | failed | aborted | timeout | cancelled",
      "started_at": "RFC 3339",
      "ended_at": "RFC 3339 or null",
      "thread_name": "string, may be empty",
      "model": "string, may be empty"
    }
  ]
}
```

Query 参数：

| 参数 | 默认 | 说明 |
|------|------|------|
| `status` | (all) | 单值或 CSV 过滤，例如 `status=running` 或 `status=completed,failed` |
| `limit` | `50` | 1..200 |
| `before` | (none) | RFC 3339；只返回 `started_at < before` |

排序固定 `started_at DESC`，无 cursor 翻页（v1 不暴露分页 cursor；如有需要后续在向后兼容下补 `next_before`）。

### 6.3 `GET /v1/sessions/{id}`

返回 `sessions` 数组中的单条对象（§6.2 同 schema）。

未找到 → `404 problem+json type=session_not_found`。

### 6.4 `GET /v1/sessions/{id}/messages` — **明确语义**

两种模式由 `follow` query 参数显式区分（不依赖 Accept header）：

| Mode | Query | Content-Type | 行为 |
|------|-------|-------------|------|
| **Snapshot** | `follow=false`（默认） | `application/json` | 返回 session 当前已落库的全部 envelope event（数组），按 `seq` 升序；session 未结束也可调用，只返回当前已写入的部分 |
| **Tail follow** | `follow=true` | `application/x-ndjson` | 从 `after_seq`（默认 -1）开始，**推送既有 + 后续**所有 envelope event；session 已结束则推完 backlog 后 `session_ended` 收尾并 close；session 仍 active 则保持流开放直到结束或客户端断开 |

Query 参数：

| 参数 | 默认 | 模式 | 说明 |
|------|------|------|------|
| `follow` | `false` | both | `true` → tail follow；`false` → snapshot |
| `after_seq` | `-1` | both | 仅返回 `seq > after_seq` 的事件；客户端断线重连时用最后看到的 `seq` 续读 |
| `limit` | snapshot=`1000`；follow=无 | snapshot | snapshot 单次最多多少 event；follow 模式忽略 |
| `types` | (all) | both | CSV 过滤，例如 `types=message,session_ended` 跳过 heartbeat |

返回字段（snapshot）：

```json
{
  "session_id": "uuid v7",
  "events": [ { "v":1, "seq":0, ... } ],
  "next_after_seq": 999,
  "has_more": false
}
```

`has_more` = 还有 `seq > next_after_seq` 的事件（受 `limit` 截断）；客户端再次调用同 endpoint 用 `after_seq=<next_after_seq>` 继续读。

Tail follow 体格式与 §5 完全一致（NDJSON envelope），客户端复用 `/exec` 的解析器。

**对 SQLite messages schema 的约束**（细节 → 03）：messages 表的主键必须支持按 `(session_id, seq)` 范围扫描；event payload 整体存储（不拆字段），以保证日后 envelope 字段扩展无需 migration。

### 6.5 `POST /v1/sessions/{id}/cancel`

Request body：空。Response：

```json
{ "id": "uuid v7", "status": "cancelled | already_terminated" }
```

| 当前 status | Response status code | `status` 字段 |
|------------|---------------------|--------------|
| `running` | `202` | `"cancelled"` |
| 已是终态 (`completed/failed/aborted/timeout/cancelled`) | `200` | `"already_terminated"` |
| Session 不存在 | `404 problem+json type=session_not_found` | — |

**幂等性**：对同一 active session 连续 POST cancel，第二次起返回 `200 already_terminated`，不重复触发 backend cancel。

---

## 7. Cancel 协议（daemon 内部 wire）

daemon 内部不依赖 `pkg/agent.Session` 提供 `Close()` 方法——上游接口仅有 `Messages` / `Result` 两个 receive-only channel（[`01`](01-agent-sdk-pump-from-multica.md) §2 锚定）。Cancel 通过 `context.Context` 实现：

1. 每个 `/v1/agents/{type}/exec` 请求 daemon 用 `ctx, cancel := context.WithCancel(req.Context())` 派生子 context，传给 `Backend.Execute(ctx, prompt, opts)`。
2. 触发 cancel 的来源有三：
   - 客户端断 TCP（`req.Context().Done()` 触发）
   - `POST /v1/sessions/{id}/cancel`（daemon 查 session 表找到对应 cancel func 并调用）
   - daemon shutdown（§8）
3. `cancel()` → 上游 `Execute` 内部 ctx 取消 → 上游 backend `os/exec.Cmd` 终止子进程（[`01`](01-agent-sdk-pump-from-multica.md) §4.4 `proc_other.go` / `proc_windows.go` helper）。
4. daemon 从 `Result` channel 收到 `Status=cancelled` 的终态 → 写 SQLite → 写 `session_ended` envelope → close response stream。

**禁止**：daemon **不** 自创 `Session.Close()` wrapper、**不** 直接给 backend 子进程发 SIGTERM 绕开 ctx。Cancel 路径只通过 ctx。

`session` 内部状态机由 daemon 持有，**不**暴露在 wire；wire 只看 `status` 字符串和 `cancel` endpoint。

---

## 8. Daemon shutdown 与 HTTP 可观察终态

### 8.1 Shutdown 流程

daemon 收到 SIGTERM / SIGINT：

1. 立刻停止 listener accept 新 HTTP；返回 active connection
2. 对每个 active session 调用 cancel func（§7）；上游 backend 子进程终止
3. 等待所有 `Execute` 返回（受 daemon `shutdown_timeout_ms` 配置约束，默认 `5000ms`）
4. 把所有 active session 状态在 SQLite 中标记为 `aborted`（不是 `cancelled`，区别在于"daemon 主动停" vs "用户主动停"）
5. 写最后一条 envelope `session_ended status=aborted` 到 NDJSON stream（如客户端尚在）
6. 关闭 SQLite，退出

`shutdown_timeout_ms` 到期仍有未返回的 `Execute`：daemon 强制结束（`os.Exit(1)`），SQLite 已写入的 `aborted` 仍有效；客户端可能看到不完整的 stream（连接被切断），但下次重连 `GET /messages?follow=true&after_seq=<last>` 一定能看到 `session_ended status=aborted`。

### 8.2 重启后客户端可观察终态

重启 daemon → 所有上一进程的 session 已被标记为 `aborted`（§8.1 step 4）；`GET /v1/sessions` 返回这些 session 时 `status=aborted`、`ended_at` 非空。

**禁止**：daemon 重启**不**尝试恢复运行中的 backend 子进程；上游 backend 没有 "detached 模式 + 重接管 stdout" 的协议保证。session 的 `aborted` 是终态。

SQLite 表结构（active session 列、cancel func 持有位置、daemon 重启恢复列）属于 03 的职责；本节只规定 HTTP 客户端能观察到的状态字段值。

---

## 9. Token endpoints — wire schema

### 9.1 `POST /v1/tokens`

Request：

```json
{ "name": "string, 1..64 chars" }
```

Response `201`：

```json
{
  "id": "uuid v7",
  "name": "string",
  "prefix": "mwt_abc12",
  "secret": "mwt_<full-secret-string>",
  "created_at": "RFC 3339",
  "created_via": "dashboard | cli"
}
```

**铁律**：

- `secret` 字段**仅在此响应**出现一次；任何后续 GET 永不返回
- daemon 内部把 `secret` 立刻 argon2id 哈希后写入 SQLite（参数详 → 03），明文 secret 不入库、不入日志
- 创建成功后 dashboard 立刻把 `secret` 给用户复制（[`docs/01-project-overview.md`](../01-project-overview.md) §7.4 铁律）

### 9.2 `GET /v1/tokens`

Response：

```json
{
  "tokens": [
    {
      "id": "uuid v7",
      "name": "string",
      "prefix": "mwt_abc12",
      "created_at": "RFC 3339",
      "last_used_at": "RFC 3339 or null",
      "revoked_at": "RFC 3339 or null",
      "created_via": "init | first_run_mint | dashboard | cli"
    }
  ]
}
```

**永不**包含 `secret`、`token_hash`、`salt`、argon2id 参数。Wire 模型在编译期保证响应永不泄露 secret（详 → 03 / 实现约束）。

### 9.3 `DELETE /v1/tokens/{id}`

Response `200`：

```json
{ "id": "uuid v7", "revoked_at": "RFC 3339" }
```

撤销操作不物理删（设 `revoked_at`，便于审计；详 → 03）。

撤销当前正用的 token：本次请求仍按已校验通过的 token 完成 200 响应；之后该 token 立即失效（下次任意请求 401）。

未找到 → `404 problem+json type=token_not_found`。

---

## 10. 错误统一格式（RFC 7807 problem+json）

### 10.1 响应

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json; charset=utf-8

{
  "type": "/problems/invalid_request",
  "title": "Invalid request",
  "status": 400,
  "detail": "prompt must be 1..16384 chars",
  "instance": "/v1/agents/claude/exec"
}
```

字段：

| 字段 | 说明 |
|------|------|
| `type` | 稳定 URI（路径形式 `/problems/<slug>`，由 daemon 在 `GET /problems/<slug>` 下提供一个人类可读说明页面，**不**纳入 v1 bearer middleware；URI 用于客户端机器识别错误种类） |
| `title` | 短摘要；i18n 默认英文 |
| `status` | HTTP status，与响应 status 一致 |
| `detail` | 长描述；可含具体上下文（字段名、限制值） |
| `instance` | 请求 path（不含 query；不含 host） |

**为什么 `/problems/<slug>` 而不是 `meowth://errors/<slug>`**：自定义 URL scheme 对 tooling（curl、HTTPie、debug log viewer）不友好；用同源 `/problems/...` 路径既稳定又可在浏览器直接打开。客户端把 `type` 字段视为 opaque identifier，匹配 slug 即可，不必发起 GET。

### 10.2 错误码表

| `type` slug | HTTP status | 何时产生 |
|------------|------------|----------|
| `invalid_request` | 400 | request body / query 校验失败 |
| `unauthorized` | 401 | 缺 bearer、bearer 格式错、bearer 不存在或已 revoked |
| `unknown_backend` | 404 | path `{type}` 不在白名单 |
| `session_not_found` | 404 | `{id}` 不存在 |
| `token_not_found` | 404 | `{id}` 不存在 |
| `session_conflict` | 409 | `resume_session_id` 已终结/不存在 |
| `payload_too_large` | 413 | request body > `1 MiB` |
| `message_truncated` | — | 仅出现在 NDJSON `error` envelope；非 HTTP status |
| `backend_unavailable` | 503 | `exec.LookPath` 失败、agent 二进制缺失 |
| `internal` | 500 | 兜底；详情不暴露给客户端，写 daemon 日志 |

未列错误一律 `internal`，daemon 日志写堆栈。

### 10.3 401 不区分原因

`unauthorized` **不**区分 "token 不存在" / "token 已 revoked" / "token 错"；统一返回 401 + `type=unauthorized`，避免给攻击者枚举信号。

---

## 11. Schema 单一真相源

本文档（02）是**人类可读权威**，但**不是**类型生成源。

工作流：

1. 02 落定 schema 描述（字段名、类型、必填、enum）
2. 在 Phase 3.7（`feat(daemon): chi router + healthz + token CRUD`）创建 `daemon/internal/server/openapi.yaml` 作为机器可读权威。模型来源**只能是** 02：openapi.yaml 字段必须能从 02 表格一一映射。
3. `packages/shared/` 的 TS 类型由 `openapi.yaml` 通过 `openapi-typescript`（或同类工具）生成，**不**手写。生成产物 commit 进 git（不是 build-time generated），便于审查。
4. daemon 端 Go handler 通过 sqlc / json.Decoder 手实现（不引入 oapi-codegen，避免额外依赖）；以 02 + `openapi.yaml` 双重 review。
5. 02 与 `openapi.yaml` 不一致：以 02 为唯一权威，立刻修 openapi.yaml；L2 测试运行时如发现 daemon 行为与 `openapi.yaml` 不符即视为 bug。

`openapi.yaml` 的具体 schema 与 Phase 3.7 commit 一起落地；本文档不嵌入 openapi.yaml 原文，避免双写。生成 TS 类型的工具版本固定在 `pnpm-lock.yaml`。

---

## 12. Middleware chain

请求经过 daemon 的固定顺序（最外层在最上）：

```
1. request_id     # X-Request-Id header（缺则生成 uuid v7），写入 ctx；所有日志带它
2. access_log     # method/path/status/duration_ms/request_id；不记录 body
3. recover        # panic → 500 problem+json type=internal；写 daemon 日志带 stack
4. nosniff        # X-Content-Type-Options: nosniff（所有响应；详 07 §4.1 C）
5. body_limit     # 1 MiB（v1）；超 → 413 problem+json type=payload_too_large
6. cors (dev only)   # 仅在 --dev 启动时挂载；先于 bearer_auth；处理 OPTIONS preflight；生产构建禁用；详 §2.4
7. bearer_auth    # 仅 /v1/* 与 /v1/agents/{type}/exec；豁免 /healthz、/、静态、/bootstrap/*、/problems/*、OPTIONS preflight
8. router            # chi router；分发到具体 handler；HTML/static handler 自己在响应里挂 security_headers（详 07 §4.1 A/B）
```

每层职责：

- **bearer_auth**：从 `Authorization: Bearer ...` 取 token，按 prefix 查 SQLite，argon2id 验证（实现细节 → 03 / Phase 3.6）；非 `/v1/*` 路径直通；`OPTIONS` preflight 直通（避免 CORS preflight 因缺 bearer 被 401，使 CORS middleware 失效）；失败 → 401 problem+json `type=unauthorized`，**不**记录失败 token 字面值，access_log 只记 prefix（前 9 字符，`mwt_` + 5 base32）；常量时间比对（详 → 03）
- **cors (dev only)**：默认**不挂载**；`--dev` 下放行 `Origin: http://localhost:5173`，无白名单则拒；**必须位于 bearer_auth 之前**，以便浏览器 `OPTIONS /v1/...` preflight（不带 bearer）能拿到正确 CORS header；不写入响应 cache。**若 dev CORS 在工程层被认为多余**（实操中 dashboard dev 走 Vite proxy 同源转发已足够），可在 Phase 3.7 实施时直接不实现该 middleware，daemon 只依赖 Vite proxy；该决策记入 §15 未决问题。
- **nosniff**：全局 middleware，所有响应（含 401 / 413 / 404 / problem+json / dashboard HTML / static asset）注入 `X-Content-Type-Options: nosniff`；与 docs/architecture/07 §4.1 C 一致；详 → 07。
- **security_headers**：**不**作为 chi middleware 全局挂载；仅 dashboard HTML / SPA fallback handler 与静态 asset handler 自行调用 `secheaders.Document` / `secheaders.Asset` wrapper（07 §4.1 A/B + §4.2 / §4.3）。`/v1/*` / `/healthz` / `/bootstrap/*` 等 API/JSON 响应只带 `nosniff`，不带 CSP / COOP / CORP / Referrer-Policy / Permissions-Policy。

---

## 13. 测试落点

> 详 → 08；本节仅列 02 范围内的覆盖目标。

| 层 | 覆盖 | 不依赖真 CLI | 怎么覆盖 |
|----|------|-------------|---------|
| **L1** | envelope JSON 编解码、`agent.Message`/`Result` → envelope 映射、problem+json 序列化、路由 reverse、middleware chain 顺序 | 是 | Go `*_test.go` in `daemon/internal/server/...` |
| **L2** | 每个 v1 端点真 HTTP，使用 fake backend（实现 `Backend` 接口、stdout 喂预录事件） | 是 | `scripts/run-l2.ts` 起 daemon + 注入 fake backend → 调 endpoint → 断言 NDJSON / JSON / problem+json |
| **L3** | dashboard ↔ daemon ↔ fake backend 关键路径（创建 session、看消息、cancel、401/404 错误页） | 是 | Playwright spec |
| **OpenAPI 一致性** | daemon 实际响应字段 ⊆ `openapi.yaml` 声明字段；问题路径 `type` slug 与 §10.2 表完全一致 | 是 | L2 增量断言；CI 跑 |

**所有 02 测试不依赖真实 5 CLI**；CI 不安装 claude/copilot/codex/hermes/pi。真实 CLI smoke 仍 opt-in，详 → 01 §8 / 08。

---

## 14. 原子化提交计划（对应 §9.2 Phase 3.6–3.12）

| Commit | 对应 Phase 节点 | 内容 |
|--------|----------------|------|
| `feat(daemon): bearer auth middleware (constant-time compare)` | 3.6 | bearer_auth middleware；与 03 commit `feat(daemon): sqlite store with tokens schema (hash only)` 联动 |
| `feat(daemon): chi router + healthz + token CRUD` | 3.7 | router、§3 摘要表里的 `/healthz` 实现（200 + `{"ok":true}`，免认证）、§9 token CRUD wire、§11 `openapi.yaml` 初版（覆盖已实现端点） |
| `feat(daemon): security headers middleware` | 3.10 | 实现细节 → 07；02 仅约束位置 |
| `feat(daemon): agent exec endpoint streaming NDJSON` | 3.11 | §4 + §5 envelope + §7 cancel + §10 错误；fake backend e2e |
| `feat(daemon): wire all 5 backends with smoke tests` | 3.12 | 5 个 backend L2 happy-path；CLI smoke opt-in（详 → 01） |

每个 commit 自带必要测试（L1 + L2）+ G1/G2 hook 全绿 + 不留 TODO。

---

## 15. 未决问题

| # | 问题 | 决策方 | 状态 |
|---|------|-------|------|
| 1 | `GET /v1/sessions/{id}/messages` 在 follow=true 时是否允许 `Last-Event-ID` header（SSE 兼容性）？v1 范围内倾向**不**支持，避免与自定义 NDJSON 协议混淆 | 实施 Phase 3.11 时由 SDE 复核 | 待 Phase 3.11 |
| 2 | OpenAPI 工具链选 `openapi-typescript` 还是 `openapi-zod` 生成 TS 类型？前者纯 type 体积小，后者 runtime 校验更稳 | @zheng-li 在 Phase 3.7 前决策 | 待 |
| 3 | `usage` event 在 backend 中段没有信号时（如 copilot）是否完全跳过？现规范允许跳过；客户端不应假设每个 session 都有 `usage` event | 实施 Phase 3.12 时复核 5 backend 真实行为 | 待 Phase 3.12 |
| 4 | daemon 是否实现 `--dev` CORS middleware？dashboard dev 走 Vite proxy 同源转发已足够，daemon 端 CORS 多余且有 preflight/bearer 协调复杂度 | 实施 Phase 3.7 时由 SDE 复核；倾向**不实现**，仅依赖 Vite proxy | 待 Phase 3.7 |

---

## 16. 相关文档

- 上层：[`docs/01-project-overview.md`](../01-project-overview.md) §7.3 / §9.2
- 兄弟文档：
  - [`01-agent-sdk-pump-from-multica.md`](01-agent-sdk-pump-from-multica.md)（`agent.Backend` / `Message` / `Result` 锚点）
  - `03-sqlite-schema-and-tokens.md`（token 表 / hash / session 表）
  - `04-bootstrap-and-first-run-mint.md`（`POST /bootstrap/mint` 完整契约）
  - `05-remote-access-modes.md`（bind 校验，本文档假设已通过）
  - `07-dashboard-security-csp-and-xss.md`（security_headers middleware 实现）
  - `08-6dq-hooks-wiring.md`（L1/L2 跑这些端点的工具链）
- 工作约束：[`../../CLAUDE.md`](../../CLAUDE.md)
