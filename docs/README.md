# Docs

Meowth 项目的编号文档目录。所有架构决策、功能设计、长任务规划在这里落地。

## 规范

- 文件命名:`NN-kebab-name.md`（两位编号 + 小写英文 + 横杠分隔）
- 编号用于排序,不代表优先级
- 每篇文档必含:设计细节 + 代码引用（文件路径） + 原子化提交计划 + 6DQ 质量计划
- 文档不含:工作量评估
- 本 README 实时维护下方索引

## 顶层文档

| 编号 | 文档 | 主题 |
|------|------|------|
| 01 | [01-project-overview.md](./01-project-overview.md) | 项目根本目的与定位（**先读这篇**） |

## 子目录

| 目录 | 用途 | 索引 |
|------|------|------|
| [`architecture/`](./architecture/README.md) | 系统架构设计（8 篇,Phase 1 文档已全部落地为代码） | 见目录 README |
| [`features/`](./features/README.md) | 功能迭代记录（端口迁移、新能力等） | 见目录 README |
| `archive/` | 已过时文档（待建） | — |

每个子目录维护各自的 `README.md` 索引,内部独立编号。

## 主题速查

| 你想…… | 入口 |
|---|---|
| 了解项目目标 + 整体架构 + Phase 计划 | [`01-project-overview.md`](./01-project-overview.md) |
| 5 家 backend SDK / agent vendor 策略 / pump 流程 | [`architecture/01`](./architecture/01-agent-sdk-pump-from-multica.md) |
| HTTP API 契约 / NDJSON 事件流 / 错误格式 | [`architecture/02`](./architecture/02-daemon-http-protocol.md) |
| SQLite schema / token / session / message 表结构 | [`architecture/03`](./architecture/03-sqlite-schema-and-tokens.md) |
| 首次启动 / `init` / `mint` / setup-code 流程与安全 | [`architecture/04`](./architecture/04-bootstrap-and-first-run-mint.md) |
| local / Tailscale / SSH tunnel / HTTPS proxy 远程暴露 | [`architecture/05`](./architecture/05-remote-access-modes.md) |
| Dashboard MVVM 分层 / basalt 设计系统 / 五页 + setup | [`architecture/06`](./architecture/06-dashboard-mvvm-and-basalt.md) |
| Dashboard 安全 / CSP / XSS sanitizer / Biome 规则 | [`architecture/07`](./architecture/07-dashboard-security-csp-and-xss.md) |
| 6DQ 测试体系 / husky hooks / CI matrix / 覆盖率门 | [`architecture/08`](./architecture/08-6dq-hooks-wiring.md) |
| 端口分配 / Caddy 域名 / Hexly 体系迁移 | [`features/01`](./features/01-port-migration-to-hexly-caddy.md) |
