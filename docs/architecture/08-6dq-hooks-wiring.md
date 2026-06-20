# Architecture · 08 · 6DQ hooks wiring

> **更新规则**：本文档定义 6DQ 六维质量体系（L1 / L2 / L3 / G1 / G2 / D1）的工具链接线、husky 钩子、CI matrix、覆盖率阈值。
> 任何工具替换、阈值改动、CI 触发方式调整，必须先回到这里更新，再向下推进。
> 历史在 `git log -- docs/architecture/08-6dq-hooks-wiring.md`。

> 上层依据：[`docs/01-project-overview.md`](../01-project-overview.md) §8、§9.2 全 Phase。
> 本文档**接线 only**：把前 7 篇定义的测试需求 wire 起来，**不**重新定义业务契约。
> 本文档**不涉及**：
> - 任何业务 *what*（→ 01–07 各自文档）
> - daemon Go module 实际版本号（→ 由 Phase 3.1 落地 `daemon/go.mod` 决定，本文档**消费**该结果）
> - CSP header 内容、token schema 等（→ 07 / 03）
> - 真实 CLI 安装步骤（→ 用户运维范畴）

---

## 1. 范围

本文档管：

- 6DQ 总览矩阵：每维工具 / 阈值 / 时机 / 触发命令
- L1 / L2 / L3 三层测试的目录布局、fixture 管理、fake backend 实现位置
- D1 测试隔离的接线方式（与 [`03`](03-sqlite-schema-and-tokens.md) §9 一致）
- husky pre-commit / pre-push 脚本拆分与超时目标
- GitHub Actions CI matrix（runner / 工具版本 / job 拆分）
- 覆盖率阈值 + 报告产出
- 真实 CLI smoke 的 opt-in 约定
- 前文遗留勘误清单（**只记录**，不在本 commit 中补丁化其它文档）

本文档不管：

- 各文档自身的 *what*（业务契约定义）
- husky 安装 / pnpm 配置等 README 一次性步骤（[`README.md`](../../README.md) 入口）

---

## 2. 6DQ 总览矩阵

| 维度 | 子分层 | 工具 | 阈值 | 时机 | 范围 |
|------|--------|------|------|------|------|
| **L1** Unit/Component | daemon Go | `go test`、`go test -cover` | pkg coverage ≥ 95%（cmd/ 入口豁免） | pre-push + CI 全量 | `daemon/...` |
| **L1** Unit/Component | dashboard TS | `vitest` + React Testing Library | 详 §6（按 [`docs/01-project-overview.md`](../01-project-overview.md) §9.2 Phase 3.25 + §13 #2） | pre-push + CI 全量 | `apps/dashboard/src/**` |
| **L2** Integration/API | daemon HTTP + fake backend | `scripts/run-l2.ts` 起真 daemon + fake backend | 100% v1 端点覆盖（[`02`](02-daemon-http-protocol.md) §3 表） | pre-push + CI | `daemon/cmd/...` + `apps/dashboard` 不参与 |
| **L3** System/E2E | dashboard ↔ daemon | Playwright | 关键流绿（详 §4） | CI（dev fixture + embed fixture） | `apps/dashboard` end-to-end |
| **G1 / static** | Go | `gofmt -d`、`go vet`、`golangci-lint run` | 0 error 0 warning | pre-commit + CI | `daemon/**` |
| **G1 / static** | TS | Biome strict、`tsc --noEmit`、dependency-cruiser、source grep（[`07`](07-dashboard-security-csp-and-xss.md) §5.2） | 0 error 0 warning | pre-commit + CI | `apps/dashboard/**` + `packages/**` |
| **G1 / static** | build artifact | `scripts/check-dashboard-dist.sh`（[`07`](07-dashboard-security-csp-and-xss.md) §6.1） | 0 远程 URL、0 eval、0 new Function | post-build / CI | `apps/dashboard/dist/**` |
| **G1 / secret-scan** | gitleaks | `gitleaks protect --staged` | 0 命中 | pre-commit | staged diff |
| **G2 / supply-chain** | Node | `osv-scanner --lockfile pnpm-lock.yaml` | critical/high 0；medium/low 见 §13 #2 | pre-push + CI | `pnpm-lock.yaml` |
| **G2 / supply-chain** | Go | `govulncheck ./...` | critical/high 0 | pre-push + CI | `daemon/**` |
| **D1** SQLite 隔离 | path + filename + marker | 三重运行时校验（[`03`](03-sqlite-schema-and-tokens.md) §9） + `scripts/check-no-prod-test-mix.sh` 静态检查 | 三项全通过；静态校验 0 violation | runtime（test mode open）+ CI G1 | `daemon/internal/home/**` + `daemon/internal/store/**` |

**总览铁律**：

- pre-commit 目标 < 30s（fast path，staged-aware）— **仅**跑 G1 快速静态检查 + secret-scan + source/D1 scan；**不**跑 L1
- pre-push 目标 < 3 min（中等 path）— 跑 L1 全量 + L2 + G2 + dist scan
- CI 跑完整 matrix + L3 + coverage gate + dist scan

[`docs/01-project-overview.md`](../01-project-overview.md) §8 Husky hooks 表写"pre-commit = L1+G1；pre-push = L2+G2"，**这是简写 / 历史目标**——实际为达成 pre-commit < 30s 目标，L1 在本文档被下移到 pre-push。overview §8 的简写表与实际配置不一致由 §14 #5 遗留勘误处理。

---

## 3. L1 / L2 / L3 测试接线

### 3.1 L1 — daemon Go

- 测试文件位置：`daemon/<pkg>/*_test.go`（Go 惯例）
- 覆盖率：`go test ./... -coverprofile=coverage.out -covermode=count`
- 覆盖率阈值断言：`go tool cover -func=coverage.out | awk` 脚本检查每个 pkg ≥ 95%；`daemon/cmd/...` 豁免（main 入口）
- 覆盖率阈值的实际门槛在 Phase 3.25 commit 落地（[`docs/01-project-overview.md`](../01-project-overview.md) §9.2 commit 3.25 `chore: bump coverage thresholds to S-tier`）
- mock 策略：用 interface + 测试 double（不引入 `gomock` 等代码生成；手写 stub）
- vendored `pkg/agent` 自带 multica `*_test.go`（[`01`](01-agent-sdk-pump-from-multica.md) §3.2）；这些测试在 vendor commit 后必须全绿

### 3.2 L1 — dashboard TS

- 测试文件位置：`apps/dashboard/src/**/*.test.ts` / `*.test.tsx`
- 工具：`vitest` + `@testing-library/react`（按 [`06`](06-dashboard-mvvm-and-basalt.md) §3.1 deps）
- 覆盖率：`vitest run --coverage`（v8 coverage provider）
- 覆盖项目（**必须**有 L1 测试）：
  - `lib/api.ts`（[`06`](06-dashboard-mvvm-and-basalt.md) §8）— `apiFetch` / `apiStream` / 401 自动清 token
  - `lib/ansi.ts`（[`07`](07-dashboard-security-csp-and-xss.md) §3.1）— ANSI parser 含 fuzz
  - `lib/redact.ts`（[`07`](07-dashboard-security-csp-and-xss.md) §8.1）— reflect + fuzz 100
  - `lib/logger.ts`（[`07`](07-dashboard-security-csp-and-xss.md) §8.2）— 自动 redact 调用
  - `lib/localStorage.ts`（[`06`](06-dashboard-mvvm-and-basalt.md) §8.3）— typed wrapper
  - `models/envelope.ts`（[`06`](06-dashboard-mvvm-and-basalt.md) §7.3）— NDJSON decoder + heartbeat 占 seq + usage replace
  - 所有 `viewmodels/useXxxViewModel.ts`（[`06`](06-dashboard-mvvm-and-basalt.md) §6.3）— mock model 函数 + 断言 hook 返回 state
  - `components/SecretReveal.tsx`（[`07`](07-dashboard-security-csp-and-xss.md) §7.1）— 默认 masked / reveal / copy mock / unmount
  - `routes/guards.tsx`（[`06`](06-dashboard-mvvm-and-basalt.md) §10）— hydrate 顺序 + 401 redirect + 不循环
- import-boundary 静态约束：由 dependency-cruiser 覆盖（[`06`](06-dashboard-mvvm-and-basalt.md) §6.2）；属 G1 不属 L1，但 wire 在同 CI job
- React 19 + Testing Library：用 `@testing-library/dom` 18+ 与 `@testing-library/react` 16+（兼容 React 19；具体版本 Phase 3.13 SDE 锁）

### 3.3 L2 — daemon HTTP + fake backend

- 测试驱动：`scripts/run-l2.ts`（根脚本 `pnpm test:l2`）
- 流程：
  1. 跑 `go build -o bin/meowthd ./daemon/cmd/meowthd`（Phase 2.1 后由根脚本 `pnpm daemon:build` 包装；daemon 是独立 Go module，**不**是 `@meowth/<x>` pnpm package）
  2. 跑 `meowthd init --skip-token --home ~/.meowth-test/` 起 test store（[`03`](03-sqlite-schema-and-tokens.md) §9 触发条件之一：`MEOWTH_TEST=1`；本文档使用 env 触发）
  3. 起 daemon 子进程；注入环境变量 `MEOWTH_BACKEND_FACTORY=fake`（详 §3.3.1）
  4. 等 `/healthz` 200
  5. 跑 端到端断言 suite：v1 全端点 happy + error path（含 problem+json schema 校验、NDJSON envelope schema 校验）
  6. 跑 04 mint endpoint 测试集（含 §3.3.2 跨进程重启）
  7. 跑 05 remote_access 启动期校验测试（不同 config.toml 起 daemon 看 stderr）
  8. SIGTERM daemon；assert 优雅退出 + sessions 表 active 行变 `aborted`
  9. 删除 `~/.meowth-test/`

#### 3.3.1 Fake backend fixture

[`02`](02-daemon-http-protocol.md) §13 / [`01`](01-agent-sdk-pump-from-multica.md) §8 / [`06`](06-dashboard-mvvm-and-basalt.md) §11 都依赖 fake backend。统一实现：

- 位置：`daemon/internal/server/testbackend/`
- 实现：满足 `agent.Backend` 接口（[`01`](01-agent-sdk-pump-from-multica.md) §2）；`Execute(ctx, prompt, opts)` 返回 `*agent.Session` 含 prerecorded `Messages` / `Result` channel
- 注入：daemon 启动期通过 `MEOWTH_BACKEND_FACTORY=fake` env 切换工厂；该 env **仅在 `MEOWTH_TEST=1` 同时设置时**接受（runtime guard），否则 daemon 启动失败并拒绝挂载 fake；生产 build（无 `MEOWTH_TEST=1`）无论 `MEOWTH_BACKEND_FACTORY` 取值都走真实 `New(type, config)` 工厂。**v1 不引入 build tag 分叉**：fake backend 代码与生产代码同二进制，由 runtime env + test-mode guard 控制可达性，避免新增 test/prod 二进制分叉
- prerecorded 事件源：`daemon/internal/server/testbackend/fixtures/<scenario>.jsonl`（每行一 `agent.Message`）
- 必有的 scenario：
  - `claude_happy.jsonl`：text → tool-use → tool-result → text → status=completed
  - `claude_error.jsonl`：MessageError 中段 + Result.Status=failed
  - `claude_cancelled.jsonl`：text → ctx cancel → Result.Status=cancelled
  - `idle.jsonl`：长时间无输出（触发 heartbeat envelope，[`02`](02-daemon-http-protocol.md) §5.7）
- daemon `MEOWTH_BACKEND_FACTORY=fake` env 是 test-only 信号；与 [`03`](03-sqlite-schema-and-tokens.md) §9.1 D1 触发同源（test-mode 才允许）

#### 3.3.2 04 mint endpoint 跨进程重启测试

[`04`](04-bootstrap-and-first-run-mint.md) §11 「跨进程测试」要求：init `--skip-token` 进程 A 退出 → daemon 进程 B 启动 → 重启 N 次 → 仍可用同一 setup-code mint。

实现 harness（在 `scripts/run-l2.ts` 的 mint suite 内）：

```ts
// 伪代码
const home = makeTempTestHome();
execSync(`meowthd init --skip-token --home=${home}`); // 进程 A 退出，stdout 取 setup-code
for (let i = 0; i < 3; i++) {
  const daemon = spawnDaemon(home);                    // 进程 B 启动
  await waitHealthz(daemon);
  await daemon.kill('SIGTERM');                        // 进程 B 退出（不 mint）
}
const daemon = spawnDaemon(home);                      // 第 4 次启动
await waitHealthz(daemon);
const resp = await postMint(daemon, setupCode);        // 用同一 setup-code mint
assertOk(resp);
await daemon.kill('SIGTERM');
```

附加测试：`os.Remove(hash)` 失败分支（[`04`](04-bootstrap-and-first-run-mint.md) §11 "崩溃 / 残留" 行）。**实现方案二选一**：

- **方案 A（推荐）**：在 daemon 内部把 `os.Remove` 调用包到一个 file-system interface（如 `type fileSystem interface { Remove(string) error }`），测试时注入 fake FS 返回固定 error；这是可控且可测的标准做法
- **方案 B**：将 `setup_nonce.hash` 的父目录 `~/.meowth-test/runtime/` 设为 `chmod 0500`（用户可读可执行、不可写），触发真实 `os.Remove` 失败；测试结束恢复 0700。注意：仅 chmod hash 文件本身（0400）**不**会让 `os.Remove` 失败，Unix 删除文件检查父目录写权限

v1 默认走方案 A（更可控；不依赖 OS 行为细节）。具体由 Phase 3.8 SDE 实施时决定。

### 3.4 L3 — Playwright（两套 fixture）

[`06`](06-dashboard-mvvm-and-basalt.md) §11 / [`07`](07-dashboard-security-csp-and-xss.md) §11 L3 要求覆盖两类场景；**必须**两套 fixture 共存：

#### 3.4.1 `dashboardDevFixture`（Vite proxy）

- daemon 起在 `127.0.0.1:7777`（fake backend）
- `pnpm --filter @meowth/dashboard dev` 在 `5173`
- Playwright 访问 `http://localhost:5173/`
- 覆盖：手输 token 路径（[`06`](06-dashboard-mvvm-and-basalt.md) §11 (a)）、401 redirect（[`06`](06-dashboard-mvvm-and-basalt.md) §11 (c)）、agent exec / cancel / session messages follow（v1 endpoints via Vite proxy）
- **不**覆盖 mint 路径 B（[`06`](06-dashboard-mvvm-and-basalt.md) §3.4 / [`07`](07-dashboard-security-csp-and-xss.md) §4.4）
- **不**覆盖 CSP header 断言（Vite dev 不注入 production CSP；[`07`](07-dashboard-security-csp-and-xss.md) §4.4）

#### 3.4.2 `dashboardEmbedFixture`（production embed）

- 跑 `pnpm --filter @meowth/dashboard build` → 产 `apps/dashboard/dist`
- 跑 `go build -o bin/meowthd ./daemon/cmd/meowthd`（或根脚本 `pnpm daemon:build`，详 §3.3 流程 step 1）— daemon embed `apps/dashboard/dist`
- daemon 起在 `127.0.0.1:7777`（fake backend）
- Playwright 访问 `http://127.0.0.1:7777/`（same-origin）
- 覆盖：mint 路径 B（[`06`](06-dashboard-mvvm-and-basalt.md) §11 (b)）、CSP / security headers 全套断言（[`07`](07-dashboard-security-csp-and-xss.md) §11 L3 a/b/c）、XSS payload 显示为转义、Tokens secret modal happy path
- 这套 fixture 是 release 前的最终守门员

Playwright config 在两套 fixture 间共享 worker；CI 矩阵 job 分别跑（`l3-dev` / `l3-embed`）。

### 3.5 Test artifacts

- L1 dashboard：`apps/dashboard/coverage/`（vitest v8 默认）
- L1 daemon：`daemon/coverage.out`
- L2：`scripts/run-l2-output/` 含 daemon log + assertion log
- L3：`playwright-report/`（HTML + traces，CI 失败时 upload artifact）

---

## 4. L3 关键流（与 06 / 07 一致）

| Flow | Fixture | 来源 |
|------|---------|------|
| (a) 手输 token → /overview → agent exec → 看消息 | dev | [`06`](06-dashboard-mvvm-and-basalt.md) §11 (a) |
| (b) mint 路径 B（path B → setup-code → /overview） | **embed** | [`06`](06-dashboard-mvvm-and-basalt.md) §11 (b) |
| (c) 401 重定向（清 localStorage → 任意页 → /setup） | dev | [`06`](06-dashboard-mvvm-and-basalt.md) §11 (c) |
| (d) production embed response headers（CSP / nosniff / Referrer-Policy / COOP / CORP / Permissions-Policy） | **embed** | [`07`](07-dashboard-security-csp-and-xss.md) §11 L3 (a) |
| (e) XSS payload 显示为转义（agent envelope payload.content 含 `<script>...`） | embed | [`07`](07-dashboard-security-csp-and-xss.md) §11 L3 (b) |
| (f) Tokens secret modal：reveal / copy / close 后 DOM/storage/toast 不含 secret | embed | [`07`](07-dashboard-security-csp-and-xss.md) §11 L3 (c) |

---

## 5. Husky hooks

### 5.1 pre-commit（目标 < 30s，staged-aware）

`scripts/hooks/pre-commit.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. secret-scan（staged diff，快速）
pnpm exec gitleaks protect --staged --no-banner

# 2. staged 文件格式化检查（lint-staged 作为 devDependency 安装，**不**用 dlx）
pnpm exec lint-staged   # 对 staged TS 文件跑 biome check --write；对 staged Go 文件跑 gofmt -w

# 3. dependency-cruiser（apps/dashboard 范围；staged 涉及 src/**/*.ts 时跑）
if git diff --cached --name-only | grep -qE '^apps/dashboard/src/'; then
  pnpm --filter @meowth/dashboard exec dependency-cruiser --config apps/dashboard/.dependency-cruiser.cjs src
fi

# 4. source scan（07 §5.2）
if git diff --cached --name-only | grep -qE '^(apps/dashboard/src/|apps/dashboard/index\.html)'; then
  bash scripts/check-dashboard-source.sh
fi

# 5. D1 static check（03 §9.4）
if git diff --cached --name-only | grep -qE '^daemon/'; then
  bash scripts/check-no-prod-test-mix.sh
fi

echo "pre-commit: OK"
```

`lint-staged` 配置放在**根** `package.json`（或根 `.lintstagedrc.*`），按 repo 路径匹配，覆盖 `daemon/**/*.go` + `apps/dashboard/**/*.{ts,tsx}` + `packages/**/*.{ts,tsx}`；hook 在 repo root 执行 `pnpm exec lint-staged`：

```json
{
  "lint-staged": {
    "{apps,packages}/**/*.{ts,tsx}": ["biome check --write"],
    "daemon/**/*.go":                ["gofmt -w"]
  }
}
```

- `biome check --write` 是 Biome v1 当前的写回参数（早期版本曾用 `--apply`；Phase 2.4 实施时按 lock 的 Biome 版本核对，若官方改名再同步本配置）
- `gofmt -w` 直接把格式化结果写回文件，lint-staged 会自动 re-stage；用 `gofmt -l`（只列出未格式化文件）不会让 hook 红，不适合 gate

**显式不进 pre-commit**：

- `tsc --noEmit`：TypeScript 项目级 type-check，不可按 staged 文件单独跑（会丢失 cross-file 类型上下文）→ 放 pre-push
- `go vet`：Go vet 按 package 跑才可靠（对单个 .go 文件 vet 会因缺 sibling files 报假错）→ 放 pre-push
- 完整 `go test`、完整 `vitest run`、`go test -cover`、`dashboard build`、`osv-scanner`、`govulncheck`、L2、L3 → 放 pre-push / CI

### 5.2 pre-push（目标 < 3 min）

`scripts/hooks/pre-push.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. 项目级 type-check / vet（pre-commit 跳过的整 package 检查）
( cd daemon && go vet ./... )
pnpm --filter @meowth/dashboard typecheck   # 包内脚本：tsc --noEmit

# 2. 全量 L1（daemon Go + dashboard TS）
( cd daemon && go test ./... -count=1 )
pnpm --filter @meowth/dashboard test:run    # 包内脚本：vitest run

# 3. L2 daemon + fake backend
pnpm test:l2

# 4. G2 supply-chain
pnpm exec osv-scanner --lockfile pnpm-lock.yaml
( cd daemon && govulncheck ./... )

# 5. dist scan（07 §6.1）— 需要先 build
pnpm --filter @meowth/dashboard build
bash scripts/check-dashboard-dist.sh

echo "pre-push: OK"
```

**约定的 dashboard pnpm script**（Phase 2.7 落地；本文档统一引用）：

- `pnpm --filter @meowth/dashboard test:run`：`vitest run`（一次性跑，CI / pre-push 用）
- `pnpm --filter @meowth/dashboard test:watch`：`vitest`（开发用）
- `pnpm --filter @meowth/dashboard typecheck`：`tsc --noEmit`
- `pnpm --filter @meowth/dashboard build`：`vite build`
- `pnpm --filter @meowth/dashboard dev`：`vite`

### 5.3 CI 完整 gate

CI 跑 5.1 + 5.2 全部 + 以下额外项：

- L3 dev fixture
- L3 embed fixture
- 全量 daemon `go test -cover` + 覆盖率阈值断言（§6）
- 全量 dashboard `vitest run --coverage` + 覆盖率阈值断言
- `golangci-lint run`（pre-commit / pre-push 不跑；太慢）
- darwin matrix（§7）

---

## 6. 覆盖率阈值

### 6.1 实际门槛

- **daemon Go pkg**：≥ 95%（`daemon/cmd/...` 主入口豁免）
- **dashboard TS**：≥ 90%（page 薄壳豁免；与 [`docs/01-project-overview.md`](../01-project-overview.md) §9.2 Phase 3.25 commit 字面值一致）

实际 commit 落地的 commit 是 [`docs/01-project-overview.md`](../01-project-overview.md) §9.2 Phase 3.25：`chore: bump coverage thresholds to S-tier (daemon 95% / dashboard 90%)`。

overview §8 表写 "TS 行覆盖 ≥ 95%" 是早期遗留，**与本文档采用的 90% 不一致**；详 §14 #1 遗留勘误。

### 6.2 与 overview §8 表的差异（遗留勘误，**不在本 commit 处理**）

[`docs/01-project-overview.md`](../01-project-overview.md) §8 表写 "TS 行覆盖 ≥ 95%；Go pkg 覆盖 ≥ 95%"，但 §9.2 Phase 3.25 commit 写 "daemon 95% / dashboard 90%"。两个表数字不一致。

本文档采用 §9.2 Phase 3.25 的实际 commit 落地数字：**daemon 95% / dashboard 90%**。

§14 遗留勘误清单 #1 列此项；后续由独立 commit 修 overview §8 表与 §9.2 Phase 3.25 对齐（统一为 90% 或 95%），不在本 commit 范围。

### 6.3 报告产出

- daemon：`coverage.out` + `go tool cover -html` → HTML 报告（CI artifact）
- dashboard：`apps/dashboard/coverage/` HTML（CI artifact）
- CI 阈值断言：用 `scripts/check-coverage.sh` 读 coverage 数字、对比阈值、未达红 CI

---

## 7. CI matrix（GitHub Actions）

### 7.1 Runner 选择

- 主 runner：GitHub-hosted darwin runner（label 在 Phase 2.12 落地时确认；候选 `macos-14` / `macos-14-large` / `macos-15` / arm64 专用 label）。GHA 的 darwin runner 默认架构与 image 版本随时间变；本文档**不**写死 "macos-14 默认 arm64"，Phase 2.12 SDE 通过 `runs-on: <label>` + 一次 dry-run 工作流确认实际架构 + 资源
- darwin-amd64：用同一份 macOS runner 跑 `GOARCH=amd64 go build` 交叉编译断言（不在 amd64 native 上跑全套测试，CI 时间成本太高）；release 阶段在本机 MBP 上做 amd64 native smoke
- **不**用 ubuntu / windows runner（meowth darwin-only，[`docs/01-project-overview.md`](../01-project-overview.md) §6 已锁定）
- Fallback（若 GHA hosted darwin runner 不可用或资源不足）：自托管 MBP runner，label `self-hosted, darwin, arm64`；§13 #3 记录此项

Phase 2.12 commit 落地 `.github/workflows/ci.yml` 时**必须**：

1. 在 PR description 写明实际选定的 runner label 与 dry-run 输出（`uname -m` / `sw_vers`）
2. 至少跑一次 lint + l1 job，验证 runner 工作正常

### 7.2 工具版本

`.github/workflows/ci.yml` 配置：

- Node：22 LTS
- pnpm：11
- Go：**跟随 `daemon/go.mod`** 的 `go` 行（[`01`](01-agent-sdk-pump-from-multica.md) §7 决策规则；Phase 3.1 实测锁定；CI 用 `actions/setup-go@v5` + `go-version-file: daemon/go.mod`）
- Python：不需要
- Rust：不需要

### 7.3 Job 拆分

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  lint:           # G1 / static (Biome + tsc + gofmt + go vet + golangci-lint + dependency-cruiser + source-scan)
  openapi-drift:  # G1 — 重新跑 generate-types，断言产物与 commit 一致（详 §9）
  l1-daemon:      # daemon go test + cover gate
  l1-dashboard:   # dashboard vitest run --coverage + cover gate
  l2:             # scripts/run-l2.ts (daemon + fake backend)
  l3-dev:         # Playwright dashboardDevFixture
  l3-embed:       # Playwright dashboardEmbedFixture
  g2:             # osv-scanner + govulncheck
  dist-scan:      # build + scripts/check-dashboard-dist.sh
  secret-scan:    # gitleaks (full repo scan; pre-commit 只跑 staged)
```

各 job 并行；`lint` / `openapi-drift` / `l1-*` / `g2` / `secret-scan` 无依赖；`dist-scan` 依赖 `lint`（如果 lint 红则 build 也红，省 CPU）；`l3-*` 依赖 `dist-scan` 完成（embed fixture 需要 dist）。

### 7.4 Smoke job（opt-in，**不在默认 CI**）

`MEOWTH_CLI_SMOKE=1` env 触发的真实 CLI smoke job：

- 不在默认 CI 跑（GitHub runner 不预装 claude/codex/hermes/pi 等 CLI）
- 仅在本机 / release 前手工触发：`cd daemon && MEOWTH_CLI_SMOKE=1 go test ./test/cli-smoke/...`（pnpm script wrapper `pnpm test:smoke` 待 Phase 2.11 husky 接通时再定义；§10 同条触发说明）
- 该 job 跑 `daemon/test/cli-smoke/*` 下的 happy path，required real-smoke 集合 = `claude` / `codex` / `hermes` / `pi`（copilot 在 SDK 白名单内但暂未纳入真实 smoke，详 [`01`](01-agent-sdk-pump-from-multica.md) §10.1 P5 行）

自动化 CI gate **永远不**依赖真实 CLI 可用（[`01`](01-agent-sdk-pump-from-multica.md) §8 决策一致）。

---

## 8. D1 测试隔离接线

D1 三重校验由 [`03`](03-sqlite-schema-and-tokens.md) §9 定义。本文档接线两侧：

### 8.1 运行时校验

- daemon 内部 `OpenStoreForTest()` / `MEOWTH_TEST=1` 触发（[`03`](03-sqlite-schema-and-tokens.md) §9.1）；本文档**不**新增 build tag / 命令行 flag
- L2 测试 harness（§3.3）通过 env 进 test mode
- L1 daemon test 直接 import `daemon/internal/store` 并调 `OpenStoreForTest()`

### 8.2 静态校验

`scripts/check-no-prod-test-mix.sh`（[`03`](03-sqlite-schema-and-tokens.md) §9.4 已定义；本文档接线 G1 触发）：

- 内容**精确**按 [`03`](03-sqlite-schema-and-tokens.md) §9.4 规定：搜代码里 `~/.meowth-test/` 字面量是否仅出现在 test 文件、搜代码里 `~/.meowth/` 字面量是否仅出现在生产 home resolver；任一逆向出现 → CI 红
- 本文档**不**在此发明额外 DB marker 或路径命名

```bash
#!/usr/bin/env bash
set -euo pipefail

# `~/.meowth-test/` 字面量必须仅出现在 *_test.go 或 daemon/internal/home/test_resolver.go
violations=$(rg -n '~/\.meowth-test' daemon/ 2>/dev/null | rg -v '_test\.go|home/test_resolver\.go' || true)
if [ -n "$violations" ]; then
  echo "::error::~/.meowth-test/ literal in non-test file:"
  echo "$violations"
  exit 1
fi

# `~/.meowth/` 字面量必须仅出现在 daemon/internal/home/prod_resolver.go
violations=$(rg -n '~/\.meowth(/|"|$)' daemon/ 2>/dev/null | rg -v 'home/prod_resolver\.go' || true)
if [ -n "$violations" ]; then
  echo "::error::~/.meowth/ literal outside production home resolver:"
  echo "$violations"
  exit 1
fi

echo "D1 static check: OK"
```

挂在 G1 pipeline（pre-commit `daemon/` 涉及时 + CI）。

---

## 9. OpenAPI 一致性接线（02 §11）

[`02`](02-daemon-http-protocol.md) §11 已锁定：02 = 人类权威；`daemon/internal/server/openapi.yaml` = 机器权威；`packages/shared/` TS 类型从 yaml 生成、commit 进 git；daemon Go handler 手写。

本文档接线：

- **生成命令**：`pnpm --filter @meowth/shared generate-types`（内部用 `openapi-typescript`；具体工具选定 [`02`](02-daemon-http-protocol.md) §15 #2 决策）。该 pnpm script 在 [`docs/01-project-overview.md`](../01-project-overview.md) §9.2 Phase 3.7（`feat(daemon): chi router + healthz + token CRUD`）随 `openapi.yaml` 初版一起落地到 `packages/shared/package.json`；本文档**不**独立给该 script 起一个 phase 2 commit，避免与 Phase 3.7 重复
- **生成产物**：`packages/shared/src/wire.gen.ts`（commit 进 git）
- **drift 检测**：CI job `openapi-drift`（属 G1）— 重新跑 `pnpm --filter @meowth/shared generate-types`，若产物与已 commit 内容不同 → CI 红
- **L2 wire 一致性**：L2 harness 对每个端点响应做 JSON Schema 校验（schema 派生自 `openapi.yaml`）；不匹配 → 视为 daemon bug，L2 红

**对 06 §7.1 "wire types (manually authored or generated from openapi.yaml)" 的收紧**：本文档**以 02 §11 为准**——`packages/shared` 类型**必须**生成；06 文案"manual or generated"是早期残留，记入 §14 #2 遗留勘误。

---

## 10. 真实 CLI smoke 的 opt-in

[`01`](01-agent-sdk-pump-from-multica.md) §8 / [`02`](02-daemon-http-protocol.md) §13 / [`06`](06-dashboard-mvvm-and-basalt.md) §11 已经决定：5 backend 的自动 L2 / L3 全部用 fake backend；真实 CLI smoke 是 opt-in。

本文档接线：

- 真实 smoke 测试位置：`daemon/test/cli-smoke/`
- 触发：`cd daemon && MEOWTH_CLI_SMOKE=1 go test ./test/cli-smoke/...`（pnpm script wrapper `pnpm test:smoke` 待 Phase 2.11 husky 接通时再定义）
- 默认 CI：**skip**
- release 前由 SDE 在本机手动跑一次 4 backend happy path（claude / codex / hermes / pi；copilot 暂未在 smoke，详 [`01`](01-agent-sdk-pump-from-multica.md) §10.1 P5 行 + commit `0ca5cc9`）

### 10.1 实际已落地（截至当前）

- `daemon/test/cli-smoke/cli_smoke_test.go` 是真实 smoke 入口（commit `0ca5cc9` + amend）
- 硬约束已实现且经验证：
  - opt-in + required CLI 缺任一 → fast fail（不静默 partial-pass）
  - 复合验收：`Result.Status=="completed"` AND（`Result.Output` 非空 OR 至少一条非空 `MessageText`）
  - 失败 transcript 日志 "last N of M" 用真实 total 数
- `daemon/test/cli-smoke/cli_smoke_unit_test.go`（commit `a1c7019`）把上述负向 gate 固化为默认 L1 自动测试（12 个 test + 5 parametrized 子测），默认 `go test ./...` 可跑，不依赖任何真实 CLI
- 本机验证（截至 commit `0ca5cc9` amend 与 `a487f67` Pi error mapping fix 之后）：4/4 backend `Result.Status="completed"` + 非空 user-visible content
  - `claude` 2.1.183 (Claude Code)
  - `codex` codex-cli 0.140.0
  - `hermes` Hermes Agent v0.16.0 (2026.6.5)
  - `pi` 0.79.3

---

## 11. 测试落点：本文档自身的可测试性

08 本身不直接产出测试代码，但它的接线脚本与配置文件本身需要 G1 可测：

- `scripts/hooks/pre-commit.sh` / `pre-push.sh`：`bash -n` 语法检查 + `shellcheck` 静态分析
- `scripts/run-l2.ts`：`tsc --noEmit` + lint
- `scripts/check-*.sh`：`shellcheck` + fixture 反向测试（注入违规样本 → 脚本红）
- `.github/workflows/*.yml`：`actionlint` 静态校验

这些挂在 G1 lint job 内统一跑。

---

## 12. 原子化提交计划

08 的接线落地分散在 [`docs/01-project-overview.md`](../01-project-overview.md) §9.2 Phase 2 全部 12 个 commit（2.1–2.12）+ Phase 3.25 覆盖率提升 commit。

| Commit | Phase | 内容 |
|--------|-------|------|
| `chore(daemon): scaffold go module with meowthd entrypoint` | 2.1 | daemon module 初始；`go build` / `go vet` 绿 |
| `chore: add daemon shell tasks to turbo + root scripts` | 2.2 | 根 `package.json` `daemon:build` / `daemon:test`；turbo |
| `chore(daemon): G1 wiring (gofmt + go vet + golangci-lint)` | 2.3 | golangci-lint 配置；fail-sample 本地验证不入 commit |
| `chore(dashboard): G1 wiring (biome strict + tsc strict)` | 2.4 | Biome strict + tsc strict；fail-sample 本地验证不入 commit |
| `chore: husky + pre-commit (G1 placeholder)` | 2.5 | husky 安装；pre-commit 跑 G1 fast path（详 §5.1） |
| `test(daemon): L1 harness (go test + go-cover) with placeholder` | 2.6 | `daemon/pkg/.../foo_test.go` skipped；`go test ./...` 退 0 |
| `test(dashboard): L1 harness (vitest) with placeholder` | 2.7 | empty `*.test.ts`；`pnpm test` 退 0 |
| `test(daemon): L2 harness (scripts/run-l2.ts)` | 2.8 | `scripts/run-l2.ts` 起 hello-world daemon、ping `/healthz`、退 0；D1 测试路径 `~/.meowth-test/` 就位 |
| `test(e2e): L3 harness (playwright config + empty spec)` | 2.9 | Playwright config + 两套 fixture（§3.4）骨架；空 spec |
| `chore: G2 wiring (osv-scanner + gitleaks + govulncheck)` | 2.10 | pre-push 跑 G2 placeholder，全绿 |
| `chore: husky pre-push (L2 + G2)` | 2.11 | pre-push hook 接通；< 3min |
| `ci: github actions darwin matrix + 6DQ gates` | 2.12 | `.github/workflows/ci.yml` 含 §7.3 jobs；darwin matrix |
| `chore: bump coverage thresholds to S-tier (daemon 95% / dashboard 90%)` | 3.25 | §6 阈值强制；CI 阈值断言 |

每个 commit 自带必要测试 + G1/G2 hook 全绿 + 不留 TODO。

---

## 13. 未决问题

| # | 问题 | 决策方 | 状态 |
|---|------|-------|------|
| 1 | `MEOWTH_BACKEND_FACTORY=fake` 工厂注册具体形态（registry / context-injection / 全局 map）？v1 已锁定**不**用 build tag（§3.3.1），统一 runtime env + `MEOWTH_TEST=1` guard；剩下的是 Go 内部实现细节 | SDE 实施 Phase 2.8 时决定 | 待 Phase 2.8 |
| 2 | dashboard 覆盖率最终阈值 90%（已在 §6.1 采用）vs overview §8 表 95%：本文档采用 90%；overview §8 表与 Phase 3.25 commit 的 90% 不一致由 §14 #1 独立勘误 commit 处理 | @zheng-li 若希望 95%，需独立 commit 改 Phase 3.25 commit 名 + 本文档 §6.1 | 已采用 90%，待 overview §8 勘误 |
| 3 | GitHub-hosted darwin-arm64 runner 不可用时的 fallback：自托管 MBP runner（label `self-hosted, darwin, arm64`）？需要本机长期挂着 | @zheng-li 在 Phase 2.12 时决定 | 待 Phase 2.12 |
| 4 | osv-scanner medium/low 阈值：v1 是否容忍 medium 不容忍 high？或全部 0？倾向 critical/high=0、medium/low 允许但 PR 描述列出 | @zheng-li | 待 |
| 5 | `golangci-lint` 启用哪些 linter？v1 倾向：`errcheck`、`govet`、`ineffassign`、`staticcheck`、`unused`、`gosec`；不强求 `gocyclo` / `funlen` 等风格 linter | SDE 实施 Phase 2.3 时确定 | 已决：Phase 2.3 落为 6 linter（`errcheck` / `govet` / `ineffassign` / `staticcheck` / `unused` / `gosec`），版本钉 v2.12.2，通过 `pnpm daemon:lint`（内部 `go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2 run`），配置见 `daemon/.golangci.yml`，豁免 path-specific 最小化 |
| 6 | OpenAPI 工具链：`openapi-typescript` vs `openapi-zod`？[`02`](02-daemon-http-protocol.md) §15 #2 留给 @zheng-li | @zheng-li | 待 |

---

## 14. 遗留勘误清单（**只记录**，不在本 commit 补丁化前文）

08 在 wire 过程中观察到以下前文不一致；本文档作为接线层**仅记录**，后续由独立 commit 处理（每条都需要单独 review + 单独原子化 commit，CLAUDE.md 规则）：

| # | 涉及文档 | 不一致点 | 建议处置 |
|---|---------|---------|---------|
| 1 | [`docs/01-project-overview.md`](../01-project-overview.md) §8 表 vs §9.2 Phase 3.25 commit | TS 覆盖率写 95%，但 Phase 3.25 commit 写 dashboard 90%；本文档 §6 已采用 90% 为实际门槛 | 独立 commit：`docs(01): align dashboard coverage threshold to 90% (matches Phase 3.25)`；或 §13 #2 决定 95% 后改 Phase 3.25 commit |
| 2 | [`06`](06-dashboard-mvvm-and-basalt.md) §7.1 `models/types.ts` 注释 "manually authored or generated from openapi.yaml" | 与 02 §11 + 08 §9 决策"必须生成"不符 | 独立 commit：`docs(arch): tighten 06 to require generated wire types (per 02 §11 / 08 §9)` |
| 3 | [`02`](02-daemon-http-protocol.md) §12 middleware chain | 缺全局 nosniff middleware 与 HTML-only security_headers 的分层（07 §4.1 + 07 §13 #5 已记） | 在 Phase 3.10 commit 内联修，或独立勘误 commit |
| 4 | [`06`](06-dashboard-mvvm-and-basalt.md) §12 commit 3.16 文案 | 残留旧名 "sanitizer wrapper for agent stdout / messages"；07 §12 已用 "safe message renderer + logger redaction" | 独立 commit：`docs(arch): align 06 commit name with 07 (safe message renderer)`；或 Phase 3.16 实施时一并改 |
| 5 | [`docs/01-project-overview.md`](../01-project-overview.md) §8 Husky hooks 表 | "pre-commit = L1+G1；pre-push = L2+G2" 是简写；本文档 §2 / §5 实际把 L1 下移到 pre-push 以达成 < 30s pre-commit 目标 | 独立 commit：`docs(01): align Husky table with 08 (L1 moved to pre-push)` |

这些勘误**不**在本 1.9 commit 中处理；08 commit 只新增本文件 + 索引一行。

### 14.1 Phase 3.1 落地后的实际状态

截至 Phase 3.1 / cli-smoke / P6–P8 落地，上述 5 条 errata **仍未触发**，因为它们都关于尚未实施的 dashboard / HTTP / SQLite / hooks 范围；当这些 phase 真正开工时，需要在那一批 commit 里同步处理对应 errata。

Phase 3.1 落地另外引出的、**已在 doc alignment commit 中就地解决**的文档与实现 drift（不再保留为悬挂 errata）：

- `README.md` `Go >= 1.22` → `Go >= 1.26.1`（与 `daemon/go.mod` 对齐）
- [`01`](01-agent-sdk-pump-from-multica.md) §4.4 保留清单含 4 个 windows shim 但 P3.2 已删（cursor helper 同源被裁）
- [`01`](01-agent-sdk-pump-from-multica.md) §2.2 调研 SHA `c0c41fa0...` vs 实际 vendor SHA `4bbaf536...`（远端 HEAD 在两次之间前移；以 `UPSTREAM.md` 为权威）
- [`01`](01-agent-sdk-pump-from-multica.md) §7.3 / §11 #1 daemon Go 版本决策从"待定"标为"已锁 1.26.1"
- [`01`](01-agent-sdk-pump-from-multica.md) §10 新增 §10.1（实际落地 commit 链）与 §10.2（上游本地补丁清单）
- [`08`](08-6dq-hooks-wiring.md) §10 cli-smoke 触发命令与 4-backend 列表（copilot 暂未在 smoke）
- README 新增"实施状态"段说明已落地范围
- `daemon/pkg/agent/agent.go` `Session` godoc 对齐真实 contract（buffered Result，drain-then-read 安全；无 Messages-before-Result close 约束）→ Phase P8 内已处理

`daemon/pkg/agent/UPSTREAM.md` 是 vendored agent SDK 的本地补丁权威；任何 pump 时改动应先看那个文件，再决定是否同步到 [`01`](01-agent-sdk-pump-from-multica.md) §10.2。

---

## 15. 相关文档

- 上层：[`docs/01-project-overview.md`](../01-project-overview.md) §8 / §9.2 全 Phase
- 兄弟文档：本文档接线 01–07 全部测试要求
  - [`01`](01-agent-sdk-pump-from-multica.md) §8（L1/L2/L3 + CLI smoke opt-in）
  - [`02`](02-daemon-http-protocol.md) §11（OpenAPI 单一真相）、§13（L1/L2/L3 wire 测试）
  - [`03`](03-sqlite-schema-and-tokens.md) §9 / §11（D1 测试隔离三重校验、token / migration 测试）
  - [`04`](04-bootstrap-and-first-run-mint.md) §11（跨进程重启 / 浏览器来源门 / 崩溃残留）
  - [`05`](05-remote-access-modes.md) §10（启动期校验矩阵 / 外部转发警告）
  - [`06`](06-dashboard-mvvm-and-basalt.md) §11（L1 viewmodel + L3 两套 fixture）
  - [`07`](07-dashboard-security-csp-and-xss.md) §11（G1/G2/build/L1/L3 安全测试矩阵）
- 工作约束：[`../../CLAUDE.md`](../../CLAUDE.md)
