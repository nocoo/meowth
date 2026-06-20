# Architecture · 03 · SQLite schema & tokens

> **更新规则**：本文档定义 daemon 持久化存储的 schema、迁移策略、token 生命周期与 bearer 认证算法。
> 任何 DDL 改动、enum 取值变动、argon2id 参数变动，必须先回到这里更新，再向下推进。
> 历史在 `git log -- docs/architecture/03-sqlite-schema-and-tokens.md`。

> 上层依据：[`docs/01-project-overview.md`](../01-project-overview.md) §7.4、§9.2 Phase 3.3–3.4 / 3.6。
> 本文档**不涉及**：
> - HTTP wire（→ [`02-daemon-http-protocol.md`](02-daemon-http-protocol.md)，token endpoints 的 wire schema 在 02 §9）
> - `setup_nonce.hash` 与 first-run mint（→ [`04-bootstrap-and-first-run-mint.md`](04-bootstrap-and-first-run-mint.md)）
> - bind 地址、远程访问 mode（→ `05-remote-access-modes.md`）
> - CSP / XSS / dashboard 安全（→ `07-dashboard-security-csp-and-xss.md`）
> - 6DQ hook 接线（→ `08-6dq-hooks-wiring.md`）

---

## 1. 范围

本文档管：

- 本机存储路径、文件权限、SQLite driver 与 PRAGMA
- 全部生产表的 DDL（tokens / sessions / messages）
- argon2id 参数、token secret 生成规则、prefix 与 hash 比对算法
- bearer 认证从 wire → SQLite → 验证 → 401 的完整流程
- migration 策略（forward-only）、ledger 表、与 sqlc 的边界
- D1 测试隔离的三重校验（test-mode only）
- daemon shutdown 与 session 状态机持久化部分（HTTP 可观察部分在 → 02 §8）

本文档不管：

- HTTP handler 的请求 / 响应字段（在 → 02）
- token endpoint 是否需要 CSRF / 同源校验（在 → 07）
- session 表的 cancel func / context.CancelFunc 注册（**runtime registry**，**不入库**；§5.3）
- backend 二进制探测缓存（v1 不建表，§9 未决问题）

---

## 2. 存储路径与权限

### 2.1 路径

| 模式 | 根目录 | DB 文件 | WAL sidecar | SHM sidecar |
|------|--------|---------|-------------|-------------|
| **生产** | `~/.meowth/` | `~/.meowth/meowth.db` | `~/.meowth/meowth.db-wal` | `~/.meowth/meowth.db-shm` |
| **测试** | `~/.meowth-test/` | `~/.meowth-test/meowth-test.db` | `~/.meowth-test/meowth-test.db-wal` | `~/.meowth-test/meowth-test.db-shm` |

WAL / SHM sidecar 文件由 SQLite 自行创建，daemon 不直接管理；§2.2 的权限规则要求它们也落在同一目录下，由父目录 0700 兜底。

### 2.2 权限（与 [`docs/01-project-overview.md`](../01-project-overview.md) §7.4 一致）

| 路径 | 模式 | 验证时机 |
|------|------|---------|
| `~/.meowth/`（目录） | `0700` | daemon 启动时 `os.Stat`，权限不符则 `chmod` 修正；修正失败 → 启动失败 |
| `~/.meowth/meowth.db` | `0600` | 同上；首次创建时显式 `os.Chmod` |
| `~/.meowth/meowth.db-wal` | `0600` | SQLite 创建后 daemon 检查并修正（WAL/SHM 由 SQLite 自动写入，daemon 在 open 之后立即 stat 一遍） |
| `~/.meowth/meowth.db-shm` | `0600` | 同 WAL |
| `~/.meowth/runtime/meowthd.pid` | `0600` | daemon 启动写 PID 时 |

测试模式同理，根目录 `~/.meowth-test/` 也走 0700 / 0600。

参考实现：raven `~/workspace/personal/raven/packages/proxy/src/lib/app-dirs.ts` 的 `DIR_MODE` / `FILE_MODE` 常量与 `ensureDir`/`ensureFileMode` 模式（pump-friendly 起见，meowth Go 实现照同样规则在 `daemon/internal/home/` 落地）。

### 2.3 Driver 与 PRAGMA

- **Driver**：`modernc.org/sqlite`（纯 Go，无 CGO，darwin-arm64 / darwin-amd64 通过 `go build` 直接出二进制；与 [`docs/01-project-overview.md`](../01-project-overview.md) §7.4 一致）
- **开 connection 后立刻执行**的 PRAGMA：

  ```sql
  PRAGMA journal_mode = WAL;       -- WAL 提供并发读、写一线，崩溃恢复友好
  PRAGMA synchronous  = NORMAL;    -- WAL 下 NORMAL 即可保证持久化；FULL 太慢
  PRAGMA foreign_keys = ON;        -- SQLite 默认关闭，必须显式打开
  PRAGMA busy_timeout = 5000;      -- 写锁竞争时等 5s 再 SQLITE_BUSY
  PRAGMA temp_store   = MEMORY;    -- 临时索引存内存，避免在 ~/.meowth/ 里散落临时文件
  PRAGMA cache_size   = -65536;    -- 64 MiB；负数表示 KiB；单机 daemon 不必很大
  ```

- 每次 `sql.DB.Conn` 取到新连接都需要重跑非持久 PRAGMA（`foreign_keys` / `busy_timeout` / `temp_store` / `cache_size`），`journal_mode` 与 `synchronous` 是数据库级别一次性设置后持久。daemon 通过 `db.ExecContext` 在每个 connection 启动钩子（`sql.OpenDB` + 自定义 connector）执行。

---

## 3. Schema 总览

V1 三张正式表：

| 表 | 用途 | 写入者 | 读取者 |
|----|------|--------|--------|
| `tokens` | bearer token 元数据 + argon2id hash | daemon (token CRUD) / `meowthd init` / `meowthd bootstrap-token` | bearer_auth middleware、`GET /v1/tokens` |
| `sessions` | agent 会话元数据（持久部分） | `POST /v1/agents/{type}/exec` 启动 + 终态写回 | `GET /v1/sessions(/...)` |
| `messages` | NDJSON envelope 持久化 | daemon stream 写入路径 | `GET /v1/sessions/{id}/messages` snapshot/follow |

外加一张 **migration ledger**：

| 表 | 用途 |
|----|------|
| `_migrations` | 记录已应用的 migration 版本 |

测试 mode 还会额外创建一张 `_test_marker`（§9）。

**`agent_install_cache` 暂不建表**：[`02`](02-daemon-http-protocol.md) §6.1 明确 v1 不缓存 `/v1/agents` 探测结果；本文档不列 DDL，避免与 02 冲突。若 v2 引入缓存，新建 migration + 在本文档新增表条目。

---

## 4. `tokens` 表

### 4.1 DDL

锚定为 [`docs/01-project-overview.md`](../01-project-overview.md) §7.4 表，本节是该 schema 的权威落地版本。`prefix` 长度（9 字符 = `mwt_` + 5 base32）由本文档 §4.2 / §4.3 锁定，overview §7.4 跟随本文档；`CHECK (created_via IN (...))` 是本文档新增、写进首版 DDL，不依赖 `ALTER TABLE ADD CONSTRAINT`（SQLite 不支持后加 named CHECK constraint）。

```sql
CREATE TABLE tokens (
  id          TEXT PRIMARY KEY,          -- uuid v7
  name        TEXT NOT NULL,             -- 用户自定的可读标签
  prefix      TEXT NOT NULL,             -- 形如 "mwt_abc12"，前 9 字符（mwt_ + 5 base32），仅用于行筛选；非唯一（§4.3）
  token_hash  BLOB NOT NULL,             -- argon2id(secret, salt)，32 byte
  salt        BLOB NOT NULL,             -- 每 token 独立随机 16 byte
  created_at  INTEGER NOT NULL,          -- unix epoch (seconds)
  last_used_at INTEGER,                  -- 最近一次成功认证；NULL 表示从未使用
  revoked_at  INTEGER,                   -- NULL = active；非 NULL = 撤销时间
  created_via TEXT NOT NULL,             -- "init" | "first_run_mint" | "dashboard" | "cli"
  CHECK (created_via IN ('init','first_run_mint','dashboard','cli'))
);

CREATE INDEX idx_tokens_prefix ON tokens(prefix);
CREATE INDEX idx_tokens_active ON tokens(revoked_at) WHERE revoked_at IS NULL;
```

无 `UNIQUE(prefix)`——9 字符 prefix 在 24 byte secret 的命名空间下碰撞概率极低，但仍可能发生；按行循环验 hash（§5.2）覆盖此场景。

### 4.2 Token secret 生成

- **熵源**：`crypto/rand.Read` 24 byte = 192 bit
- **编码**：base32（RFC 4648，**无 padding**），24 byte → 39 字符（`ceil(24*8/5)=39`）
- **前缀**：固定字面量 `mwt_`（4 字符）
- **完整 secret**：`mwt_` + 39 字符 base32 = **总长 43 字符**
- **prefix 列**（DDL `prefix`）：完整 secret 的前 **9 字符**（`mwt_` + base32 的前 5 字符）。例：完整 secret `mwt_4Z3KH2QJWNRY7L8XSPVCT5MGABDE6F9U...`（取头 43）→ `prefix='mwt_4Z3KH'`

> setup-code（路径 B mint）的生成规则与本节**同源同熵**（前缀 `mws_` + 39 字符 base32），但 setup-code 不入 `tokens` 表，详 → 04。

### 4.3 prefix 非唯一与碰撞处理

- 写入：daemon 生成 secret 后**不**检查 prefix 重复；直接 `INSERT`。9 字符 prefix（含 `mwt_`）在白名单 + 单机场景下碰撞极少；即使碰撞也由 §5 验证算法处理。
- 读取：bearer_auth 按 prefix 检索**所有** active rows，逐行计算 argon2id 比对（§5.2）；多行命中场景下取首个 `subtle.ConstantTimeCompare` 通过的 row。

不强制 `UNIQUE(prefix)` 的好处是：避免在写入路径上为极小概率事件做重试循环，且让 prefix 仍能保留人类可读的"识别提示"功能。

### 4.4 argon2id 参数

| 参数 | 值 | 备注 |
|------|----|------|
| `algorithm` | argon2id | 与 setup-code 一致 |
| `version` | `0x13` (19) | argon2 v1.3 |
| `memory` | `65536` KiB（64 MiB） | OWASP 推荐基线下沿；本机 daemon 不在意冷启动 |
| `time` | `3` | 迭代次数 |
| `parallelism` | `4` | macOS 双核以上即可 |
| `salt` | 16 byte（`crypto/rand`） | 每 token 独立，存 `tokens.salt` |
| `digest` | 32 byte | 存 `tokens.token_hash` |

实现：标准库 `golang.org/x/crypto/argon2` 的 `argon2.IDKey(secret, salt, 3, 65536, 4, 32)`（在 daemon `go.mod` require）。这是 **`pkg/agent` 之外** 引入的第一个第三方依赖，预期；与 [`01`](01-agent-sdk-pump-from-multica.md) §2.2 "`pkg/agent` 内 0 第三方依赖"不冲突。

### 4.5 `created_via` 来源分层

| 取值 | 写入路径 | HTTP 客户端是否可指定 |
|------|---------|---------------------|
| `init` | `meowthd init` CLI（路径 A，[`04`](04-bootstrap-and-first-run-mint.md) §1） | **否** |
| `first_run_mint` | `POST /bootstrap/mint`（路径 B，[`04`](04-bootstrap-and-first-run-mint.md) §2） | **否** |
| `dashboard` | `POST /v1/tokens`（dashboard 发起） | daemon **固定写**，不读 wire |
| `cli` | `meowthd token create` CLI 子命令 | daemon **固定写**，不读 wire |

**铁律**：HTTP `POST /v1/tokens` request body **不含** `created_via` 字段（[`02`](02-daemon-http-protocol.md) §9.1）；daemon handler 写入时硬编码 `dashboard`。CLI 子命令同理硬编码 `cli`。`init` / `first_run_mint` 由 bootstrap 路径自己写入。

DB 层 CHECK 在 §4.1 DDL 中已经写进 `CREATE TABLE`，等价于一个表级约束：违反枚举的 INSERT 会被 SQLite 拒绝。应用层 handler 也做白名单校验，是双重保险。

---

## 5. Bearer 认证算法（02 §12 `bearer_auth` 的实现）

### 5.1 Wire 输入

`Authorization: Bearer mwt_4Z3KH2QJWNRY7L8XSPVCT5MGABDE6F9U...`

格式校验失败（不以 `Bearer ` 开头、token 不以 `mwt_` 开头、长度不为 43）→ 401 problem+json `type=unauthorized`，**不**查 DB。

### 5.2 验证算法

```go
// 在 daemon 启动时预生成；常量在进程生命周期内复用。
var (
    dummySalt = mustRandomBytes(16)
    dummyHash = argon2.IDKey([]byte("__meowth_dummy__"), dummySalt, 3, 65536, 4, 32)
)

func authenticate(ctx context.Context, db *sql.DB, presented string) (*Token, error) {
    if len(presented) != 43 || !strings.HasPrefix(presented, "mwt_") {
        return nil, errUnauthorized // 格式错误：早期拒绝，不跑 dummy
    }
    prefix := presented[:9] // "mwt_" + 5 chars

    rows, err := db.QueryContext(ctx, `
        SELECT id, name, token_hash, salt, created_at, last_used_at
        FROM tokens
        WHERE prefix = ? AND revoked_at IS NULL
    `, prefix)
    if err != nil { return nil, errInternal }
    defer rows.Close()

    presentedBytes := []byte(presented)
    matched := false
    var winner Token
    for rows.Next() {
        var t Token
        var hash, salt []byte
        if err := rows.Scan(&t.ID, &t.Name, &hash, &salt, &t.CreatedAt, &t.LastUsedAt); err != nil {
            return nil, errInternal
        }
        computed := argon2.IDKey(presentedBytes, salt, 3, 65536, 4, 32)
        if subtle.ConstantTimeCompare(computed, hash) == 1 && !matched {
            matched = true
            winner = t
            // 继续遍历剩余行（避免多 row 命中时的时序短路）；不再触发新的 ConstantTimeCompare 写入。
        }
    }
    if err := rows.Err(); err != nil {
        return nil, errInternal
    }

    if !matched {
        // 合法格式 + 0 命中行：仍跑一次 dummy argon2id 以缩小与"命中"路径的时序差异。
        _ = argon2.IDKey(presentedBytes, dummySalt, 3, 65536, 4, 32)
        _ = subtle.ConstantTimeCompare(dummyHash, dummyHash) // 形式上对齐 compare 调用次数
        return nil, errUnauthorized
    }

    // 命中。异步更新 last_used_at，不阻塞响应。
    go updateLastUsedAt(winner.ID)
    return &winner, nil
}
```

**安全约束**：

1. **必须**用 `subtle.ConstantTimeCompare`，不允许 `bytes.Equal`
2. 401 响应**不区分**"prefix 无匹配 / hash 不等 / 已 revoked"（与 [`02`](02-daemon-http-protocol.md) §10.3 一致）
3. **合法格式 + 0 命中行**必须跑一次 dummy argon2id（伪代码已落实）；格式错误（长度/前缀不符）属于显然非法请求，直接拒绝，不跑 dummy
4. `last_used_at` 异步更新是因为同步 UPDATE 会阻塞响应；用 `go` + 5s timeout 兜底。失败仅写日志，不影响认证结果。
5. 多行 prefix 碰撞场景：遍历**所有**命中行而非短路 `return`，避免"第几行命中"造成时序差异（已落实）

### 5.3 daemon runtime registry vs SQLite session 表

`POST /v1/agents/{type}/exec` 启动一个 agent → daemon 在内存中维护：

```go
type ActiveSession struct {
    ID         string
    Cancel     context.CancelFunc
    EnvelopeWriter *NDJSONWriter
}

type Registry struct {
    mu      sync.Mutex
    active  map[string]*ActiveSession
}
```

这个 registry 是**进程内存对象**，**不**持久化到 SQLite。daemon 重启则 registry 清空；上一进程留下的 `sessions` 表行已被标记为 `aborted`（§8.1 / [`02`](02-daemon-http-protocol.md) §8.1）。

`sessions` 表只存**可观察**字段（id / status / 时间戳 / backend 元数据），不存 `cancel_func_handle` 或类似试图持久化 runtime 引用的字段。

---

## 6. `sessions` 表

### 6.1 DDL

```sql
CREATE TABLE sessions (
  id                  TEXT PRIMARY KEY,        -- uuid v7
  backend_type        TEXT NOT NULL,           -- "claude" | "copilot" | "codex" | "hermes" | "pi"
  backend_session_id  TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL,           -- 见 §6.2 状态机
  started_at          INTEGER NOT NULL,        -- unix epoch (seconds)
  ended_at            INTEGER,                 -- NULL 表示尚未终结
  thread_name         TEXT NOT NULL DEFAULT '',
  model               TEXT NOT NULL DEFAULT '',
  daemon_pid          INTEGER NOT NULL,        -- 启动本 session 的 daemon 进程 pid
  error               TEXT NOT NULL DEFAULT '',
  duration_ms         INTEGER NOT NULL DEFAULT 0,
  usage_json          BLOB NOT NULL DEFAULT (X''),  -- agent.Result.Usage JSON 编码；空 BLOB 表示无数据
  CHECK (backend_type IN ('claude','copilot','codex','hermes','pi')),
  CHECK (status IN ('running','completed','failed','aborted','timeout','cancelled'))
);

CREATE INDEX idx_sessions_started_at ON sessions(started_at DESC);
CREATE INDEX idx_sessions_status ON sessions(status);
```

`usage_json` 用 BLOB 而非 TEXT 是为了避免 SQLite 的字符编码假设；JSON 内容是 ASCII，BLOB 同样可读。

### 6.2 状态机

```
running ──cancel──> cancelled
        ──timeout──> timeout
        ──error──> failed
        ──ok──> completed
        ──daemon shutdown / kill──> aborted
```

`aborted` 与 `cancelled` 的区别：

- `cancelled`：用户主动 `POST /v1/sessions/{id}/cancel`、客户端断 TCP
- `aborted`：daemon 自己停（SIGTERM/SIGINT 收到、`os.Exit` 兜底）

终态（所有非 `running` 状态）一律设 `ended_at` + 写 `error`/`duration_ms`/`usage_json`。

### 6.3 daemon 启动期清理（与 [`02`](02-daemon-http-protocol.md) §8.1 step 4 联动）

daemon 启动时**第一件事**（在挂载 HTTP listener 之前）：

```sql
UPDATE sessions
SET    status = 'aborted',
       ended_at = strftime('%s','now'),
       error = COALESCE(NULLIF(error,''), 'daemon restarted')
WHERE  status = 'running';
```

这覆盖了**上一进程崩溃 / 强杀**留下的 `running` 行。已经被上一进程优雅 shutdown 标记为 `aborted` 的不受影响（`WHERE status='running'`）。

---

## 7. `messages` 表

### 7.1 DDL

```sql
CREATE TABLE messages (
  session_id    TEXT    NOT NULL,
  seq           INTEGER NOT NULL,
  event_type    TEXT    NOT NULL,       -- "session_started" | "message" | "usage" | "error" | "session_ended" | "heartbeat"
  ts            INTEGER NOT NULL,       -- unix epoch milliseconds
  envelope_json BLOB    NOT NULL,       -- 完整 NDJSON envelope，包括 v/seq/ts/session_id/type/payload 全部字段
  PRIMARY KEY (session_id, seq),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CHECK (event_type IN ('session_started','message','usage','error','session_ended','heartbeat'))
);

CREATE INDEX idx_messages_session_ts ON messages(session_id, ts);
```

**列名说明**：

- `envelope_json` **不是** `payload`——存的是整条 envelope（[`02`](02-daemon-http-protocol.md) §5.1 的完整对象，含 `v/seq/ts/session_id/type/payload` 五段），不要只存 `payload` 字段；存 `payload` 会丢失 envelope 元信息且 follow/replay 时无法重建客户端可见的 NDJSON 行。
- `event_type` / `ts` 是冗余索引列，方便 [`02`](02-daemon-http-protocol.md) §6.4 的 `types=` 过滤与时间排序，避免每次都解析 BLOB。

主键 `(session_id, seq)` 支持 [`02`](02-daemon-http-protocol.md) §6.4 `after_seq` 续读的范围扫描：

```sql
SELECT seq, envelope_json
FROM   messages
WHERE  session_id = ? AND seq > ?
ORDER  BY seq
LIMIT  ?;
```

### 7.2 写入路径

daemon 在生成每条 NDJSON envelope 后**先**持久化、**再**写 HTTP，以保证 [`02`](02-daemon-http-protocol.md) §6.4 `after_seq` 续读与 follow replay 的契约——客户端可见的每个 `seq` 在 SQLite 里都必有同 `seq` 的行：

1. `INSERT INTO messages(session_id, seq, event_type, ts, envelope_json)`
2. 写 HTTP response（chunked，一行 NDJSON）

如果 step 1 失败（SQLite 异常、磁盘满、PRAGMA 失效等），适用**硬规则**：

- **不再向该 NDJSON stream 写任何新的 envelope**——包括 `session_ended`。任何写到 wire 但不入库的 envelope 都会破坏 replay 契约（占 `seq` 但 `GET /messages?after_seq=...` 找不到，重连断档），所以不允许。
- 调用上游 backend cancel（`context.CancelFunc`）让子进程退出
- 尽力执行 `UPDATE sessions SET status='failed', ended_at=..., error=<persist 失败原因>`；如果连这个 UPDATE 也失败，仅写 daemon 日志
- **关闭 HTTP response stream**（让客户端看到 EOF）

客户端的可观察终态：

- 流断（无 `session_ended` 信号）
- `GET /v1/sessions/{id}` 返回 `status=failed`（前提是 `sessions` UPDATE 成功）
- 如果 `sessions` UPDATE 也失败：daemon 启动期清理（§6.3 `WHERE status='running' → 'aborted'`）在下一次重启时把它兜底为 `aborted`

`type=error code=persist_failed` 不在 [`02`](02-daemon-http-protocol.md) §10.2 错误码表中，也**不**作为 NDJSON event 发出；持久化错误对客户端的信号统一是"流断 + sessions 终态"。daemon **不**承诺向已发起的 stream 产生任何 terminal envelope。

### 7.3 保留策略

V1 **不做** GC：`messages` 表 + `sessions` 表内容**永久保留**。

理由：单机 daemon、单用户、几百 MB 量级在 SQLite 上完全无压力。带 GC 的复杂度（按时间 / 按 session 数 / 按字节数）暂不引入。后续如需，在 `docs/features/` 下立项编号文档，新增 migration。

---

## 8. `_migrations` ledger 与 migration runner

### 8.1 Ledger DDL

```sql
CREATE TABLE _migrations (
  version    INTEGER PRIMARY KEY,         -- 单调递增，e.g. 1, 2, 3
  name       TEXT NOT NULL,               -- 文件名（不含路径）
  applied_at INTEGER NOT NULL             -- unix epoch seconds
);
```

### 8.2 Migration 文件布局

```
daemon/internal/store/migrations/
├── 001_init_tokens.up.sql
├── 002_init_sessions.up.sql
├── 003_init_messages.up.sql
└── ...
```

- 命名：`NNN_<kebab-name>.up.sql`（三位编号，零填充）
- **只 up，没有 down**：forward-only；schema 改动通过新增表 + 数据迁移完成（[`docs/01-project-overview.md`](../01-project-overview.md) §7.4 一致）
- 每个文件内可含多条 statement；runner 用 BEGIN/COMMIT 事务包起

### 8.3 Migration runner

**手写 / 小包**实现，**不**依赖 sqlc：

```go
package store

func ApplyMigrations(ctx context.Context, db *sql.DB, fs embed.FS) error {
    // 1. 确保 _migrations 表存在
    // 2. SELECT 已应用 version
    // 3. 列 fs，按 NNN 排序
    // 4. 对未应用的逐个 BEGIN → exec → INSERT INTO _migrations → COMMIT
    // 5. 任一失败：ROLLBACK + 错误返回
}
```

`sqlc` **只生成业务 query**（`daemon/internal/store/queries/`），不参与 migration apply。这两者职责严格分开，避免 sqlc 配置变动影响 schema 演进。

### 8.4 sqlc 配置

`daemon/internal/store/sqlc.yaml`：

```yaml
version: '2'
sql:
  - engine: sqlite
    schema: 'daemon/internal/store/migrations'
    queries: 'daemon/internal/store/queries'
    gen:
      go:
        out: 'daemon/internal/store/gen'
        package: 'store'
        emit_interface: true
        emit_json_tags: false
        emit_db_tags: false
        emit_prepared_queries: false
```

`schema` 指向 migration 目录，sqlc 据此推导类型；**注意**：sqlc 把每个 `.up.sql` 文件视为 schema 语句，因此 migration 文件**只允许 DDL**（`CREATE TABLE / CREATE INDEX / ALTER TABLE`），不允许 DML（`INSERT / UPDATE`）。需要数据迁移的复杂场景：把数据 migration 写在 daemon Go 代码里、由 runner 在该 version 下执行；不入 `.up.sql`。

业务 query 文件示例 `daemon/internal/store/queries/tokens.sql`：

```sql
-- name: ListActiveTokensByPrefix :many
SELECT id, name, prefix, token_hash, salt, created_at, last_used_at, revoked_at, created_via
FROM tokens
WHERE prefix = ? AND revoked_at IS NULL;

-- name: TouchTokenLastUsedAt :exec
UPDATE tokens SET last_used_at = ? WHERE id = ?;
```

---

## 9. D1 测试隔离（三重校验，**仅 test-mode**）

### 9.1 触发条件

daemon 进入 test mode 由**显式信号**控制（任一）：

- 环境变量 `MEOWTH_TEST=1`
- 测试 harness 通过 `daemon/internal/home.OpenStoreForTest(...)` 函数打开
- 命令行 `--store=test`（仅在 build tag `meowth_test` 下编译；生产 build 不含此 flag）

**没有任一信号 = 生产模式**。

### 9.2 校验矩阵

| 模式 | 必须满足 | 必须拒绝 |
|------|---------|---------|
| **test** | 1. 路径前缀 `~/.meowth-test/`<br>2. DB 文件名以 `-test` 结尾（例 `meowth-test.db`）<br>3. `_test_marker` 表存在且含一行 `marker='meowth-test'` | 任何非 `~/.meowth-test/` 路径；缺少 `_test_marker` |
| **生产** | 路径 `~/.meowth/`、文件 `meowth.db` | 路径前缀 `~/.meowth-test/`；文件名含 `-test` 后缀 |

任一不满足 → daemon 拒绝打开 DB，返回明确错误：

- test mode 失败：`refusing to open: test store must reside in ~/.meowth-test/ and have _test_marker table`
- 生产 mode 失败：`refusing to open: production store must not be in test directory (~/.meowth-test/...)`

### 9.3 `_test_marker` 表

```sql
CREATE TABLE _test_marker (
  marker TEXT PRIMARY KEY CHECK (marker = 'meowth-test')
);
INSERT INTO _test_marker(marker) VALUES ('meowth-test');
```

由测试 harness 在 DB 初始化时创建（不属于生产 migration 文件，**不**进 `daemon/internal/store/migrations/`，避免污染生产 schema）。

### 9.4 构建时静态校验（与 §7.4 D1 三重校验一致）

在 daemon 启动期检查（运行时）之外，CI 还跑一个静态校验脚本（`scripts/check-no-prod-test-mix.sh`，详 → 08）：

- 搜代码里 `~/.meowth-test/` 字面量是否仅出现在 test 文件
- 搜代码里 `~/.meowth/` 字面量是否仅出现在生产 home resolver
- 任一逆向出现 → CI 红

---

## 10. Token CRUD 与 daemon 实现侧约束（02 §9 wire 的对应实现）

### 10.1 `POST /v1/tokens`（dashboard）

handler 实现序列：

1. 读 wire body `{ "name": "..." }`，校验 1..64 字符
2. 生成 `secret` = `mwt_` + base32(crypto/rand 24 byte)
3. `salt` = crypto/rand 16 byte
4. `token_hash` = argon2.IDKey(secret, salt, 3, 65536, 4, 32)
5. `id` = uuid v7
6. `created_via` 硬编码 `'dashboard'`
7. INSERT
8. 响应里包含完整 `secret`；wire 模型类型在编译期保证只有此 endpoint 含 `secret` 字段（§10.4）
9. **明文 secret 的最小化生命周期**（best-effort，承认 Go 的限制）：
   - 不落库（只入 hash + salt）、不写日志、不进 `error.Error()` 文本
   - 不持有到 handler 返回之外的生命周期；不放进任何 long-lived map / cache
   - 对可控 `[]byte` buffer（如 base32 编码前的 24 byte 随机源、Scan 时持有的临时 byte slice）做 best-effort 零化（`for i := range buf { buf[i] = 0 }`）
   - **Go `string` 一旦构造即不可变**，且 `json.Encoder` 在序列化过程中可能产生若干临时拷贝；daemon 因此**无法**对响应里的 `secret` 字符串做严格清零，本节不承诺这一点。安全边界落在"hash-only 存储 + only-once 响应"，不在"内存清零"。

### 10.2 `GET /v1/tokens`

```sql
SELECT id, name, prefix, created_at, last_used_at, revoked_at, created_via
FROM tokens
ORDER BY created_at DESC;
```

注意 **不 SELECT** `token_hash` / `salt`。

### 10.3 `DELETE /v1/tokens/{id}`

```sql
UPDATE tokens
SET    revoked_at = strftime('%s','now')
WHERE  id = ? AND revoked_at IS NULL;
```

`UPDATE` 受影响行 0 → 404 problem+json `type=token_not_found`（与 [`02`](02-daemon-http-protocol.md) §9.3 一致）。

### 10.4 编译期保证响应永不泄露 secret

Go 实现侧的两层模型：

```go
// 仅创建端点使用，含 secret 字段
type TokenCreateResponse struct {
    ID         string `json:"id"`
    Name       string `json:"name"`
    Prefix     string `json:"prefix"`
    Secret     string `json:"secret"`
    CreatedAt  string `json:"created_at"`
    CreatedVia string `json:"created_via"`
}

// 列表 / 详情用，没有 secret 字段
type TokenView struct {
    ID         string  `json:"id"`
    Name       string  `json:"name"`
    Prefix     string  `json:"prefix"`
    CreatedAt  string  `json:"created_at"`
    LastUsedAt *string `json:"last_used_at"`
    RevokedAt  *string `json:"revoked_at"`
    CreatedVia string  `json:"created_via"`
}
```

`TokenView` 类型上**没有** `Secret` 字段，任何 handler 把它传入 `json.Encoder` 都不可能写出 secret——这是 wire 安全的编译期保证（[`docs/01-project-overview.md`](../01-project-overview.md) §7.4 铁律 + [`02`](02-daemon-http-protocol.md) §9.2 实现）。

---

## 11. 测试落点（与 6DQ 的映射）

> 详 → 08；本节只列 03 范围内的覆盖目标。

| 层 | 覆盖什么 | 怎么覆盖 |
|----|---------|---------|
| **L1** | argon2id 参数固定；secret 生成长度/字符集；prefix 长度；ConstantTimeCompare 比对；prefix 碰撞下多行验证；wire 模型 `TokenView` 无 `Secret` field（reflect 反射断言） | `daemon/internal/store/*_test.go`、`daemon/internal/server/tokens_test.go` |
| **L2** | `POST/GET/DELETE /v1/tokens` 真 HTTP、bearer auth 命中/未命中/已 revoked、撤销当前 token 后立刻失效、`created_via` 客户端不能注入（无论 body 有无该字段都被 daemon 硬编码） | `scripts/run-l2.ts` |
| **D1** | 三重校验全通过 / 任一不满足 daemon 拒绝；生产路径 vs 测试路径互拒；`_test_marker` 缺失立即拒；构建时静态校验脚本 | unit test + CI gate |
| **timing oracle** | dummy-hash 路径在 prefix 无匹配时仍执行一次 argon2id；统计 p50/p95 时间差应在 acceptable 范围内 | L1 micro-benchmark + assertion |
| **migration** | 干净库 → apply 全部 migration → schema 一致；中途中断后再 apply 幂等 | `daemon/internal/store/migrate_test.go` |

---

## 12. 原子化提交计划（对应 [`docs/01-project-overview.md`](../01-project-overview.md) §9.2 Phase 3.3 / 3.4 / 3.6）

| Commit | Phase | 内容 |
|--------|-------|------|
| `feat(daemon): ~/.meowth path resolver` | 3.3 | `daemon/internal/home/` 的 `Production()` / `Test()` resolver；权限校验；D1 测试路径分支；L1 全覆盖 |
| `feat(daemon): sqlite store with tokens schema (hash only)` | 3.4 | driver 接入、PRAGMA、migration runner、`_migrations` ledger、`tokens` 表 DDL、sqlc 配置、argon2id 包装、`_test_marker` D1 校验 |
| `feat(daemon): bearer auth middleware (constant-time compare)` | 3.6 | §5.2 完整算法（含 timing oracle dummy hash）；与 02 §12 middleware chain 拼装 |

`sessions` / `messages` 表的 DDL 与 sqlc 在 Phase 3.7 (`feat(daemon): chi router + healthz + token CRUD`) 与 3.11 (`feat(daemon): agent exec endpoint streaming NDJSON`) 时各自落地（属 02 范围），03 仅作为 schema 权威。

每个 commit 自带必要测试 + G1/G2 hook 全绿 + 不留 TODO。

---

## 13. 未决问题

| # | 问题 | 决策方 | 状态 |
|---|------|-------|------|
| 1 | `agent_install_cache` 是否在 v2 引入？需要先看 dashboard 是否对 `/v1/agents` 频繁调用 | 实施 Phase 3.7 后由 SDE 观察 | 待 Phase 3.7 后 |
| 2 | argon2id 参数是否需要做"按机器自校准"（启动时跑一次 benchmark 调 memory/time）？v1 写死 `64 MiB × 3`，简单稳定 | 暂不引入；如未来在低端机器导致冷启动 > 200ms 再立项 | 待观察 |
| 3 | base32 编码是否换成 base58 / base62 以避免 base32 的 `0/O/1/l` 视觉混淆？v1 用 base32 与 setup-code 同源 | 实施 Phase 3.4 前由 SDE 复核；若改需要与 04 同步 | 待 Phase 3.4 |
| 4 | `last_used_at` 异步更新失败的容忍度 / 重试策略 | 实施 Phase 3.6 时由 SDE 复核 | 待 Phase 3.6 |

---

## 14. 相关文档

- 上层：[`docs/01-project-overview.md`](../01-project-overview.md) §7.4 / §9.2
- 兄弟文档：
  - [`02-daemon-http-protocol.md`](02-daemon-http-protocol.md)（token endpoints 的 wire schema、session 状态机的 HTTP 可观察部分）
  - `04-bootstrap-and-first-run-mint.md`（`setup_nonce.hash`、`first_run_mint` 路径的 token 写入）
  - `05-remote-access-modes.md`（config.toml / `remote_access.mode` 字段；本文档不读 config）
  - `07-dashboard-security-csp-and-xss.md`（dashboard 端 secret 显示 UX）
  - `08-6dq-hooks-wiring.md`（D1 静态校验脚本 + L1/L2 跑 token + migration）
- 实现参考：raven `~/workspace/personal/raven/packages/proxy/src/lib/app-dirs.ts`（`DIR_MODE`/`FILE_MODE` 模式）
- 工作约束：[`../../CLAUDE.md`](../../CLAUDE.md)
