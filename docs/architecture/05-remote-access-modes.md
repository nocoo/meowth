# Architecture · 05 · Remote access modes

> **更新规则**：本文档定义 daemon 的远程访问模式 enum、`config.toml` `[remote_access]` 块完整 schema、bind 地址校验、启动期诊断输出、以及该 mode 与 04 mint endpoint 的联动。
> 任何 mode enum 扩展、bind 校验表改动、诊断文案改动，必须先回到这里更新，再向下推进。
> 历史在 `git log -- docs/architecture/05-remote-access-modes.md`。

> 上层依据：[`docs/01-project-overview.md`](../01-project-overview.md) §7.7、§9.2 Phase 3.9。
> 本文档**不涉及**：
> - HTTP wire schema、middleware chain（→ [`02-daemon-http-protocol.md`](02-daemon-http-protocol.md)）
> - `tokens` 表 / argon2id（→ [`03-sqlite-schema-and-tokens.md`](03-sqlite-schema-and-tokens.md)）
> - `setup_nonce.hash` / mint endpoint 内部逻辑（→ [`04-bootstrap-and-first-run-mint.md`](04-bootstrap-and-first-run-mint.md)）
> - dashboard / CSP（→ `07-dashboard-security-csp-and-xss.md`）
> - 6DQ hook 接线（→ `08-6dq-hooks-wiring.md`）

---

## 1. 范围

本文档管：

- `config.toml` 中 `[remote_access]` 块的字段、类型、默认值
- 4 种 mode 枚举值（`local` / `tailscale` / `ssh_tunnel` / `https_proxy`）的语义与配置要求
- bind 地址校验表（每种 mode 允许 / 拒绝的 `bind_addr`）
- daemon 启动期校验流程与诊断输出文案
- mode 与 04 mint endpoint 的联动（`RemoteAccess.IsLocal()` 布尔值的来源）
- 三种远程暴露方式的运维操作样板（最简 hands-on）
- 明确禁止项的清单

本文档不管：

- token 是否暴露在 URL query、CSRF / drive-by 保护（→ 02 / 04）
- daemon CORS 行为（→ 02）
- Tailscale ACL / Caddy 证书细节（指向外部工具文档；本文档只给最简片段）

---

## 2. `[remote_access]` block schema

`~/.meowth/config.toml`（[`03`](03-sqlite-schema-and-tokens.md) §2 权限 0600）含此块：

```toml
[remote_access]
mode             = "local"           # "local" | "tailscale" | "ssh_tunnel" | "https_proxy"
bind_addr        = "127.0.0.1"       # IP literal or "localhost"; no CIDR, no port, no wildcard
bind_port        = 7777               # TCP port; default 7777
acknowledged_by  = ""                 # required when mode != "local"
```

### 2.1 字段约束

| 字段 | 类型 | 默认（仅当整个 `[remote_access]` 块缺失时适用） | 取值 |
|------|------|------|------|
| `mode` | string | `"local"` | enum 之一；其它值拒绝启动；缺失字段（块存在）→ 诊断 D0 |
| `bind_addr` | string | `"127.0.0.1"` | IP literal（`127.0.0.1` / `::1` / `100.64.x.y` 等）或字符串 `"localhost"`；详 §2.3 normalize 规则；缺失字段（块存在）→ 诊断 D0 |
| `bind_port` | int | `7777` | 1..65535；端口**仅**来自此字段，不允许在 `bind_addr` 里拼接；缺失字段（块存在）→ 诊断 D0 |
| `acknowledged_by` | string | `""` | 非空人类标签（用户名 / 团队 / 备注）；不是 secret；进诊断日志；**仅** `mode != "local"` 时必填且非空 |

**字段存在性的硬规则**：

- 缺**整个** `[remote_access]` 块 → 使用 §2.2 完整 local 默认（全部 4 个字段都按上表默认值填充）；不报错。
- `[remote_access]` 块**一旦存在**，`mode` / `bind_addr` / `bind_port` 这三个字段必须显式写出；缺任一字段 → 启动失败，诊断 **D0 missing field**（指明缺哪个字段、推荐补全）。这避免 TOML 局部默认悄悄改变监听地址或 mode。
- `acknowledged_by` 在 `mode = "local"` 时可缺失或为 `""`；`mode != "local"` 时必须显式非空字符串 → 诊断 D2。

`mode = "local"` 时 `acknowledged_by` 可缺失或空字符串（默认本机不需要审计标签）。

### 2.2 默认行为：缺 `[remote_access]` 块 = local

未在 `config.toml` 写 `[remote_access]` 块时，daemon 视为：

```toml
[remote_access]
mode      = "local"
bind_addr = "127.0.0.1"
bind_port = 7777
acknowledged_by = ""
```

**显式 vs 默认**：`mode = "local"` 也可显式写出（推荐，便于审计 + grep）；`tailscale` / `ssh_tunnel` / `https_proxy` **绝不**靠默认推导，必须显式 `mode = "..."` 且 `acknowledged_by` 非空——这一约束直接来自 [`docs/01-project-overview.md`](../01-project-overview.md) §7.7 "防止悄悄改 config 暴露公网"。

### 2.3 `bind_addr` 解析与 normalize

config 字段允许写：

- IPv4 literal：`"127.0.0.1"`、`"100.64.0.1"` 等
- IPv6 literal（**不含**方括号）：`"::1"`、`"fd7a:115c:a1e0::1"` 等
- 字符串 `"localhost"`：**固定 normalize 为 `127.0.0.1`**（**不**做任何 DNS 解析；DNS 可能返回非 loopback 或 IPv6 地址，必须按确定值处理）；用户若需要 IPv6 loopback 必须显式写 `"::1"`

**拒绝**的写法（启动失败）：

- `"0.0.0.0"` / `"::"`（wildcard，本文档明令禁止）
- 空字符串
- 带 CIDR 后缀：`"127.0.0.1/8"`
- 带端口：`"127.0.0.1:7777"` / `"[::1]:7777"`（端口只能来自 `bind_port`）
- 非 IP / 非 `"localhost"` 的任意字符串（`"meowth.local"`、`"my-mac"` 等）

**实现要点**：

- 先做 `"localhost"` → `"127.0.0.1"` 的字符串替换，再用 Go `net/netip.ParseAddr` 解析；解析失败 → 拒绝
- 用 `netip.Prefix.Contains` 做 CIDR 归属判断（§4 校验表），**不**做字符串前缀匹配
- 拼接最终 listen address 时按 Go `net.JoinHostPort` 规则（IPv6 加方括号）：`net.JoinHostPort(bindAddr, strconv.Itoa(bindPort))`；但 config 字段**永远**只存裸 `bind_addr`

### 2.4 `mode = local` 的精确语义（关键边界）

`mode = "local"` **不**等于"daemon 不可被远程访问"。daemon 自身只 bind loopback，但用户可以在 daemon 外部跑：

- SSH tunnel：`ssh -L 7777:127.0.0.1:7777 mac`，远端通过 SSH 转发 → 触达本机 loopback
- HTTPS reverse proxy：Caddy / Cloudflare Tunnel 配置 upstream `127.0.0.1:7777`，公网通过反代 → 触达本机 loopback
- 任何其它本机进程把外部流量转成 loopback 请求

如果用户**意图**让远程客户端访问 daemon，必须按真实暴露方式把 `mode` 设为 `ssh_tunnel` / `https_proxy` / `tailscale`，**即使 daemon 仍 bind loopback**。这是因为：

- 04 mint endpoint 在 `mode != local` 时启动期就**不挂载**（[`04`](04-bootstrap-and-first-run-mint.md) §5.1 step 1）；若依旧用 `mode = local`，外部 tunnel/proxy 转发的请求会通过 loopback 触达 `/bootstrap/mint`，绕过 mint endpoint 的远程禁用约束
- 安全 / 审计预期失配：`acknowledged_by` 不会被填，运维变更无追溯线索

**铁律**：`mode = local` **仅适用于**用户在本机使用 daemon（dashboard 由 daemon embed 自己提供，本机浏览器 + curl），且**不**外接任何 tunnel / proxy / 第三方网络转发。一旦外接，必须改 mode。本文档不能在工具层强制（daemon 看不到外面有没有 ssh tunnel），但**通过文档约束 + 诊断文案 + 测试矩阵警告**让用户在配置阶段意识到。

---

## 3. mode 枚举与运维语义

### 3.1 `local`（默认）

- 用途：开发者本机使用 daemon；不外接任何远程转发
- bind：`127.0.0.1` 或 `::1`（精确等于；`localhost` normalize 为 `127.0.0.1`，§2.3）
- mint endpoint：**挂载**（启动期检查通过；[`04`](04-bootstrap-and-first-run-mint.md) §5.1 step 1）
- `acknowledged_by`：可空

### 3.2 `tailscale`

- 用途：通过 [Tailscale](https://tailscale.com/) Tailnet 直连本机；零运维证书，依赖 Tailscale ACL 控制 device 访问
- bind：本机 Tailscale IP（`100.64.0.0/10` IPv4 或 `fd7a:115c:a1e0::/48` IPv6），且必须出现在 `net.InterfaceAddrs()`（§4.1）
- mint endpoint：**不挂载**（[`04`](04-bootstrap-and-first-run-mint.md) §5.1 step 1 `CLOSED(reason=remote_access_mode)`）
- `acknowledged_by`：必填非空

### 3.3 `ssh_tunnel`

- 用途：远端机器通过 `ssh -L` 把 daemon 本机端口转发到远端；单连接、低频
- bind：**仅** `127.0.0.1` 或 `::1`（精确等于；`localhost` normalize 为 `127.0.0.1`）
- mint endpoint：**不挂载**
- `acknowledged_by`：必填非空

### 3.4 `https_proxy`

- 用途：本机前面挂 Caddy / Cloudflare Tunnel，反代到 daemon loopback；多端 / 常驻
- bind：**仅** `127.0.0.1` 或 `::1`（反代必须与 daemon 同机，daemon 不直接面向 Internet）
- mint endpoint：**不挂载**
- `acknowledged_by`：必填非空

---

## 4. Bind 校验表（与 [`docs/01-project-overview.md`](../01-project-overview.md) §7.7 一致）

| `mode` | 允许的 `bind_addr` | 拒绝的 `bind_addr` |
|--------|--------------------|------------------|
| **`local`**（含未设置 `[remote_access]`） | 精确等于 `127.0.0.1` 或 `::1`（`localhost` normalize 到 `127.0.0.1`，§2.3） | 其它全部（含 `127.0.0.2` 之类非 `127.0.0.1` 的 loopback IP、Tailscale IP、公网 IP、wildcard） |
| **`tailscale`** | IPv4 `100.64.0.0/10`（Tailscale CGNAT 段）或 IPv6 `fd7a:115c:a1e0::/48` | 其它全部（loopback、公网 IP、wildcard） |
| **`ssh_tunnel`** | 精确等于 `127.0.0.1` 或 `::1`（仅 loopback；远端靠 `-L` 转发） | 其它全部（包括 Tailscale IP；SSH tunnel 的语义就是 daemon 只听本机） |
| **`https_proxy`** | 精确等于 `127.0.0.1` 或 `::1`（反代必须与 daemon 同机） | 其它全部 |
| **任何 mode** | — | **`0.0.0.0` / `::` 永远拒绝**，即使表里允许其它本地 IP 也不行（必须明确单一接口） |

**对 loopback 的严格定义**：本文档**只**允许两个 loopback literal：`127.0.0.1` 与 `::1`（`localhost` normalize 后等于 `127.0.0.1`）。不接受 `127.0.0.0/8` 范围内的其它 IP（如 `127.0.0.2`）——尽管 macOS 内核接受 bind，但 `net.InterfaceAddrs()` 通常只列 `127.0.0.1/8` 的子网描述，逐个 IP 校验会失败；而且 v1 没有 use case 需要非 `127.0.0.1` 的 loopback alias，简单收紧能避免 §4.1 接口归属校验歧义。

### 4.1 额外的"本机可绑定"校验

CIDR / loopback 精确匹配只说明地址类型，**不**保证这台机器拥有该 IP。daemon 启动期对 `bind_addr` 解析后的 IP **额外**校验：

- 对 `tailscale` mode：`bind_addr` 解析得到的 IP 必须以**精确相等**方式出现在 `net.InterfaceAddrs()` 返回的 IP 列表中（注意：`InterfaceAddrs()` 返回 `net.Addr` 实际是 `*net.IPNet`，要从 `IPNet.IP` 字段取 IP 并和 `bind_addr` 比对）
- 对 `local` / `ssh_tunnel` / `https_proxy` mode：`bind_addr` 解析后为 `127.0.0.1` 或 `::1`；macOS / Linux 默认 loopback 接口存在，**不**做接口校验（loopback 接口缺失是极端不正常的内核状态，归 listen error 处理）
- 不在本机接口列表里（仅适用 `tailscale`）→ 启动失败，诊断指向"先启动 Tailscale 并用 `tailscale ip` 给出的实际 IP"

这一步主要覆盖 Tailscale 未运行场景：`bind_addr` 写了 `100.x.y.z` 但 `tailscale up` 未跑 → `InterfaceAddrs()` 无该 IP → D6。

### 4.2 CIDR / loopback 判断的实现要求

- IPv4 Tailscale 段：`netip.MustParsePrefix("100.64.0.0/10").Contains(addr)`
- IPv6 Tailscale 段：`netip.MustParsePrefix("fd7a:115c:a1e0::/48").Contains(addr)`
- loopback（local / ssh_tunnel / https_proxy）：**精确相等** `addr == netip.MustParseAddr("127.0.0.1") || addr == netip.MustParseAddr("::1")`；**不**用 `netip.Addr.IsLoopback()`（它覆盖整个 `127.0.0.0/8`，与本文档严格定义不符）
- wildcard：用 `netip.Addr.IsUnspecified()`（覆盖 `0.0.0.0` 与 `::`）

**Tailscale IPv6 段的实现注**：实现必须用 `netip.Prefix` 精确判断，不用字符串前缀；本机 / CI 测试环境若无法稳定拿到 Tailscale IPv6（macOS Tailscale 默认开 IPv6，但 CI runner 上没有 Tailscale），L1 测试用注入的 fake IP 走 parser；L2 测试可以先只覆盖 IPv4 tailscale IP，IPv6 由 release 前手工本机验证（详 → 08）。

---

## 5. 启动期校验流程

daemon 启动**早于挂载 HTTP listener** 完成以下校验（按顺序）：

```
1. 读取 ~/.meowth/config.toml；若缺整个 [remote_access] 块 → 等价 §2.2 默认（全 local + loopback + 默认 port），跳到 step 8
1a. 若 [remote_access] 块存在但缺 mode / bind_addr / bind_port 任一字段 → 启动失败 (诊断 D0)
2. 解析 mode：必须是 enum 之一；其它值 → 启动失败 (诊断 D1)
3. 校验 acknowledged_by：mode != "local" 时必须非空 → 否则启动失败 (诊断 D2)
4. 解析 bind_addr：按 §2.3 normalize；拒绝写法 → 启动失败 (诊断 D3)
5. 解析 bind_port：1..65535；越界 → 启动失败 (诊断 D4)
6. 按 §4 表校验 bind_addr ∈ allow_set(mode) → 否则启动失败 (诊断 D5)
7. 按 §4.1 校验本机接口归属：**仅** `tailscale` mode 校验 `bind_addr ∈ net.InterfaceAddrs()`；loopback mode 不做此步（§4.1 说明）→ 否则启动失败 (诊断 D6)
8. 把校验通过的 (mode, bind_addr, bind_port, acknowledged_by) 写入 daemon runtime config 对象
9. 在 daemon 启动日志写一行: `remote_access: mode=<m> bind=<addr>:<port> acknowledged_by=<label>`
   - acknowledged_by 进日志是有意的（非 secret，便于运维审计）
```

任一步骤失败：

- daemon 退出 1
- stderr 打印诊断（§6）
- **不**触碰 SQLite、**不**写任何文件
- pre-existing daemon（若有）通过 PID 文件不受影响

校验通过后，daemon 暴露：

```go
type RemoteAccess struct {
    Mode            string  // "local" | "tailscale" | "ssh_tunnel" | "https_proxy"
    BindAddr        netip.Addr
    BindPort        uint16
    AcknowledgedBy  string
}

func (r *RemoteAccess) IsLocal() bool {
    return r.Mode == "local"
}
```

[`04`](04-bootstrap-and-first-run-mint.md) §5.1 step 1 通过 `IsLocal()` 判定 mint endpoint 是否挂载；该函数**仅**看 `Mode`，不看 `BindAddr` 是不是 loopback——这是 §2.4 "bind loopback ≠ IsLocal" 的代码层落地。

---

## 6. 诊断输出（固定文案）

所有启动失败诊断**三段式**：现状 / 期望 / 修复建议。stderr 输出，UTF-8，每行 ≤ 100 字符（macOS Terminal 默认宽度友好）。

### 6.1 通用结构

```
meowthd: startup failed — remote_access validation

  state:
    mode           = <实际 mode 字面值>
    bind_addr      = <实际 bind_addr 字面值>
    bind_port      = <实际 bind_port>
    acknowledged_by = <实际 acknowledged_by>

  reason:
    <一句话拒绝原因>

  fix:
    <可复制的修复片段 + 命令>

  doc: docs/architecture/05-remote-access-modes.md §<相关小节>
```

### 6.2 文案样板

**D0 — `[remote_access]` 块存在但缺必填字段**：

```
  reason: [remote_access] block is present but field "<name>" is missing
          (when the block is present, mode/bind_addr/bind_port must all be explicit)
  fix:    add the missing field to ~/.meowth/config.toml; example for local mode:
            [remote_access]
            mode      = "local"
            bind_addr = "127.0.0.1"
            bind_port = 7777
          (or remove the entire [remote_access] block to fall back to defaults)
```

**D1 — `mode` 不在 enum**：

```
  reason: mode "<value>" is not a valid enum value
  fix:    set mode = "local" | "tailscale" | "ssh_tunnel" | "https_proxy"
          vim ~/.meowth/config.toml
```

**D2 — `acknowledged_by` 缺失**：

```
  reason: mode = "<m>" but acknowledged_by is empty
  fix:    add an audit label to [remote_access].acknowledged_by
          (any non-empty human label, e.g. "alice@laptop")
          vim ~/.meowth/config.toml
```

**D3 — `bind_addr` 写法错**：

```
  reason: bind_addr "<value>" rejected: <wildcard|empty|has_port|has_cidr|not_an_ip>
  fix:    write only an IP literal or "localhost"
          ports go in bind_port, not bind_addr
          vim ~/.meowth/config.toml
```

**D4 — `bind_port` 越界**：

```
  reason: bind_port <value> out of range (must be 1..65535)
  fix:    set bind_port to 7777 (default) or a free TCP port on this host
          vim ~/.meowth/config.toml
```

**D5 — `mode` 与 `bind_addr` 不匹配**：

```
  reason: mode = "<m>" but bind_addr = "<addr>" is not in the allowed set for this mode
  fix:    {根据 m 给三种具体片段，避免泛泛建议}
```

D5 子样板（按真实组合预生成；不可变模板）：

- `mode=ssh_tunnel` 却 bind Tailscale IP：
  ```
  fix:  ssh_tunnel must bind a loopback address (the remote side forwards via `ssh -L`)
        bind_addr = "127.0.0.1"
  ```
- `mode=tailscale` 却 bind loopback：
  ```
  fix:  tailscale must bind your Tailscale IP from 100.64.0.0/10 or fd7a:115c:a1e0::/48
        check it with:  tailscale ip
        bind_addr = "100.<x>.<y>.<z>"
  ```
- `mode=local` 但 bind Tailscale IP：
  ```
  fix:  local mode must bind loopback
        if you want remote access via Tailscale:
          mode = "tailscale"
          bind_addr = "<your tailscale ip from `tailscale ip`>"
          acknowledged_by = "<your audit label>"
  ```
- `mode=https_proxy` 却 bind 公网 IP：
  ```
  fix:  https_proxy must bind loopback; the reverse proxy (Caddy / cloudflared) must run on this host
        bind_addr = "127.0.0.1"
  ```

**D6 — bind_addr 不在本机接口**：

```
  reason: bind_addr "<addr>" is not bound to any local interface
  fix:    {按 mode 给具体建议}
```

D6 子样板（Tailscale-only，§4.1 接口归属校验只对 `tailscale` mode 触发）：

- `mode=tailscale` 但 `tailscale up` 未跑：`tailscale up` 后用 `tailscale ip` 取本机分配的实际 IP，写回 `bind_addr`
- `mode=tailscale` 且 `tailscale up` 已跑但 `bind_addr` 与 `tailscale ip` 输出不符：用 `tailscale ip` 的精确值更新 `bind_addr`

---

## 7. 与 04 mint endpoint 的联动（明确边界）

[`04`](04-bootstrap-and-first-run-mint.md) §5.1 step 1 描述了 mint endpoint 启动期依赖 `remote_access.mode`：

- `mode = local` → endpoint **挂载**（路径 B bootstrap 流程可用）
- `mode != local` → endpoint **不挂载**（路径 B 在远程模式下永远 404）

本文档承诺的契约：

1. daemon 启动期校验通过后暴露 `RemoteAccess.IsLocal() bool`
2. 04 仅消费 `IsLocal()` 返回值，**不**读 `BindAddr`、**不**读 `AcknowledgedBy`
3. 校验失败时 daemon 退出 1，根本到不了 04 §5.1 step 1——`IsLocal()` 在那个分支永不被调用

这是 §2.4 "bind loopback ≠ IsLocal" 在代码层的体现：04 mint endpoint 的远程禁用约束**只**取决于配置文件里写的 `mode`，不取决于 bind 类型。

---

## 8. 三种远程暴露方式的最简 hands-on（可复制）

> 真正的证书 / ACL / 长期运维交给对应工具的文档；本节只给"用户能马上跑起来"的最简片段，足以验证 daemon 在该 mode 下能被远端调用。

### 8.1 Tailscale

前置：本机已安装 Tailscale 并加入 Tailnet。

```bash
# 取本机 Tailscale IP
tailscale ip

# 假设是 100.64.10.20
```

`~/.meowth/config.toml`：

```toml
[remote_access]
mode            = "tailscale"
bind_addr       = "100.64.10.20"
bind_port       = 7777
acknowledged_by = "alice@laptop"
```

启 daemon：`meowthd start`。远端有 Tailscale 的机器可访问 `http://100.64.10.20:7777/`。ACL 在 Tailscale admin console 控制；建议给本机 device 加 `tag:meowth-server`，并限制可访问的 source tag。

### 8.2 SSH tunnel

`~/.meowth/config.toml`：

```toml
[remote_access]
mode            = "ssh_tunnel"
bind_addr       = "127.0.0.1"
bind_port       = 7777
acknowledged_by = "alice@laptop"
```

启 daemon。远端机器：

```bash
ssh -N -L 7777:127.0.0.1:7777 alice@mac.local
# 远端访问 http://127.0.0.1:7777/
```

### 8.3 HTTPS reverse proxy（Caddy）

`~/.meowth/config.toml`：

```toml
[remote_access]
mode            = "https_proxy"
bind_addr       = "127.0.0.1"
bind_port       = 7777
acknowledged_by = "alice@laptop"
```

`Caddyfile`（同机器）：

```
meowth.example.com {
    reverse_proxy 127.0.0.1:7777
}
```

Caddy 自己处理 TLS（ACME），upstream 仍 plain HTTP（daemon 不持证书；详 §9）。

### 8.4 HTTPS reverse proxy（Cloudflare Tunnel）

`~/.cloudflared/config.yml`（同机器）：

```yaml
tunnel: <tunnel-id>
credentials-file: <path>

ingress:
  - hostname: meowth.example.com
    service: http://127.0.0.1:7777
  - service: http_status:404
```

`cloudflared tunnel run` 在 daemon 同机器跑。Cloudflare 终止 TLS，upstream 通过 outbound connection 推到 daemon loopback。

---

## 9. 明确禁止

直接来自 [`docs/01-project-overview.md`](../01-project-overview.md) §7.7，本节作为权威落地：

- ❌ 裸 `0.0.0.0:7777` / `[::]:7777` 直接面对公网（任何 mode 都拒绝 wildcard）
- ❌ daemon 内置 TLS（自签或 ACME）——证书职责不进 daemon；让 Caddy / Cloudflare Tunnel / 反代终止 TLS
- ❌ 把 token 作为 query string 传（`?token=xxx`）；只允许 `Authorization: Bearer ...` header（[`02`](02-daemon-http-protocol.md) §2.2 已明文）
- ❌ remote mode 启用 daemon CORS（[`02`](02-daemon-http-protocol.md) §2.4 已明文 production zero-CORS；remote mode **不**改变这一策略）
- ❌ `mode = local` 配合外接 tunnel / proxy（§2.4 已明文；必须改 mode 让 04 mint endpoint 启动期禁用）

---

## 10. 测试落点（与 6DQ 的映射）

> 详 → 08；本节只列 05 范围内的覆盖目标。

| 层 | 覆盖什么 |
|----|---------|
| **L1** | TOML parser；mode enum 校验；`bind_addr` normalize（IP literal / `"localhost"` → 固定 `127.0.0.1` / 拒绝写法 8 类）；`netip.Prefix.Contains` 走 IPv4 Tailscale 段、IPv6 Tailscale 段；loopback 精确相等 `127.0.0.1` / `::1`（断言 `127.0.0.2` 被拒绝）；`bind_port` 边界；`RemoteAccess.IsLocal()` 返回值；诊断文案 D0–D6 各一个 unit test 校 stderr 输出包含期望字段 |
| **L2** | daemon 启动期校验完整矩阵：(a) 缺整个 `[remote_access]` 块 → 默认 local + 启动成功；(b) 块存在但缺字段 → D0；(c) `mode` 非 enum → D1；(d) `mode != local` + `acknowledged_by=""` → D2；(e) `bind_addr` 写法错 → D3；(f) `bind_port` 越界 → D4；(g) mode×bind 不匹配 → D5 子样板；(h) `tailscale` bind IP 不在接口 → D6（用 stub `net.InterfaceAddrs()` 注入 IP 列表）；启动失败时 SQLite / 文件未被触碰的断言；`mode = ssh_tunnel` + loopback 时 04 mint endpoint **不挂载**（启动期）；`mode = local` + loopback 时 mint endpoint **挂载** |
| **外部转发警告（文档层）** | 测试不可强制；§2.4 "bind loopback ≠ IsLocal" 的语义由 04 测试矩阵的 mint endpoint 挂载断言间接覆盖；L2 增加一条"`mode = local` + bind loopback + 模拟外部 SSH tunnel 传入请求 → mint endpoint 可达"的反例测试，**仅作为警告记录**（不强制 fail，目的让用户在 review 测试输出时看到这个语义） |

**关于 Tailscale IPv6 测试**：L1 用 `netip.MustParseAddr("fd7a:115c:a1e0::1")` 喂 parser 即可；L2 / 真实 listen 测试若 CI 无法稳定拿到 Tailscale IPv6 → 只跑 IPv4 tailscale IP（fixture：`100.64.10.20`），IPv6 由 release 前本机手工验证。

---

## 11. 原子化提交计划（对应 [`docs/01-project-overview.md`](../01-project-overview.md) §9.2 Phase 3.9）

| Commit | Phase | 内容 |
|--------|-------|------|
| `feat(daemon): remote_access config + bind validation` | 3.9 | §2 schema + §3 mode enum + §4 校验表 + §4.1 接口归属校验 + §5 启动期校验流程 + §6 诊断文案 D0–D6 + `RemoteAccess.IsLocal()` 暴露；L1 + L2 全覆盖 |

后续 04 mint endpoint 实施（Phase 3.8）依赖此 commit 完成；按 [`docs/01-project-overview.md`](../01-project-overview.md) §9.2 顺序 3.8 在 3.9 之前，需要 SDE 在 Phase 实施时确认是否调整顺序，或在 3.8 之前先落一个最小 `RemoteAccess.IsLocal()` stub（详 §13 未决问题 #1）。

每个 commit 自带必要测试 + G1/G2 hook 全绿 + 不留 TODO。

---

## 12. 失败模式

| 失败 | 体现 | daemon 处置 |
|------|------|------------|
| `config.toml` 不存在 | daemon 启动 | 视为缺整个 `[remote_access]` 块 = §2.2 默认 local；不报错 |
| `config.toml` 不是合法 TOML | parse 失败 | 启动失败，stderr 打印 parse 错误（行号），不进入 §5 校验 |
| `[remote_access]` 块存在但缺 `mode` / `bind_addr` / `bind_port` 任一 | §5 step 1a | 诊断 D0 |
| `mode` 是其它 enum | §5 step 2 | 诊断 D1 |
| `mode != local` 但 `acknowledged_by=""` | §5 step 3 | 诊断 D2 |
| `bind_addr` 写法错 | §5 step 4 | 诊断 D3 |
| `bind_port` 越界 | §5 step 5 | 诊断 D4 |
| `mode` 与 `bind_addr` 不匹配 | §5 step 6 | 诊断 D5 子样板 |
| `mode = tailscale` 的 `bind_addr` 不在 `net.InterfaceAddrs()` | §5 step 7 | 诊断 D6 子样板 |
| `mode = tailscale` 但 Tailscale 未运行 / IP 不在 `net.InterfaceAddrs()` | §5 step 7 | 诊断 D6 子样板 |
| `bind_addr` 在接口上但 `Listen` 失败（端口占用、权限、OS 错误） | §5 校验全部通过后 daemon 调用 `net.Listen` 阶段 | 普通 listen error 直接抛出；daemon 退出 1；不属于 `[remote_access]` validation 范畴；后续可加针对性 hint 但 v1 不强求 |

---

## 13. 未决问题

| # | 问题 | 决策方 | 状态 |
|---|------|-------|------|
| 1 | Phase 3.8 (mint endpoint) 顺序在 3.9 (remote_access 校验) 之前？Phase 3.8 测试需要 `RemoteAccess.IsLocal()`，可选方案：(a) 在 3.8 commit 内置一个 hardcoded `IsLocal() = true` stub，3.9 替换；(b) 调整顺序让 3.9 先于 3.8 | SDE 实施 Phase 3 时决定 | 待 Phase 3 |
| 2 | `acknowledged_by` 是否做长度上限（如 64 字符）？v1 不限，UTF-8 任意非空即可 | 实施 Phase 3.9 时复核 | 待 |
| 3 | 是否在 dashboard Settings 页面提供改 mode 的 UI？v1 倾向**不提供**（避免运维路径分散）；用户直接改 `config.toml` 后重启 daemon | @zheng-li | 暂不实现 |

---

## 14. 相关文档

- 上层：[`docs/01-project-overview.md`](../01-project-overview.md) §7.7 / §9.2 Phase 3.9
- 兄弟文档：
  - [`02-daemon-http-protocol.md`](02-daemon-http-protocol.md)（生产 zero-CORS；remote mode 不改）
  - [`03-sqlite-schema-and-tokens.md`](03-sqlite-schema-and-tokens.md)（`~/.meowth/` 目录与权限规则；`config.toml` 0600）
  - [`04-bootstrap-and-first-run-mint.md`](04-bootstrap-and-first-run-mint.md)（mint endpoint 通过 `IsLocal()` 决定挂载）
  - `06-dashboard-mvvm-and-basalt.md`（Settings 页面是否提供 mode UI，§13 #3）
  - `08-6dq-hooks-wiring.md`（L2 启动期校验测试 harness）
- 工作约束：[`../../CLAUDE.md`](../../CLAUDE.md)
