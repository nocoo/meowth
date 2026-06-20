# Architecture · 04 · Bootstrap & first-run mint

> **更新规则**：本文档定义首个 root token 的诞生路径、`setup_nonce.hash` 文件格式、`POST /bootstrap/mint` 端点的硬约束、应急通路。
> 任何改 bootstrap 流程、改 nonce hash JSON schema、改 mint endpoint 行为、改 lockout 语义的事，必须先回到这里更新，再向下推进。
> 历史在 `git log -- docs/architecture/04-bootstrap-and-first-run-mint.md`。

> 上层依据：[`docs/01-project-overview.md`](../01-project-overview.md) §7.8、§9.2 Phase 3.5 / 3.8。
> 本文档**不涉及**：
> - HTTP 通用 wire schema（→ [`02-daemon-http-protocol.md`](02-daemon-http-protocol.md)；02 §3 已把 `/bootstrap/mint` 列为非 v1 特例端点）
> - `tokens` 表 DDL / argon2id 参数 / token secret 生成规则（→ [`03-sqlite-schema-and-tokens.md`](03-sqlite-schema-and-tokens.md)）
> - `remote_access.mode` 的 config.toml schema、bind 校验表（→ `05-remote-access-modes.md`；本文档只读结果）
> - CSP / dashboard 安全（→ `07-dashboard-security-csp-and-xss.md`）
> - 6DQ hook 接线（→ `08-6dq-hooks-wiring.md`）

---

## 1. 范围

本文档管：

- `meowthd init` 命令的两条互斥路径
- `setup_nonce.hash` 文件的存储位置、权限、完整 JSON schema
- `POST /bootstrap/mint` 端点的全部硬约束（mode-gated / loopback / one-shot / lockout / 抖动 / 统一 404）
- mint 成功路径的写入顺序（crash-safety）
- daemon 启动期检测 mint 窗口的逻辑（含跨进程语义）
- 应急通路 `meowthd bootstrap-token` 与路径 A/B 的关系
- 失败模式（hash corrupted、token 表非空但 hash 存在、5 次 lockout 后恢复）
- token 显示策略的本文档落点（与 03/02 一致）

本文档不管：

- `tokens.created_via` enum 的取值由 03 §4.5 锁定；本文档**遵循** enum，不增删
- bind 地址、`remote_access.mode` 配置解析（→ 05；本文档只**消费**布尔结果"是否默认本机"）
- mint endpoint 是否要走 v1 bearer middleware（02 §3 已答：**否**）

---

## 2. 总览：两条互斥路径 + 应急通路

| 路径 | 触发命令 | 创建首个 token 的方式 | `created_via` |
|------|---------|---------------------|---------------|
| **A**（推荐默认） | `meowthd init` | init 自己生成并 stdout 单次明文 root token | `init` |
| **B**（脚本化部署） | `meowthd init --skip-token` → 用户后续在 dashboard 提交 setup-code → `POST /bootstrap/mint` | mint 端点收 setup-code 后生成并响应一次 secret | `first_run_mint` |
| **应急通路** | `meowthd bootstrap-token`（daemon 停机时） | 直接读 SQLite + 插一行 + stdout 单次明文 | `cli` |

**互斥保证**：daemon 在路径 A 完成后看到 `tokens` 表非空 → 即使 `setup_nonce.hash` 文件存在也不开放 mint endpoint，并把 stale hash 文件清理掉（§5.3）。路径 A 与路径 B **不会同时生效**。

应急通路与 A/B 不互斥：用户既丢失全部 token 又错过初次 stdout 时使用；它不依赖 mint 窗口、不依赖 hash 文件、也不依赖远程访问 mode。

---

## 3. 路径 A · `meowthd init`

### 3.1 流程

1. **检查幂等性**：若 `~/.meowth/` 已存在（任何文件均算存在）→ 退出 1，stderr 打印「已存在 home，拒绝执行；如需重置先手工清理，或使用 `meowthd bootstrap-token` 注入新 token」。这与 [`docs/01-project-overview.md`](../01-project-overview.md) §7.8 路径 A 第 6 条幂等约束一致。
2. **创建目录结构**（与 [`03`](03-sqlite-schema-and-tokens.md) §2 一致）：
   ```
   ~/.meowth/                   (0700)
   ├── config.toml              (0600；最小内容，详 → 05)
   ├── meowth.db                (0600；SQLite，先空文件再 open)
   ├── logs/                    (0700)
   └── runtime/                 (0700)
       └── meowthd.pid          (写 daemon pid，本步骤不写；由 daemon 启动时写)
   ```
3. **跑 migration**（[`03`](03-sqlite-schema-and-tokens.md) §8 runner）→ 初始化 `tokens` / `sessions` / `messages` / `_migrations` 四张表。
4. **生成首个 root token**（与 [`03`](03-sqlite-schema-and-tokens.md) §4.2 同源算法，无修改）：
   - `secret` = `mwt_` + base32(crypto/rand 24 byte) = 43 字符
   - `salt` = crypto/rand 16 byte
   - `token_hash` = argon2id(secret, salt, t=3, m=64 MiB, p=4, digest=32 byte)
   - `id` = uuid v7
   - `name` = `"bootstrap"`
   - `created_via` = `"init"`
5. **INSERT** 入 `tokens`。
6. **stdout 单次打印**：
   ```
   <secret 字面量>
   Dashboard: http://127.0.0.1:7777
   把上面的 token 粘贴到 dashboard 的 token 输入框。
   token 只显示这一次，请立即保存。
   ```
   不写日志、不进 daemon stderr。明文 secret 在此之后不再存在于任何文件或进程内存（best-effort，详 [`03`](03-sqlite-schema-and-tokens.md) §10.1 step 9）。
7. **退出 0**。

### 3.2 与 mint endpoint 的关系

路径 A 跑完 `tokens` 表非空 → daemon 启动时（§5）发现 token 表非空，**不**开放 mint endpoint；即使将来用户错运行 `meowthd init --skip-token` 也因幂等检查（step 1）直接退出，不会创建 stale hash 文件。

---

## 4. 路径 B · `meowthd init --skip-token` + `POST /bootstrap/mint`

### 4.1 init `--skip-token` 流程

1. 同 §3.1 step 1 幂等检查
2. 同 §3.1 step 2–3 建目录 + migration
3. **不**生成 root token（`tokens` 表为空）
4. **生成 setup-code**：
   - 字面前缀 `mws_`（与 `mwt_` 区分；不入任何 token 表）
   - `crypto/rand` 24 byte = 192 bit
   - base32（RFC 4648, **无 padding**）编码 39 字符
   - 完整 setup-code = `mws_` + 39 字符 = **总长 43 字符**
   - 与 [`03`](03-sqlite-schema-and-tokens.md) §4.2 root token 同源同熵
5. **生成 nonce hash 文件**（§4.2）→ 写入 `~/.meowth/runtime/setup_nonce.hash`，权限 0600
6. **stdout 单次打印明文 setup-code**：
   ```
   <setup-code 字面量>
   Dashboard: http://127.0.0.1:7777
   在 dashboard /setup 页面输入上面的 setup-code 完成首个 token mint。
   setup-code 只显示这一次，请立即保存（脚本化部署可重定向到密钥库）。
   ```
7. 退出 0。明文 setup-code 自此**不再存在于任何文件或进程内存**。

### 4.2 `setup_nonce.hash` JSON schema

文件路径：`~/.meowth/runtime/setup_nonce.hash`
权限：0600
父目录权限：0700（与 [`03`](03-sqlite-schema-and-tokens.md) §2 一致）
内容：**单行 JSON object**（不 pretty-print，避免多行 parser 不一致）

```json
{
  "algorithm": "argon2id",
  "version": 19,
  "memory_kib": 65536,
  "time_cost": 3,
  "parallelism": 4,
  "salt_b64": "<base64 std encoding of 16 byte crypto/rand>",
  "digest_b64": "<base64 std encoding of 32 byte argon2id digest>",
  "created_at": 1729432980,
  "one_shot": true
}
```

字段含义与约束：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `algorithm` | string | yes | 固定 `"argon2id"`；其它值 daemon 拒绝（§5.2 失败模式） |
| `version` | int | yes | argon2 版本号 decimal **19**（= argon2 v1.3 / `0x13`；JSON 不支持 hex literal） |
| `memory_kib` | int | yes | argon2 内存代价；写盘当下为 `65536`（64 MiB）；daemon 校验时 cast 为 uint32 喂给 `argon2.IDKey`，**直接使用文件内的值**，不校验上下限——这就是把参数写进文件的目的：跨进程 parameter agility |
| `time_cost` | int | yes | argon2 时间代价；写盘当下为 `3` |
| `parallelism` | int | yes | argon2 并行度；写盘当下为 `4` |
| `salt_b64` | string | yes | base64 std encoding（**有 padding**，与 Go `encoding/base64.StdEncoding` 一致）；解码后必须 16 byte |
| `digest_b64` | string | yes | base64 std encoding；解码后必须 32 byte（参数变了会变长，daemon 按解码后长度判断） |
| `created_at` | int | yes | unix epoch seconds；仅作为审计与日志参考，不参与 mint 校验 |
| `one_shot` | bool | yes | 固定 `true`；保留字段，未来若引入多次 mint 模式，daemon 拒绝 `false` 直到本文档显式扩展 |

**关键含义**：

- 文件本身**自包含**——daemon 启动时只读它就能完成 mint 校验，不需要另一个 config 来告诉 argon2 参数
- daemon 与 init 是**独立进程**，可以分别由不同时机启动；只要 hash 文件未被消费或 lockout，校验语义保持稳定
- 文件**只读**：daemon 不会向 hash 文件写任何内容；成功 mint / lockout 时直接 `os.Remove`

### 4.3 mint endpoint 路径

```
POST /bootstrap/mint
Content-Type: application/json

{ "setup_code": "mws_4Z3KH2QJWNRY7L8XSPVCT5MGABDE6F9U..." }
```

成功响应（`201`）：

```json
{
  "id": "uuid v7",
  "name": "bootstrap",
  "prefix": "mws_4Z3KH",
  "secret": "mwt_...",
  "created_at": "RFC 3339",
  "created_via": "first_run_mint"
}
```

**字段说明**：

- 响应 schema 与 [`02`](02-daemon-http-protocol.md) §9.1 `POST /v1/tokens` 一致，但路径不同；secret **永远** `mwt_` 前缀（这是 token，不是 setup-code 回显）
- `prefix` 字段是被创建 token 的 prefix（[`03`](03-sqlite-schema-and-tokens.md) §4.1，9 字符）；这里**不**回显 setup-code 的 prefix
- `created_via` 由 daemon 硬编码 `"first_run_mint"`（[`03`](03-sqlite-schema-and-tokens.md) §4.5）；客户端**不能**指定

后续：dashboard 把响应里的 `secret` 存 `localStorage`，跳 `/overview`（详 → 06）。

---

## 5. daemon 启动期：mint 窗口判定

### 5.1 顺序

daemon 启动**早于任何 HTTP listener accept** 完成以下检查（按顺序）：

1. **读取 `remote_access.mode`**（详 → 05）。如果**不是**默认本机模式（即用户已经把 daemon 配成 tailscale / ssh_tunnel / https_proxy）→ mint endpoint **不挂载到路由表**。daemon 启动日志写 `first-run mint window: CLOSED(reason=remote_access_mode)`。这是 mint 的第一道门。
2. **查询 `tokens` 表是否曾经写入过任何 row**：
   ```sql
   SELECT EXISTS(SELECT 1 FROM tokens LIMIT 1);
   ```
   **不**带 `WHERE revoked_at IS NULL` 限定——任何历史 token row（哪怕全部已 revoked）都关闭 mint 窗口。理由：mint 是首个 token 的诞生路径；用户把所有 token revoke 后必须走 `meowthd bootstrap-token`（§8）应急通路，不允许通过保留 stale `setup_nonce.hash` 重新开 mint。非空 → mint endpoint 不挂载；尝试清理 stale `setup_nonce.hash`（§5.3）；日志 `CLOSED(reason=token_exists)`。
3. **检查 `~/.meowth/runtime/setup_nonce.hash` 是否存在 + 可读**。不存在 → mint endpoint 不挂载；日志 `CLOSED(reason=no_nonce_file)`。
4. **解析 hash 文件 JSON**（按 §4.2 schema 严格校验）。解析失败 / 字段缺失 / 字段类型错误 → mint endpoint 不挂载；日志 `CLOSED(reason=nonce_invalid)`；**不**删除 hash 文件（让用户走 §10 恢复路径，不暗示 `init --skip-token` 可原地修复）。
5. **检查 `algorithm` / `one_shot` 字段值**。`algorithm != "argon2id"` 或 `one_shot != true` → mint endpoint 不挂载；日志 `CLOSED(reason=nonce_invalid)`；不删 hash 文件。
6. 全部通过 → daemon 把 hash 文件内容（salt + digest + 参数）加载到**进程内存窗口对象** `mintWindow`；mint endpoint 挂载；日志 `first-run mint window: OPEN`。

**对 02 的兼容**：mint endpoint 不挂载状态下，访问 `POST /bootstrap/mint` 走 chi router 默认 404 + problem+json `type=not_found`（与 §6.5 统一 404 一致）。

### 5.2 mintWindow 内存对象

```go
type MintWindow struct {
    Algorithm    string  // "argon2id"
    Version      uint32  // 19
    MemoryKiB    uint32  // 65536
    TimeCost     uint32  // 3
    Parallelism  uint8   // 4
    Salt         []byte  // 16
    Digest       []byte  // 32
    NoncePath    string  // 用于成功/lockout 时删文件

    Mu           sync.Mutex
    FailureCount int     // 进程内累计（§7）
    Closed       bool    // lockout / consumed 后设 true
}
```

daemon 启动后 mintWindow 在内存内可读：

- daemon 重启 → 进程内存清空 → `FailureCount` 归 0；但只要 hash 文件还在且 daemon 启动期通过 §5.1 的全部检查，**窗口仍可继续接受 mint**
- 进程内 `FailureCount` 不跨重启累计；§7.3 已明确：达到 5 后只有 `os.Remove(hash)` **成功**时重启不可恢复；`os.Remove` 失败时 hash 仍在、重启会重新打开窗口（要求人工清理或 `meowthd bootstrap-token`）。5 次累计永远在单次 daemon 进程内发生

### 5.3 Stale hash 清理

§5.1 step 2 在 `tokens` 表非空但 hash 文件仍存在时：

- 关闭 mint endpoint
- **同步删除** stale `setup_nonce.hash`（`os.Remove`）；失败仅日志告警，不阻塞启动
- 日志写 `cleaned stale nonce: <reason: token_exists>`

这是路径 A 跑过后 / 历史 path B 残留 / mint 已成功但删文件失败（§6.4）的兜底。

---

## 6. `POST /bootstrap/mint` 行为契约

### 6.1 路由挂载

- 仅当 daemon 启动期 §5.1 全部通过、`mintWindow.Closed == false` 时**挂载到 chi router**
- 不走 v1 bearer middleware（[`02`](02-daemon-http-protocol.md) §3）
- 不走 v1 body_limit middleware 的 1 MiB 限额？**仍走**——`/bootstrap/*` 在 [`02`](02-daemon-http-protocol.md) §12 是 bearer_auth 豁免但 body_limit 仍生效；mint body 远小于 1 MiB，毫无影响

### 6.2 loopback 第二道门

**第一道门**是 §5.1 step 1（`remote_access.mode` 非默认本机 → endpoint 不挂载，从根上不存在）。

**第二道门**是 endpoint handler 内的 socket-level 检查：

```go
host, _, _ := net.SplitHostPort(r.RemoteAddr)
ip := net.ParseIP(host)
if ip == nil || (!ip.IsLoopback() && !isIPv4MappedLoopback(ip)) {
    return notFound(w) // 统一 404
}
```

其中 `IsLoopback()` 已覆盖 IPv4 `127.0.0.0/8` 与 IPv6 `::1`；额外检查 `::ffff:127.0.0.1` 等 IPv4-mapped 形式（在 darwin 上罕见但合规）。

**daemon 仅信任 socket-level `r.RemoteAddr`，不读** `X-Forwarded-For` / `Forwarded` / 任何代理头。理由：mint endpoint 不应该走代理（第一道门已禁），即便有人尝试用代理头伪造 loopback，第二道门也是真实 socket IP，不被影响。

### 6.3 成功路径（crash-safety + 并发互斥写入顺序）

```
1. 读 body { "setup_code": "..." }；格式 / JSON / size 检查 → 失败走统一 404（§6.5）
2. 校验 setup-code 长度（必须 43）、前缀（必须 "mws_"）→ 失败走统一 404
3. argon2id(setup_code, mintWindow.Salt, mintWindow.{Time/Memory/Parallelism}, len(Digest)) →
   subtle.ConstantTimeCompare(computed, mintWindow.Digest) →
   不等：在 mintWindow.Mu 锁内 FailureCount++；若 ≥ 5 → lockout（§7.2）；释放锁；200–500ms 抖动 sleep；返回 404
4. 命中：mintWindow.Mu 加锁
   - 4a. **锁内 re-check**（防并发双发 token）：
         - `mintWindow.Closed != true`
         - `SELECT EXISTS(SELECT 1 FROM tokens LIMIT 1)` 必须仍为 false（与 §5.1 step 2 同 SQL）
         - `os.Stat(mintWindow.NoncePath)` 仍存在
         任一不满足：释放锁，走 §6.5 统一 404；同上不计入 FailureCount（已成功 argon2 比对，不视为攻击）
   - 4b. 生成 root token：mwt_ + base32(24 byte)
   - 4c. INSERT tokens(... created_via='first_run_mint' ...) — 在事务中
   - 4d. 事务 COMMIT 成功
   - 4e. `os.Remove(mintWindow.NoncePath)` — 删 hash 文件；失败仅日志告警（§6.4）
   - 4f. mintWindow.Closed = true — 关闭内存窗口
   - 4g. 释放锁
5. 响应 201 + JSON（§4.3）
```

**关键不变量**：

- token INSERT **必须在**删 hash 文件**之前**完成。理由：如果先删 hash 再 INSERT，INSERT 失败时窗口已没了、客户端拿不到 token、用户必须用应急通路恢复——这是糟糕的可恢复性。
- 删 hash 文件失败**不**回滚 INSERT。理由：token 已经写进 SQLite 表非空了，下次 daemon 重启走 §5.1 step 2 会发现"`tokens` 非空 + hash 文件存在"，触发 §5.3 stale 清理。
- **并发互斥**：两个并发 mint 请求即使都通过 argon2 比对，只有第一个进入锁后通过 step 4a re-check 才能创建 token；第二个看到 tokens 非空 / `mintWindow.Closed=true`，走统一 404 但**不**计入 FailureCount（避免合法请求被并发争用引发 lockout）。
- **FailureCount 仅在锁内修改**（step 3 与 §7），保证计数与 `Closed` 翻转之间无 race。

### 6.4 删 hash 文件失败的处置

- 失败原因可能：filesystem 不可写（极少）、文件被另一进程占用（Windows 罕见，darwin 不会）
- daemon 在响应里**不**告知客户端这一异常（客户端拿到 token 即可）
- 日志写 `WARN: failed to remove setup_nonce.hash after successful mint; will be cleaned at next startup`
- 下次 daemon 启动 §5.3 stale 清理负责消除

### 6.5 失败统一 404（"不区分原因"）

**作用域**：本节统一外观**仅覆盖请求已进入 mint handler 后**的失败。早于 handler 的 middleware 失败按 02 既有约定返回：

- `body_limit` 超 1 MiB → 02 §10.2 默认 `413 payload_too_large`（**不**向下转 404）；mint endpoint 不接管这一层
- `Origin` / `Sec-Fetch-Site` 浏览器来源门失败（§6.6）→ 404，但**不**计入 §7 失败计数（拒绝早于 setup-code 比对）
- mode 非默认导致 endpoint 未挂载 → chi router 默认 404（不抖动、不计数）

进入 mint handler 后的所有失败统一外观：

| 失败原因 | HTTP status | Body | 计入 §7 FailureCount + 抖动 |
|----------|------------|------|----------------------------|
| body JSON malformed | 404 | `application/problem+json { "type":"/problems/not_found", "title":"Not Found", "status":404 }` | **是** |
| setup-code 格式错（长度 / 前缀） | 404 | 同上 | **是** |
| setup-code argon2 不等 | 404 | 同上 | **是** |
| 锁内 re-check 失败：`mintWindow.Closed=true` / `tokens` 非空 / hash 缺失（§6.3 step 4a） | 404 | 同上 | 否（并发争用 / 已被另一成功 mint 占用，不视为攻击） |
| lockout 已发生（请求落在 `Closed=true` 后） | 404 | 同上 | 否 |

**Body 永远不告诉客户端为什么**；日志可以写**内部** reason（`mint: 404 reason=hash_mismatch ip=127.0.0.1 ...`），但不写明文 setup-code、不写 hash 字面值。

**抖动覆盖范围**：上表"计入"列为**是**的 3 种 mint handler 内失败（body malformed / 格式错 / argon2 不等）走 200–500ms 随机 sleep；锁内 re-check 失败与 lockout 后请求**不抖动**——它们是合法 mint 与并发/状态争用的产物，让客户端尽快收到 404 即可。

**关于"早期 token 非空 / hash 缺失"**：在 daemon 进程生命周期内，启动期 §5.1 step 2–3 已完成一次性的早期检查；endpoint 挂载后，"早期"再次出现 token 非空 / hash 缺失只可能来自**并发 mint 已经成功**或**另一线程的 `os.Remove`**，这些场景由 §6.3 step 4a 的锁内 re-check 统一处理（已收纳到上表"锁内 re-check 失败"行）。本文档**不**再单独列"handler 内早期 token 非空"作为独立失败原因，避免实现者在 step 4a 之外再造一个不一致的早期检查。

### 6.6 浏览器来源门（防 drive-by lockout）

loopback 检查（§6.2）能挡住远程网络流量，但**挡不住**用户浏览器上其它网页向 `http://127.0.0.1:7777/bootstrap/mint` 发 POST：即使攻击者读不到响应（CORS 不返回），用 malformed body 连打 5 次也能触发 lockout（§7），达成 drive-by **DoS**（让合法 mint 不可用）。

mint endpoint handler 在 §6.2 loopback 检查**之后**追加**浏览器来源门**（这是 bootstrap endpoint 自身的 CSRF / drive-by lockout 防护，**不属于** 07 dashboard XSS/CSP 范畴）：

```go
origin := r.Header.Get("Origin")
fetchSite := r.Header.Get("Sec-Fetch-Site")

// 拒绝任何已知的跨站来源
if fetchSite == "cross-site" || fetchSite == "same-site" {
    return notFound(w) // 统一 404 外观
}

// Origin 必须缺失（非浏览器客户端如 curl）或等于 daemon 同源
if origin != "" {
    expectedOrigin := "http://" + r.Host // r.Host = "127.0.0.1:7777" 等
    if origin != expectedOrigin {
        return notFound(w) // 统一 404 外观
    }
}
```

规则细节：

- `Sec-Fetch-Site` 由浏览器写入，**不可被 JS 伪造**。`none` = 用户直接键入地址或脚本工具发请求（接受）；`same-origin` = 同源 fetch（接受）；`cross-site` / `same-site` 都来自其它页面（拒绝）
- `Origin` header：浏览器发起的 POST **必带**；缺失意味着不是浏览器（curl / Go HTTP client / dashboard 自己），允许
- 当 `Origin` 存在时必须等于 daemon 当前实际 `Host`（动态构造 `http://` + `r.Host`，避免 hardcode 端口）
- **失败外观与计数**：上述门失败统一走 §6.5 的 404 外观；**不**计入 §7 FailureCount（攻击者通过来源门外触发的请求不应能消耗合法用户的 5 次预算）；**不**抖动（避免让 drive-by 攻击者通过时序探测能力）
- 通过来源门的请求才进入 setup-code 解析与 argon2 比对路径（§6.3 step 1–5）

dashboard 自己的 mint 调用（路径 B 用户在 `/setup` 输 setup-code）由 daemon 同源（`http://127.0.0.1:7777` embed 出来的页面）发起，`Origin: http://127.0.0.1:7777` + `Sec-Fetch-Site: same-origin`，通过来源门毫无影响。

### 6.7 关于 `name`

daemon 写入 `tokens.name = "bootstrap"`（与 §3.1 step 4 路径 A 一致）。客户端 mint 请求 body 不允许指定 name；后续在 dashboard `Tokens` 页用户可以修改 `name`（[`02`](02-daemon-http-protocol.md) §9 未来扩展），不影响 secret。

---

## 7. Lockout

### 7.1 触发

`mintWindow.FailureCount` 在**进程内**累计已进入 mint handler 且通过 §6.6 来源门、§6.2 loopback 门的失败次数（即 §6.5 表中"计入 §7 FailureCount + 抖动"列为"是"的 3 种情形）。

**计入计数 + 抖动**（共 3 种，与 §6.5 表"是"列一致）：

- body JSON malformed
- setup-code 格式错（长度 / 前缀）
- setup-code argon2 不等

**不计入计数、也不抖动**：

- §6.6 浏览器来源门失败（攻击者通过来源门外触发的请求不消耗合法用户预算）
- §6.2 loopback 门失败
- mode 非默认导致 endpoint 未挂载（chi 默认 404，不进 handler）
- `body_limit` 超 1 MiB → 02 §10.2 默认 413（不进 handler）
- §6.3 step 4a 锁内 re-check 失败（已成功通过 argon2 比对，与并发争用 / 状态翻转相关，不视为攻击）
- 已 lockout（`mintWindow.Closed=true`）后的所有请求

所有计数与抖动相关的状态修改**都在 `mintWindow.Mu` 锁内**进行（§6.3 step 3 "在 mintWindow.Mu 锁内 FailureCount++"），避免计数与 `Closed` 翻转之间的 race。

### 7.2 触发后动作

当 `FailureCount >= 5`（在 §6.3 step 3 的锁内判定）：

1. `mintWindow.Closed = true`
2. `os.Remove(mintWindow.NoncePath)` —— 尝试删除 hash 文件
3. 后续所有 mint 请求走 §6.5 统一 404
4. 日志 `first-run mint window: CLOSED(reason=locked_out)`，写明 `FailureCount=5`

**`os.Remove` 失败的处置**（诚实写出来）：

- 失败原因极少（filesystem 不可写 / 权限错配），但仍可能发生
- daemon 日志写 **CRITICAL** 级：`failed to remove setup_nonce.hash after lockout: <err>; manual cleanup required`
- 在当前 daemon 进程内 lockout 仍**有效**（`mintWindow.Closed=true` 是进程内事实）
- **重启后的真实语义**：`FailureCount` 不持久化，hash 文件仍在；§5.1 step 3 看到 hash 文件**会重新打开 mint 窗口**，攻击者可以再用 5 次尝试。这是 `os.Remove` 失败时的真实行为，不要假装"等价 lockout 持久化"。
- 恢复路径：用户手工 `rm ~/.meowth/runtime/setup_nonce.hash`，或运行 `meowthd bootstrap-token`（§8）让 token 表非空 → §5.1 step 2 拒绝挂载 + §5.3 stale 清理兜底

### 7.3 跨重启语义（明文）

`FailureCount` **不**跨重启累计。这是有意设计：

- 若达到 5 且 `os.Remove(hash)` 成功：hash 文件已删，重启后 §5.1 step 3 走 `no_nonce_file` 关窗口 → 等价于 lockout 持久化
- 若达到 5 但 `os.Remove(hash)` 失败：见 §7.2 末段"重启后的真实语义"——hash 仍在，重启后 mint 窗口会重新打开；这是真实行为，不掩盖
- 若 < 5 重启：FailureCount 归 0，但 hash 文件仍在，窗口在下次启动后仍接受 mint —— 这意味着攻击者可以通过反复重启 daemon 绕开累计 5 次的阈值

**为什么仍接受这个语义**：

- 路径 B 的攻击者要能反复重启 daemon → 已经在本机 root；root 权限可以直接读写 SQLite，bootstrap 防护无意义
- 把 FailureCount 写盘需要把 hash 文件改成可写文件 + 写并发原子保证，与 §4.2 "文件只读" 不变量冲突，复杂度劣于收益
- 5 次抖动 200–500ms = 1–2.5s wall-clock，反复重启 daemon 的开销远大于此

### 7.4 Lockout 后的恢复

V1 **唯一**恢复路径：`meowthd bootstrap-token`（§8）应急通路。

**不**提供 `meowthd init --skip-token --renew-setup-code` 之类的子命令，避免引入第三条 init 语义。`meowthd init --skip-token` 在 lockout 后用户重跑也会被 §3.1 step 1 的幂等检查（`~/.meowth/` 已存在）拒绝。

---

## 8. 应急通路 · `meowthd bootstrap-token`

### 8.1 触发场景

- 用户丢失所有 token（dashboard 撤销光、忘了存）
- 路径 A/B 错过 stdout 单次明文
- 路径 B lockout 后用户仍需要新 token
- 任何"daemon 仍有 SQLite 但无可用 token"的情况

### 8.2 流程

1. **daemon 必须停机**：命令首先尝试取得 `~/.meowth/meowth.db` 的 SQLite 写锁（busy_timeout=5000）；取不到 → 提示 "daemon 仍在运行，请先 `meowthd stop` 或 SIGTERM PID（见 `~/.meowth/runtime/meowthd.pid`）"，退出 1
2. 直接 open SQLite（不通过 HTTP）
3. 生成 root token（与 §3.1 step 4 同源算法）
4. INSERT `tokens(... created_via='cli', name='emergency bootstrap' ...)`
5. stdout 单次打印明文 secret + dashboard URL
6. 退出 0

**与 03 §4.5 `created_via` enum 的一致性**：应急通路写 `cli`，**不**新增 `bootstrap_token` 枚举值；03 enum 不变。`name` 用固定可读字符串 `"emergency bootstrap"` 让用户在 dashboard 列表中能识别。

### 8.3 不要求的事

- **不**要求 `tokens` 表为空（否则"丢失全部 token 但表非空"无法救——例：误把所有 token 设 `revoked_at`）
- **不**要求 `setup_nonce.hash` 存在
- **不**要求 `remote_access.mode` 为默认本机（命令是本机 CLI，不走 HTTP）
- **不**通过 HTTP、无法被远程触发（无路由、无 endpoint）

---

## 9. Token 显示策略（硬性，跨所有通路）

与 [`docs/01-project-overview.md`](../01-project-overview.md) §7.8 末段 + [`02`](02-daemon-http-protocol.md) §9.1 + [`03`](03-sqlite-schema-and-tokens.md) §10.4 一致：

- 任何创建端点 / CLI 命令的响应里，secret **仅出现一次**：
  - 路径 A：`meowthd init` stdout
  - 路径 B：`POST /bootstrap/mint` HTTP response
  - 应急通路：`meowthd bootstrap-token` stdout
  - 普通通路：`POST /v1/tokens` HTTP response（[`02`](02-daemon-http-protocol.md) §9.1）
- 之后 `GET /v1/tokens` **永不**返回 secret（[`03`](03-sqlite-schema-and-tokens.md) §10.2 SQL 不 SELECT `token_hash`）
- dashboard 创建 token 后弹 modal 让用户复制，关闭即失（详 → 06 / 07）

---

## 10. 失败模式（汇总）

| 失败 | 体现 | daemon 处置 |
|------|------|------------|
| `setup_nonce.hash` 文件 corrupted / JSON 不合法 | 字段缺失 / 类型错 | §5.1 step 4 `CLOSED(reason=nonce_invalid)`；**不删** hash 文件；日志写明；恢复路径见 §10 末段 |
| `algorithm != "argon2id"` / `one_shot != true` | 未来扩展时若旧 daemon 读新 hash | §5.1 step 5 `CLOSED(reason=nonce_invalid)`；不删 hash 文件 |
| `tokens` 表非空但 hash 文件存在 | 路径 A 跑过后用户错误执行 `init --skip-token` 被幂等拒绝、未清理 hash | §5.3 mint 关闭 + `os.Remove(stale)`；日志 |
| 5 次失败 lockout | 攻击 / 用户错输 | §7.2 删 hash + `Closed=true`；后续走 §6.5 统一 404 |
| daemon 在 INSERT 后、`os.Remove` 前崩溃 | 极少 | §5.3 stale 清理在重启后兜底 |
| 多个 mint 请求并发到达同一窗口 | 极少（loopback + 本机） | §6.3 `mintWindow.Mu` 加锁；第一个成功后 `Closed=true`，后续请求落到 §6.5 统一 404 |

**`nonce_invalid` 与 lockout 之后的恢复路径（明文）**：

- daemon 启动期 §5.1 看到 `setup_nonce.hash` invalid，daemon 关闭 mint 窗口、不删 hash 文件；用户必须**手工**清理或替换：
  1. `rm ~/.meowth/runtime/setup_nonce.hash` 后再用 `meowthd init --skip-token` 重置——**但** `~/.meowth/` 已存在，§3.1 step 1 幂等检查会拒绝；要重置必须先**手工 destructive 清理**整个 `~/.meowth/`（备份 SQLite 后 `rm -rf`），再 `meowthd init --skip-token`
  2. 或运行 `meowthd bootstrap-token`（§8）注入 root token；token 表非空后，下次 daemon 启动 §5.1 step 2 拒绝挂载 + §5.3 stale 清理兜底——这是**非 destructive** 的首选恢复
- daemon **不**提供 `meowthd init --skip-token --renew-setup-code` 之类的原地修复（§7.4 已说明）；不要在恢复文案中暗示普通 `init --skip-token` 可以原地修复 corrupted hash 或 lockout 状态

---

## 11. 测试矩阵（与 6DQ 的映射）

> 详 → 08；本节只列 04 范围内的覆盖目标。

| 层 | 覆盖什么 |
|----|---------|
| **L1** | setup-code 生成长度/字符集；hash JSON 编解码（含 `version=19` decimal、`salt_b64`/`digest_b64` 长度校验）；argon2id 参数喂入 `argon2.IDKey` 一致性；mintWindow 状态机（OPEN/CLOSED/lockout）；loopback IP 判断（含 `::ffff:127.0.0.1`） |
| **L2** | mint handler 内 3 种计数失败外观一致并抖动：body malformed / 格式错 / argon2 不等（body 和 timing 都不区分）；锁内 re-check（`Closed=true` / tokens 非空 / hash 缺失）返回同款 404 但**不计数不抖动**；已 lockout 后请求返回同款 404 但不计数不抖动；one-shot：成功 mint 后立即再请求 → 404；抖动覆盖：argon2 不等的 5 次响应时间分布；5 次 lockout 后第 6 次"正确" code 也 404；远程模式下 endpoint 启动期未挂载（请求拿 `chi` 默认 404，**不**经 mint handler，**不**抖动）；socket-level loopback 检查（伪造 `X-Forwarded-For` 不绕过）；**浏览器来源门**：`Sec-Fetch-Site: cross-site` / `same-site` → 404 不计数不抖动；`Origin` 不匹配 daemon 同源 → 404 不计数不抖动；`Origin` 缺失（非浏览器客户端） → 通过来源门进入 mint 逻辑；drive-by lockout 不可达（来源门外触发的失败不消耗 FailureCount） |
| **L3** | 路径 A：`meowthd init` → `/setup` 手输入框 → dashboard 调通 agent；路径 B：`meowthd init --skip-token` → 取 setup-code → `/setup` mint → dashboard 调通；远程模式 + path B：mint endpoint 404 |
| **跨进程测试**（[`docs/01-project-overview.md`](../01-project-overview.md) §7.8 必须验证） | init `--skip-token` 进程 **A** 退出 → daemon 进程 **B** 启动 → daemon 进程 **B** 重启 N 次（N≥3）→ 仍可用**同一** setup-code mint；mint 成功后 daemon 重启 → mint endpoint 不挂载（窗口已关 + hash 已删 + tokens 非空） |
| **崩溃 / 残留** | token INSERT 成功但 `os.Remove(hash)` 失败的 stale hash：手工注入 stale，重启 → §5.3 清理 + endpoint 不挂载；tokens 非空 + hash 存在 mint 请求 → 404；lockout `os.Remove(hash)` 成功后重启 → 仍关闭；**lockout `os.Remove(hash)` 失败分支**：mock filesystem 拒绝 `Remove` → 当前进程 lockout（`mintWindow.Closed=true`，后续请求 404）+ CRITICAL 日志；daemon 重启后 hash 仍在 → §5.1 step 3 通过 → 窗口**重新打开**（这是真实行为，§7.2 末段 / §7.3 第二项已承认）；恢复路径 `meowthd bootstrap-token` 让 token 表非空 → 重启 §5.1 step 2 关窗口 + §5.3 stale 清理兜底 |

---

## 12. 原子化提交计划（对应 [`docs/01-project-overview.md`](../01-project-overview.md) §9.2 Phase 3.5 / 3.8）

| Commit | Phase | 内容 |
|--------|-------|------|
| `feat(daemon): meowthd init command (+ --skip-token)` | 3.5 | §3 路径 A + §4.1 路径 B（不含 mint endpoint）；§4.2 hash 文件落盘；幂等检查；stdout 单次打印；L1 + CLI e2e |
| `feat(daemon): first-run mint endpoint (mode-gated + loopback + nonce-hash + one-shot + lockout)` | 3.8 | §5 启动期检测；§6 mint endpoint；§7 lockout；与 05 `remote_access.mode` 协作；L2 五种 404 + 跨进程重启；崩溃测试 |
| `feat(daemon): meowthd bootstrap-token` | 与 3.5 同 commit 或紧随 | §8 应急通路；本文档 §12 commit 计划允许把它并进 3.5（同属 init/CLI 范畴），由 Phase 3.5 SDE 视代码量决定 |

每个 commit 自带必要测试 + G1/G2 hook 全绿 + 不留 TODO。

---

## 13. 未决问题

| # | 问题 | 决策方 | 状态 |
|---|------|-------|------|
| 1 | 失败抖动 200–500ms 是否需要随机种子来自 `crypto/rand` 而非 `math/rand`？v1 用 `crypto/rand` 取一个 byte 转范围即可；性能足够 | 实施 Phase 3.8 时 SDE 复核 | 待 Phase 3.8 |
| 2 | `meowthd bootstrap-token` 是否需要支持 `--name <custom>` 让用户给应急 token 自定义名字？v1 写死 `"emergency bootstrap"` | @zheng-li 可后续提 | 暂不实现 |
| 3 | mint endpoint 是否在 `mintWindow.Closed=true` 后**立刻**从 chi router 卸载，还是保留挂载但 handler 走 §6.5 统一 404？v1 倾向后者（简化路由维护），但两者外观对客户端等价 | 实施 Phase 3.8 时 SDE 复核 | 待 Phase 3.8 |

---

## 14. 相关文档

- 上层：[`docs/01-project-overview.md`](../01-project-overview.md) §7.8 / §9.2
- 兄弟文档：
  - [`02-daemon-http-protocol.md`](02-daemon-http-protocol.md)（mint endpoint 是 02 §3 特例端点；body_limit 仍生效；不走 bearer middleware）
  - [`03-sqlite-schema-and-tokens.md`](03-sqlite-schema-and-tokens.md)（`tokens` DDL、argon2id 参数源、`created_via` enum、token secret 生成、token wire 模型）
  - `05-remote-access-modes.md`（`remote_access.mode` 取值与"默认本机"语义；本文档只消费判定结果）
  - `06-dashboard-mvvm-and-basalt.md`（`/setup` 页面手输入框 + mint 表单两种 UI 模式）
  - `07-dashboard-security-csp-and-xss.md`（dashboard 显示 secret 的 UX）
  - `08-6dq-hooks-wiring.md`（跨进程测试 harness 怎么搭）
- 工作约束：[`../../CLAUDE.md`](../../CLAUDE.md)
