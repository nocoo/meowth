# Architecture · 01 · Agent SDK pump from multica

> **更新规则**：本文档定义 `daemon/pkg/agent/` 的来源、vendor 命令、裁剪 checklist、再次同步上游（pump）的流程。
> 任何对 `daemon/pkg/agent/` 的改动若涉及上游来源、vendor 边界或裁剪范围，必须先回到这里更新，再向下推进。
> 历史在 `git log -- docs/architecture/01-agent-sdk-pump-from-multica.md`。

> 上层依据：[`docs/01-project-overview.md`](../01-project-overview.md) §7.2、§9.2 Phase 3.1–3.2。
> 本文档**不涉及** HTTP 端点（→ `02-daemon-http-protocol.md`）、数据库/token（→ `03-sqlite-schema-and-tokens.md`）、bootstrap（→ `04-bootstrap-and-first-run-mint.md`）、CSP/XSS（→ `07-dashboard-security-csp-and-xss.md`）、6DQ hook 接线（→ `08-6dq-hooks-wiring.md`）。

---

## 1. 范围

本文档管：

- `daemon/pkg/agent/` 的源代码出处与许可证状态
- 哪些上游文件原样 vendor、哪些必须裁剪
- vendor 命令序列（可重复、可审计）
- `UPSTREAM.md` 的字段与维护规则
- 再次 pump 上游变更的标准流程
- daemon `go.mod` 的 Go 版本决策规则
- 上游新增 backend 时的处置决策模板

本文档不管：

- daemon HTTP 路由 / NDJSON envelope（→ 02）
- backend 配置持久化、token 表（→ 03）
- backend 调用是否需要身份认证（→ 02 / 03）
- dashboard 显示 backend 输出时的 sanitize（→ 07）
- backend e2e 测试如何在 CI 上跑（→ 08）

---

## 2. 上游锁定

### 2.1 仓库与锚点

- **Source repo**：`https://github.com/multica-ai/multica.git`
- **License**：上游仓库根有 `LICENSE`（Modified Apache 2.0，含 anti-SaaS + 保留 logo 条款）；根目录**无 `NOTICE`** 文件（写文档时核验，命令见 §2.3）。
- **本机调研镜像**：`~/workspace/reference/multica`。**仅作调研用，不作锁定锚点**。锁定永远以 GitHub 远端为准。
- **vendor 锚点字段**：`commit SHA`（40 字符 hex）。任何带 SHA 的 `UPSTREAM.md` 都必须等于某个真实的远端 commit；不允许使用 tag / branch name / 本机 SHA。

### 2.2 调研结果（写文档当下）

写本文档时核验的事实，仅作调研快照；后续 vendor 时必须重新核验：

| 项 | 值 |
|----|----|
| 远端 HEAD `git ls-remote origin HEAD` | `c0c41fa0b4015355c9d6dbd38501b8381a61a29a` |
| 本机镜像 HEAD（`~/workspace/reference/multica`） | `63b9b10df5b82169998cd37e4513ffd57a04f2ac`（比远端旧，仅作参考） |
| `server/pkg/agent/` 文件总数 | 61（递归含 `testdata/` 中 1 个 fixture）；顶层（不含 testdata 内文件）60 |
| `server/pkg/agent/testdata/` 内容 | 仅 `openclaw-2026.5.5-stdout.json`（属被裁 provider；§4.2 删除清单含它） |
| 根目录 `LICENSE` | 存在 |
| 根目录 `NOTICE` | 不存在 |
| `server/pkg/agent/` 内部 `package` 声明 | 全部 `package agent` |
| `server/pkg/agent/` 内部对 `github.com/multica-ai/multica/...` 的 import | **0 处** |
| `server/pkg/agent/` 外部依赖 import | **0 个第三方模块**，全为 Go stdlib（`go list -f '{{range .Imports}}{{.}}{{end}}{{range .TestImports}}...{{end}}{{range .XTestImports}}...{{end}}' ./pkg/agent` 输出：`bufio` / `bytes` / `context` / `encoding/json` / `errors` / `fmt` / `io` / `log/slog` / `os` / `os/exec` / `path/filepath` / `reflect` / `regexp` / `runtime` / `slices` / `sort` / `strconv` / `strings` / `sync` / `sync/atomic` / `syscall` / `testing` / `time`） |

**关键含义**：

1. `pkg/agent/` 是自包含的（无第三方依赖、无 multica module 自引用），vendor 时**不需要** rewrite import path，也**不需要**为它在 daemon `go.mod` 里加 require。
2. 上游 module 是 `github.com/multica-ai/multica/server`（`server/go.mod`），但 `server/pkg/agent/` 不通过 module path 引用任何上游兄弟包，因此 vendor 后 `package agent` 直接可用。
3. Vendor commit (Phase 3.1) 的"不动一行上游代码"约束因此可严格执行。

### 2.3 vendor 前的核验命令（每次重新执行）

写 `UPSTREAM.md` 之前、`feat(daemon): vendor multica pkg/agent verbatim` commit 之前，**必须**重新跑下面这一组命令。每条命令右侧说明了**预期事实**与**容忍语义**（哪些非零退出是预期的、哪些必须 fail-fast）。结果与 §2.2 不一致时，先回到本文档更新 §2.2，再继续 vendor。

```bash
# 1. 锚定远端 HEAD SHA（必须返回 40-char hex；任何 stderr 失败 fail-fast）
git ls-remote https://github.com/multica-ai/multica.git HEAD

# 2. 临时浅克隆到调研路径（不污染 meowth 仓库；后续步骤复用这一份本地副本）
rm -rf /tmp/multica-pump
git clone --depth 1 https://github.com/multica-ai/multica.git /tmp/multica-pump

# 3. 钉准要 vendor 的 commit；记录到 UPSTREAM.md 的 commit_sha 字段
cd /tmp/multica-pump && git rev-parse HEAD

# 4. 检查 LICENSE / NOTICE
#    - LICENSE 必须存在（fail-fast）
#    - NOTICE 不存在是预期事实（不要用 ls 两者一起触发 exit 1）
test -f /tmp/multica-pump/LICENSE && echo "LICENSE: present"
test -f /tmp/multica-pump/NOTICE  && echo "NOTICE: present" || echo "NOTICE: absent (expected per §2.2)"

# 5. 检查 agent 包没有 module-path 自引用、没有第三方 import
#    - grep 0 行是预期事实；用 `|| true` 容忍非零退出
cd /tmp/multica-pump/server/pkg/agent
grep -rn "github.com/multica-ai/multica" . || true   # 必须 0 行

#    用 `go list` 提取该包**直接** import（不含递归依赖），同时覆盖 block import、单行 import、
#    test import 和 xtest import。旧版 awk 仅能匹配 `import (...)` 块，
#    会漏掉上游已有的 `import "log/slog"` / `import "os/exec"` 单行 import；
#    未来若上游加入单行第三方 import 会被旧命令漏报。
cd /tmp/multica-pump/server
go list -f '{{range .Imports}}{{.}}
{{end}}{{range .TestImports}}{{.}}
{{end}}{{range .XTestImports}}{{.}}
{{end}}' ./pkg/agent | sort -u
#    期望输出全部为 Go stdlib（路径**不含**"."；任何 `<host>.<tld>/...` = 第三方依赖出现，
#    需要在 daemon go.mod 中 require，并按 §6.4 诊断顺序复核）。

# 6. 文件总数与子目录
#    - 与 §2.2 表对齐：包内含 testdata 在内总计 61 个 file
#    - maxdepth=1（顶层 .go + 子目录入口）= 60；不要用 maxdepth=1 与 61 对比
find . -type f | wc -l            # 期望 61
find . -maxdepth 1 -type f | wc -l # 期望 60
ls -d */                          # 期望仅 testdata/
ls testdata/                      # 期望仅含 openclaw fixture（见 §4.2）
```

任一**必须项**（步骤 1、2、3、4 的 LICENSE 行、5 的 `go list` import 列表、6 的两个 wc 数值）与 §2.2 不一致：先回到本文档 §2.2 修订，再继续 vendor。NOTICE 不存在、`grep` 返回 0 行属于**预期事实**，不视为失败。

---

## 3. Vendor 范围

### 3.1 复制策略

**整目录快照 vendor**，不使用 `git subtree` / `git submodule` / `go mod replace`。

理由：

- 上游 `server/pkg/agent/` 无子树历史价值（multica 的业务不进 meowth），保留其 git 历史只是噪音
- meowth `daemon/pkg/agent/` 必须由 meowth 维护者直接 commit，避免子树 push/pull 出错
- 再次 pump 时用同一条命令覆盖即可，无需处理子树合并

**命令模板**（实际 Phase 3.1 / pump 用）：

GitHub 当前**不支持** `git archive --remote`（远端调用返回 `HTTP 422 / fatal: git archive: expected ACK/NAK`，写文档时实测）。主路径采用**临时 shallow clone → 本地 git archive 抽取子树**，复用同一份本地 clone 同时获取 `LICENSE`（与 `NOTICE` 若存在）。

```bash
# 假设已跑过 §2.3，本地副本在 /tmp/multica-pump，且记下了 SHA
cd /tmp/multica-pump
UPSTREAM_SHA=$(git rev-parse HEAD)

# 在 meowth 仓库根下重置 vendor 目录（首次为空；pump 时清空再覆盖）
cd ~/workspace/personal/meowth
rm -rf daemon/pkg/agent
mkdir -p daemon/pkg/agent

# 从本地副本抽取 server/pkg/agent/ 子树（strip 前 3 层让内容直接落在 daemon/pkg/agent/ 下）
git -C /tmp/multica-pump archive --format=tar "$UPSTREAM_SHA" server/pkg/agent \
  | tar -x --strip-components=3 -C daemon/pkg/agent

# 同步 LICENSE（必须存在；fail-fast）
cp /tmp/multica-pump/LICENSE daemon/pkg/agent/LICENSE

# 同步 NOTICE（仅当上游存在；不存在是预期事实，不视为失败）
if [ -f /tmp/multica-pump/NOTICE ]; then
  cp /tmp/multica-pump/NOTICE daemon/pkg/agent/NOTICE
fi

# 立即写 UPSTREAM.md（见 §5 模板），填入 commit_sha = $UPSTREAM_SHA、vendored_at = UTC 日期
```

**回退路径**（GitHub 恢复 `--remote` 支持，或换不支持本地 archive 的上游）见 §6.4。

复制后**立刻**执行：

```bash
cd ~/workspace/personal/meowth/daemon
go vet ./pkg/agent/...
go test ./pkg/agent/...
```

两条都必须绿，才允许进入 §4 裁剪步骤。任何一条红：把 vendor 目录恢复到 commit 前状态，回到 §2.3 重新核验。

### 3.2 同步进 meowth 仓库的辅助文件

Vendor commit (Phase 3.1) 同时落地以下文件，确保许可证合规与可复现。**获取命令已经写进 §3.1 主流程**，本表只描述每个文件的语义。

| 路径 | 内容 | 何时存在 |
|------|------|---------|
| `daemon/pkg/agent/LICENSE` | 上游根 `LICENSE` 原文逐字节拷贝（不修改、不裁剪 anti-SaaS / 保留 logo 条款） | 每次 vendor 必创建（§3.1 `cp /tmp/multica-pump/LICENSE ...`） |
| `daemon/pkg/agent/NOTICE` | 上游根 `NOTICE` 原文 | 仅当上游存在 `NOTICE` 时才创建（§3.1 用 `if [ -f ... ]` 守护）。§2.2 调研结果为不存在，所以首次 vendor commit **不**会包含此文件；pump 时若上游新增 `NOTICE` 自动同步加进来 |
| `daemon/pkg/agent/UPSTREAM.md` | 见 §5 模板 | 每次 vendor 必创建/更新 |

### 3.3 Package path

- 上游 `server/pkg/agent/` 所有 `.go` 文件均为 `package agent`，且**不引用** `github.com/multica-ai/multica/...`。
- Vendor 到 `daemon/pkg/agent/` 后**保持 `package agent`，不改一个字符**。
- daemon 内其它包通过 module-relative path 引用，例如：
  ```go
  import "<meowth-module>/pkg/agent"
  ```
  其中 `<meowth-module>` 是 daemon `go.mod` 的 module 声明（Phase 3.0 由 `2.1 chore(daemon): scaffold go module` commit 定）。
- **唯一允许的源码修改边界**：当（且仅当）上游在未来某次 pump 中开始在 `pkg/agent/` 内部引用 `github.com/multica-ai/multica/server/...` 兄弟包时，做一次最小 rewrite 把这些 import 改成 meowth module path，rewrite 落到独立 commit（`chore(daemon): rewrite vendored agent imports for meowth module`）。

---

## 4. 裁剪 checklist（5 backend 白名单）

V1 白名单：`claude / copilot / codex / hermes / pi`。需要**删除**的 8 个 provider：`antigravity / codebuddy / cursor / gemini / kimi / kiro / openclaw / opencode`。

裁剪发生在 Phase 3.2，**严格独立于 vendor commit**。3.2 必须同步动以下 7 处，缺一不可。

### 4.1 七处同步点

| # | 修改点 | 文件 | 说明 |
|---|--------|------|------|
| 1 | `SupportedTypes` 白名单 | `daemon/pkg/agent/agent.go` | 收窄为 5 条 |
| 2 | `New()` 工厂 switch | `daemon/pkg/agent/agent.go` | 删去 8 个被裁 provider 的 case |
| 3 | `launchHeaders` map | `daemon/pkg/agent/agent.go`（§7.2 引用 line 218 起，pump 时按上游实际位置核对） | 删 8 个被裁 provider 的条目 |
| 4 | `ListModels()` switch / 各 provider 分支 | `daemon/pkg/agent/models.go`（§7.2 引用 line 94） | 删 8 个被裁 provider 的分支 |
| 5 | 版本探测 / 最低版本表 | `daemon/pkg/agent/version.go` | 删被裁 provider 的条目 |
| 6 | thinking enum / 校验 | `daemon/pkg/agent/thinking.go` | 删被裁 provider 的 enum 与对应 switch case |
| 7 | 删 8 个 provider 的所有源文件、测试、`*_invocation_*` 平台分桶文件、对应 `testdata/` 子目录 | 见 §4.2 文件清单 | `rm -f` |

### 4.2 §4.1 #7 需要删的文件清单

按 §2.2 文件树枚举：

```
daemon/pkg/agent/antigravity.go
daemon/pkg/agent/antigravity_test.go

daemon/pkg/agent/codebuddy.go
daemon/pkg/agent/codebuddy_test.go

daemon/pkg/agent/cursor.go
daemon/pkg/agent/cursor_test.go
daemon/pkg/agent/cursor_execute_unix_test.go
daemon/pkg/agent/cursor_invocation.go
daemon/pkg/agent/cursor_invocation_other.go
daemon/pkg/agent/cursor_invocation_test.go
daemon/pkg/agent/cursor_invocation_windows.go
daemon/pkg/agent/cursor_invocation_windows_test.go

daemon/pkg/agent/gemini.go
daemon/pkg/agent/gemini_test.go

daemon/pkg/agent/kimi.go
daemon/pkg/agent/kimi_test.go

daemon/pkg/agent/kiro.go
daemon/pkg/agent/kiro_test.go

daemon/pkg/agent/openclaw.go
daemon/pkg/agent/openclaw_test.go

daemon/pkg/agent/opencode.go
daemon/pkg/agent/opencode_test.go
daemon/pkg/agent/opencode_mcp.go
daemon/pkg/agent/opencode_mcp_test.go
```

**`testdata/` 中需删的 fixture**（按 §2.2 调研当下，仅有以下一个，全部属于被裁 provider）：

```
daemon/pkg/agent/testdata/openclaw-2026.5.5-stdout.json
```

裁剪完成后 `testdata/` 应只剩白名单 provider 的 fixture（若上游为白名单 provider 新增过 testdata）；§2.2 当下白名单 provider **没有** testdata 文件。pump 时若上游新增 testdata：

- 属于白名单 provider → 保留
- 属于被裁 provider（或新被裁 provider） → 加入本节删除清单

裁剪 commit 末尾跑 `ls daemon/pkg/agent/testdata/` 与本节清单对账，避免 openclaw fixture 残留。

### 4.3 验证

裁剪 commit 落地前**必须**全绿：

```bash
cd ~/workspace/personal/meowth/daemon
go vet ./pkg/agent/...
go test ./pkg/agent/...
```

任何被裁 provider 在 `agent.go` / `models.go` / `version.go` / `thinking.go` 的残留引用，`go vet` 会以 `undefined: <被裁 provider 函数/类型>` 报错；上游 `*_test.go` 仍引用被裁 provider 的，要么删除测试要么改成不依赖。

### 4.4 保留的共享 helper

下列文件**不**裁剪，5 个白名单 backend 共用：

```
agent.go                  # Backend 接口 + 公共类型
agent_test.go
agent_supported_types_test.go
models.go
models_test.go
version.go
version_test.go
thinking.go
thinking_test.go

stderr_tail.go            # 跨 backend 的 stderr 处理
proc_other.go             # 跨平台 helper（非 Windows）
proc_windows.go           # Windows 平台 helper（构建 tag，不在 darwin 编译）
proc_windows_test.go

exec_fixture_unix_test.go
exec_fixture_windows_test.go

copilot.go                # 5 个白名单 backend 源 + 测试
copilot_test.go
copilot_invocation.go
copilot_invocation_other.go
copilot_invocation_test.go
copilot_invocation_windows.go
copilot_invocation_windows_test.go

claude.go
claude_test.go
claude_deadlock_test.go

codex.go
codex_test.go

hermes.go
hermes_test.go

pi.go
pi_test.go
pi_invocation.go
pi_invocation_other.go
pi_invocation_test.go
pi_invocation_windows.go
pi_invocation_windows_test.go
```

合计 ≈ 36 个 `.go` 文件。`testdata/` 当前**不**保留任何 fixture（§2.2 调研下，唯一的 fixture 属于被裁的 openclaw，已在 §4.2 删除清单中）。pump 时若上游为白名单 provider 新增 testdata，自动落在 `daemon/pkg/agent/testdata/` 下并保留。

---

## 5. `UPSTREAM.md` 模板

落在 `daemon/pkg/agent/UPSTREAM.md`，每次 vendor / pump 都更新：

```markdown
# Upstream

This package is vendored verbatim from multica `server/pkg/agent`.

| Field           | Value |
|-----------------|-------|
| source_repo     | https://github.com/multica-ai/multica.git |
| source_path     | server/pkg/agent/ |
| commit_sha      | <40-char SHA> |
| vendored_at     | YYYY-MM-DD (UTC) |
| vendor_method   | local shallow clone + git archive &lt;sha&gt; (see docs/architecture/01 §3.1) |
| license         | Modified Apache 2.0 (see daemon/pkg/agent/LICENSE) |
| notice          | none on upstream as of <commit_sha> |
| local_patches   | see commit log: `git log -- daemon/pkg/agent` |

## Trimmed providers

Removed at Phase 3.2 to keep V1 whitelist (claude, copilot, codex, hermes, pi):

- antigravity
- codebuddy
- cursor
- gemini
- kimi
- kiro
- openclaw
- opencode

## How to pump

See `docs/architecture/01-agent-sdk-pump-from-multica.md` §6.
```

**铁律**：

- `commit_sha` 必须是真实的远端 commit；禁止填 tag / branch / 本机 SHA
- `local_patches` 不要在这里手维护列表，让 `git log -- daemon/pkg/agent` 是唯一真相源
- pump 后更新 `commit_sha` 与 `vendored_at`；若上游新增了被裁 provider，更新 `Trimmed providers` 列表

---

## 6. Pump 流程

### 6.1 触发场景

- 上游 multica 有想要同步的修复 / 新 backend / 协议改动
- meowth 自身发现 vendor 里的 bug 需要先在上游解决后再回拉

### 6.2 标准流程

`set -e` 友好（除显式标注的预期-非零退出步骤外）。

```bash
# 0. 在干净的 main 分支上
cd ~/workspace/personal/meowth
git status   # 必须 clean

# 1. 取上游新 SHA
NEW_SHA=$(git ls-remote https://github.com/multica-ai/multica.git HEAD | awk '{print $1}')

# 2. 读当前 UPSTREAM.md 里的旧 SHA
OLD_SHA=$(grep "commit_sha" daemon/pkg/agent/UPSTREAM.md | awk '{print $NF}')

# 3. 临时 shallow clone 同时用于 diff、archive、LICENSE/NOTICE 同步
rm -rf /tmp/multica-pump
git clone --depth 50 https://github.com/multica-ai/multica.git /tmp/multica-pump

# 3a. 钉准 NEW_SHA：HEAD 可能在 ls-remote 与 clone 之间已经向前移动；
#     如果 NEW_SHA 不在 shallow clone 范围内，扩大 depth 重新 fetch 该 SHA。
if ! git -C /tmp/multica-pump cat-file -e "${NEW_SHA}^{commit}" 2>/dev/null; then
  git -C /tmp/multica-pump fetch --depth 100 origin "$NEW_SHA"
fi
# 同样把 OLD_SHA 也带进来（用于下一步 diff）；非致命，OLD_SHA 可能在 50-100 commit 之外
git -C /tmp/multica-pump fetch --depth 200 origin "$OLD_SHA" 2>/dev/null || true

# 4. 上游在 OLD_SHA..NEW_SHA 之间对 server/pkg/agent/ 的变更（仅供 review；若 OLD_SHA 不在 shallow 范围，扩大 depth 重新 fetch）
git -C /tmp/multica-pump log --oneline "$OLD_SHA..$NEW_SHA" -- server/pkg/agent 2>/dev/null \
  | tee /tmp/pump-changes.txt || echo "(OLD_SHA not in shallow range; deepen and rerun if needed)"
git -C /tmp/multica-pump diff --stat "$OLD_SHA" "$NEW_SHA" -- server/pkg/agent 2>/dev/null \
  | tee -a /tmp/pump-changes.txt || true

# 5. 重新 vendor（§3.1 主命令）
cd ~/workspace/personal/meowth
rm -rf daemon/pkg/agent
mkdir -p daemon/pkg/agent
git -C /tmp/multica-pump archive --format=tar "$NEW_SHA" server/pkg/agent \
  | tar -x --strip-components=3 -C daemon/pkg/agent

# 6. 同步 LICENSE / NOTICE
cp /tmp/multica-pump/LICENSE daemon/pkg/agent/LICENSE
if [ -f /tmp/multica-pump/NOTICE ]; then
  cp /tmp/multica-pump/NOTICE daemon/pkg/agent/NOTICE
else
  rm -f daemon/pkg/agent/NOTICE   # 上游若曾经有过 NOTICE 后又删了，meowth 也同步删
fi

# 7. **第一道闸门**：原样 vendor 必须可编译可测试
cd daemon
go vet ./pkg/agent/...
go test ./pkg/agent/...
#    若红：vendor commit 不许提交；按 §6.4 诊断顺序排查。
#    "测试因白名单裁剪丢失而红" 不是预期理由——裁剪还没发生。

# 8. 提交 vendor commit（§6.3 第一行）

# 9. 重做 §4 裁剪（§4.1 七处 + §4.2 文件清单）

# 10. **第二道闸门**：裁剪后必须可编译可测试
go vet ./pkg/agent/...
go test ./pkg/agent/...

# 11. 更新 UPSTREAM.md 的 commit_sha / vendored_at（在裁剪 commit 之前；UPSTREAM.md 属于 vendor commit）
#     —— 实操上 UPSTREAM.md 在 step 5–6 后立即写入，与 vendor commit 一并提交，不在 step 11 单独动
```

**两道闸门均不许带红 commit**：第一道证明 vendor 干净（原样上游测试在 meowth 环境下绿），第二道证明裁剪正确无残留引用。任何一道红 → 中止并按 §6.4 诊断。

### 6.3 Commit 拆分（pump 一次至少 2 个 commit）

```
chore(daemon): pump multica pkg/agent to <NEW_SHA>     # 仅 vendor + LICENSE/NOTICE + UPSTREAM.md
chore(daemon): re-trim agent SDK after pump <NEW_SHA>  # 裁剪 7 处 + 删除新增被裁文件
```

理由（与 CLAUDE.md 原子化提交规则一致）：

- vendor commit 可以独立 `git revert`，回到上一个 SHA
- 裁剪 commit 独立审计、独立回滚（仅在 vendor commit 之上 cherry-pick 历史裁剪 patch）

### 6.4 异常路径

| 异常 | 处置 |
|------|------|
| `git archive --remote` 失败 / 上游禁用 | 当前 §3.1 主路径已经是"本地 clone + 本地 archive"，不依赖 `--remote`。若未来连本地 archive 都不可行（极端罕见），回退到 `git clone --depth 1` + `cp -R server/pkg/agent/* daemon/pkg/agent/`（注意保持 `--strip-components` 行为，避免多嵌一层目录）。回退路径必须在 commit message 中注明 |
| Vendor 后 `go vet` / `go test` 红 | 按以下诊断顺序排查（不要假定单一原因）：(a) 检查 daemon `go.mod` Go 版本是否与上游 `server/go.mod` 对齐（§7）；(b) `cd daemon && go mod tidy` 看是否需要新增 stdlib 外依赖（§2.2 当下不需要）；(c) 检查 build tag 是否齐全（`proc_windows.go` / `*_other.go` 平台分桶是否完整复制）；(d) 检查上游测试是否依赖未拷贝的 fixture 路径；(e) 若上游本身在该 SHA 下 `go test` 不绿，pump 中止，等上游修复 |
| 上游新增 backend 但不在白名单 | 按 §6.5 决策；若决定不纳入则按 §4 扩展裁剪清单 |
| 上游新增 backend 且在白名单（极少） | 按 §6.5 决策；纳入后必须给该 backend 加 e2e fixture，与 08-6dq 协同 |
| 上游开始在 `pkg/agent/` 内引用 `github.com/multica-ai/multica/server/...` | 按 §3.3 最小 rewrite，单独 commit |
| 上游删了 `LICENSE` 或新增/删除 `NOTICE` | §6.2 step 6 的 cp / rm 逻辑会自动同步；但 vendor commit message 必须显式记录这一许可证状态变化，便于法务审计 |

### 6.5 上游新增 backend 的决策模板

每次 pump 都明确选一项，写进 pump commit message：

```
Upstream introduced backend `<name>` between <OLD_SHA>..<NEW_SHA>.

Decision: [ ] include in V1 whitelist
          [ ] exclude (added to Trimmed providers in UPSTREAM.md)

Rationale: <一句话理由>
```

**默认决策**：排除（保守）。纳入需要单独的 docs/feature 提案（编号 `docs/features/NN-add-backend-<name>.md`），覆盖白名单扩张、CLI 协议接入、e2e fixture、08-6dq 的真实 CLI smoke 策略。

---

## 7. Go 版本决策

### 7.1 上游基线

- 上游 `server/go.mod` 当前声明 `go 1.26.1`（§2.2 调研）
- `pkg/agent/` 包内**未使用第三方依赖**，仅 stdlib

### 7.2 daemon `go.mod` 的 Go 版本规则

按以下顺序判定：

1. **默认**：daemon `go.mod` 的 Go 版本 = vendor 时刻上游 `server/go.mod` 中的 `go` 行。理由：vendor 进来的代码可能用了对应版本的 stdlib 新 API，强行降版可能编译失败。
2. **允许下调**：仅当当前上游 `pkg/agent/` 的实际语法只用到更低版本的 stdlib API，且在目标 Go 版本下 `go vet ./pkg/agent/...` + `go test ./pkg/agent/...` 全绿，才允许 daemon `go.mod` 比上游低。下调必须在 Phase 3.1 的 commit message 里写明证据（哪个版本测过 + 全绿日志摘要）。
3. **禁止上调**：daemon `go.mod` 不应高于上游 `server/go.mod` 声明的版本（避免上游不在该版本下测试）。

### 7.3 与 README 的同步

- `README.md` 当前写 `Go >= 1.22`，是 Phase 0 阶段的占位。
- Phase 3.1 落地 daemon `go.mod` 时，若实际 Go 版本不是 1.22，立即用一个最小勘误 commit 更新 README：
  ```
  docs(readme): bump Go requirement to <X.Y> for vendored agent SDK
  ```
- 该勘误 commit 不依赖本文档的修订，属于 §10 工作流约束的应用而非额外规划。

---

## 8. 测试落点（与 6DQ 的映射）

> 详细 6DQ 接线见 `08-6dq-hooks-wiring.md`，本节只规定 `pkg/agent/` 这一包的覆盖目标。

| 层 | 覆盖什么 | 怎么覆盖 | 依赖真 CLI 吗 |
|----|----------|---------|-------------|
| **L1** | parser / argv 组装 / event decode / 平台分桶逻辑 | 直接跑 vendor 进来的上游 `*_test.go` + `testdata/`；任何新增 daemon 内 unit test 一并算入 | 否 |
| **L2** | daemon `/v1/agents/{type}/exec` 端到端，使用 fake backend（实现 `Backend` 接口、stdout 喂预录事件） | `scripts/run-l2.ts` 起 daemon → 调 endpoint → 检查 NDJSON 输出 | 否 |
| **L3** | dashboard ↔ daemon ↔ fake backend 关键路径（创建 session、看消息、cancel） | Playwright spec | 否 |
| **CLI smoke（opt-in）** | 真实 claude/copilot/codex/hermes/pi 的 happy-path | `daemon/test/cli-smoke/*` 独立目录，`MEOWTH_CLI_SMOKE=1` 才跑；本机/release 验证用 | 是 |

CI 默认**不安装**任何真实 CLI，因此 CI gate 永不依赖 §未决问题 #1 的决策。CLI smoke 是开发者本机或 release runner 的一次性确认。

---

## 9. 失败模式与回滚

| 失败 | 体现 | 处置 |
|------|------|------|
| Vendor 后 `go vet` 红 | undefined symbol / import 不存在 / build tag 不匹配 | 立刻 `git restore` vendor 目录；按 §6.4 诊断顺序排查（Go 版本 / `go mod tidy` / build tag / 平台文件 / 上游本身是否绿） |
| Vendor 后 `go test ./pkg/agent/...` 红 | 上游单测失败 | 不允许带红 commit；上游测试本身红应作为 pump 中止理由，等上游修了再 pump |
| 裁剪后 `go vet` 红 | `undefined: <被裁 provider 函数>` | 找到引用点（必属 §4.1 七处之一漏改），补上裁剪，重试 |
| 裁剪后某些上游测试因 fixture 缺失红 | `testdata/<被裁 provider>/...` 文件不存在 | 找到引用 testdata 的 test 文件，要么也删（该 test 仅测被裁 provider）要么改路径（该 test 跨 provider 共享） |
| pump 把白名单 5 backend 中某个的协议改坏 | L2 红、L3 红 | 不要在 vendor commit 上面修；直接 `git revert` 整个 pump（vendor + trim 两个 commit），上游有修复后再 pump |

---

## 10. 原子化提交计划（对应 §9.2 Phase 3.1 / 3.2）

| 顺序 | Commit message | 内容 |
|------|---------------|------|
| 1 | `feat(daemon): vendor multica pkg/agent verbatim` | 跑 §2.3 核验 → 跑 §3.1 vendor 命令 → 加 `LICENSE` / `UPSTREAM.md`（无 `NOTICE`） → 跑 `go vet` + `go test` 全绿 → 提交。**不动一行上游代码**；7 处裁剪不在此 commit |
| 2 | `feat(daemon): trim agent SDK to 5 whitelisted backends` | 同步动 §4.1 七处 + §4.2 文件清单 `rm -f` → `go vet` + `go test` 全绿 → 提交 |

后续 pump（§6.3）每次也按这两个 commit 的形态拆分。

每个 commit 自带必要测试 + 6DQ hook 全绿 + 不留 TODO。

---

## 11. 未决问题

| # | 问题 | 决策方 | 状态 |
|---|------|-------|------|
| 1 | daemon `go.mod` 是否需要严格等于上游 `1.26.1`？ | 实施 Phase 3.1 时由 SDE 按 §7.2 规则判定（若上游 `pkg/agent/` 语法允许下调到 `1.22`，则下调；否则与上游对齐） | 待 Phase 3.1 落地 |
| 2 | 是否需要在 meowth 增加"上游 backend 增删审计"自动化（CI 跑 `git ls-remote` + diff）？ | @zheng-li | 暂记此处，不影响 1.2 文档收口 |

---

## 12. 相关文档

- 上层：[`docs/01-project-overview.md`](../01-project-overview.md) §7.2 / §9.2
- 工作约束：[`CLAUDE.md`](../../CLAUDE.md)
- 兄弟文档：
  - `02-daemon-http-protocol.md`（在 vendor 后的 `Backend.Execute` 上构建 HTTP）
  - `08-6dq-hooks-wiring.md`（CLI smoke gate 与 fake backend fixture）
