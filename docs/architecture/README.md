# Architecture

`docs/architecture/` 下放系统架构编号文档。命名 `NN-kebab-name.md`，每篇文档头部声明范围与上层依据。

## 索引

| # | 文档 | 上层依据 |
|---|------|---------|
| 01 | [`01-agent-sdk-pump-from-multica.md`](01-agent-sdk-pump-from-multica.md) | `docs/01-project-overview.md` §7.2、§9.2 Phase 3.1–3.2 |
| 02 | [`02-daemon-http-protocol.md`](02-daemon-http-protocol.md) | `docs/01-project-overview.md` §7.3、§9.2 Phase 3.6–3.12 |
| 03 | [`03-sqlite-schema-and-tokens.md`](03-sqlite-schema-and-tokens.md) | `docs/01-project-overview.md` §7.4、§9.2 Phase 3.3–3.4 / 3.6 |
| 04 | [`04-bootstrap-and-first-run-mint.md`](04-bootstrap-and-first-run-mint.md) | `docs/01-project-overview.md` §7.8、§9.2 Phase 3.5 / 3.8 |
| 05 | [`05-remote-access-modes.md`](05-remote-access-modes.md) | `docs/01-project-overview.md` §7.7、§9.2 Phase 3.9 |
| 06 | [`06-dashboard-mvvm-and-basalt.md`](06-dashboard-mvvm-and-basalt.md) | `docs/01-project-overview.md` §7.5、§9.2 Phase 3.13–3.20 |
| 07 | [`07-dashboard-security-csp-and-xss.md`](07-dashboard-security-csp-and-xss.md) | `docs/01-project-overview.md` §7.9、§9.2 Phase 3.10 / 3.15 / 3.16 / 3.24 |
| 08 | [`08-6dq-hooks-wiring.md`](08-6dq-hooks-wiring.md) | `docs/01-project-overview.md` §8、§9.2 Phase 2.1–2.12 / 3.25 |

Phase 1 文档全部就位。后续 architecture 文档（如 v2 设计）按需新增。

## 实施状态

主要已落地的是 01 对应的 agent SDK 底座（Phase 2.1 + Phase 3.1 / 3.2 + 后续 P5–P8 hardening；详 01 §10.1）；08 §10 的真实 CLI smoke / 负向 gate L1 已随 SDK 底座部分落地（commit `0ca5cc9` / `a1c7019`，详 08 §10.1）。02–07 以及 08 其余 hooks / CI 接线 / OpenAPI drift / coverage gates 等仍是文档定义，代码尚未实施。
