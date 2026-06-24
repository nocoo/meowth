# Architecture

`docs/architecture/` 下放系统架构编号文档。命名 `NN-kebab-name.md`,每篇文档头部声明范围与上层依据。

## 索引

| # | 文档 | 主题 | 上层依据 |
|---|------|------|---------|
| 01 | [`01-agent-sdk-pump-from-multica.md`](01-agent-sdk-pump-from-multica.md) | 5 家 backend SDK vendor / 裁剪 / pump 上游流程 | `docs/01` §7.2、§9.2 Phase 3.1–3.2 |
| 02 | [`02-daemon-http-protocol.md`](02-daemon-http-protocol.md) | HTTP API 契约 / NDJSON 事件 envelope / 错误码 | `docs/01` §7.3、§9.2 Phase 3.6–3.12 |
| 03 | [`03-sqlite-schema-and-tokens.md`](03-sqlite-schema-and-tokens.md) | SQLite schema / argon2id / tokens / sessions / messages | `docs/01` §7.4、§9.2 Phase 3.3–3.4 / 3.6 |
| 04 | [`04-bootstrap-and-first-run-mint.md`](04-bootstrap-and-first-run-mint.md) | `init` / `bootstrap-token` / mint 端点 / loopback 安全 | `docs/01` §7.8、§9.2 Phase 3.5 / 3.8 |
| 05 | [`05-remote-access-modes.md`](05-remote-access-modes.md) | local / Tailscale / SSH tunnel / HTTPS proxy 四模式 + 启动期校验 | `docs/01` §7.7、§9.2 Phase 3.9 |
| 06 | [`06-dashboard-mvvm-and-basalt.md`](06-dashboard-mvvm-and-basalt.md) | dashboard MVVM 分层 + basalt 设计系统 + 6 个页面 | `docs/01` §7.5、§9.2 Phase 3.13–3.20 |
| 07 | [`07-dashboard-security-csp-and-xss.md`](07-dashboard-security-csp-and-xss.md) | CSP header / XSS sanitizer / Biome `noDangerouslySetInnerHtml` | `docs/01` §7.9、§9.2 Phase 3.10 / 3.15 / 3.16 / 3.24 |
| 08 | [`08-6dq-hooks-wiring.md`](08-6dq-hooks-wiring.md) | 6DQ 测试体系（G1/G2 + L1/L2/L3 + D1）+ husky / CI matrix | `docs/01` §8、§9.2 Phase 2.1–2.12 / 3.25 |

## 实施状态

Phase 1（文档定稿）+ Phase 2（harness 就位）+ Phase 3.1–3.25（TDD 实现）**全部落地**。当前所有 8 篇架构文档对应的代码均已实现:

- daemon 二进制 `daemon/meowthd` 自包含 + 内嵌 dashboard
- 5 家 backend（claude / codex / copilot / hermes / pi）端到端跑通
- HTTP API 9 个端点全实现,包含 bearer auth + 中间件链 + 安全 header + statics
- SQLite tokens / sessions / messages 持久化（sqlc 生成绑定）
- 4 种远程访问模式 + 启动期校验诊断
- dashboard 6 个页面 + Setup mint 两条路径
- husky pre-commit 跑 lint-staged（biome / gofmt staged 子集）;pre-push 跑 vet + tsc + L1 + 覆盖率 + L2 + G2

**仍未接入自动化**:L3 Playwright、D1 隔离扫描、CI matrix（GitHub Actions darwin runner）。这三项需要 release 前手动 `pnpm --filter @meowth/dashboard e2e` / `pnpm scan:d1` 跑;详 [`08`](08-6dq-hooks-wiring.md) §5.3。

## 跨文档约束

文档之间有依赖,改一处常需要联动:

- **02 §6.2 sessions 列表字段** ⇄ 03 schema ⇄ shared `openapi-types.ts`
- **04 §6.6 mint origin gate** ⇄ 06 §3.4 `useSetupViewModel` ⇄ features/01 §2.3 Caddy 约束
- **05 mode 启动期校验** ⇄ 04 §5.1 mint 端点挂载决策（mode 非 local 不挂载 mint）
- **07 CSP header** ⇄ daemon `internal/server/secheaders`(prod statics 生效;dev Vite 不注入)
- **08 D1 隔离** ⇄ `~/.meowth-test/` 路径（`MEOWTH_TEST=1` 切换）
